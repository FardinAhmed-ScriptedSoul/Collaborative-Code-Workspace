# Collaborative Code Workspace

A multi-tenant collaborative development workspace built with React, Monaco, Yjs, Socket.IO, Express, and MongoDB. Users can create organizations and projects, invite teammates, edit code together, exchange durable chat messages, discuss selected code ranges, save named snapshots, and optionally start a peer-to-peer voice/video call.

## Run with Docker

Requirements: Docker Engine and Docker Compose.

```powershell
Copy-Item .env.example .env
# Set JWT_ACCESS_SECRET to a unique random value of at least 32 characters.
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080). Nginx serves the frontend and proxies API, health, and Socket.IO/WebSocket traffic to the backend. Compose starts MongoDB with a health check and stores MongoDB/Yjs data in named volumes.

To stop the app, run `docker compose down`. To remove persisted MongoDB and Yjs data as well, run `docker compose down --volumes`.

## Run locally

Requirements: Node.js 24, npm, and MongoDB listening on port `27017`.

Start the installed MongoDB Windows service from an elevated PowerShell terminal:

```powershell
Start-Service MongoDB
```

Alternatively, start MongoDB using Docker Desktop:

```powershell
docker compose up -d mongodb
```

Configure the backend and install dependencies:

```powershell
cd backend
npm ci
Copy-Item .env.example .env
# Set JWT_ACCESS_SECRET in backend/.env to a random value of at least 32 characters.
npm run dev
```

In another terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). Vite proxies `/api`, health checks, and Socket.IO requests to `http://localhost:3000`.

## Identity, access, and collaboration

- Registration/login use normalized email and salted scrypt password hashes.
- Access JWTs are short-lived and held only in browser memory. A random refresh token is stored hashed in MongoDB and sent to the browser only as an HttpOnly cookie. Refresh rotates the token; logout revokes it.
- Organization owners/admins manage organization members and inherit editor access to their projects. Other organization members need explicit project membership. Project editors can write; viewers are read-only.
- HTTP routes, Socket.IO project-room joins, chat writes, and Yjs room/update access are authorized on the backend.
- Chat, code-anchored discussions, and named code snapshots are durable MongoDB records. Presence and WebRTC signaling are ephemeral. WebRTC media is peer-to-peer.
- A MongoDB startup migration backfills legacy embedded organization/project memberships and normalized email values before indexes are ensured.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for request flows, repository boundaries, data lifecycles, API routes, and current limitations. [docs/SYSTEM_DESIGN.md](./docs/SYSTEM_DESIGN.md) and [docs/PROJECT_ROADMAP.md](./docs/PROJECT_ROADMAP.md) describe design decisions and remaining phases.

## Tests and checks

Backend tests:

```powershell
cd backend
npm test
```

Frontend tests, lint, and production build:

```powershell
cd frontend
npm test
npm run lint
npm run build
```

GitHub Actions runs backend/frontend checks and Docker image builds for pushes and pull requests.

## Important limitations

- Email verification, password reset, and email delivery for invitations are not implemented. Invitation links are returned to the authorized caller.
- Organization/project membership removal, archival, and a complete management UI are not implemented.
- Named snapshots save source text; they are not Yjs update-log checkpoints and do not restore CRDT history.
- WebRTC currently uses public STUN only and has not been validated for production networks or larger calls.
- The backend is a single-instance modular monolith. Horizontal scaling requires shared Socket.IO/Yjs coordination. Do not treat the current deployment setup as production certification.
