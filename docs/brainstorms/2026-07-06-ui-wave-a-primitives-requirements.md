---
title: "packages/ui wave A — primitives (Button, ModalShell, ToastSystem, ToggleRow) requirements"
date: 2026-07-06
trello: https://trello.com/c/VD1JPfyY
card: VD1JPfyY
depends_on: Fw1NtsCr
stage: todo → brainstormed
status: requirements-locked
source_readonly: /Users/base/dev/appletolye/fabrika
---

# packages/ui wave A: primitives — requirements & approach

Requirements/approach artifact for the `todo → brainstormed` transition. Two of the
four primitives (`Button`, `ModalShell`) are a near-verbatim **port** of the v1
`@fabrika/core/ui` kit; the other two (`ToastSystem`, `ToggleRow`) are **new
extractions** from game god-files that have no v1 primitive yet. So this doc
front-loads: (1) a per-source take / reject / generalize ledger against the
read-only v1 tree, (2) the typed API each primitive must export, (3) the token
inventory that keeps `packages/ui/src` literal-free, and (4) the scaffolding gaps
(one of them a dependency add that needs Batu) the downstream `worked` stage must
close for the acceptance command to pass. No code is written at this stage.

## Goal

Stand up `@fabrikav2/ui` as the DOM shell kit's primitive layer: four
framework-agnostic, token-themed render functions with typed APIs, ported vitest
suites (+ new suites for the two new primitives) green, typecheck green, and **zero
literal colors / copy / asset paths in the component source** — everything resolves
through `--fab-*` CSS custom properties (defined once, neutrally, in `ui.css`) plus
injected copy/assets. This unblocks the screen-kit and game-shell cards that consume
these primitives.

## Constraints (inherited, non-negotiable)

