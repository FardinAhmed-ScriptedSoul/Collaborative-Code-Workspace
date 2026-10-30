# Architecture and Implementation Guide

This document describes the application that is currently in the repository. The longer-term design and roadmap are in [SYSTEM_DESIGN.md](./SYSTEM_DESIGN.md) and [PROJECT_ROADMAP.md](./PROJECT_ROADMAP.md).

## System boundaries

The project is a modular monolith: one Express process serves HTTP and Socket.IO, one MongoDB database stores durable application records, and the React client owns presentation state.

```text
React app
  ├─ HTTP API ────────────────┐
  ├─ Socket.IO chat/signaling ├── Express + Socket.IO ── MongoDB
  └─ y-socket.io/Yjs ─────────┘          │                ├─ repositories
                                        └─ access policy  ├─ users/sessions
                                                         ├─ orgs/projects/memberships
                                                         ├─ invitations
                                                         └─ chat/discussions/snapshots
WebRTC media travels peer-to-peer; Socket.IO only relays signaling.
```

In local development Vite proxies `/api`, `/socket.io/`, and health requests to the backend. In Docker, Nginx provides the same-origin proxy. Keeping one browser origin avoids a separate API URL and allows the refresh cookie to stay HttpOnly.

## Backend structure and patterns

- `src/server.js` is the composition root. It loads configuration, opens the singleton MongoDB connection, runs migrations/index setup, creates repositories and the project-access service, then wires HTTP and real-time transports.
- `src/app.js` configures Express middleware and maps HTTP routes to feature modules.
- `src/modules/` contains the auth, organization, project, invitation, and collaboration route modules. Route handlers validate transport input and orchestrate use cases; they do not choose collection names or issue MongoDB queries.
- `src/infrastructure/database/mongoDatabase.js` owns one process-wide connection promise. Concurrent callers share the connection. A conflicting URI/database name is rejected; connection failure clears the promise for a later retry; shutdown closes the client.
- `src/infrastructure/database/repositories.js` is the MongoDB adapter. It exports domain-oriented operations for users, organizations, projects, invitations, refresh sessions, and collaboration data. Project/organization membership queries are kept inside these repositories.
- `src/modules/projects/access.js` centralizes effective project authorization and is injected into both HTTP and Socket.IO/Yjs handlers.
- `src/infrastructure/database/indexes.js` performs the idempotent backfill from embedded memberships and legacy email fields, then creates unique/query/TTL indexes.

The repository pattern keeps feature handlers from depending on MongoDB query syntax. Tests can exercise the route layer with in-memory collection adapters, while repository tests check that persistence operations and migration behavior match the model.

## Identity and session lifecycle

1. Registration lowercases/normalizes email, validates the name/password, stores a salted scrypt password hash, and creates a refresh session.
2. Login looks up the normalized email and verifies the password hash.
3. Both flows return a short-lived access JWT (15 minutes by default) and set a random refresh token in an HttpOnly cookie. The raw refresh token is never stored in MongoDB; only its SHA-256 hash is stored.
4. The frontend keeps the access token in a module-level in-memory store, never `localStorage`. It refreshes on startup and before expiry. API requests also retry once after a 401 by rotating the refresh token.
5. Refresh is an atomic token-hash swap constrained by unrevoked, unexpired state. Replaying a rotated token fails. Logout revokes the current refresh session and expires the cookie.

The cookie uses `SameSite=Lax`, `Path=/api/auth`, and `Secure` in production. CORS allows credentials only for configured exact origins. Access-token claims include issuer, audience, issued/expiry times, subject, and a random token ID. Organization/project roles are not embedded in JWTs; authorization reads current membership records.

## Membership model and access rules

Memberships are separate documents to avoid unbounded arrays:

- `organizationMemberships`: one record per organization/user, role `owner`, `admin`, or `member`.
- `projectMemberships`: one record per project/user, role `editor` or `viewer`.

Effective access follows one policy:

1. Organization owners/admins inherit editor access to projects in their organization.
2. Other organization members need explicit project membership.
3. An explicit project editor may edit; a viewer may read but cannot edit code, create/resolve discussions, send chat, or create snapshots.
4. The project creator is given an editor membership when the project is created.
5. Every HTTP operation, Socket.IO room join/write, and Yjs room/update is authorized server-side. The client-provided project ID, room name, and display-name/presence fields are never trusted as role claims.

The migration reads legacy `members` arrays and `email` fields, upserts their normalized membership/email records, and removes the embedded arrays only after each document's memberships were copied. Re-running startup is safe: upserts do not overwrite existing membership records and already-migrated fields are absent from the source query.

## Persistence and state ownership

