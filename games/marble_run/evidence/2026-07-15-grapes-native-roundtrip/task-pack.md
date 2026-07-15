# MR2 native GrapesJS visual task pack

## T1 — Native editor owns the layout

- **Status:** passed
- **Goal:** Open all nine Marble surfaces as native GrapesJS Pages at 390 × 844 with semantic canvas and Layers selection.
- **Why now:** A custom constrained shell editor or a third layout AST would invalidate the experiment.
- **User lens:** Batu sees normal GrapesJS canvas, Layers, Styles, Asset Manager, and page selection rather than a bespoke Phaser-like frontend.
- **Pre-shot:** `screenshots/editor-before.png`
- **Acceptance:** Real GrapesJS chrome is visible; menu uses exact Marble assets; raw `getProjectData()` is the only editable layout document; no generic/Kenney art appears.
- **Constraints:** Browser evidence proves the editor surface only, never physical-mobile fidelity.
- **Out of scope:** gameplay mechanics, Portal routing, device convergence.
- **Verification:** workspace checks plus the actual editor screenshot and raw-project validator.

## T2 — Required edits survive a full restart

- **Status:** passed
- **Goal:** Exercise live copy, show/hide, duplicate identity, save, full server termination/restart, Preview, and reset.
- **Pre-shot:** `screenshots/editor-before.png`
- **Post-shots:** `screenshots/editor-edited.png`, `screenshots/preview-edited.png`, `screenshots/editor-baseline.png`
- **Acceptance:** copy becomes `250` as typed; duplicate receives `.copy-1`; saved values survive a fresh Vite process; Preview shows the same content-addressed revision; reset restores the protected baseline.
- **Constraints:** The committed working project is reset to baseline after the proof.
- **Verification:** live runtime sequence plus `test/project.test.ts` restart/publish/reset cases.

## T3 — Complete primary-surface coverage

- **Status:** passed for MR2 authoring coverage; device fidelity remains MR4 work
- **Goal:** Render one recognizable canonical state for menu, gameplay HUD, pause, both settings contexts, win, fail, finale, and shop.
- **Capture targets:** `screenshots/preview-<page>.png` for all nine pages.
- **Acceptance:** every page opens from the saved native project; exact assets and current copy are present; meaningful UI layers remain independently editable; the gameplay board is a neutral placeholder.
- **Spawned:** physical-device capture and PixelSmith P1/P2 convergence belong to the Marble Gate card, not this browser-authoring card.
