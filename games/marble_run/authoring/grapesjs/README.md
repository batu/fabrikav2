# Marble Run native GrapesJS project

This directory contains the real Marble Run GrapesJS authority. `baseline/project.json` and `working/project.json` are raw `editor.getProjectData()` documents with nine native GrapesJS Pages. There is no intermediate layout AST.

- Start: `npm run dev --workspace=@fabrikav2/grapes-shell`
- Edit: use the GrapesJS canvas, Layers, Styles, exact Asset Manager tray, and the top live-copy control.
- Save: writes the native project document atomically to `working/project.json`.
- Publish Preview: validates exact source asset bytes and semantic IDs, then creates a content-addressed publication under `publications/<revision>/` and opens a visibly revision-stamped Preview.
- Reset baseline: replaces only `working/project.json` from the protected baseline after confirmation.

The editor supports canvas/layer selection, absolute move/resize, native layer reorder, Styles color edits, show/hide, exact-source image replacement, and stable semantic duplication. A duplicate preserves `data-fab-role` while receiving a unique `data-fab-id` ending in `.copy-N`.

The gameplay page deliberately uses a neutral field. Marble board, marbles, physics, progression behavior, ads, purchases, and navigation remain outside this authoring project.
