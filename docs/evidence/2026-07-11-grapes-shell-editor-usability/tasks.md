# Grapes Shell Editor Usability Task Pack

## Task U3-V1 - Make asset replacement visually legible

### Status

passed

### Goal

Let a designer identify, compare, select, and confirm curated raster assets without reading opaque IDs.

### Why Now

Asset replacement is one of the representative V1 edits required by the A1 gate, but the baseline editor exposes the seed inventory as text-only rows and the canvas does not show the selected raster.

### User Lens

A designer cannot confidently tell which asset is installed or whether clicking a replacement changed the page.

### Pre-Shot Targets

- Menu page with the hero component selected and its asset tray visible.
- Artboard after selecting a compatible replacement.

### Repro Setup

- Route: `/`
- Viewport: 1440x1000 desktop
- Fixture: bundled U2 Kenney seed manifest and starter project
- State: Menu page, `menu.hero` selected, base presentation

### Acceptance Criteria

- Every compatible asset choice shows a real thumbnail, semantic name, dimensions, and source pack.
- The installed asset is visibly identified in the tray.
- The artboard visibly renders the installed raster without enabling arbitrary URLs, raw HTML, or raw CSS.

### Expected Visual Result

The tray reads as a small curated library and the artboard gives immediate visual confirmation of the selected asset.

### Constraints

- Asset URLs must be build-time, trusted local bundle URLs derived from U2's pinned manifest.
- Raw GrapesJS panels and arbitrary asset upload remain unavailable.

### Out of Scope

- Adding new assets, editing raster bytes, or changing the U2 manifest.

### Verification

- Matched before/after desktop screenshots.
- Browser interaction proves two compatible assets produce visibly different artboard output.
- Existing project validation, typecheck, unit, lint, and build checks remain green.

### Spawn Rules

- If the artboard cannot fit the workspace at the target viewport, add or activate Task U3-V2 instead of expanding this task.
- If acceptance is partial, append another iteration to this task.

## Task U3-V2 - Keep the full editing loop in one desktop view

### Status

passed

### Goal

Keep page selection, artboard context, selected-component controls, feedback, and primary actions understandable without losing the active edit to excessive vertical scrolling.

### Why Now

The fixed 390x844 artboard plus editor chrome can exceed a typical laptop-height viewport.

### User Lens

A designer may scroll away from the component or status they are editing and lose the relationship between control and result.

### Pre-Shot Targets

- Full editor at 1440x900.
- Bottom controls while the selected artboard remains visible.

### Repro Setup

- Route: `/`
- Viewport: 1440x900 desktop
- Fixture: starter project
- State: Menu page, `menu.play` selected

### Acceptance Criteria

- The browser document itself does not require vertical scrolling at 1440x900.
- The complete phone artboard remains legible and preserves its 390:844 ratio.
- Navigation and inspector can scroll independently while the header, stage context, and publication status remain stable.

### Expected Visual Result

The workspace reads as one coherent studio rather than a tall webpage containing a phone mockup.

### Constraints

- The canonical canvas remains 390x844; presentation scaling is visual only.
- Desktop-first editor scope remains explicit; this task does not create a mobile authoring UI.

### Out of Scope

- Runtime responsive behavior or iOS/Android game layout changes.

### Verification

- Before/after 1440x900 full-page screenshots.
- Browser metrics record document height, viewport height, and independent panel overflow.

### Spawn Rules

- If a control hierarchy issue remains after fit is solved, add a separate task instead of redesigning the whole editor.
- If acceptance is partial, append another iteration to this task.

## Task U3-V3 - Make constrained edits trustworthy

### Status

passed

### Goal

Make it obvious which values are editable, which contract data is locked, and whether a supported edit succeeded or was rejected.

### Why Now

The baseline color control uses vocabulary outside the U1 contract and can fail while appearing available.

### User Lens

A designer may believe a palette edit was saved when the closed AST actually rejected it.

### Pre-Shot Targets

- Inspector for a color-editable component.
- Feedback and dirty/saved state after palette, copy, geometry, visibility, reorder, and duplicate edits.

### Repro Setup

- Route: `/`
- Viewport: 1440x900 desktop
- Fixture: starter project
- State: representative editable components across Menu and Settings

### Acceptance Criteria

- Every visible edit control maps to an allowed U1 presentation property and succeeds for an in-range value.
- Rejected edits remain unchanged and present a persistent, specific error state.
- Locked binding and accessibility fields are visually distinct from editable fields.

### Expected Visual Result

The inspector feels deliberately constrained: available controls work, locked semantics are clear, and errors cannot be mistaken for success.

### Constraints

- No raw CSS, HTML, arbitrary attributes, runtime bindings, or accessibility edits.
- Contract caps remain authoritative.

### Out of Scope

- Adding new edit categories or broadening V1 geometry constraints.

### Verification

- Matched screenshots for success and rejection states.
- Programmatic representative-edit exercise and focused regression tests.

### Spawn Rules

- If a missing edit category is discovered, record it as a later product decision rather than widening V1.
- If acceptance is partial, append another iteration to this task.

