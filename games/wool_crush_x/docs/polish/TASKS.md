# Wool Crush reference-polish task pack

## Task P1 - Make gameplay read as a crafted wool world

### Status

complete

### Goal

Replace the prototype-like gameplay composition with a dense, tactile wool scene that holds up beside the supplied gameplay references.

### Why Now

The first physical-iPhone capture disproves the earlier polish claim: shell surfaces are coherent, but gameplay is flat and visually unfinished.

### User Lens

The player currently sees a debug track with emoji actors and simple circles where the reference presents knitted materials, expressive characters, depth, and a deliberately composed playfield.

### Pre-Shot Targets

- Level 1 initial state on the physical iPhone
- Reference frames `gameplay-8.png` and `gameplay-20.png`

### Repro Setup

- Route: installed Capacitor app, Play → Level 1
- Device: Batu's iPhone, portrait, 390×844 CSS px / 3× DPR
- State: untouched level start

### Acceptance Criteria

- The track, background, dragon, kitten, threads, and spools all use a coherent tactile yarn/felt material language; no emoji remain.
- Gameplay fills the upper and middle viewport with a clear focal path and no accidental dead zone.
- The objective and next action are understandable within five seconds through visual hierarchy and a first-move cue.
- HUD and controls remain safe-area compliant and at least 44 CSS px.

### Expected Visual Result

A warm knitted tabletop scene with a stitched path, layered braided dragon, expressive textile characters, dimensional spool tray, and immediate action cue.

### Constraints

- Preserve engine legality, level solutions, economy, and win/fail conditions.
- Device capture is the acceptance surface; desktop rendering is not evidence.

### Out of Scope

- Changing the core queue/spool mechanic to match the reference's arrow-block puzzle.
- New paid asset-generation calls.

### Verification

- Same-state before/after physical-iPhone screenshots.
- Unit tests, typecheck, production build, and rendered input-path behavior.

### Spawn Rules

- If shell HUD polish remains visibly behind after gameplay passes, promote it to P2.
- If motion cannot be judged from a still, capture a short physical-device clip as P3.

## Task P2 - Tighten gameplay HUD hierarchy

### Status

complete

### Goal

Reduce top-of-screen crowding and make level, objective, lives, currency, and settings feel intentionally grouped.

### Acceptance Criteria

- No text overlaps or competes with the playfield.
- Level/objective is readable without becoming the dominant object.
- Lives, currency, and settings remain stable and thumb-safe.

## Task P3 - Prove move-level game feel

### Status

partial — final tour proves the resting device states, but no finger-driven move clip was captured

### Goal

Verify that selecting and resolving a spool has crisp visual motion and immediate feedback comparable in intensity to the references.

### Acceptance Criteria

- Tap response is immediate and visible.
- Thread pull and dragon advance are legible without blocking repeated play.
- Device video shows stable frame pacing through a move and outcome.
