# Collaborative Code Workspace — System Design

**Status:** Approved target design; implementation status is summarized below.
**Scope:** Architecture decisions and target boundaries. For exact runtime behavior, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## 1. Purpose and design approach

The product is a multi-tenant workspace where a team can collaboratively edit code, discuss work in project chat, and retain decisions alongside the code they concern. Organization and project membership determine who can access that work.

The design uses:

- **Behavior-first development:** define observable user and system behavior, examples, and failure cases before designing handlers or schemas.
- **Domain-driven design:** model the business concepts and invariants explicitly; organize code around bounded contexts rather than technical layers alone.
- **Repository pattern:** application/domain logic depends on domain-specific repository contracts. Infrastructure adapters implement those contracts using MongoDB or another selected store.
- **Modular monolith first:** keep one deployable backend with explicit module boundaries. Extract services only when measured scale or independent operational needs justify it.

“Repository” here means a persistence abstraction in the application architecture. It does not mean a Git repository or source-control feature.

## 2. Current state versus target

The current implementation is a single-instance modular monolith with:

- React/Vite/Monaco UI, authenticated workspace, and an in-memory access-token client.
- Express HTTP APIs, a process-wide MongoDB connection singleton, domain-specific Mongo repository adapters, and startup backfill/index management.
- Separate organization/project membership collections and server-side effective-access policy.
- Socket.IO/Yjs project collaboration, persisted/paged chat, code-anchored discussions, source-text snapshots, and a basic WebRTC peer-call prototype.
- Docker Compose, GitHub Actions, health/readiness endpoints, and backend/frontend automated tests.

The implementation is not production-certified. Current gaps include email verification/password reset, transaction-backed multi-document workflows, collection validators/versioned migration tooling, Yjs update restore guarantees, distributed Socket.IO/Yjs coordination, TURN/SFU, backups, and deployment monitoring. See [ARCHITECTURE.md](./ARCHITECTURE.md) and [PROJECT_ROADMAP.md](./PROJECT_ROADMAP.md) for as-built details and remaining work.

Security boundaries already apply: display names and room/project identifiers are not authorization credentials; HTTP and socket operations resolve current roles from MongoDB; durable chat is separate from ephemeral presence; Yjs persistence is separate from named source snapshots.

## 3. Product boundary and actors

### Actors

- **Visitor:** unauthenticated person who can register or sign in.
- **Organization owner/admin:** manages the organization, memberships, and projects.
- **Project editor:** reads and edits project code and participates in project discussions.
- **Project viewer:** reads project code and discussions but cannot edit code or send messages.
- **System:** authenticates requests, authorizes access, persists durable state, and distributes live updates.

An organization owner/admin receives project access through organization membership unless a project is explicitly archived or otherwise restricted. Project roles are editor and viewer. Keep this initial policy small and make any inheritance behavior explicit in authorization tests.

### First release boundary

1. Authenticated accounts and refreshable/revocable sessions.
2. Organizations, projects, invitations/membership, and role enforcement.
3. Live collaborative editor and online presence scoped to an authorized project.
4. Durable project chat with live delivery.
5. Code-anchored discussions and named source snapshots.
6. Optional experimental peer-to-peer audio/video.

## 4. Domain model

Use stable opaque identifiers (`UserId`, `OrganizationId`, `ProjectId`, `MessageId`, etc.). Do not use display names, room names, or client-supplied values as authorization keys.

### Bounded contexts

| Context | Owns | Core behaviors |
|---|---|---|
| Identity | User, credential/session | Register, authenticate, revoke a session, retrieve current user. May later delegate to a managed identity provider. |
| Organization Access | Organization, organization membership, invitation | Create organization, invite/remove members, assign organization role, determine organization-level access. |
| Project Management | Project, project membership, project lifecycle | Create/archive project, grant/revoke project role, resolve effective access. |
| Collaboration | Project document identity, live Yjs session, participant presence | Authorize room join, synchronize editor updates, publish ephemeral awareness, persist/recover document state when that capability is added. |
| Communication | Project chat messages | Send, page through, edit or delete a message according to policy, broadcast accepted changes. |
| Contextual Discussion (later) | Code-anchored thread, replies, resolution state | Create and resolve a thread anchored to a document position; retain useful context as code changes. |

