# 2026-07-13 — FTD rewire aesthetics P1 remediation (card qWCv9tUo, U1)

Fresh frames after remediating the five aesthetics-round-1 P1 blockers on the
Find-the-Dog structure rewire. Filenames match the reviewer's requested set:
Menu, Win-preclaim, Win-postclaim, Fail (plus the unchanged surfaces).

- `menu.png` — the bottom nav dock now reads **PLAY** on the dominant center
  action (was "Continue"), and the **Shop / Settings** labels ride the light
  on-accent ink so they stay legible on the dark slate dock (was dark-on-dark).
  *(P1-1 Play copy, P1-2 dock contrast.)*
- `win-preclaim.png` — the pre-claim win surface shows **only** the reward
  readout (**"5 Coins earned"**), **Claim**, and **Claim 2x / Watch ad**. The
  Next navigation is **not** disclosed — no disabled Next is shown. *(P1-3.)*
- `win-postclaim.png` — after Claim, the two claim actions are **replaced** by a
  single enabled **NEXT**; the reward readout stays. *(P1-3.)*
- `fail.png` — the **Rescue bundle · $4.99** is now a complete, bounded purchase
  card-button (white card surface with its own accent border) rather than loose
  text, and the docked rescue sheet floors its bottom padding above the
  safe-area inset so the bundle no longer reaches the raw viewport bottom.
  *(P1-4 safe-area clearance, P1-5 complete bundle card.)* Continue · 10 Coins,
  free Retry, priced bundle — still no Home.
- `shop.png`, `settings.png`, `pause.png` — unchanged seven-surface context.

Capture medium — honest scope: Chromium (Playwright) against the Vite dev
server, 390x844 viewport at 2x device scale, states driven through the game's
window harness `driveTo` (Win-postclaim is captured after clicking Claim). This
is a **web-canvas** capture, **not a device claim**.

Device proof (Android via ADB, iPhone WKWebView) of these frames is downstream
and **conductor-owned** — see the card verification. It is recorded as
remaining, never faked.
