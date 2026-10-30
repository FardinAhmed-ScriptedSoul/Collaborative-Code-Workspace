# Collaborative Code Workspace — Product and Engineering Roadmap

## Product direction

Build a team workspace where people can work on code together in real time, discuss changes in context, and keep project membership and decisions organized. The goal is not to clone a general-purpose chat app. The distinguishing idea is **conversation attached to collaborative code**: teammates can see who is present, edit together, and keep discussions and decisions connected to the code they concern.

## Current implementation snapshot

The repository is beyond the original editor prototype. Current implemented slices include:

- Account registration/login, short-lived access JWTs, rotating hashed refresh sessions, HttpOnly cookie handling, and in-memory browser access-token storage.
- Organization/project creation, separate organization/project membership collections, invitation links, and server-side effective-role checks.
- MongoDB connection singleton, domain-specific repository adapters, startup membership/email backfill, and database indexes.
- Project-scoped Yjs editing/presence, durable paged chat, code-anchored discussions, and named source snapshots.
- A React workspace UI, optional WebRTC peer calls, Docker Compose, GitHub Actions, health/readiness endpoints, and automated backend/frontend tests.

The as-built architecture and route behavior are documented in [ARCHITECTURE.md](./ARCHITECTURE.md). The phases below track remaining product/operational work; they are not a claim that the prototype is production-certified.

| Phase | Current status |
|---|---|
| 0 — Foundation | Complete for the current single-instance local/dev setup. |
| 1 — Identity and access | Core behavior implemented and covered by tests. |
| 2 — Durable project chat | Core history/live delivery/edit/delete flow implemented and covered by tests. |
| 3 — Contextual collaboration | Code-anchored discussions and named text snapshots implemented; activity/replies/reactions and durable Yjs restore remain. |
| 4 — Operational readiness | Docker/CI, indexes, health, basic rate limits/logging, and integration tests exist; accessibility, production metrics/backup/deployment, and scale validation remain. |
| 5 — Audio/video | Basic peer-to-peer prototype exists; production network/TURN/SFU and privacy validation remain. |

## Product principles

1. Make the core collaboration experience reliable before adding more communication modes.
2. Keep durable application data separate from live collaboration state.
3. Enforce access on the server; hiding a UI control is not authorization.
4. Make it easy to understand who can access a project and why.
5. Build features in demonstrable slices with tests, a useful README, and a repeatable local setup.

## Recommended feature sequence

### Phase 0 — Stabilize and organize the foundation (complete)

- Replace the single-screen prototype with clear app areas: workspace, project, editor, members, and activity.
- Split frontend components and backend routes/services into focused modules.
- Add environment-based configuration for API, Socket.IO, and future database URLs.
- Add consistent error handling, request validation, logging, and health checks.
- Add basic automated tests and document local setup.
- Keep the current collaboration server and editor room working through the refactor.

**Exit criteria:** a new developer can install dependencies, start frontend and backend, join the same project room from two browser sessions, and see edits and presence synchronize.

### Phase 1 — Identity and access control (core complete)

- Add account registration/login and authenticated sessions or tokens.
- Create organizations with an owner/admin and member list.
- Create projects under organizations.
- Add project invitations and membership management.
- Enforce project membership on REST endpoints and Socket.IO room joins.
- Start with a small role model:
  - **Organization owner/admin:** manage organization, members, and projects.
  - **Project editor:** edit code and participate in discussions.
  - **Project viewer:** read code and discussions.

Keep roles intentionally small at first. Add custom roles only when the built-in roles prove insufficient.

**Exit criteria:** unauthenticated users cannot join private project rooms or access their data; each role has tested permissions.

### Phase 2 — Durable project chat (core complete)

- Add project chat with message history, pagination, timestamps, and author identity.
- Use Socket.IO for live delivery and MongoDB for durable chat history.
- Persist a message before broadcasting it so clients receive a consistent server-created message.
- Add basic editing/deletion rules, message length limits, and input validation.
- Add unread counts or last-read markers after the basic history flow works.

MongoDB is a reasonable choice for messages and flexible project metadata. It is not required for live Yjs updates: those are collaboration state, not chat records. Decide separately whether to persist Yjs document updates or snapshots; do not assume MongoDB chat persistence also provides editor history.

**Exit criteria:** messages remain after reload, arrive live for project members, and cannot be read or sent by non-members.

### Phase 3 — Contextual collaboration (partially implemented)