These are logical boundaries within a modular backend, not a requirement for separate databases or deployables.

### Aggregates and invariants

- **Organization** is the consistency boundary for organization settings and owner-level operations. It must always have at least one owner.
- **OrganizationMembership** is unique for `(organizationId, userId)`. A user can be an owner, admin, or member within an organization.
- **Project** belongs to exactly one organization. Archived projects reject new write operations.
- **ProjectMembership** is unique for `(projectId, userId)`. The role is editor or viewer. Effective access must account for organization-level owner/admin rules.
- **ChatMessage** belongs to one project and has a server-assigned author, ID, and creation time. A client cannot impersonate another author or choose trusted timestamps.
- **Presence** is ephemeral and scoped to one authorized collaboration room. Presence is not a durable membership record.
- **Document state** is scoped to one project/document identity. It is not a chat message and must not be conflated with MongoDB chat persistence.

Avoid one giant `User` or `Project` aggregate containing every chat message and document update. Keep aggregates small and enforce cross-aggregate policies in application services backed by explicit authorization queries.

### Initial role policy

| Action | Organization owner/admin | Project editor | Project viewer |
|---|---:|---:|---:|
| Manage organization members | Yes | No | No |
| Create/archive organization projects | Yes | No | No |
| Read project and chat | Yes | Yes | Yes |
| Edit collaborative code | Yes | Yes | No |
| Send project chat messages | Yes | Yes | No |
| Manage project membership | Yes | No, unless explicitly granted later | No |

Organization members do not automatically get access to every project unless the product explicitly adopts that policy. The initial implementation should grant project membership at project creation to the creator and verify effective access in one authorization service.

## 5. Behavior-first workflow

For each feature, work in this order:

1. Write user-visible scenarios, including denied and failure cases.
2. Agree on the domain rule/invariant each scenario demonstrates.
3. Define the application use case and its input/output.
4. Define the repository and external-service ports that use case needs.
5. Implement domain/application behavior and test it without a database or socket server.
6. Implement infrastructure adapters and integration tests.
7. Connect HTTP/socket/UI surfaces and verify the end-to-end behavior.

Example acceptance scenarios:

```gherkin
Feature: Project access
  Scenario: An editor joins their project editor
    Given the user has an active session
    And the user is an editor of the project
    When the user joins the project's collaboration room
    Then the server authorizes the room join
    And the user receives the current document state

  Scenario: A non-member cannot join a private project
    Given the user has an active session
    And the user is not a member of the project
    When the user requests to join its collaboration room
    Then the server rejects the request
    And no document data or room events are sent to the user

Feature: Project chat
  Scenario: An editor sends a message
    Given the user is an editor of the project
    When the user sends a valid message
    Then the server stores it with a server-generated ID and timestamp
    And the server broadcasts the stored message to authorized project members

  Scenario: A viewer attempts to send a message
    Given the user is a viewer of the project
    When the user sends a message
    Then the request is rejected
    And no message is stored or broadcast
```

Acceptance scenarios should be executable as API/socket integration tests where practical. UI tests should verify that the user can discover the behavior and understand errors; they do not replace backend authorization tests.

## 6. Backend architecture and repository pattern

Use a modular monolith organized by business capability:

```text
backend/src/
  config/                 # environment parsing and dependency composition
  shared/
    errors/
    http/
    validation/
  modules/
    identity/
      domain/
      application/
      infrastructure/
      http/
    organizations/
      domain/
      application/
      infrastructure/
      http/
    projects/
      domain/
      application/
      infrastructure/
      http/
    collaboration/
      application/
      infrastructure/
      sockets/
    chat/
      domain/
      application/
      infrastructure/
      http/
      sockets/
  app.js
  server.js
```

The exact folders should be introduced when a module has real behavior; do not generate empty architecture folders in advance.

### Dependency direction

```text
HTTP / Socket.IO adapters
          |
          v
Application use cases -----> Domain model and policies
          |                             ^
          v                             |
Repository/service ports <--- Infrastructure adapters
                                      (MongoDB, Yjs, Socket.IO)
```

