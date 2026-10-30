# Frontend

The React/Vite client for Collaborative Code Workspace.

## Development

Install dependencies and start Vite:

```powershell
npm install
npm run dev
```

The client uses the collaboration server at `http://localhost:3000` and the `monaco-room` room. Start the backend separately; see the repository [README](../README.md).

## Checks

```powershell
npm run lint
npm run build
```

The application shell is in `src/app/`. Collaboration UI components are in `src/features/collaboration/`.
