---
title: "packages/kernel — port v1 runtime primitives + flow-machine seed (requirements)"
date: 2026-07-06
trello: https://trello.com/c/Fw1NtsCr
card: Fw1NtsCr
depends_on: iz57J8mL
stage: todo → brainstormed
status: requirements-locked
source_readonly: /Users/base/dev/appletolye/fabrika/packages/core/src
---

# packages/kernel: port v1 runtime primitives — requirements & approach

Requirements/approach artifact for the `todo → brainstormed` transition. This is
a **mechanical port**, not a green-field feature, so this doc front-loads the two
things a port actually needs: (1) an exact per-file take/reject ledger against the
read-only v1 source, and (2) the package-scaffolding gaps the downstream `worked`
stage must close for the acceptance command to pass. No code is written at this
stage.

## Goal

Stand up `@fabrikav2/kernel` as the zero-dependency runtime substrate: typed event
emitter, guarded persisted-state, seeded RNG, responsive layout math, plus the
**screen flow machine seed** (carried in but marked `@experimental`). All five
subpaths exported; ported vitest suites green; typecheck green; no dependency on any
other package. This unblocks the UI and game cards that consume these primitives.

## Constraints (inherited, non-negotiable)

- **v1 is READ-ONLY.** Copy from `/Users/base/dev/appletolye/fabrika/packages/core/src`; never edit it.
- **Kernel has ZERO runtime deps.** No Phaser, no other `@fabrikav2/*` package. DOM
  surface limited to the `localStorage` / `matchMedia` guards the primitives already use.
- **Files touched: `packages/kernel/**` only.**
- Advance exactly one column; no PRs (conductor merges); no secrets.

## Prior-art ledger — take / reject per v1 file

"Prior art is an instruction": what to carry verbatim, what to adapt, what to leave behind.

### `runtime/emitter.ts` (49 lines) → `src/emitter.ts` — TAKE AS-IS
- Typed `createTypedEventEmitter<EventMap>` + `TypedEventEmitter` interface + `Listener<T>` helper.
- Pure, zero-dep, no DOM. Uses `Map<key, Set<listener>>`; `emit` variadic-tuple-typed on whether the payload is `undefined`.
- **Reject nothing.** Already clean. Verbatim copy.

### `runtime/persisted-state.ts` (46 lines) → `src/persist.ts` — TAKE AS-IS
- `loadPersistedJson<T>(key, defaults, isValid?)` + `savePersistedJson(key, data)`.
- Keep the doc comment intact — it is the load-bearing rationale ("extracted here
  after the fifth identical copy"; guards `localStorage` throwing at **access** time,
  not just parse, because a save-state singleton touches storage during module eval and
  an uncaught throw black-screens the bundle before boot). This is exactly the guard
  the zero-DOM-beyond-localStorage rule sanctions.
- **Rename note:** card's exports map calls this subpath `./persist`; source file is
  `persisted-state.ts`. Land the file as `src/persist.ts` so file ↔ subpath match. The
  paired v1 test filename follows (`persist.test.ts`).

### `runtime/rand.ts` (16 lines) → `src/rand.ts` — TAKE AS-IS
- `mulberry32(seed)` deterministic PRNG. Pure, zero-dep. Verbatim.

### `runtime/responsive.ts` (101 lines) → `src/responsive.ts` — TAKE AS-IS
- `createResponsiveLayout(options)` + the `Responsive*` types. **Pure numeric math** —
  contain/cover fit, DPR clamp, orientation resolution. **It does not touch `matchMedia`
  or any DOM** (see Surprises §S1). Nothing to guard here; verbatim copy.

### `shell/flow-machine.ts` (393 lines) + `shell/events.ts` (29 lines) → `src/flow/` — TAKE AS SEED, mark `@experimental`
- Carries: `createFlowMachine`, `FlowStates` / `FlowTransitions` / `FLOW_TRANSITION_TABLE`,
  `FlowMachine` / `FlowMachineConfig` interfaces, `FlowMachineError`, and the flow event
  types (`FlowEventMap`, `FlowMeta`, payload interfaces, `ENDLESS_LEVEL_ID`) from `events.ts`.
- `flow-machine.ts` imports `createTypedEventEmitter` from the same emitter we're porting
  and imports its event types from `events.ts` — so **`events.ts` must come along** (the card
  says "flow-machine" but the machine does not compile without its event map). Land both under
  `src/flow/` (`flow/machine.ts` + `flow/events.ts`, or flat `flow/index.ts` re-exporting).
- **`@experimental` TSDoc is mandatory.** Rationale — two sources agree it is unproven:
  - Card: "ZERO consumers in v1 … it is the seed of the screen flow machine and WILL be
    rewritten against real consumers in the ui cards."
  - Research `06 §2`/`§5`: flow-machine has **0 consumers anywhere**; §5's raw verdict was
    literally *"drop"*. **The card deliberately overrides that drop** to keep the seed. Cite
    this tension in the handoff: we are carrying dead-in-v1 code on purpose, quarantined by
    `@experimental` so no downstream card mistakes it for a settled contract.
- **Reject:** do not wire it to anything, do not "improve" the transition table, do not add
  consumers. Port + test + quarantine only.