- Domain code must not import Express, Socket.IO, MongoDB, or React.
- Application use cases coordinate domain behavior, authorization, and repository calls.
- Inbound adapters parse/validate input, call use cases, and translate outcomes into HTTP responses or socket acknowledgements.
- Infrastructure adapters implement repository ports and external-service ports.
- Composition at startup supplies adapter implementations to use cases.

### Repository contracts

Define repository interfaces around aggregate or query needs, not generic CRUD methods for every collection. Illustrative contracts:

```text
OrganizationRepository
  findById(organizationId)
  save(organization)

ProjectRepository
  findById(projectId)
  save(project)
  listAccessibleTo(userId, organizationId, page)

ProjectAccessRepository
  getEffectiveRole(userId, projectId)
  addMember(projectId, userId, role)
  removeMember(projectId, userId)

ChatMessageRepository
  append(message)
  listByProject(projectId, beforeCursor, limit)
  findById(projectId, messageId)
```

Use a separate read/query service for pagination, dashboards, or joins when those needs do not map naturally to aggregate repositories. Do not expose raw MongoDB documents to domain or UI code. Repositories return domain entities/value objects or explicit read models.

For chat delivery, the application use case validates authorization and content, stores the message, then publishes the persisted message. Clients fetch missed messages using a stable cursor after reconnect. If reliable publication across process crashes becomes necessary, introduce an outbox; do not add it before the delivery guarantee requires it.

## 7. Data and persistence

### Initial storage proposal

MongoDB is a reasonable initial persistence choice for accounts, organizations, memberships, projects, chat messages, and discussion threads. Use explicit collection schemas, unique indexes, validation, and migration/index-management procedures. The design is storage-adapter-based, so domain behavior should not depend on MongoDB-specific semantics.

Suggested collections:

| Collection | Important fields and indexes |
|---|---|
| `users` | normalized unique email, password hash or external identity subject, created/updated times |
| `sessions` | user ID, hashed opaque token/session ID, expiry, revoked time; TTL index where appropriate |
| `organizations` | name, owner/member references or separately modeled memberships, status |
| `organizationMemberships` | unique `(organizationId, userId)`, role, status |
| `projects` | organization ID, name, status, created by |
| `projectMemberships` | unique `(projectId, userId)`, role |
| `chatMessages` | project ID, message ID, author ID, text, created/edited/deleted times; compound `(projectId, createdAt, _id)` index for history |
| `discussionThreads` (later) | project ID, anchor metadata, author, status, timestamps |

Keep membership in a separate collection initially to avoid growing organization/project documents without bound. Optimize read models later using measured query patterns.

### Ephemeral versus durable state

| State | Lifecycle / store |
|---|---|
| Login/session state | Durable with expiry/revocation; store only hashed session secrets if using opaque sessions. |
| Organization/project configuration and memberships | Durable MongoDB documents. |
| Chat and contextual discussions | Durable MongoDB documents. |
| Presence, cursor, selection, typing | Ephemeral awareness/Socket.IO state; remove on disconnect/expiry. |
| Live collaborative document | Yjs CRDT state transported over Socket.IO. Choose persistence independently: persist binary Yjs updates or periodic snapshots plus update log, and test recovery before claiming durable editor history. |
| Voice/video media | WebRTC peer media; Socket.IO carries signaling/control, not media streams. |

Yjs persistence should be its own design decision. MongoDB can store binary updates/snapshots, but a dedicated persistence adapter or service may be preferable as usage grows. Define document retention, snapshot cadence, compaction, backup, and recovery behavior before enabling production persistence.

## 8. HTTP and real-time interfaces

Use versioned HTTP routes for durable operations and Socket.IO for low-latency events. Exact names may evolve; behavior and authorization are the contract.

### Candidate HTTP API

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/me

POST   /api/v1/organizations
GET    /api/v1/organizations
POST   /api/v1/organizations/:organizationId/invitations
PATCH  /api/v1/organizations/:organizationId/members/:userId
DELETE /api/v1/organizations/:organizationId/members/:userId

