# Database Schema Design

**Status:** Core identity, membership, invitation, chat, discussion, snapshot, and index persistence is implemented.
**Scope:** This document records the approved data design. The current MongoDB field/collection shape and migration are summarized below; proposed fields not listed here remain future work. See [ARCHITECTURE.md](./ARCHITECTURE.md) for runtime flows.

## 0. As-built persistence model

The current application uses these collections and fields:

| Collection | Current fields and purpose |
|---|---|
| `users` | `email`, `normalizedEmail`, `name`, `passwordHash` (scrypt), `createdAt`. Unique `normalizedEmail` index. |
| `refreshSessions` | `userId`, hashed `tokenHash`, `expiresAt`, nullable `revokedAt`, `createdAt`, `lastUsedAt`, bounded `userAgent`. Unique token-hash and expiry/query indexes. |
| `organizations` | `name`, `createdBy`, `createdAt`. |
| `organizationMemberships` | `organizationId`, `userId`, `role` (`owner`, `admin`, `member`), `createdAt`; unique organization/user pair. |
| `projects` | `organizationId`, `name`, `createdBy`, `createdAt`. |
| `projectMemberships` | `projectId`, `userId`, `role` (`editor`, `viewer`), `createdAt`; unique project/user pair. |
| `invitations` | `email`, `role`, `targetType`, `targetId`, `invitedBy`, hashed `tokenHash`, `createdAt`, `expiresAt`. |
| `messages` | `projectId`, `author` (`id`, `name`), `body`, `createdAt`, optional `updatedAt`; indexed for project-scoped cursor paging. |
| `discussions` | `projectId`, `author`, line/text `anchor`, `body`, `status`, `createdAt`, `updatedAt`. |
| `snapshots` | `projectId`, `name`, source `code`, `createdBy`, `createdAt`. |

This implementation intentionally keeps user-facing names and selected text in the application documents. It does not yet include email verification, account status, refresh-session device management, slugs, archival state, reactions/replies, or activity events. Passwords are hashed with Node.js scrypt; refresh/invitation secrets are never persisted in raw form.

The startup migration in `backend/src/infrastructure/database/indexes.js` backfills `normalizedEmail` and copies legacy `organizations.members` / `projects.members` entries to the separate membership collections. It uses upserts and only unsets the embedded member array after the corresponding membership writes succeed. The migration also ensures each legacy project creator has editor membership. Review the migration behavior before changing legacy document shape.

## 1. Design goals

- Keep the schema aligned with the Identity, Organization Access, Project Management, and Communication bounded contexts.
- Keep user, membership, invitation, project, and message records in separate collections so unbounded lists do not grow inside one document.
- Enforce tenant boundaries in repository queries and application authorization, not only in the UI.
- Put unique constraints and useful query indexes in MongoDB.
- Store only password hashes and hashed refresh tokens; never store raw passwords or reusable bearer tokens.
- Keep presence and live Yjs synchronization distinct from durable application records.
- Start with one MongoDB database and a modular monolith; do not introduce extra databases or services prematurely.

MongoDB's flexible documents do not remove the need for explicit field validation, index management, and controlled schema evolution.

## 2. Identifier and document conventions

- Use MongoDB `ObjectId` for persisted `_id` fields in the first implementation. Serialize IDs as strings at HTTP/socket boundaries.
- Use UTC BSON dates for timestamps.
- Use camelCase field names consistently.
- Every mutable business document has `createdAt` and `updatedAt`; immutable message/session events have `createdAt`.
- Set timestamps on the server, not from client payloads.
- Validate request bodies before constructing domain values or repository documents.
- Add MongoDB collection validators for required fields, BSON types, enums, and maximum string sizes once collections are created.
- Do not return password hashes, refresh-token hashes, invitation token hashes, or internal security fields to clients.

## 3. Collections

### 3.1 `users` — Identity

```js
{
  _id: ObjectId,
  email: "person@example.com",          // display/canonical email
  normalizedEmail: "person@example.com",// trimmed and lower-cased lookup key
  displayName: "Jordan Lee",
  passwordHash: "...",                  // salted scrypt output in the current implementation
  status: "active",                     // active | disabled
  emailVerifiedAt: null,                // reserved for a later verification flow
  createdAt: Date,
  updatedAt: Date
}
```

Rules:

- Require and normalize email before persistence; `normalizedEmail` is the account identity for login.
- Enforce a unique index on `normalizedEmail`.
- Hash passwords with a maintained password-hashing function. The current implementation uses Node.js scrypt; reassess the work factor and algorithm before production deployment.
- Never log credentials or password hashes.
- Do not add a separate `username` identity unless a product behavior requires it; use `displayName` for display.
- Email verification is out of the first simple email/password flow. Do not collect SMTP credentials until verification or email invitations are implemented.