| Record/state | Owner | Lifecycle |
|---|---|---|
| User and password hash | MongoDB `users` repository | Durable; normalized email is unique. |
| Refresh session | MongoDB `refreshSessions` repository | Durable, hashed token, rotated/revoked in code; TTL index is cleanup only. |
| Organization/project memberships | MongoDB membership repositories | Durable; unique compound indexes enforce one membership per pair. |
| Invitations | MongoDB `invitations` repository | Durable until consumed/expired; raw invitation token is returned once and never stored. |
| Chat messages | MongoDB collaboration repository | Durable, project-scoped cursor pagination; persisted before live broadcast. |
| Discussions/snapshots | MongoDB collaboration repository | Durable; discussions store selected line/text anchors, snapshots store code and creator metadata. |
| Presence/cursors/peer state | Socket.IO/Yjs awareness | Ephemeral; discarded on disconnect. |
| Collaborative editor document | Yjs via `y-socket.io` | Separate from chat/history. Optional LevelDB persistence is controlled by `YPERSISTENCE`; it is not a named code snapshot. |
| Audio/video | WebRTC peer connections | Media is not routed through Express/Socket.IO; Socket.IO carries signaling only. |

## HTTP surface

All routes below are served under the backend origin. Private routes require `Authorization: Bearer <access-token>`.

| Route | Behavior |
|---|---|
| `POST /api/auth/register` | Register, create refresh session, return access token. |
| `POST /api/auth/login` | Authenticate and create a refresh session. |
| `POST /api/auth/refresh` | Rotate the HttpOnly refresh cookie and issue a new access token. |
| `POST /api/auth/logout` | Revoke refresh session and clear cookie. |
| `GET /api/auth/me` | Return the authenticated user's public profile. |
| `GET, POST /api/organizations` | List accessible organizations / create an organization with its owner membership. |
| `POST /api/organizations/:id/members` | Add a registered user as an organization admin/member; requires owner/admin. |
| `GET, POST /api/projects` | List accessible projects / create a project under an organization. |
| `GET /api/projects/:id` | Read project and effective role. |
| `POST /api/projects/:id/members` | Set a registered user's editor/viewer role; requires organization owner/admin. |
| `POST /api/projects/:id/edit-check` | Server-side editor permission check. |
| `GET, POST, PATCH, DELETE /api/projects/:id/messages` | Read paged history, create, edit, or delete project chat messages. |
| `GET, POST, PATCH /api/projects/:id/discussions` | Read, create code-anchored discussion, or change its open/resolved state. |
| `GET, POST /api/projects/:id/snapshots` | List/create named code snapshots; `GET .../:snapshotId` reads snapshot code. |
| `POST /api/invitations/organizations/:id` | Create organization invitation link. |
| `POST /api/invitations/projects/:id` | Create project invitation link. |
| `POST /api/invitations/accept` | Accept a single-use invitation bound to the authenticated email. |
| `GET /health`, `GET /health/ready` | Liveness and MongoDB readiness. |

Chat history is cursor-paged with `before` and `limit`; page size is capped at 100. Message and snapshot payloads have explicit size limits. Relevant project writes emit Socket.IO events only after persistence succeeds.

## Real-time collaboration

- Socket.IO connections are authenticated with an access JWT.
- `project:join` resolves current effective project access before the socket joins the internal `project:<ObjectId>` room.
- `chat:send` rechecks access and editor role, enforces a per-socket rate limit, persists the message through the repository, then broadcasts it.
- WebRTC signals are relayed only between sockets already in the same authorized project room and are size-limited.
- Yjs namespaces validate the token and project identity and authorize project membership before synchronization. Yjs `sync-update` events are rejected for viewers.

The current Socket.IO room state is process-local. Horizontal scaling requires a shared Socket.IO adapter and an appropriate shared/persistent Yjs backend.

## Configuration and local checks

Copy `.env.example` to `.env` for Compose or `backend/.env.example` to `backend/.env` for a local backend. Set a random `JWT_ACCESS_SECRET` of at least 32 characters. The other security-relevant settings are `JWT_ACCESS_TTL`, `JWT_ISSUER`, `JWT_AUDIENCE`, `REFRESH_TOKEN_TTL_DAYS`, and exact `ALLOWED_ORIGINS`.

Run the backend tests with `cd backend; npm test`. Run frontend tests, lint, and build with `cd frontend; npm test; npm run lint; npm run build`. The backend suite covers configuration, singleton lifecycle, repository/migration behavior, auth/session rotation, project access, invitation behavior, REST collaboration, Socket.IO/Yjs sync, and readiness.

## Current gaps

- Password hashes currently use Node's salted scrypt implementation; email verification and password reset are not implemented.
- Membership invitation links are returned to the caller; email delivery and invitation management/revocation UI are not implemented.
- Organization/project removal, role revocation UI, and project archival are not implemented.
- Named snapshots are code copies; Yjs CRDT update history/recovery is separate and does not restore from a named snapshot.
- The WebRTC implementation uses public STUN only and has not been validated for production networks, larger calls, or TURN/SFU deployment.
- The app is designed for one backend instance; distributed socket coordination, production metrics/export, backups, and deployment automation beyond the local Docker/CI setup remain follow-ups.