- Allow a user to select a code range and start a discussion attached to that location.
- Show unresolved discussions alongside the editor and navigate back to their code location.
- Add reactions, resolve/reopen, and mention teammates only after anchored discussions work.
- Add project activity events for meaningful actions such as joining, discussion creation, and resolution.
- Add named snapshots/checkpoints so a team can return to a known shared state.

This code-linked decision trail is a stronger portfolio differentiator than adding generic chat features alone.

**Exit criteria:** a discussion retains its project and code context, has clear permissions and status, and remains useful after reload and later edits.

### Phase 4 — Quality and operational readiness (partially implemented)

- Add accessibility and responsive layout checks.
- Add integration tests for auth, roles, project membership, chat, and collaboration events.
- Add rate limits and abuse protections for login, invitations, and chat.
- Add structured logs, request IDs, error reporting, and basic service metrics.
- Add Docker-based local development and a documented deployment path.
- Add database migrations/index management, backups, and secret/configuration guidance.

### Phase 5 — Optional real-time audio/video (prototype only)

- Add voice/video as an optional project-room feature using WebRTC.
- Use Socket.IO for signaling and connection coordination, not as the media transport.
- Start with small rooms and peer-to-peer connections; consider an SFU if group size or reliability requires it.
- Include explicit microphone/camera controls, device selection, connection state, and permission handling.
- Test bandwidth, reconnect behavior, browser compatibility, and privacy before calling it production-ready.

The repository includes an optional peer-to-peer prototype, but that is not a production-ready calling service. It still needs explicit privacy review, TURN infrastructure, browser/network compatibility work, and group-size limits before being presented as reliable for real teams.

## Suggested data boundaries

| Data | Initial storage | Notes |
|---|---|---|
| Accounts and sessions | MongoDB or a managed identity provider | Store password hashes only if implementing password auth; never store plaintext passwords. |
| Organizations, memberships, projects | MongoDB | Enforce ownership and membership rules in backend services. |
| Chat messages and discussion threads | MongoDB | Index by project and creation time; paginate history. |
| Presence and typing indicators | Socket.IO/Yjs awareness | Ephemeral state; do not treat as durable records. |
| Live editor synchronization | Yjs over Socket.IO | Keep separate from chat persistence; plan persistence/snapshots independently. |
| Audio/video media | WebRTC, optionally an SFU | Avoid routing media through the application server. |

## Suggested repository organization

As the app grows, evolve toward a structure like this rather than adding all logic to `App.jsx` or `server.js`:

```text
frontend/
  src/
    app/             # routing, app shell, providers
    features/
      auth/
      organizations/
      projects/
      editor/
      chat/
    shared/          # reusable UI and API helpers
backend/
  src/
    config/
    middleware/      # authentication, validation, error handling
    modules/
      auth/
      organizations/
      projects/
      chat/
      collaboration/
    sockets/         # Socket.IO setup and room authorization
    app.js
    server.js
```

Adopt this incrementally: first extract coherent modules, then add a workspace-level setup and shared conventions. Avoid creating empty folders or abstraction layers before there is code to put in them.

## Cross-cutting engineering requirements

- Validate all client input at API and socket boundaries.
- Authenticate Socket.IO connections and authorize every room join.
- Scope every project data query and event to an authorized organization/project.
- Use server-generated IDs and timestamps for persisted messages.
- Configure CORS and allowed origins explicitly outside local development.
- Keep secrets in environment variables; provide a checked-in `.env.example` with placeholders only.
- Avoid logging passwords, tokens, private messages, or full collaboration payloads.
- Add tests around permission boundaries, not just happy-path UI rendering.
- Document which state is ephemeral, durable, and recoverable.

## Portfolio / CV presentation

Present the project as a **multi-tenant collaborative development workspace**, not simply a code editor. A strong demo should show:

1. Two authenticated teammates editing the same project simultaneously.
2. Organization/project membership and a viewer-versus-editor permission difference.
3. Chat history that survives reload and updates live.
4. A discussion anchored to a code selection and a named snapshot.
5. Tests or a short architecture diagram explaining server-side authorization and the boundary between MongoDB, Socket.IO, Yjs, and WebRTC.

For a CV, describe only implemented and tested capabilities. Include the problem solved, the role/authorization model, the real-time architecture, test/deployment setup, and a link to a short demo.

## Next implementation milestone

Continue Phase 3/4 by adding discussions/replies and activity history, then close operational gaps with accessibility checks, production metrics/backup/deployment guidance, and multi-instance design. Do not claim production readiness for WebRTC or horizontal scaling until those paths are validated.