POST   /api/v1/organizations/:organizationId/projects
GET    /api/v1/organizations/:organizationId/projects
GET    /api/v1/projects/:projectId
POST   /api/v1/projects/:projectId/members
PATCH  /api/v1/projects/:projectId/members/:userId

GET    /api/v1/projects/:projectId/messages?before=...
POST   /api/v1/projects/:projectId/messages
PATCH  /api/v1/projects/:projectId/messages/:messageId
DELETE /api/v1/projects/:projectId/messages/:messageId
```

Use consistent error responses with a stable machine-readable code, human-readable message, and request ID. Validate IDs, lengths, enum values, pagination cursors, and payload shape at the boundary.

### Candidate Socket.IO events

Client to server:

```text
project:join       { projectId }
project:leave      { projectId }
chat:send          { projectId, clientMessageId, text }
```

Server to client:

```text
project:joined     { projectId, role }
project:error      { code, message, requestId }
chat:message       { message }
chat:messageEdited { message }
chat:messageDeleted { projectId, messageId }
```

Yjs provider synchronization uses its supported protocol but must share the same authentication and project authorization boundary. Socket event names are illustrative; avoid creating two independent membership/auth systems for regular Socket.IO events and Yjs room joins.

### Realtime authorization flow

1. Client establishes a Socket.IO connection with an authenticated session/token.
2. Server validates the credential and resolves a `UserId`; do not accept `userId` or role as trusted client fields.
3. Client requests a project join using `ProjectId`.
4. Server calls the project access use case and checks active project/organization state.
5. If allowed, server joins the internal room derived from the validated project ID and returns the effective role.
6. Every write event is independently validated and authorized; joining once is not a permanent authorization grant.
7. On revocation, disconnect or remove the member from relevant rooms and reject subsequent operations.

In a multi-instance deployment, Socket.IO room coordination needs a shared adapter (for example Redis) and Yjs document synchronization needs a compatible shared/persistent backend. One process-local room is not sufficient for horizontal scaling.

## 9. Frontend architecture

Organize the client by user-facing capability while keeping domain rules on the backend:

```text
frontend/src/
  app/                 # router, providers, app shell
  features/
    auth/
    organizations/
    projects/
    collaboration/     # editor, presence, collaboration connection
    chat/
    discussions/       # later
  shared/
    api/               # HTTP client, error decoding
    components/
    hooks/
```

The frontend owns presentation state and connection lifecycle; it does not decide access. It should:

- Render only actions allowed by the server-provided effective role, while still handling server denial safely.
- Keep HTTP query/mutation state distinct from ephemeral socket/Yjs state.
- Reconnect and fetch missed durable chat using a cursor.
- Show explicit loading, disconnected, reconnecting, permission-denied, and failed states.
- Avoid placing provider, editor, form, and all workspace state in one root component.

## 10. Security and privacy requirements

- Use a maintained authentication/session design; hash passwords with a modern password-hashing algorithm if passwords are stored.
- Authenticate every HTTP request and Socket.IO connection that accesses private workspace data.
- Authorize every project read/write and room join on the server.
- Validate and length-limit messages, names, invitations, and socket payloads.
- Configure CORS and allowed origins from environment configuration; do not ship wildcard production origins.
- Apply rate limits to authentication, invitation, and message operations.
- Prevent cross-organization/project identifier substitution by scoping repository queries and authorization checks together.
- Do not log secrets, session tokens, passwords, private message bodies, or full Yjs document payloads.
- Use TLS in deployed environments, secure cookies where applicable, secret rotation, backups, and a documented deletion/retention policy.
- Treat presence and display names as untrusted input.

## 11. Reliability, scale, and observability

Initial target is a single backend instance and a modest number of collaborative users per project. Do not promise specific throughput until load tests establish it.

Required operational behaviors:

- Liveness/readiness health checks; readiness should include critical dependency status once a database is added.
- Structured logs with request/correlation IDs and redaction.
- Metrics for HTTP/socket errors, active connections, room membership, chat persistence latency, and document sync/recovery failures.
- Graceful shutdown: stop accepting new requests, close Socket.IO, and flush/close persistence adapters.
- Backups and tested restore procedures for durable data and persisted editor state.
- Pagination for all unbounded lists; limits and quotas for message and document payload sizes.

Scale out only after identifying the bottleneck. Likely additions are a shared Socket.IO adapter, shared Yjs persistence, database indexes/query tuning, and then service separation if ownership or load requires it.

## 12. Test strategy

Test behavior at several levels:

1. **Domain tests:** membership uniqueness, owner protection, role policy, project lifecycle, chat edit/delete rules.
2. **Application tests:** use cases with fake repository ports; verify ordering and failure behavior.
3. **Repository integration tests:** Mongo indexes, persistence, pagination, unique constraints, and migrations.
4. **HTTP tests:** validation, authentication, authorization, status/error contract.
5. **Socket integration tests:** authorized/unauthorized room join, reconnect, role revocation, room isolation, and message delivery.
6. **Collaboration tests:** two clients converge on document content; unauthorized clients receive no document updates; persistence recovery if enabled.
7. **Frontend tests:** join flow, errors/loading/connection state, role-aware controls, chat history and live updates.
8. **End-to-end tests:** owner creates organization/project, invites members, editor collaborates and chats, viewer is read-only.

The most important negative tests prove that a user cannot access another tenant's project data by changing an ID or emitting a socket event directly.

## 13. Deployment shape

Start with:

```text
Browser
  | HTTPS / WSS
  v