- **v1 is READ-ONLY.** Seed from `/Users/base/dev/appletolye/fabrika`; never edit it.
- **DOM-only, token-themed.** No Phaser, no canvas. Theming is `--fab-*` custom
  properties scoped to a `.fab-ui` root; copy + asset URLs are **injected**, never
  literal (guardrail #2 — the audit-linter card will enforce).
- **Files touched: `packages/ui/**` only.**
- Advance exactly one column; no PRs (conductor merges); no secrets.
- `depends_on: Fw1NtsCr` (kernel) is **satisfied** — landed at HEAD `1481f55`;
  `@fabrikav2/kernel/flow` is importable (relevant only to the ModalShell §S1 note).

## Prior-art ledger — take / reject / generalize per v1 source

"Prior art is an instruction": what to carry verbatim, what to generalize, what to leave behind.

### `packages/core/src/ui/internal.ts` (161 lines) → `src/internal.ts` — TAKE AS-IS (undeclared co-dependency)
- `createUiRoot` lifecycle helper + `UiHandle`, `ThemeTokens` (`` Record<`--fab-${string}`, string> ``),
  `applyTheme`. Provides re-entrancy (id-keyed live-handle `WeakMap`), idempotent
  `dismiss`, tracked timers (`scheduleTimeout`), abort signal, cleanup + post-dismiss
  hooks — the substrate `Button` and `Modal` both build on.
- **The card names four primitives but none compile without `internal.ts`.** Bringing
  it is required, not scope creep (mirrors the kernel port's `events.ts`, S2). Verbatim
  copy; it is already pure DOM, zero literals.
- Keep it package-internal (not re-exported from the barrel), matching v1.

### `packages/core/src/ui/Button.ts` (123 lines) → `src/Button.ts` — TAKE AS-IS
- `mountButton(opts) → ButtonHandle`, `buildButtonElement(opts) → HTMLButtonElement`
  (the detached builder `Modal`/actions reuse), `ButtonVariant = 'primary' | 'secondary' | 'icon'`.
- Already token-themed (class-per-variant → `ui.css`), injection-safe (`textContent`,
  not `innerHTML`), zero color/copy literals in the TS. Icon-variant guard (needs a
  visible label or `ariaLabel`) is a thrown Error string, not UI copy — keep it.
- **Reject nothing.** Verbatim copy.

### `packages/core/src/ui/Modal.ts` (116 lines) → `src/ModalShell.ts` — TAKE + KEEP GENERIC
- `mountModal(opts) → UiHandle`. Already the generic shell the card asks for:
  **slot content** (`body: HTMLElement | HTMLElement[]`), **actions slot**
  (`ModalAction[]` auto-built via `buildButtonElement`, or a raw `HTMLElement`),
  **backdrop** (`.fab-modal-backdrop`), **dismiss policy** (`backdropDismiss?: boolean`
  → click-scrim-to-close; `onDismiss?` post-dismiss callback; `dismissed` promise),
  ARIA (`role="dialog"`, `aria-modal`, labelled/described-by), fresh-slot assertion.
- v1's FTD hand-rolled every modal instead of using a shell (research 07 **R9**:
  `showHintBoosterModal` HUD.ts:263-397 duplicates the modal shape). This primitive is
  the deduplication target — carry it verbatim, keep it generic, **do not** re-add
  game-specific content.
- **File rename only:** land as `src/ModalShell.ts` (card's primitive name); the export
  can stay `mountModal` for source-parity, or add a `mountModalShell` alias — pick one
  in `worked` and note it. No behavior change.
- **Back-stack: see S1.** The card's "back-stack integration with kernel flow machine"
  does **not** map onto any existing kernel API. Scope decision below.

### ToastSystem → `src/ToastSystem.ts` — NEW, extract from FTD `HUD.ts:1372-1420` (research 07 R55)
- v1 `showToast(message)` — the **smallest-coupling** extraction in the god-file:
  queue-of-one (dismiss any in-flight toast, no stacking), `requestAnimationFrame`
  fade-in (add `.visible`), `TOAST_DURATION_MS = 3000` auto fade-out, `TOAST_FADE_MS = 250`
  removal. `role="status"`.
- **Reject the coupling:** v1 hard-codes the `#hud-overlay` mount, the `hud-toast` /
  `visible` class names, and the module-level `activeToast` singleton. Generalize:
  - inject the mount point (`mountInto: HTMLElement`), don't `getElementById`;
  - rename classes to `.fab-toast` / `.fab-toast--visible`;
  - make the queue-of-one state instance-scoped (a `mountToaster()` factory returning
    a `{ show(message), dismiss() }` handle) rather than a module singleton, so two
    surfaces can host independent toasters. (Preserves the "no stacking within one
    toaster" behavior without a global.)
  - timings (`--fab-toast-duration-ms`, `--fab-toast-fade-ms`) become tokens read via
    `getComputedStyle` with JS numeric fallbacks — mirrors v1 `LevelComplete`'s
    `readMsToken` pattern so a reskin can retune without a code edit, and so jsdom
    (which computes no `@layer` defaults) still runs on the fallbacks (§S4).
- Message text is **injected copy** (already is — `textContent`). No literals.

### ToggleRow (music/sfx/haptics) → `src/ToggleRow.ts` — NEW, extract two seeds
- **View-model seed (better):** marble_run `sugar3d/src/shell/settings.ts:9-74` — the
  decoupled `SettingKey = 'music' | 'sfx' | 'haptics'`, `SettingsToggleRow { key, label, value }`,
  `buildSettingsModel(input)` with actions **injected by the caller** (comment lines 4-5).
  Pure, no DOM/no state/no audio.
- **DOM-shape seed:** FTD `HUD.ts:852-898` `renderSettingsRows` — the row markup
  (`.settings-row` + `.toggle-switch` checkbox + `.toggle-slider`). Take the *shape*,
  reject the `innerHTML` template (build via `createElement`, injection-safe).
- **Reject the literals the seeds carry** (they violate guardrail #2):
  - marble's `TOGGLE_LABELS { music:'Music', sfx:'Sound Effects', haptics:'Haptics' }`
    — labels are **copy**; they must be **injected** per row, not hard-coded in the primitive.
  - FTD's `src="/ui/settings/settings_icon_*.png"` — asset paths; injected (optional
    per-row `icon?`) or omitted, never literal.
  - FTD's `gameState.settings.*` binding + fixed `#toggle-music` ids — replace with
    injected `value` + an `onToggle(key, next)` callback (the DOM never owns state).
- Proposed API: `mountToggleRows({ mountInto, rows: ToggleRow[], onToggle, theme }) → UiHandle`
  where `ToggleRow = { key: string; label: string; value: boolean; icon?: string }`.
  The `SettingKey` union + `buildSettingsModel` can come along as a **typed helper**
  (pure, re-exported) so consumers get the music/sfx/haptics shape for free, but the
  primitive itself is key-agnostic (takes any rows).

### `packages/core/src/ui/ui.css` (1198 lines) → `src/ui.css` — TAKE THE BUTTON + MODAL SLICE ONLY, add Toast + ToggleRow
- Carry the `@layer fab.tokens` scalar block + the Button (`.fab-btn*`) and Modal
  (`.fab-modal-*`, keyframes `fabModalBackdropIn`/`fabModalCardIn`) component rules,
  plus their tokens (see inventory below). Keep the `@layer fab.tokens, fab.components`
  structure and the reduced-motion block.
- **Leave behind (out of wave-A scope):** `.fab-levelmap-*`, `.fab-complete-*`,
  `.fab-rate-*`, `.fab-transition-cover-*` and their token groups. They belong to later
  screen-kit cards; carrying them now imports ~900 lines of unused CSS.
- **Add new rules:** `.fab-toast` (+ `--fab-toast-*` tokens), `.fab-toggle-row` /
  `.fab-toggle-switch` / `.fab-toggle-slider` (+ `--fab-toggle-*` tokens).
- **Do NOT port `tokens.ts` / `tokens.test.ts`** (v1's numeric-0x canvas mirror): it is
  full of hex literals by design and would fail the AC grep. Canvas-consumable numeric
  tokens are a separate concern for a later card, not wave A (§S3).

## Typed API surface (what `src/index.ts` must export)

```ts
// Button
mountButton(opts: ButtonOptions): ButtonHandle
buildButtonElement(opts): HTMLButtonElement
type ButtonVariant = 'primary' | 'secondary' | 'icon'
// ModalShell
mountModalShell(opts: ModalShellOptions): UiHandle   // (v1 mountModal, renamed/aliased)
type ModalAction
// ToastSystem
mountToaster(opts: ToasterOptions): ToasterHandle    // { show(message): void; dismiss(): void; el; dismissed }
// ToggleRow
mountToggleRows(opts: ToggleRowsOptions): UiHandle
type ToggleRow = { key: string; label: string; value: boolean; icon?: string }
buildSettingsModel(input): SettingsViewModel         // pure helper, music/sfx/haptics shape
// shared
applyTheme, type ThemeTokens, type UiHandle
```
AC reads "4 primitives exported with typed APIs" — the four mount* entry points above,
each with its `*Options`/`*Handle` types, satisfy it.

## Token inventory (keeps `src/*.ts` and component CSS rules literal-free)

- **Shared scalars** (from v1 ui.css:24-46): `--fab-color-{surface,overlay-scrim,text,
  text-muted,accent,on-accent,secondary-surface,on-secondary,secondary-border}`,
  `--fab-space-{sm,md,lg}`, `--fab-radius-{sm,md,pill}`, `--fab-font-*`, `--fab-duration-fast`.
- **Button** (ui.css:47-73): `--fab-shadow-button{,-active,-disabled}`,
  `--fab-btn-secondary-shadow`, `--fab-btn-icon-{color,shadow,size}`,
  `--fab-btn-{min-size,primary-padding,secondary-padding,disabled-opacity,line-height}`.
- **Modal** (ui.css:75-94): `--fab-modal-backdrop-{padding,bg,animation}`,
  `--fab-modal-card-{bg,shadow,animation}`.
- **Toast (NEW):** `--fab-toast-{bg,color,shadow,radius,padding,duration-ms,fade-ms}`.
- **ToggleRow (NEW):** `--fab-toggle-{track-off,track-on,thumb,label-color,row-gap,row-padding}`.
- All new tokens get **neutral defaults** in the `@layer fab.tokens .fab-ui` block —
  that block is the one sanctioned home for literal default values (see §S5).

## Scaffolding gaps the `worked` stage MUST close (else acceptance fails)

Verification command: `npm run typecheck --workspace=packages/ui && npm run test:unit --workspace=packages/ui`

1. **⚠ DOM test environment — a dependency add (needs Batu).** v1's UI tests run under
   jsdom via a per-file `// @vitest-environment jsdom` pragma. **Neither `jsdom` nor
   `happy-dom` is in the v2 root `devDependencies` or `node_modules`.** The `worked`
   worker must add one to the **root** `package.json` devDeps (root, because vitest/TS
   are hoisted there) — this is the one gate that requires a dependency addition, so it
   is **consent-gated per the operating contract**. Recommend `jsdom` for source-parity
   with the v1 pragmas (least test churn); `happy-dom` is a lighter alt the card also
   sanctions. Set it either via the pragma (verbatim port) or a `vitest.config.ts`
   `test.environment: 'jsdom'`.
2. **`packages/ui/package.json`** currently has only `name/version/main/types` (no
   scripts, no exports map). Add: `"typecheck": "tsc --noEmit"`, `"test:unit": "vitest run"`
   (matches the kernel sibling), an `exports` map (`"." → ./src/index.ts`, `"./ui.css" →
   ./src/ui.css`), and **no `dependencies`** (zero-dep like kernel; `@fabrikav2/kernel`
   is only touched if S1 wires the flow machine — recommended NOT for wave A).
3. **`packages/ui/tsconfig.json`** extending `../../configs/tsconfig.base.json`,
   `include: ["src"]` (copy the kernel sibling). Base `lib` already includes `DOM` +
   `DOM.Iterable` — covers all four primitives' DOM types with no extra `@types`.
   Base is strict (`verbatimModuleSyntax`, `noUnusedLocals/Parameters`,
   `noImplicitOverride`, `noFallthroughCasesInSwitch`) — v1 Button/Modal/internal already
   satisfy these; the port should be clean, but the stricter base is the real gate.
4. **`vitest.config.ts`** (`test.include: ['src/**/*.test.ts']`, matching v1 core) —
   optional if the root vitest default already globs, but pin it to also carry the DOM
   `environment` from gap #1 in one place.

## Test porting / authoring plan

| Test | Source | Action |
|---|---|---|
| `Button.test.ts` | v1 `Button.test.ts` (116 ln) | Port; fix import path (`./index`); keep jsdom pragma |
| `ModalShell.test.ts` | v1 `Modal.test.ts` (163 ln) | Port; rename to primitive; fix import path |
| `ToastSystem.test.ts` | — (no v1 test) | **New:** assert queue-of-one replace, rAF `.--visible` add, timer-driven fade+removal (fake timers), `role=status`, injected mount |
| `ToggleRow.test.ts` | — (no v1 test) | **New:** assert rows render injected labels (no hard-coded copy), checkbox reflects `value`, `onToggle(key,next)` fires, no literal asset paths |

Only edits to ported tests: import specifiers (+ `.ts` extension per Bundler resolution). No behavior changes.

## Acceptance criteria (restated) & how they'll be verified

- [ ] `npm run typecheck --workspace=packages/ui` green.
- [ ] `npm run test:unit --workspace=packages/ui` green (4 suites, incl. 2 new).
- [ ] 4 primitives exported with typed APIs (`mountButton`, `mountModalShell`,
      `mountToaster`, `mountToggleRows` + their types) from `src/index.ts`.
- [ ] Zero literal colors/copy/asset paths in **component source**: `grep -RniE
      "#[0-9a-f]{3,8}|rgba?\(" packages/ui/src/*.ts` returns nothing; copy + asset
      URLs arrive via injected content only. (See §S5 for the ui.css exemption.)
- [ ] No hard-coded toggle labels or icon paths; all injected.

## Surprises / open items to carry forward

- **S1 — "back-stack integration with kernel flow machine" has no target API.** The
  landed `@fabrikav2/kernel/flow` machine is a **game-screen** state machine
  (menu/level/paused/complete/fail with `start/complete/fail/next/pause/resume/toMenu/
  selectLevel`); it has **no push/pop back-stack** and no modal concept. A modal
  back-stack is a stack of `UiHandle`s (dismiss-top-first, backdrop chaining), an
  orthogonal concern. **Recommendation:** wave A ships ModalShell's existing dismiss
  policy (`backdropDismiss` + `onDismiss` + `dismissed`) and does **not** invent a
  flow-machine coupling; a `ModalStack` helper (and any flow-machine wiring, if it even
  belongs there) is a follow-up card once a real consumer exists. Flagged so the
  `worked` worker doesn't fabricate a dependency. Reduces `worked` to zero
  `@fabrikav2/*` deps.
- **S2 — `internal.ts` is an undeclared co-dependency.** Card lists four primitives;
  Button + ModalShell don't compile without `internal.ts` (`createUiRoot`/`UiHandle`/
  `applyTheme`). Bringing it is required, not scope creep (kernel port hit the same with
  `events.ts`).
- **S3 — `tokens.ts` deliberately NOT ported.** v1's numeric-0x canvas token mirror is
  hex-literal by design and would fail the AC grep. Canvas-consumable tokens are a
  separate later concern; wave A is DOM-only.
- **S4 — jsdom computes no `@layer` token defaults.** Any primitive that reads a token
  via `getComputedStyle` (Toast timings) gets `''` under jsdom → **must** carry a JS
  numeric fallback (v1 `LevelComplete.readMsToken` is the proven pattern). Tests use
  fake timers + fallbacks, never real computed styles.
- **S5 — the literal-free rule needs a token-definition exemption.** Neutral default
  values (`#ffffff`, `rgba(...)`) must live *somewhere*; their one sanctioned home is
  the `@layer fab.tokens { .fab-ui { --fab-*: ... } }` block in `ui.css`. The AC grep
  above targets `packages/ui/src/*.ts` (component TS); the **audit-linter card** must
  either scope to TS + component CSS rules or explicitly exempt the token-definition
  layer, else there is nowhere to define defaults. Open question for that card, flagged
  here so the two don't collide.
- **S6 — module-singleton → instance.** v1 `showToast` uses a module-level `activeToast`
  singleton; generalizing to `mountToaster()` makes queue-of-one instance-scoped. Minor
  behavior generalization (multiple independent toasters possible), not a regression —
  each toaster keeps the no-stacking guarantee.
