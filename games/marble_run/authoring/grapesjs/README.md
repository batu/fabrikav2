# Marble Run native GrapesJS project

This directory contains the real Marble Run GrapesJS authority. `baseline/project.json` and `working/project.json` are raw `editor.getProjectData()` documents with nine native GrapesJS Pages. There is no intermediate layout AST.

- Start: `npm run dev --workspace=@fabrikav2/grapes-shell`. The service binds to loopback only. Remote access must pass through Portal's authenticated same-origin reverse proxy, preserving `Origin` and setting `X-Forwarded-Host`/`X-Forwarded-Proto`.
- Edit: use the GrapesJS canvas, Layers, Styles, exact Asset Manager tray, and the top live-copy control.
- Save: writes the native project document atomically to `working/project.json`. Save and reset use the revision returned by load as `If-Match`; a stale tab receives `409` and must reload instead of overwriting newer work.
- Publish Preview: validates exact source asset bytes and semantic IDs, then creates a content-addressed publication under `publications/<revision>/` and opens a visibly revision-stamped Preview. Each publication owns its project, manifest, token CSS, fonts, and exact image bytes; Preview requests only that immutable revision tree. Before URL checks or publication, every page component must match the closed Marble schema: only native `wrapper`, `default`, `image`, and `text` types; only their required `section`, `span`, or implicit tags; and only operation-required fields and type-specific attributes. Scriptable tags, fields, event attributes, embedded documents, link/media attributes, and unknown structures fail closed. CSS escape syntax is rejected so an escaped `url()` cannot bypass exact-asset checks or revision URL freezing. Component copy is plain text; raw or entity-encoded HTML markup is rejected before it can introduce an unvalidated style node or attribute.
- Reset baseline: replaces only `working/project.json` from the protected baseline after confirmation and the same optimistic-revision check.

State-changing requests require both a same-origin check and a random in-memory capability fetched by the editor for this server session. The capability is regenerated on every process start and is never stored in this project.

The editor supports canvas/layer selection, absolute move/resize, native layer reorder, Styles color edits, show/hide, exact-source image replacement, and stable semantic duplication. Replacement requires a selected image, and one component-model update synchronizes its `src`, `data-asset-role`, and `data-asset-sha`. A duplicate preserves `data-fab-role` while receiving a unique `data-fab-id` ending in `.copy-N`.

The gameplay page deliberately uses a neutral field. Marble board, marbles, physics, progression behavior, ads, purchases, and navigation remain outside this authoring project.