### 3.2 `refreshSessions` — Authentication session revocation

Implemented to support logout, token rotation, and revocation without waiting for a long-lived JWT to expire.

```js
{
  _id: ObjectId,
  userId: ObjectId,
  tokenHash: "...",                     // hash of a random opaque refresh token
  expiresAt: Date,
  revokedAt: null,
  createdAt: Date,
  lastUsedAt: Date,
  userAgent: "optional, bounded length"
}
```

Rules:

- Return a short-lived signed access JWT and a cryptographically random opaque refresh token.
- Persist only a hash of the refresh token. Rotate it when it is used; revoke the previous session token.
- Place refresh tokens in an `HttpOnly`, `Secure` (in production), `SameSite` cookie; keep access tokens short-lived.
- Add a TTL index on `expiresAt` for cleanup. TTL deletion is asynchronous and is not an authorization check: reject expired/revoked sessions in application code.
- Index `userId` and `tokenHash`; never accept a client-supplied user ID as authenticated identity.

The current implementation uses this collection. Access JWTs remain valid until their short expiry, while refresh-token rotation/revocation prevents future access-token renewal.

### 3.3 `organizations` — Organization Access

```js
{
  _id: ObjectId,
  name: "Northstar Studio",
  slug: "northstar-studio",
  createdBy: ObjectId,                  // UserId
  status: "active",                     // active | archived
  createdAt: Date,
  updatedAt: Date
}
```

### 3.4 `organizationMemberships` — Organization roles

```js
{
  _id: ObjectId,
  organizationId: ObjectId,
  userId: ObjectId,
  role: "owner",                        // owner | admin | member
  status: "active",                     // active | suspended
  addedBy: ObjectId,
  createdAt: Date,
  updatedAt: Date
}
```

Rules:

- One active membership per `(organizationId, userId)`; a unique compound index prevents duplicates.
- Each active organization must have at least one owner. Owner transfer/removal must be a dedicated application use case, not a generic role update.
- If an operation changes both the organization and membership records, use a MongoDB transaction. Use a replica-set deployment (including a single-node local replica set) for local integration tests that cover transactional owner changes.
- Do not embed an unbounded member array in the organization document.

### 3.5 `projects` — Project Management

```js
{
  _id: ObjectId,
  organizationId: ObjectId,
  name: "Aurora",
  slug: "aurora",
  description: "",
  createdBy: ObjectId,
  status: "active",                     // active | archived
  createdAt: Date,
  updatedAt: Date
}
```

Rules:

- Project belongs to exactly one organization.
- Enforce unique `(organizationId, slug)`.
- Slug normalization and collision handling are application behavior.
- Archived projects reject writes, chat sends, and collaboration joins; any read-only archive access must be an explicit policy.

### 3.6 `projectMemberships` — Project-level access

```js
{
  _id: ObjectId,
  projectId: ObjectId,
  userId: ObjectId,
  role: "editor",                       // editor | viewer
  addedBy: ObjectId,
  createdAt: Date,
  updatedAt: Date
}
```

Rules:

- One membership per `(projectId, userId)`, enforced with a unique compound index.
- Project creator receives an editor membership as part of project creation.
- A viewer can read project data but cannot edit code or send chat messages.
- Resolve effective access in one application policy/service used by HTTP, Socket.IO, and the Yjs collaboration entry point. Never trust a client-provided role.
- Organization owners/admins inherit project access; ordinary members require explicit project membership.

### 3.7 `invitations` — Organization/project invitations

Use one collection for invitations with a scope discriminator, rather than duplicate token handling in each feature.

```js
{
  _id: ObjectId,
  scope: "organization",                // organization | project
  organizationId: ObjectId,
  projectId: null,                      // set only for project invitation
  email: "person@example.com",
  normalizedEmail: "person@example.com",
  role: "member",                       // scoped role, validated against scope
  tokenHash: "...",                     // hash of a random, single-use token
  invitedBy: ObjectId,
  expiresAt: Date,
  acceptedAt: null,
  revokedAt: null,
  createdAt: Date
}
```

Rules:

- Never store the raw invitation token. Return it once through a future email/link delivery flow.
- Tokens are single-use, expire, and are bound to an email and one organization/project.
- Add unique `tokenHash`, lookup index on `(normalizedEmail, scope, organizationId, projectId)`, and TTL index on `expiresAt`.
- Do not implement invitation email delivery in the initial auth milestone; the first schema can support manually copied invite links later.

### 3.8 `chatMessages` — Communication (target naming; runtime uses `messages`)

The durable chat flow is implemented. Its current collection name and document fields are listed in section 0; this target shape is retained for future schema evolution.

```js
{
  _id: ObjectId,
  projectId: ObjectId,
  authorId: ObjectId,
  clientMessageId: "client-generated-uuid", // optional idempotency key
  text: "Let's review this change together.",
  createdAt: Date,
  updatedAt: null,
  deletedAt: null
}
```