Frontend static hosting
  |
  v
Node.js modular monolith (Express + Socket.IO + Yjs provider)
  |                         |
  v                         v
MongoDB                Yjs persistence adapter (when enabled)
```

Use separate development/staging/production configuration. Provide `.env.example` with placeholders, never real credentials. Use managed MongoDB for a deployed portfolio demo if available; keep local development reproducible. Add Redis/shared socket infrastructure only when deploying multiple backend instances.

WebRTC calls, if implemented later, need STUN/TURN configuration and likely an SFU for larger rooms. Media should not be proxied through Express or Socket.IO.

## 14. Delivery sequence and decision gates

### Slice A — Stabilize current collaboration

- Extract client configuration (backend URL and room/project identity) from hardcoded values.
- Add connection and failure states.
- Verify two-client editor convergence and presence with an integration test.
- Keep display-name identity explicitly labeled as development-only.

**Gate:** collaboration is repeatable locally and failures are visible.

### Slice B — Identity and project access

- Add authenticated identity and organization/project membership.
- Implement project access policy and repository contracts.
- Secure HTTP and Socket.IO/Yjs room joins.
- Test unauthorized access and role restrictions before adding chat.

**Gate:** backend tests demonstrate tenant isolation and room authorization.

### Slice C — Durable chat

- Define message behavior scenarios and message policy.
- Implement `SendProjectMessage` and `ListProjectMessages` use cases.
- Add Mongo repository adapter and indexes.
- Persist accepted messages before live broadcast; add cursor-based reconnect loading.

**Gate:** a message survives reload, is delivered live, and stays isolated to authorized project members.

### Slice D — Contextual discussions

- Design a stable anchor model using Yjs-relative positions or another tested mapping strategy.
- Add thread/reply and resolve behavior.
- Test anchor behavior under concurrent edits and deletions.

**Gate:** a thread remains navigable or degrades clearly when its anchor can no longer be resolved.

### Slice E — Optional voice/video

- Validate demand and room-size target first.
- Prototype WebRTC signaling, permissions, device selection, reconnect, and TURN.
- Decide whether an SFU is needed using real test conditions.

**Gate:** do not ship until privacy, reliability, and operational requirements are met.

## 15. Open decisions

These should be decided when the corresponding slice starts, not guessed prematurely:

1. Authentication: managed identity provider versus application-managed password/session flow.
2. Organization membership default access: organization members see all projects or require explicit project membership.
3. Chat policy: edit/delete windows, moderation, retention, attachments, and message size.
4. Yjs durability: update log, snapshots, existing persistence adapter, retention, and recovery objectives.
5. Project/document model: one document per project or multiple named files/documents.
6. Deployment target and expected concurrent users/room size.
7. Whether voice/video is actually a product priority after collaboration and contextual discussion are validated.
