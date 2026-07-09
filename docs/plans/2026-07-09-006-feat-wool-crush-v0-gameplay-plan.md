---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
---

# Wool Crush v0 Gameplay - Plan

## Goal Capsule

Build the v0 gameplay of Wool Crush in `games/wool_crush/`: a thread-board → 4-slot spool
buffer dueling a segmented yarn dragon that advances toward a cat. Product authority:
Batu's dictated design (2026-07-09), grilled via ce-brainstorm this session; full mechanics
record in `games/wool_crush/docs/brief.md`. Open blockers: none — all edges ruled.

## Product Contract

### Core mechanics (all ruled by Batu, 2026-07-09)

1. **Board**: a grid of yarn threads, each with a color, a direction, and a **length**.
   Tapping a thread slides it straight along its direction, off the board — unless another
   thread blocks its path (then it cannot move at all). No walls/obstacles in v0.
2. **Slots**: a released thread becomes a **spool** in one of 4 slots (leftmost free slot).
   Exactly 4 slots, always.
3. **Dragon**: a chain of colored yarn sections sliding along a winding track toward a cat at
   constant speed. **Screen layout**: the track occupies the TOP half as an S / reverse-S
   curve (matches reference frames); the thread board occupies the BOTTOM half. The dragon is
   **longer than the visible track** — the tail feeds in from the top edge, so only the front
   portion is visible.
   Dragon composition is derived from the board: sections per color == total thread length
   per color (conservation invariant; a level is defined by its thread map alone).
4. **Pulling**: a spool automatically pulls the **closest visible matching section**
   (pullable = sections currently on screen; the viewport is the scarcity window).
   Pulled from the middle → the body **seams shut (gap closes, Zuma-style)**.
   While any pull is active the dragon **holds in place** (it shortens instead of advancing).
   A spool with no visible match **idles, keeping its progress and its slot**.
5. **Spool lifecycle**: a spool of length N pulls exactly N sections, then completes and
   frees its slot. When several spools could finish, the **closest-to-finish finishes first**.
6. **Win**: board cleared (== dragon fully consumed, by conservation).
7. **Fail**: the dragon's head reaches the cat. No separate deadlock detection in v0 — idle
   spools lose the race naturally (e.g. 4 teal spools while teal lives at the unseen tail).

### v0 scope

- 3 levels, single layout style, ramping difficulty (~6 tiles/3 colors → ~10/4 → ~14/5 —
  tuning numbers, not contract).
- Pull rate and dragon speed are tuning constants.
- **Minimalist gameplay rendering**: dragon = a simple curving line of colored sections; board
  and slots simple shapes. Juice later. **Shell/menus are a full asset clone** of the
  reference (style guide + design sheet landed 2026-07-09).
- Analytics: existing `level_start` / `level_complete` / `level_fail` from game.config.ts.

### Out of scope (v0)

- Boosters (4 exist in reference; discard/swap are sellable boosters later).
- Warehouse boxes (they spawn new tiles — later).
- More than 4 slots, walls/obstacles, timers, scoring/stars, shop/economy behavior.

### Success criteria

- Level 1 (~6 tiles) is winnable by a first-time player; level 3 requires actual sequencing.
- The teal-death scenario is reproducible: releasing spools whose colors are only at the
  unseen tail loses the level.
- Conservation invariant holds for every shipped level (unit-tested).
- Game states drive via harness `driveTo` and match `refs/manifest.yaml` states.

### Key decisions (why)

- **Viewport-as-zone**: keeps Batu's original scarcity/sequencing soul with trivial
  implementation (pullable = on-screen sections), after grilling showed whole-dragon
  pullability + conservation made fail unreachable and order irrelevant.
- **Gap-closes body**: mid-body pulls change adjacencies → planning depth.
- **Level-as-data**: dragon derived from thread map; content is data, kernel is code
  (fabrikav2 house pattern).
