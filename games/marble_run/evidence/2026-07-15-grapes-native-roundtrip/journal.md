# MR2 native GrapesJS visual review journal

## T1 — Native editor owns the layout

Task snapshot: verify that the result is genuinely GrapesJS, not another custom shell editor, before judging its pixels.

### Iteration 1

- **Planned result:** native page/canvas/layer/style controls around a recognizable Marble menu.
- **Capture setup:** `http://127.0.0.1:5203/`, Chromium 1440 × 1000, Marble device 390 × 844, menu Page, 2.5-second asset wait.

![Native GrapesJS editor baseline](./screenshots/editor-before.png)
What to look at: GrapesJS device toolbar, canvas, Style Manager, and the exact coin, gear, banner, nodes, and green CTA.
Observation: The native editor is present and the menu is immediately recognizable. Semantic components have selection outlines and standard Grapes resize/duplicate controls.
Acceptance check: native editor pass; exact visible assets pass; nine-page coverage verified separately; device fidelity not claimed.

- **Change explanation:** retained native Grapes chrome and added only a small game-specific save/page/copy toolbar. Layout remains in raw Grapes Project Data; the server validates and stores it but does not project from another layout model.
- **Decision:** passed.
- **Next action:** prove destructive edits, restart persistence, revision Preview, and reset.

## T2 — Required edits survive a full restart

Task snapshot: prove the editor is a round trip rather than a static reconstruction.

### Iteration 1

- **Planned result:** edit currency copy live, hide settings, duplicate the currency group, save, terminate the Vite process, restart it, and observe the same native project.
- **Capture setup:** same editor URL and viewport; select `menu.currency.value`, type `250`; select/hide `menu.settings.group`; duplicate `menu.currency.group`; Save.

![Edited working project](./screenshots/editor-edited.png)
What to look at: the top copy field and canvas both show `250`; the selected duplicate remains a normal Grapes component.
Observation: the copy updates before Enter, Save succeeds, and the duplicate receives `menu.currency.group.copy-1` while its children receive their own unique IDs.
Acceptance check: live copy met; visibility met in saved style data; duplicate identity met; save met.

- **Restart evidence:** the dev server was terminated, a fresh process started, and a clean Chromium page reported `250` plus `menu.currency.group.copy-1` from `getProjectData()`.

![Revision-stamped edited Preview](./screenshots/preview-edited.png)
What to look at: the visible SHA-256 revision and the edited `250` currency value.
Observation: Preview loaded the immutable publication, not the mutable working file.
Acceptance check: Preview freshness and revision identity met.

- **Change explanation:** fixed the Preview canvas from Grapes' default 85% panel width to the full 390-pixel device width after the first screenshot exposed right-edge clipping.
- **Reset evidence:** `/api/reset` restored the protected baseline, then a new baseline publication was created. Baseline and working files are byte-identical at handoff.
- **Decision:** passed.
- **Next action:** inspect every page after delayed image/font load.

## T3 — Complete primary-surface coverage

Task snapshot: make incompleteness visible by capturing all nine saved Pages, not only the menu.

### Iteration 1

- **Planned result:** one stable screenshot per primary Page from the final baseline revision.
- **Capture setup:** `/preview?revision=sha256-17a64c1f89fcfc1f589d4b8af123821ddb6e7d4a1c8bf77904d669bb1e144516&page=<id>`, direct page load, 1000-millisecond asset/font wait, screenshot of the 390 × 844 Grapes frame body.

![Menu](./screenshots/preview-menu.png)
![Gameplay HUD](./screenshots/preview-gameplay-hud.png)
![Pause](./screenshots/preview-pause.png)
![Settings from menu](./screenshots/preview-settings-menu.png)
![Settings from pause](./screenshots/preview-settings-level.png)
![Win](./screenshots/preview-win.png)
![Fail](./screenshots/preview-fail.png)
![Finale](./screenshots/preview-finale.png)
![Shop](./screenshots/preview-shop.png)

What to look at: exact Marble source art, separate settings contexts, separate win/fail/finale compositions, shop without invented product icons, and a neutral gameplay field.
Observation: all nine Pages load from the committed native project. An initial 120-millisecond page-switch capture produced missing delayed images, so the evidence was recaptured through direct routes after a one-second wait. Capturing the outer iframe element also produced false compositor bands in the gameplay image; the final evidence captures the frame body itself, after computed background styles, images, and fonts are ready.
Acceptance check: page completeness met; current copy met; exact-asset identity covered by hashes and byte verification; semantic editability covered by native layers/tests. Physical-device geometry and P1/P2 convergence are not proved here.

- **Decision:** superseded by the independent aesthetics regression recorded below.
- **Next action:** repair every validated P1/P2 before fresh independent review.

## T4 — Canonical aesthetics regression repair

Task snapshot: repair all ten findings from the rejected Aesthetics Reviewed pass without introducing a second layout authority.

### Iteration 1

- **Project authority:** the protected and working files remain byte-identical raw `editor.getProjectData()` documents. No runtime-output patch or intermediate geometry model was added.
- **Menu:** restored 66 × 66 completed nodes and the 150 × 150 current node, moved the saga lower, kept the current node in front of the CTA, and added 16 independently named deterministic confetti flecks using the exact runtime palette.
- **Gameplay:** separated the texture and base-gradient sizing/repeat contract, removed the visible dashed placeholder scaffold, and restyled the coin/cost row so `125` is readable at 390 pixels.
- **Settings:** rendered the exact popup-card asset into its declared tall card bounds so the ribbon overlaps it, anchored the close target to the card corner, and removed same-color shadows from all six toggle labels.
- **Results:** rendered the exact popup-card asset into the declared result bounds, moved the win/fail eyebrow into the ribbon with sufficient contrast, and seam-matched the fail/finale card/ribbon composition.
- **Publication:** `sha256-17a64c1f89fcfc1f589d4b8af123821ddb6e7d4a1c8bf77904d669bb1e144516`.
- **Capture integrity:** every final `preview-<page>.png` was loaded directly from that revision, waited for images/fonts plus 1000 ms, and captured from the inner 390 × 844 frame body to avoid outer-iframe compositor artifacts.

Visual inspection of the refreshed nine-page set confirms: a continuous quiet gameplay field, no visible placeholder label/border, legible hint cost, exact-size lower saga with visible colored confetti, tall unified settings popup/ribbon, clean settings labels, visible result eyebrows, and overlapping unified result chrome. Pause and shop were unchanged except for being recaptured from the final revision.

- **Decision:** local repair pass complete; fresh independent Aesthetics Reviewed judgment is still required. Physical-device fidelity remains MR4 work and is not claimed here.
