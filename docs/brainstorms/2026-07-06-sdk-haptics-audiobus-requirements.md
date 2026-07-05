---
title: "packages/sdk — haptics (carry v1) + AudioBus (requirements)"
date: 2026-07-06
trello: https://trello.com/c/GjUg0sbk
card: GjUg0sbk
depends_on: Fw1NtsCr
stage: todo → brainstormed
status: requirements-locked
source_readonly: /Users/base/dev/appletolye/fabrika
---

# packages/sdk: haptics + AudioBus — requirements & approach

Requirements/approach artifact for the `todo → brainstormed` transition. Two concerns,
two very different shapes:

- **haptics** is a *carry* — v1 core's 92-line module was already correct (research `04`
  claim 1: "core already suffices"); the failure was **adoption** (3 of 4 games wrote their
  own before/instead of using it). So the job is: copy it nearly verbatim + add the one
  thing the games actually needed that made them fork — a **settings gate** — but as an
  *injected predicate*, not a hard-coupled global (FTD's coupling is exactly why FTD's gate
  couldn't be reused).
- **AudioBus** is *net-new* — 4 games wrote ~1,860 lines of audio with 4 different
  mute/volume APIs and zero sharing (research `04` "Beyond the list"). The job is a minimal
  mixing/state bus (channels, mute, volume, duck, unlock) that games plug clips or
  procedural synths into. **No synth content is ported** — bus + one trivial test synth only.

No code is written at this stage. This doc front-loads the two things the `worked` stage
needs: (1) an evidence-mapped API contract proving the bus covers **all 4 games' shapes**
(the card's explicit requirement), and (2) the package-scaffolding gaps the acceptance
command depends on.

## Goal

Stand up two `@fabrikav2/sdk` subpaths:

- `./haptics` — v1 core `haptics/index.ts` carried nearly as-is (`safeImpact`,
  `safeNotification`, web/native two-layer safety, `ImpactStyle`/`NotificationType`
  re-exports) **plus** a gated factory taking an injected `isEnabled: () => boolean`
  predicate (FTD's `HapticsManager` gating pattern, decoupled from `gameState`).
- `./audio` — a new minimal `AudioBus`: `play(id)`, per-channel `setMuted`/`setVolume`,
  depth-counted `duck`/`unduck`, `unlock()`; games register clips or procedural voices;
  ships with exactly one trivial test synth so the bus is exercisable in isolation.

Acceptance: typed interfaces + adapters compile; unit tests for the bus state machine
(mute/volume/duck) and haptics gating; typecheck + `test:unit` green for `packages/sdk`.

## Constraints (inherited, non-negotiable)

- **v1 is READ-ONLY.** Read from `/Users/base/dev/appletolye/fabrika`; never edit it.
- **Files touched: `packages/sdk/**` only.**
- **Do NOT port synth content.** AudioBus is the mixer/state layer + one test synth. The
  4 games' oscillator/noise synthesis stays in the games (or lands in later per-game cards).
- Advance exactly one column; no PRs (conductor merges); no secrets.
- UI guardrail #2 (zero literal colors/copy/asset paths in `packages/ui`) is **N/A here** —
  this is `packages/sdk`, no rendering surface. Noted so the next worker doesn't chase it.

## Part 1 — Haptics: the carry + the one adaptation

### Prior-art ledger — take / adapt / reject

| Source (READ-ONLY) | Lines | Verdict |
|---|---|---|
| `packages/core/src/haptics/index.ts` | 92 | **TAKE AS-IS** → `src/haptics/index.ts` |
| `packages/core/src/haptics/index.test.ts` | (port) | **TAKE**, adapt import path |
| `games/find_the_dog/src/haptics/HapticsManager.ts` | 41 | **ADAPT the gate only** (below); reject its `gameState` coupling and its multi-beat sequences |
| `games/arrow/src/game/haptics.ts` | 42 | **REJECT** — dynamic-import, no web branch; strictly worse than core |
| `games/block_blast/src/ui/Haptics.ts` | 13 | **REJECT** — raw `navigator.vibrate`, no native path |

**TAKE AS-IS** — v1 core `haptics/index.ts` is carried verbatim: the `Capacitor.getPlatform() === 'web'` → `navigator.vibrate` branch (avoids the `UNIMPLEMENTED` rejection on web — load-bearing, keep the doc comment), the try/catch swallow so callers can `void safeImpact(...)`, and the **direct re-export of the native `ImpactStyle`/`NotificationType` enums** (a Capacitor rename then breaks at compile time, not silently at runtime). The `webImpactPattern` / `webNotificationPattern` millisecond tables carry unchanged.

**ADAPT — the gate, as an injected predicate.** FTD's `HapticsManager` gates every call on:

```ts
gameState.settings.hapticsOn && Capacitor.isNativePlatform()
```

That gate is *why FTD forked* (core had no gate → always fires). But FTD hard-imported
`../core/GameState` — the coupling that made its gate un-shareable (research `04`:
"settings-gating … belong[s] at call sites"). The v2 fix: keep the gate, **inject** it.

Proposed addition (worked stage):

```ts
export interface GatedHaptics {
  impact(style?: ImpactStyle): void;      // fire-and-forget; no-ops when !isEnabled()
  notification(type?: NotificationType): void;
}
export function createHaptics(opts: { isEnabled: () => boolean }): GatedHaptics;
```

- Each method early-returns when `!opts.isEnabled()`, else delegates to the carried
  `safeImpact`/`safeNotification`. The game supplies the predicate, e.g.
  `() => settings.hapticsOn` (and folds in `Capacitor.isNativePlatform()` itself if it wants
  native-only, as FTD did — that's a per-game policy, not a bus concern).
- The ungated `safeImpact`/`safeNotification` stay **exported** (backward-compatible carry;
  marble_run already imports `@fabrika/core/haptics` directly). `createHaptics` is additive.

**REJECT — multi-beat sequences.** FTD's `hapticLevelComplete` (short-short-long via
`setTimeout`) does **not** move into the SDK. Research `04`: multi-beat sequences "belong at
call sites (marble_run's pattern)". The SDK ships gated primitives; games compose rhythms.

### Haptics gating — the tested behavior (AC)

Unit test (`src/haptics/index.test.ts`), no native runtime:
- `isEnabled: () => false` → `impact()`/`notification()` fire **no** `navigator.vibrate` and
  **no** Capacitor bridge call (spy asserts zero calls).
- `isEnabled: () => true` on web → `navigator.vibrate` called with the mapped pattern.
- Predicate is read **per call** (toggling it mid-session flips behavior) — not captured once.
- Enum re-exports are stable (`ImpactStyle.Light` etc. importable from the subpath).

Test seam: `vi.mock('@capacitor/core')` forcing `getPlatform() → 'web'` +
`vi.spyOn(navigator, 'vibrate')`. This exercises the web path + the gate without a native
shell (the sdk README already flags "native-backed SDKs need a native shell to verify" —
gating + web-vibration is the unit-testable slice).

## Part 2 — AudioBus: what "cover all 4 games' shapes" actually means

The card mandates the mute/volume API cover all 4 games; here is each game's **read** shape
(agents read the READ-ONLY v1 sources directly; line cites below).

### Per-game shape matrix (evidence)

| | arrow `game/audio.ts` (80) | block_blast `SoundFx.ts`(44)+`ProceduralSfx.ts`(337) | marble `Music.ts`(145)+`Sfx.ts`(245) | FTD `AudioManager.ts`(458)+`AmbientManager.ts`(551) |
|---|---|---|---|---|
| **Channels** | 1 flat (sfx) | 1 (sfx) | 2 (music, sfx) | 3 (master ▸ music, sfx) |
| **Play** | `play(kind)` fixed enum `pop\|chime\|thud` | `playProceduralSfx(key, pitch=1)` — **pitch param** | zero-arg named cues (`uiTap()`, `thud()`, `winFanfare()`…) + `setRollingActive(bool)` loop | zero-arg named cues (`playFind()`, `playWrongTap()`…) |
| **Mute** | global bool `setMuted`/`isMuted` | global bool `setSfxMuted`, **persisted** `localStorage bb_sfx_muted` | **per-channel** bool (`saveState.sfxEnabled`/`musicEnabled`) | **per-channel** bool + **whole-bus ad-mute (depth-counted `adMusicPauseDepth`)** |
| **Volume** | none | none (`masterGain` exists, never set) | none | **binary 0/1 only** (gain nodes toggled, no scale) |
| **Duck** | none | none | none | ad hard-mute of master (depth counter) — **NOT** sfx-under-music |
| **Fade** | internal per-note envelope only | none | music fade-in 2.2s / out 0.8s; rolling-loop `setTargetAtTime` | music **crossfade** between ambient presets (ms `linearRamp`) |
| **Unlock** | `init()` lazy on gesture | implicit `ctx.resume()` on every play | `unlockAudio()` | `ensureAudioUnlocked()` + `installAudioUnlock()` (iOS one-shot listeners) |
| **Lifecycle** | none | none | self-managed `visibilitychange` | `suspend`/`resume` lifecycle hooks |
| **Settings source** | caller pushes via `setMuted` | self-owned localStorage | `saveState` (pushed) + `refresh()` hook | `gameState.settings` (pushed) |
| **Synth vs clips** | 100% procedural | both (Phaser `.ogg` + procedural) | 100% procedural | both (WAV/MP3 clips + procedural) |
| **Master tap** | — | `getRecordingStream()` | `getMasterOutput()` + `getRecordingStream()` | `getMasterOutput()`/`getMusicOutput()`/`getSoundEffectsOutput()` |

### The union → proposed minimal `AudioBus` contract (for the worked stage)

Design rule: the **superset that covers every row** is small if we make three moves —
(a) fixed two-channel model `music | sfx` (all "master"/"ui" cases collapse into this: UI
sounds route through sfx in *every* game; "master" is the aggregate), (b) **mute and volume
are orthogonal** (effective gain `= muted ? 0 : volume * duckFactor`) so binary-only games
(FTD) and any future slider both fall out of the same state, (c) **ducking is depth-counted**
(directly generalizes FTD's `adMusicPauseDepth`, the only real "duck" in the repo).

```ts
export type AudioChannel = 'music' | 'sfx';

/** A game plugs in either a decoded clip or a procedural voice factory. */
export type AudioSource =
  | { kind: 'clip'; buffer: AudioBuffer }
  | { kind: 'voice'; render: (ctx: AudioContext, out: AudioNode) => { stop(): void } };

export interface AudioBus {
  register(id: string, source: AudioSource): void;
  play(id: string, opts?: { channel?: AudioChannel; pitch?: number; loop?: boolean }): PlayHandle;
  stop(handle: PlayHandle): void;

  // --- the state machine the AC unit-tests (mute / volume / duck) ---
  setMuted(channel: AudioChannel, muted: boolean): void;
  isMuted(channel: AudioChannel): boolean;
  setVolume(channel: AudioChannel, volume: number, ms?: number): void; // 0..1 clamped, optional fade
  getVolume(channel: AudioChannel): number;
  duck(channel: AudioChannel, toGain: number, ms?: number): void;      // depth-counted
  unduck(channel: AudioChannel, ms?: number): void;
  effectiveGain(channel: AudioChannel): number; // muted ? 0 : volume * duckFactor — PURE, tested

  // --- context lifecycle ---
  unlock(): Promise<void>;   // resume AudioContext on first gesture; idempotent
  suspend(): void;
  resume(): Promise<void>;
  readonly master: GainNode; // recording-tap accessor (testkit/debug harness)
}
```

**Coverage proof (each game satisfied):**
- arrow → `register` 3 voices on `sfx`, `play(id)`, `setMuted('sfx', …)`, `unlock()`. ✓
- block_blast → same + optional `pitch`. Persistence is the *game's* job (bus is stateless
  re: storage); flag below. ✓
- marble → `music`+`sfx` channels, per-channel `setMuted`, `setVolume(…, ms)` for the music
  fade, rolling loop via `play(id,{loop:true})`. ✓
- FTD → per-channel mute; **binary** falls out of `setVolume(ch, 0|1)`; ad-pause = `duck`/
  `unduck` (depth-counted); ambient crossfade = `setVolume`/`duck` with `ms`; `unlock` +
  `suspend`/`resume`; `master` for the recording tap. ✓

**Key testability decision:** factor `effectiveGain()` as a **pure function** of
`{ volume, muted, duckDepth, duckGain }` so the mute/volume/duck state machine unit-tests
run **without a real `AudioContext`** (no jsdom Web Audio). The WebAudio wiring (GainNodes)
is a thin apply-layer over that pure state. This is what makes the AC's "unit tests for bus
state machine" cheap and deterministic.

**Test synth:** one trivial built-in `voice` (e.g. a single short sine beep) registered so
the bus is playable/demoable in isolation and the pilot has something to plug. This is the
*only* synthesis the SDK ships — not ported from any game.

### AudioBus — the tested behavior (AC)

Unit test (`src/audio/*.test.ts`) over `effectiveGain` + the state transitions:
- `setVolume('music', 0.5)` then `isMuted` false → `effectiveGain('music') === 0.5`.
- `setMuted('sfx', true)` → `effectiveGain('sfx') === 0` regardless of volume; unmute restores.
- `setVolume` clamps out-of-range (`-1 → 0`, `2 → 1`).
- `duck` twice + `unduck` once → still ducked (depth 1); second `unduck` → restored (balanced
  depth counter, mirroring FTD's `adMusicPauseDepth`). Over-`unduck` doesn't go negative.
- channels are independent (ducking `music` leaves `sfx` unchanged).

## Scaffolding gaps the `worked` stage MUST close (else acceptance fails)

Verification command (card):
`npm run typecheck --workspace=packages/sdk && npm run test:unit --workspace=packages/sdk`

Current `packages/sdk/` has only `package.json` (name/type/main/types, **no scripts, no
exports**) + `README.md`. Mirror the sibling `packages/kernel` pattern (already landed by
card `Fw1NtsCr`):

1. **`typecheck` + `test:unit` scripts** in `packages/sdk/package.json`
   (`"typecheck": "tsc --noEmit"`, `"test:unit": "vitest run"` — copy kernel verbatim).
2. **`exports` map**: `"./haptics": "./src/haptics/index.ts"`,
   `"./audio": "./src/audio/index.ts"`, `".": "./src/index.ts"` (source-shipped, no `dist/` —
   matches kernel + v1 convention).
3. **`tsconfig.json`** extending `../../configs/tsconfig.base.json`, `include: ["src"]`
   (identical to `packages/kernel/tsconfig.json`). Base is strict
   (`verbatimModuleSyntax`, `noUnusedLocals/Parameters`, etc.) and its `lib` includes `DOM`
   → covers `AudioContext`/`GainNode`/`navigator.vibrate` types with no extra `@types`.
4. **Vitest/TypeScript come from ROOT dev deps** (already present: `vitest ^4`, `typescript
   ^5.7`) — no per-package test dep. No `vitest.config.ts` is needed unless the default
   `**/*.test.ts` glob is insufficient (kernel ships none; match it).
5. **DECISION for worked stage — Capacitor deps.** The haptics carry imports
   `@capacitor/core` + `@capacitor/haptics`. Neither is in root deps today. Two options:
   - **(A)** add them to `packages/sdk/package.json` `dependencies` (they ship types; v1 uses
     both throughout). Simplest, matches "carry as-is". **Dependency addition — flag for the
     conductor/Batu** per CLAUDE.md's "ask first for dependency additions."
   - **(B)** make the native bridge injectable / dynamically imported so the SDK core stays
     dep-light (like kernel's zero-dep bar) and unit tests never touch native modules.
   Recommendation: **(A)** for a faithful carry, with tests mocking `@capacitor/core`
   (`getPlatform → 'web'`) so no native shell is needed — but this is Batu's call; do not add
   deps silently. If (A) is blocked, (B) keeps AC reachable.

## Acceptance criteria (restated) & how they'll be verified

- [ ] typed `AudioBus` interface + `GatedHaptics`/`createHaptics` + carried haptics compile —
      `npm run typecheck --workspace=packages/sdk`
- [ ] unit tests for **bus state machine** (mute/volume/duck, depth-counted) green
- [ ] unit tests for **haptics gating** (predicate false → no fire; true → web vibrate) green
- [ ] `package.json` `exports` map exposes `./haptics` and `./audio`
- [ ] no synth content copied from any game (bus + one test synth only)

## Surprises / open items to carry forward

- **S1 — "ducking" is a misnomer for what the games do.** The word implies "music ducks under
  sfx." **No game does that.** The only real duck is FTD's **ad-interruption hard-mute** of
  master, depth-counted (`adMusicPauseDepth`). The bus's `duck`/`unduck` generalizes *that*
  (depth-counted attenuation), not a sidechain compressor. Naming kept as `duck` per the card,
  but the semantics are "temporary attenuation with balanced nesting."
- **S2 — no game has a numeric volume slider.** arrow/block_blast/marble expose **no** volume
  API at all; FTD's gains are **binary 0/1**. The card mandates `volume`, so the bus adds a
  `0..1` scale as *new* surface (falls out free from `effectiveGain`), but be honest: it's
  forward-looking, not covering an existing shape. All internal gains are `0-1` (WebAudio),
  **never** `0-100` — so the bus is `0..1`.
- **S3 — mute persistence is a game concern, not the bus's.** block_blast persists its mute to
  `localStorage bb_sfx_muted`; marble/FTD read from `saveState`/`gameState.settings`. Every
  game **pushes** enabled-state in (or owns its own store). The bus stays storage-free; games
  wire persistence via `@fabrikav2/kernel`'s `persist`. Same decoupling principle as haptics'
  injected predicate.
- **S4 — master-output / recording-stream tap is a shared need (3 of 4 games).** block_blast,
  marble, FTD all expose the master node for the debug **recording harness** (testkit). The
  bus exposes `master: GainNode`; the actual `getRecordingStream()` MediaStream tap belongs in
  `packages/testkit`/debug, not the bus. Flag so the testkit card knows the accessor exists.
- **S5 — lifecycle policy stays in the game.** marble self-wires `visibilitychange`; FTD wires
  explicit hooks. The bus exposes `suspend()`/`resume()` primitives but **does not** auto-install
  document listeners — the game owns when to call them (differs per game).
- **S6 — haptics needs native deps to *carry faithfully*, which fights kernel's zero-dep ethos.**
  See scaffolding gap #5. This is the one genuine decision the `worked` stage can't make
  unilaterally (dependency addition). Pre-flag to Batu/conductor.
- **S7 — `@capacitor/haptics` `UNIMPLEMENTED` on web is the reason the web branch exists.** Do
  not "simplify" the carry by dropping the `getPlatform() === 'web'` fast-path — it prevents
  unhandled rejections that make the playwright/dev run noisy (the module's own header warns).