Rules:

- Author ID and timestamps are assigned by the backend.
- Validate and cap message text length at the application boundary and database validator.
- Store a message before broadcasting its persisted representation.
- Use cursor-based pagination scoped by `projectId`; do not load an entire project history.
- Add unique `(projectId, authorId, clientMessageId)` when `clientMessageId` is present to make retries idempotent.
- Soft deletion may replace message text with a tombstone; select a retention policy before implementing edit/delete.

### 3.9 Later collections and implemented adjacent data

- The runtime `discussions` collection stores code-anchored decisions and open/resolved state. Replies/reactions are not implemented.
- The runtime `snapshots` collection stores named source-text snapshots.
- `documentSnapshots` or `documentUpdates`: Yjs recovery/persistence. Choose update log versus snapshots after defining recovery, retention, and compaction requirements.
- `activityEvents`: only if a durable, queryable project activity feed is required.

Presence, cursor positions, active selections, typing, and socket connection state are ephemeral and should not be stored in MongoDB.

## 4. Index plan

Create indexes from migrations/startup tooling and verify them in integration tests:

| Collection | Index | Purpose |
|---|---|---|
| `users` | unique `{ normalizedEmail: 1 }` | Account lookup and duplicate prevention |
| `refreshSessions` | `{ userId: 1, revokedAt: 1, expiresAt: 1 }` | List/revoke a user's active sessions |
| `refreshSessions` | unique `{ tokenHash: 1 }` | Refresh-token lookup |
| `refreshSessions` | TTL `{ expiresAt: 1 }` | Expired-session cleanup |
| `organizations` | unique `{ slug: 1 }` | Organization URL lookup; revisit if slugs should be non-global |
| `organizationMemberships` | unique `{ organizationId: 1, userId: 1 }` | Membership uniqueness and lookup |
| `organizationMemberships` | `{ userId: 1, status: 1, organizationId: 1 }` | List a user's organizations |
| `projects` | unique `{ organizationId: 1, slug: 1 }` | Project URL lookup within organization |
| `projects` | `{ organizationId: 1, status: 1, updatedAt: -1 }` | List active/recent projects |
| `projectMemberships` | unique `{ projectId: 1, userId: 1 }` | Membership uniqueness and authorization lookup |
| `projectMemberships` | `{ userId: 1, projectId: 1 }` | List a user's projects |
| `invitations` | unique `{ tokenHash: 1 }` | Secure token lookup |
| `invitations` | `{ normalizedEmail: 1, scope: 1, organizationId: 1, projectId: 1 }` | Pending invitation lookup |
| `invitations` | TTL `{ expiresAt: 1 }` | Expired invitation cleanup |
| `chatMessages` | `{ projectId: 1, createdAt: -1, _id: -1 }` | Project-scoped history pagination |
| `chatMessages` | unique partial `{ projectId: 1, authorId: 1, clientMessageId: 1 }` | Idempotent client retries |

Use the last index as a partial unique index for documents where `clientMessageId` exists. Confirm query plans against real access patterns before adding more indexes; every index increases write/storage cost.

## 5. Repository boundaries

Repositories should expose domain-specific operations, not MongoDB collections or generic CRUD to the domain:

```text
UserRepository
  findByNormalizedEmail(email)
  findById(userId)
  save(user)

RefreshSessionRepository
  create(session)
  findActiveByTokenHash(tokenHash, now)
  rotate(oldSessionId, newSession)
  revoke(sessionId, revokedAt)
  revokeAllForUser(userId, revokedAt)

OrganizationRepository
  findById(organizationId)
  save(organization)

OrganizationMembershipRepository
  findByOrganizationAndUser(organizationId, userId)
  listByUser(userId)
  save(membership)
  remove(organizationId, userId)

ProjectRepository
  findById(projectId)
  findByOrganizationAndSlug(organizationId, slug)
  listForOrganization(organizationId, cursor, limit)
  save(project)

ProjectAccessRepository
  getEffectiveRole(userId, projectId)
  addMember(projectId, userId, role)
  changeRole(projectId, userId, role)
  removeMember(projectId, userId)

ChatMessageRepository
  append(message)
  listByProject(projectId, beforeCursor, limit)
  findByProjectAndId(projectId, messageId)
```

Transactions are owned by application use cases through a unit-of-work/transaction port when a business invariant spans multiple writes. Do not pass MongoDB sessions into domain entities.

## 6. Authentication data flow

1. Registration normalizes email and validates password policy.
2. Application checks for an existing normalized email; the unique database index is the final concurrency guard.
3. Password hashing occurs before persistence; persist the hash only.
4. Login looks up by normalized email and verifies the password hash using a constant-time library operation.
5. On success, issue a short-lived signed access JWT and create a refresh session containing only the refresh token hash.
6. On refresh, verify and rotate the opaque refresh token, revoke the previous token, and issue a new access JWT.
7. On logout, revoke the current refresh session and clear its cookie.
8. Authorization derives user identity from a validated access token and project/organization role from repositories.

