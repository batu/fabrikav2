# 2026-07-13 — FTD structure rewire (card qWCv9tUo, U1)

Fresh frames of the three restructured surfaces plus the unchanged ones, after
the Find-the-Dog structure rewire.

- `menu.png` — the persistent bottom nav dock: **Shop** (left), **Continue/Play**
  (center, accent-filled and dominant), **Settings** (right). Currency stays in
  the header; the level map stays above the dock. Shop and Settings left the header.
- `win.png` — the claim surface: a **"5 Coins earned"** reward readout, an accent
  **Claim**, **Claim 2x / Watch ad** (the deterministic rewarded-ad seam), and a
  muted, **gated Next** (disabled until a claim succeeds).
- `win-claimed.png` — after Claim: the claim group is spent and **Next** is enabled.
- `fail.png` — the rescue surface over frozen gameplay: the coin balance, an accent
  **Continue · 10 Coins**, a free **Retry**, and the priced IAP **Rescue bundle · $4.99**.
  There is **no Home**.
- `shop.png`, `settings.png`, `pause.png` — unchanged seven-surface context.

Capture medium — honest scope: Chromium (Playwright) against the Vite dev server,
390x844 viewport at 2x device scale, states driven through the game's window
harness `driveTo`. This is a **web-canvas** capture, **not a device claim**.

Device proof (Android via ADB, iPhone WKWebView) of these frames is downstream
and **conductor-owned** — see the card verification. It is recorded as remaining,
never faked.
