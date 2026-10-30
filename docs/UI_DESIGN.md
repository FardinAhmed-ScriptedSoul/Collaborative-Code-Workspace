# UI Design Concept

This folder contains a standalone visual prototype for the Collaborative Code Workspace. It is intentionally separate from the React application and does not change the production-facing app.

## Preview

Open `index.html` directly in a browser, or serve this folder locally:

```powershell
cd ui-design
python -m http.server 4173
```

Then open `http://localhost:4173`.

The concept focuses on an approachable dark workspace, soft cyan/indigo gradients, restrained 3D motion, and a single view combining project files, the collaborative editor, presence, and project chat. The file selection, chat composer, and run button have lightweight prototype interactions.

Animations respect `prefers-reduced-motion`. All project data and interactions are mock data only; this design is not connected to the backend.