Recommended initial access token claims: `sub` (user ID), `iss`, `aud`, `iat`, `exp`, and `jti`. Do not put mutable organization/project roles in long-lived JWT claims; role changes must take effect through server-side authorization queries.

## 7. Environment configuration

### Needed for the first database/auth implementation

| Variable | Example/format | Notes |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas URI including the database name | Keep private. Use a dedicated least-privilege database user. URL-encode special characters in credentials. |
| `JWT_ACCESS_SECRET` | random secret, at least 32 bytes of entropy | Signing key for access JWTs. Generate locally; never commit or paste into chat. |
| `JWT_ACCESS_TTL` | `15m` | Short access-token lifetime; configuration must be parsed/validated. |
| `JWT_ISSUER` | `collaborative-code-workspace` | Validate issuer when verifying JWTs. |
| `JWT_AUDIENCE` | `collaborative-code-workspace-web` | Validate audience when verifying JWTs. |
| `PORT` | `3000` | Backend HTTP/Socket.IO port. |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Exact allowed browser origin for CORS and cookie policy. |
| `NODE_ENV` | `development` | Controls secure-cookie and logging behavior; do not use it as an authorization control. |

### Needed if the recommended refresh-session flow is selected

| Variable | Example/format | Notes |
|---|---|---|
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Lifetime of a refresh session; expiry is still validated in code. |
| `REFRESH_COOKIE_NAME` | `workspace_refresh` | Cookie name; use `HttpOnly`, `Secure` in production, and an appropriate `SameSite` policy. |

An opaque random refresh token does not need a JWT signing secret; only its hash is stored. This project uses that opaque rotating refresh-token approach, not JWT refresh tokens. Do not add a refresh signing secret.

### Not needed yet

- SMTP/email provider credentials: only needed when email verification or email-delivered invitations are implemented.
- Redis: only needed when scaling Socket.IO across multiple backend instances or introducing shared ephemeral coordination.
- S3/object storage: only needed for attachments or large durable artifacts.
- TURN credentials: only needed when WebRTC voice/video is implemented.
- Separate frontend API URL: add when deploying frontend/backend separately; local Vite can use a documented localhost URL/proxy.

Store local values in `backend/.env`, which must remain untracked. Commit only `backend/.env.example` with empty placeholders. In production, inject secrets through the hosting platform's secret manager. Restrict the Atlas network allowlist appropriately; do not use `0.0.0.0/0` for a production deployment.

Generate a signing secret locally with Node.js:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Do not send actual MongoDB URIs, passwords, JWT secrets, or production connection details in chat.

## 8. Schema evolution and local development

- Keep collection creation, validators, and indexes in versioned migrations or a deterministic database setup command.
- Avoid silently relying on Mongoose `autoIndex` in production. Index creation should be explicit and observable.
- Use a local MongoDB replica set or Atlas for integration tests involving transactions.
- Make database startup fail clearly if required configuration is missing or connection fails; do not start an apparently healthy API with a broken database dependency.
- Include a readiness check that verifies the database after persistence is introduced. Liveness should only report process health.
- Keep `.env`, dumps, and test secrets out of Git.
- Test unique-index races, invalid documents, transaction rollback, pagination boundaries, and migration repeatability.

## 9. Implementation status and next work

Completed for the current phase: environment parsing, MongoDB singleton lifecycle, startup membership/email migration, indexes, domain-specific repositories, short-lived JWT and rotating hashed refresh sessions, organization/project authorization, durable chat, and tests for the core data/access paths.

Next database work should add collection validators and versioned migrations, test migration/index behavior against a real MongoDB instance, define transaction behavior for multi-document invitation/owner changes, and decide retention/recovery semantics for Yjs document history. Keep repository operations scoped by the authorized project/organization.

The target schema above includes future fields and collection names; section 0 is the source of truth for what is currently persisted.

## 10. Confirmed decisions

These decisions were confirmed for the initial design:

1. **Token lifecycle:** short-lived access JWT plus opaque, rotating refresh token stored hashed in `refreshSessions`.
2. **Browser storage:** refresh token in an `HttpOnly` cookie and short-lived access token held in memory; no bearer token in `localStorage`.
3. **Project access:** project creator receives editor membership; organization owners/admins inherit project read/write access; ordinary organization members need explicit project membership.
4. **Slugs:** globally unique organization slug and organization-scoped project slug.
5. **Database scope:** initial database layer includes chat message schema, indexes, and repository persistence tests. Chat routes/use cases/live delivery come after authentication and project authorization are implemented and tested.