## Line-count note (card said "360", source is 393)

Card body cites `flow-machine.ts` as 360 lines; the read-only source is **393**. Research
`06 §2` also says "360 lines". The file was last touched 2026-07-06 (per `shell/` dir mtime)
— it grew (dispose/`can()`/queue-drain hardening visible in the source) after the research
snapshot. Not a blocker; noted so the downstream worker doesn't think it grabbed the wrong file.

## Exports map (acceptance-critical)

`packages/kernel/package.json` needs an `exports` map with these subpaths (card-specified):

| Subpath | Source file(s) |
|---|---|
| `./emitter` | `src/emitter.ts` |
| `./persist` | `src/persist.ts` |
| `./rand` | `src/rand.ts` |
| `./responsive` | `src/responsive.ts` |
| `./flow` | `src/flow/` (machine + events) |

Follow v1's source-shipped convention (research `06 §3`): every export points straight at a
`.ts` file, `"main"`/`"types"` → `src/index.ts`, **no build step / no `dist/`**. The scaffold's
existing `packages/kernel/package.json` already sets `type: module`, `main`/`types: src/index.ts`
— extend it with the `exports` map and the two scripts below. A root `src/index.ts` barrel
re-exporting the five subpaths is optional but matches v1; the card's contract is the subpaths.

## Test porting plan (~1:1, carry alongside)

Port each v1 `*.test.ts` next to its source (vitest, `describe/it/expect`):

| Test | Lines | Notes |
|---|---|---|
| `emitter.test.ts` | 53 | verbatim |
| `persist.test.ts` (was `persisted-state.test.ts`) | 76 | rename import path to `./persist` |
| `rand.test.ts` | 33 | verbatim |
| `responsive.test.ts` | 53 | verbatim |
| `flow/machine.test.ts` (was `shell/flow-machine.test.ts`) | 308 | fix relative import of emitter/events |
| `flow/events.test.ts` (was `shell/events.test.ts`) | 315 | verbatim modulo path |

Only edits allowed: import specifiers (path + `.ts` extension already used in v1). No behavior changes.

## Scaffolding gaps the `worked` stage MUST close (else acceptance fails)

The verification command is:
`npm run typecheck --workspace=packages/kernel && npm run test:unit --workspace=packages/kernel`

Current `packages/kernel` has only `package.json` (no scripts) + `README.md`. Missing:

1. **`typecheck` + `test:unit` npm scripts** in `packages/kernel/package.json`
   (`"typecheck": "tsc --noEmit"`, `"test:unit": "vitest run"` — match sibling convention once one exists).
2. **`tsconfig.json`** extending `../../configs/tsconfig.base.json` (`include: ["src"]`).
   - ⚠ Base config is **stricter than v1's**: `verbatimModuleSyntax`, `noUnusedLocals`,
     `noUnusedParameters`, `noImplicitOverride`, `noFallthroughCasesInSwitch`. The v1 files
     already satisfy these (emitter/flow use `type`-qualified imports; flow's switch has no
     fallthrough; helper params are all used) — port should be clean, but typecheck under the
     stricter base is the real gate, not v1's looser tsconfig.
   - Base `lib` includes `DOM` — covers the `localStorage` guard types with no `@types/node` needed for the primitives.
3. **`vitest.config.ts`** (`test.include: ['src/**/*.test.ts']`, matching v1 core's).
4. **Zero-dep check:** `package.json` must declare **no** `dependencies` and no `@fabrikav2/*`.
   Vitest/typescript come from the **root** dev deps (already present in root `package.json`).

## Acceptance criteria (restated) & how they'll be verified

- [ ] typecheck green — `npm run typecheck --workspace=packages/kernel`
- [ ] ported vitest suites green — `npm run test:unit --workspace=packages/kernel`
- [ ] `package.json` `exports` map with `./emitter`, `./persist`, `./rand`, `./responsive`, `./flow`
- [ ] no dependency on any other package (grep `package.json` for `@fabrikav2/`; deps empty)
- [ ] `flow/` carries `@experimental` TSDoc

## Surprises / open items to carry forward

- **S1 — "matchMedia guard" is aspirational for this file set.** Card says "no DOM types
  beyond localStorage/matchMedia guards." Of the ported files, **only `persist.ts` touches the
  DOM (`localStorage`)**; `responsive.ts` is pure math and never calls `matchMedia`. No
  matchMedia usage exists to guard. Not a blocker — the constraint is a ceiling, not a checklist.
- **S2 — `events.ts` is an undocumented co-dependency.** Card names only `flow-machine.ts`;
  the machine does not compile without `events.ts`. Bringing it is required, not scope creep.
- **S3 — flow-machine is dead-in-v1 by design.** Research §5 said "drop"; the card overrides
  to seed. Quarantine with `@experimental`; do not add consumers this card.
- **S4 — line-count drift** (360 → 393): source grew post-research snapshot. Correct file, noted.
- **S5 — no sibling package has scripts/tsconfig yet.** kernel is (likely) the first real port;
  the `worked` stage establishes the per-package `tsconfig`/`vitest`/scripts pattern that later
  package cards will copy. Keep it minimal and base-config-derived.
