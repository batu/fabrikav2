# U6 P1 fix — BROWSER proof (NOT device evidence)

Date: 2026-07-14

> ⚠️ **This is a Chromium (Android-WebView engine) render, not a Pixel 6a
> capture.** It proves the *code changes* took effect and is NOT a substitute
> for on-device verification. The full seven-state + four-beat Pixel 6a
> recapture is conductor/device-owned (this worker sandbox has no adb/device).

Rendered from the real game dev server (`vite`, port 5399), driving the frozen
harness `__SHELL_PROOF_PHASER_HARNESS__` and reading the frozen evidence probe
`__SHELL_PROOF_PHASER_EVIDENCE_PROBE__`. Applied projection is unchanged:
`sha256-42f2a6ef…` over publication `sha256-132969b9…`.

## What each shot proves

- `menu.png`, `level.png`, `shop.png` — the player-visible `PHASER · 42f2a6ef`
  revision badge is **gone** from the canvas (P1 #1). Identity is preserved
  nonvisually: the boot log `[fabrikav2:projection-ready]` still carries the
  exact publication/projection ids, and the probe still returns
  `revision: sha256-42f2a6ef…` / `sentinel: "42f2a6ef"` (see `probe.json`).
- `level.png` — the **Win / Lose** row now clears the bottom; `#app` is inset by
  `max(env(safe-area-inset-bottom), 32px)` so Phaser FIT-scales the authored
  390x844 grid *into* the safe box (measured canvas 375x812, bottomGap 32px in a
  390x844 viewport). No authored coordinate moves (P1 #3). The device-exact
  clearance still needs a Pixel 6a confirmation.
- `win-preclaim.png` vs `win-postclaim.png` — the Win **pre-claim** and
  **post-claim** beats are genuinely distinct (Claim + Watch-ad → Next + Home),
  driven by tapping the Claim rect from the probe's authored hit geometry. See
  `probe.json`: pre-claim exposes `claim`/`claim-double` visible+enabled; after
  the claim tap they are hidden and `next`/`result-home` become visible+enabled.

## Still open (see card handoff)

- `shop.png` still shows the **stray VIP-bundle icon** (the small
  `progression_node_locked` glyph on the trophy). It is authored in U5's
  immutable publication source, so U6 cannot remove it without re-authoring U5's
  publication and re-keying the P0/A/B apply chain (P1 #2 — routed to U5).
- `win-postclaim.png` also reveals a **post-claim layout concern** in the
  authored Win scene: the claim/watch-ad button *surfaces* remain while
  Next/Home render at the modal's bottom edge. First time this beat was
  rendered; needs device review.
