Deep-read complete. Below are the raw findings from the sub-agent's investigation of `/Users/base/dev/appletolye/design-sheets` and its integration with `/Users/base/dev/appletolye/fabrika` (v1).

## 1. What design-sheets is

**Purpose** (`design-sheets/README.md`): a standalone tool defining a "sheet spec" that represents a game's design surface (page cards, component/token cards, an asset index) so it can be pushed to `claude.ai/design`, edited by a human, and mechanically synced back. Bootstrapped 2026-07-03 — this is a days-old repo.

**Architecture** (README.md:12-24), 3 layers: sheet spec (`docs/sheet-spec.md`), deterministic CLI (this repo), and agentic steps ("prompts/skills in consuming repos, not code here" — i.e. not implemented here).

**`src/`**: `cli.ts`, `commands/{build,diff,validate,apply,tokens,pull-tokens}.ts`, `apply/{anchors,change-brief,edit-plan,snapshot}.ts`, `codegen/{css,targets}.ts` (only a CSS target is registered — a "future Unity/USS target" is aspirational, not built), `sheet/{diff,files,load,paths,references,validate}.ts`, `util/{errors,stable}.ts`.

**Schemas** (`design-sheets/schemas/`, 4 files, all read):
- `sheet-manifest.schema.json` — validates `sheet.json` (spec version, card list, mechanical.tokens path, assets.index path, changeBrief path).
- `tokens.schema.json` — W3C-design-tokens-style leaves (`$value`/`$type`/`sourceMap`), sourceMap kind restricted to `css-var`/`ts-const`/`ts-string`, plus `assetBindings`.
- `asset-index.schema.json` — per-asset id/path/hash/dimensions/classification/provenance (source, license, shippable).
- `change-brief.schema.json` — ordered entries (annotation/structural-edit/new-variant).

None model screen layout, positioning, animation timing, or copy/text (see gap section 5).

**`sheets/`**: one real generated sheet, `sheets/marble-run-sugar3d/`, produced by the `fabrika-sugar3d` ingester — real extracted values (e.g. `COLORS3D.marble.red = #ff4d6d`). **Flag: `ingesters/fabrika-sugar3d/README.md:57-58` discloses that 4 page cards are "structural-only" with literal "TODO capture" notes** — disclosed placeholder, not concealed.

**`ingesters/`**: only one exists, `fabrika-sugar3d/` (plain `.mjs`, no compiled TS). Reads (read-only) `games/marble_run/sugar3d/src/core/Constants.ts`, `src/shell/shellTheme.ts`, only the `--marble-font-*`/`--vida-font-*` CSS vars from `src/ui/style.css` (not the ~200 hex literals also there), and `src/ui/dom.ts` import paths. Writes only into `design-sheets/sheets/marble-run-sugar3d/`; explicitly never writes into fabrika (README.md:35). **Its own README (lines 62-64) states the color palette is "intentionally documented as triplicated across `COLORS3D`, `MARBLE_LEVELMAP_THEME`, and hard-coded CSS" and that "this ingester does not reconcile those surfaces."**

**`examples/minimal-sheet/`**: hand-authored fixture with a fictional `consumingRepo.root: "games/minimal-game"` — explicitly a test fixture, not production data.

**`agents/`**: `agents/config.json` contains **only Trello board/list IDs** — no agent definition, prompt, or skill file exists here despite the directory name. Flag: misleading directory name; matches README's claim that real "agentic steps" live in consuming repos, but there's no agent implementation anywhere in this repo.

## 2. The pipeline end-to-end

Traced flow: sheet → ingester is a one-way, already-executed, **read-only** extraction from fabrika into `design-sheets/sheets/marble-run-sugar3d/`. An `apply` command (`src/commands/apply.ts`) and `pull-tokens` command exist and are designed to write mechanical changes back into a consuming repo, with atomic rollback-safe writes.

**No evidence this has ever run against fabrika:**
- `grep -rIl "design-sheets\|design_sheets"` across all of fabrika (excluding node_modules/.git): **zero matches**.
- `grep -rIl "dsheets"` across fabrika: **zero matches**.
- No `theme.json` or any generated token file in fabrika traces back to design-sheets output.
- No `dsheets tokens codegen` output file exists anywhere in fabrika.

**Conclusion: NO INTEGRATION FOUND.** Fabrika's own `--fab-*` CSS custom properties (`packages/core/src/ui/ui.css`), `ftdTheme.ts`, and `shellTheme.ts` are a pre-existing, independent mechanism that the ingester merely *reads from* — design-sheets does not manage or write to them.

## 3. Where the pipeline stops short

