# 2026-07-12 — Shop contrast remediation (card qWCv9tUo)

Remediation evidence for the U1 aesthetics-review blockers: price/restore CTAs
now use explicit accent fills with a legible muted disabled state, each
CTA/status chip renders inside its bounded item card, the locked card is
grounded (muted dashed fill, no opacity wash), Coins and Gems are visually
distinct labeled pills, Pause is a compact centered dialog (no bottom-sheet
drag handle), and the Shop header Back matches the Settings Back treatment.

Frames: `menu.png`, `shop.png`, `settings.png`, `pause.png`.

Capture medium — honest scope: Chromium (Playwright) against the vite dev
server, 390x844 viewport at 2x scale, states driven through the game's window
harness `driveTo`. This is a web-canvas capture of the deterministic DOM shell,
per the card's re-scoped verification ("no device claim is required for this
upstream deterministic card"). It is NOT a device claim; on-device frames come
from the lane device runs.