## Task U3-V4 - Clarify save, export, and publication handoff

### Status

partial

### Goal

Separate browser-local saving, project export, immutable CLI publication, and future U4 apply so the editor never claims an action it did not perform.

### Why Now

The baseline `Prepare publication` action only changes helper text, while the CLI publishes a repository project file through a separate seam.

### User Lens

A designer may think their browser edits reached Fabrika when they are still only in local storage.

### Pre-Shot Targets

- Header save/export actions and publication state.
- Footer publication handoff and locked apply action.

### Repro Setup

- Route: `/`
- Viewport: 1440x900 desktop
- Fixture: starter project with one dirty edit
- State: dirty, then saved/export-ready

### Acceptance Criteria

- Browser-local save, JSON export, CLI publication, and U4 apply are named as distinct states/actions.
- The A1 Portal handoff can submit the exact validated project JSON with the reviewer decision.
- No UI control claims an immutable publication occurred unless the publisher actually created and verified it.

### Expected Visual Result

The action hierarchy tells a truthful short story: edit, validate/save, hand the exact project to Fabrika, then publish/apply in later deterministic steps.

### Constraints

- Portal remains a transport/review surface, not a new source of truth.
- U4 apply stays disabled and U4 implementation does not begin.

### Out of Scope

- Automatic watcher, hot reload, MCP layer, or projection/apply implementation.

### Verification

- Before/after screenshots of dirty and saved/export-ready states.
- Portal verdict payload contains explicit decision, checklist, and validated project JSON.

### Spawn Rules

- If Portal transport limits block the exact payload, record a blocking task rather than silently truncating it.
- If acceptance is partial, append another iteration to this task.

## Task U3-V5 - Match editor and publication geometry at the kernel seam

### Status

passed

### Goal

Make the editor artboard and portable publication use the same baseline safe-area projection that validates the U1 closed AST.

### Why Now

Independent Sol review found that both consumers used center translation and full-canvas percentages instead of the kernel projector, visibly clipping top-anchored controls and making edited positions diverge from validation.

### User Lens

A designer could approve a position in the editor and receive a different or clipped position in the published game shell.

### Pre-Shot Targets

- Existing 1440x900 Menu capture showing clipped top currency, title, and settings controls.
- Editor and portable DOM bounds for every Menu semantic instance.

### Repro Setup

- Route: `/` and generated `portable/menu.html`
- Viewport: editor 1440x900; inner and portable canvas 390x844
- Fixture: starter project and baseline safe insets 59/0/34/0
- State: Menu base presentation

### Acceptance Criteria

- Editor bounds equal `projectShellGeometry` output for every Menu instance within 0.02px, covering Chromium's 1/64px layout quantization.
- Portable bounds equal the same expected output and editor bounds within 0.02px.
- The post-shot visibly restores top-anchored controls inside the 59px safe guide without changing the closed AST.

### Expected Visual Result

The top row sits fully inside the safe rectangle, and the same normalized edit produces identical editor and portable pixel bounds.

### Constraints

- The kernel projector remains the single deterministic layout implementation.
- The canonical 390x844 canvas and safe-area contract do not change.

### Out of Scope

- Runtime projection to other device profiles, which belongs to U4 and later device cards.

### Verification

- Before/after screenshots.
- Programmatic editor/portable/kernel bounds comparison.
- Unit, render, typecheck, and lint gates.

### Spawn Rules

- Any non-baseline device mapping issue becomes a U4/U6 follow-up rather than widening U3.
- If acceptance is partial, append another iteration to this task.

## Task U3-V6 - Reconcile the Kenney seed with the U1 asset-slot contract

### Status

blocked on U2 contract repair

### Goal

Make one Fabrikav2-owned asset-slot vocabulary authorize editor choices, portable publication, and later runtime projection without a secondary `compatibleRoles` registry.

### Why Now

Independent Sol review found that U3 strips asset IDs before U1 presentation validation and trusts U2 `compatibleRoles` instead. A deterministic audit confirms that the current U2 seed cannot be represented honestly as U1 assets.

### Acceptance Criteria

- U2 emits slot-specific catalog entries accepted by `parseShellAssetCatalog`, including actual dimensions, alpha, MIME, hashes, and provenance.
- Each asset identity targets exactly one U1 slot; cross-slot reuse uses separate semantic identities or is removed.
- U3 validates presentation with that exact U1 catalog, filters the tray by role slot, enforces slot fit, and publishes the same canonical catalog.
- The complete starter project passes asset compatibility before editor load and publication.

### Evidence

- [Asset-slot audit](./asset-slot-audit.json): 29 assets, 40 asset/role pairs, 39 dimension-invalid pairs, seven cross-slot identities, and 33 of 33 starter uses dimension-invalid.

### Constraints

- Do not weaken U1 silently, relabel intrinsic dimensions, or resize bytes during U3 publication.
- U3 does not take ownership of the U2 curated source pack inside this card.

### Next Action

Choose the recommended seam repair: reopen the U2 Kenney seed as slot-specific contract-valid fixtures, then make U3 consume U1's parsed catalog directly. Only after that gate is green should the live A1 request be posted.
