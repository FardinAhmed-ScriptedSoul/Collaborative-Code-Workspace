# Collaborative Code Workspace

A prototype real-time collaborative code editor built with React, Monaco, Yjs, Socket.IO, and Express. The current version supports a shared editor session and live participant presence using a display name.

> This is an early development project. Usernames are not authenticated accounts, and collaboration rooms are not access-controlled. Do not use it for private or sensitive code.

## Project structure

```text
backend/
  src/
    config/         # environment loading and validation
    collaboration/   # Yjs/Socket.IO server integration
    infrastructure/
      database/      # MongoDB connection lifecycle
    app.js           # HTTP routes
    server.js        # HTTP server startup
  test/              # backend tests
frontend/
  src/
    app/             # Application shell and styles
    features/
      collaboration/ # Editor and participant UI
    main.jsx         # React entry point
```

## Requirements

- Node.js 20.19+ or 22.12+ (required by the current Vite version)
- npm
- MongoDB running locally on port `27017`

## Run locally

Install dependencies once in each application:

```powershell
cd backend
npm install
```

For local backend configuration, copy the example file:

```powershell
Copy-Item .env.example .env
```

The backend defaults to `mongodb://localhost:27017/` and database `Orbit`. Keep `backend/.env` local; it is ignored by Git.

In another terminal:

```powershell
cd frontend
npm install
```

Start the backend from `backend/`:

```powershell
npm run dev
```

Start the frontend from `frontend/`:

```powershell
npm run dev
```

Open the Vite URL printed in the frontend terminal. Open the same URL in another browser window, enter a display name in each, and join the same editor room to try collaboration.

The backend listens on port `3000`; its health endpoint is `http://localhost:3000/health`.

## Local database

The backend uses MongoDB at `mongodb://localhost:27017/` and database `Orbit` by default. Copy `backend/.env.example` to `backend/.env` to override these settings. The `.env` file is local-only and must never be committed.

## Verification

Run these commands from `frontend/`:

```powershell
npm run lint
npm run build
```

Run backend configuration tests from `backend/`:

```powershell
npm test
```

## Current limitations

- A display name is only a client-provided label, not authentication.
- The collaboration room is shared and has no organization/project membership checks.
- Chat history, accounts, organizations, projects, and persistent editor history are not implemented.
- The development CORS policy and server configuration need production hardening.

Internal design documents are kept locally in `docs/` and intentionally excluded from Git.
