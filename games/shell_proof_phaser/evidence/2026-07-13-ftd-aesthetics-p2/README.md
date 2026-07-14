# 2026-07-13 — FTD rewire aesthetics P2 remediation (card qWCv9tUo, U1)

Fresh frames after closing the two aesthetics-round-2 P1 blockers (card comment
57/58) plus the surgical contract-adjacent P2s. Filenames match the reviewer's
requested set: Menu, Win-preclaim, Win-postclaim, Fail.

- `win-postclaim.png` — **P1-1 (post-claim Home).** After a claim, the surface
  shows **NEXT** (primary) **and Home** (a quiet tertiary below a divider). Home
  is a genuinely claimed-only disclosure: it is **not** shown before a claim.
  `win.home` is reintroduced in `shell-presentation.v2` as an optional,
  default-hidden, action-less instance (parallel to `win.next`).
- `win-preclaim.png` — the pre-claim win surface still discloses **only** the
  reward readout, **Claim**, and **Claim 2x / Watch ad** — **no Next, no Home**.
  P2s folded in: the reward readout is one wider line with an enlarged amount;
  **Claim 2x** carries an accent border so it reads as a live reward path; the
  action stack reserves the taller pre-claim height so it does not jump when the
  claim actions swap for Next + Home.
- `fail.png` — **P1-2 (bundle outcome disclosure).** The **Rescue bundle · $4.99**
  now spells out its outcome on a second line — **"Continue this level"** (it
  grants no coins and resumes the current level) — in both the visible label and
  the `aria-label`, so it is never an undisclosed charge. P2s folded in:
  Continue + Retry read as the two immediate choices with the paid bundle
  separated below a wider gap, and the **false drag handle** is removed (the
  docked sheet is not draggable, so it no longer advertises a grabber). The
  safe-area bottom-padding floor is preserved.
- `menu.png` — unchanged this round (Shop / **Play** dominant / Settings dock).

`measurements.json` — machine DOM measurements captured in the same Playwright
run: pre-claim has no Next/Home; post-claim Next is primary and Home is tertiary
(48 CSS px); every Fail control ≥ 48 CSS px (Continue 54, Retry 54, bundle 59);
the fail card `::before` drag-handle content is `none`; the bundle text/aria
contain "Continue this level".

Capture medium — honest scope: Chromium (Playwright) against the Vite dev
server, 390×844 viewport at 2× device scale, states driven through the game's
window harness `driveTo` (Win-postclaim is captured after clicking Claim). This
is a **web-canvas** capture, **not a device claim**.

Device proof (Android via ADB, iPhone WKWebView) of these frames is downstream
and **conductor-owned** — see the card verification. It is recorded as
remaining, never faked.