**`fabrika/games/marble_run/sugar3d/src/ui/style.css`** (2473 lines):
- Hex color literals: **197 occurrences (112 unique)**
- `rgba()`/`rgb()` literals: **227**
- Pixel values (`Npx`): **817**
- Examples: `style.css:44` `background: #9b7bcd;`; `:61` `transform: translate3d(-128px, -128px, 0);`; `:165` gradient `#72f86c, #22d642 45%, #10a934`.
- Only font CSS vars from this file are mechanically extracted; the ~200 hex/rgba literals are only counted for a "style-notes" card, never lifted into tokens.

**`fabrika/games/marble_run/sugar3d/src/ui/dom.ts`**: hardcoded copy, e.g. `:249` `'route blocked'`, `:525` `'Rewarded ad unavailable. Please try again.'`, `:536` `'WATCH AD'`, `:650` `'Tap again to wipe all progress'` — none covered by any design-sheets token schema.

**`fabrika/games/find_the_dog/src/ui/ftdTheme.ts`** (145 lines): **46 hex/`0x` literal occurrences**, e.g. `:8` `'--fab-color-surface': '#ffffff'`, `:12` `'--fab-color-accent': '#FF8C42'`, `:60/:72` gradient literals — independent of design-sheets entirely.

**`fabrika/games/find_the_dog/src/ui/HUD.ts`** (1441 lines): 2 raw hex literals plus multiple hardcoded copy strings (`:446` `'No levels available'`, `:921` `'Opening…'`, `:1229` `'Purchasing…'`, etc.). No hardcoded Phaser position calls found via grep in this file (not exhaustively checked across all scenes).

## 4. What a reskin currently requires

No dedicated reskin/theme-swap process doc exists in either repo. Design-sheets' own `docs/requirements.md:114-119` explicitly **defers** cross-game reskin to future scope (V2). Fabrika mentions from `games/arrow/AGENTS.md:28` and `docs/plans/2026-07-02-001-refactor-neutralize-core-ui-defaults-plan.md` describe manual, code-review-based token extraction disciplines unrelated to design-sheets.

Enumerated manual steps a developer must take today (no automated propagation exists):
1. Edit hex/rgba literals directly in `style.css` / theme map files (197 + 46 candidate sites).
2. Edit hardcoded copy strings directly in `dom.ts` / `HUD.ts` — no copy schema or codegen exists.
3. Swap asset files and update hardcoded import paths in `dom.ts` — `apply.ts`'s own `change-brief.ts:79-90` explicitly refuses to auto-apply DOM-import asset bindings ("v0 apply does not rewrite DOM import asset bindings"), routing them to a manual change brief instead.
4. Even for tokens design-sheets could theoretically apply mechanically, no `dsheets apply` invocation against fabrika exists on record — manual edits to `Constants.ts`/`shellTheme.ts`/`style.css` are still required.

## 5. Unused capabilities and gaps

**Unused capabilities**: `dsheets apply` (full write-back with rollback), `dsheets pull-tokens`, `dsheets tokens codegen --target css`, the change-brief mechanism, and the mentioned-but-unimplemented Unity/USS codegen target — none have any consumer or generated artifact in fabrika.

**Schema gaps vs. actual game needs**:
- **No layout/position schema** — nothing models the 817 `px` occurrences or `translate3d(...)` position literals in `style.css`.
- **No copy/text schema** — none of the 4 schemas define a localized-copy or UI-text leaf type; the many hardcoded strings in `dom.ts`/`HUD.ts` have no binding path (`ts-string` sourceMap targets style-value-like strings, not natural-language copy).
- **No animation/timing schema** — `$type` is an open string so a timing value could technically be shoehorned in (as seen with `fabLevelmapFarOpacity` in `sheets/marble-run-sugar3d/tokens/mechanical.json:250-269`), but no dedicated construct or ingester extraction exists.
- **No component-variant/state schema** — component cards are just HTML with an optional `#ds-tokens` block; variant/state modeling is left to prose.
- Even the existing color-token schema is under-applied: the ingester's own README (lines 62-64) flags the tri-source-of-truth color palette (`COLORS3D`, `MARBLE_LEVELMAP_THEME`, hardcoded CSS) as unreconciled.

**Key files cited**: `design-sheets/README.md`, `docs/sheet-spec.md`, `docs/requirements.md`, `schemas/{sheet-manifest,tokens,asset-index,change-brief}.schema.json`, `ingesters/fabrika-sugar3d/{README.md,run.mjs,lib/*.mjs}`, `sheets/marble-run-sugar3d/{sheet.json,tokens/mechanical.json}`, `examples/minimal-sheet/`, `agents/config.json`, `src/commands/apply.ts`, `src/apply/change-brief.ts`, `src/codegen/css.ts`; `fabrika/games/marble_run/sugar3d/src/ui/{style.css,dom.ts}`, `fabrika/games/find_the_dog/src/ui/{ftdTheme.ts,HUD.ts}`, `fabrika/games/arrow/AGENTS.md`, `fabrika/docs/plans/2026-07-02-001-refactor-neutralize-core-ui-defaults-plan.md`.