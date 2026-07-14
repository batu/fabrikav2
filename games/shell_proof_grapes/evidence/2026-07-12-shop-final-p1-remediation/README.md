# 2026-07-12 — Final-pass P1 remediation (card qWCv9tUo)

Remediation evidence for the two P1s from the final U1 aesthetics pass.

P1-1 (two-column grid contract): the full-row span on the lone locked sample
card is removed. Item C is one column wide again and the fourth grid cell
stays naturally empty, per the conductor's product-contract resolution — no
fourth product is invented. `shop.png` shows the locked card occupying only
the first column of row 2; `shop-control-measurements.json` records each
card wrapper at 0.484 of the grid width.

P1-2 (>=48px control floor): measured on the live page, every Shop control
and state chip renders at exactly 48 CSS px — the live `$0.99` price CTA,
the inert `OWNED` chip, the disabled `UNAVAILABLE` chip, `RESTORE PURCHASES`,
and the header Back. Per-control bounding-box heights are recorded in
`shop-control-measurements.json`. The floor was already carried by
`min-height: var(--fab-btn-min-size)` (48px) at the reviewed SHA — a pixel
scan of the prior committed `shop.png` shows the same 96-image-px (=48 CSS px
at 2x) CTA fills — so this pass encodes the floor as a frozen test (explicit
min-height pins on the price and restore CTAs plus a guard that no
disabled/owned/locked state rule restyles height) rather than changing
rendered behavior.

Frames: `menu.png`, `shop.png`, `settings.png`, `pause.png`.
Measurements: `shop-control-measurements.json` (bounding-box heights/widths
per control and grid placement per card, captured in the same run as the
frames).

Capture medium — honest scope: Chromium (Playwright) against the vite dev
server, 390x844 viewport at 2x scale, states driven through the game's window
harness `driveTo`. This is a web-canvas capture of the deterministic DOM shell,
per the card's re-scoped verification ("no device claim is required for this
upstream deterministic card"). It is NOT a device claim; on-device frames come
from the lane device runs.
