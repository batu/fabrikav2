# 2026-07-13 — U3 Fail balance-pill panel clearance (card qrVosoLc, U3)

Repairs the aesthetics P1 bounce (Trello comments 60/61/62): the Fail balance
pill (`fail.currency`, **"25 Coins"**) sat with its bottom edge flush on the
`fail.panel` (**"Try Again"**) top border — an unintended collision. The
equivalent Win pill (`win.reward`, **"5 Coins earned"**) already cleared its
panel with a gap, proving this was not a designed badge.

Root cause: the neutral seed overrode geometry only for the menu dock trio and
copy for the fact instances, so `fail.currency` kept U1's kernel-default
geometry, which projects to `y=141.61`, **bottom=190.43 == `fail.panel` top
(190.43)**. `win.reward` sits higher at `bottom=122.84`.

Fix: the neutral seed now lifts `fail.currency` into the top HUD band —
`y=74`, **bottom≈122.8** — so it clears the panel top with the same ~68px gap
`win.reward` has. It is a **pure vertical move**: x (15.6), width (124.8),
height (48.815), and fit (`contain`) are U1's defaults for this instance,
unchanged. No colors or fonts were restyled; the override stays inside the
`currency-counter` role's geometry caps and the safe rectangle, so the editor
canvas and the portable publication project it identically.

Only source change: the seed-geometry map in
`tools/grapes-shell/src/shared/project.ts` (a `fail.currency` entry added to the
former `DOCK_LAYOUT`, generalized to `SEED_GEOMETRY`). A regression assertion in
`test/unit/project.test.ts` now proves the balance pill's bottom is above the
result-panel top on **both** the Win and Fail surfaces. The P0 `project.json`,
immutable publication, and Playwright previews were regenerated from the seed.

`fail.png` / `win.png` are the regenerated **portable publication** previews
(Playwright Chromium, 390x844, DPR 1, animations disabled) — the exact bytes
hashed into the immutable publication. They are **web-canvas** captures, **not a
device claim**.

- `fail.png` — the **"25 Coins"** balance pill now sits in the top HUD band,
  clearly above the **"Try Again"** panel; the priced continue
  **"Continue · 10 Coins"**, a free **Retry**, and the IAP
  **"Rescue bundle · $4.99 · Continue this level"** remain. No **Home**.
- `win.png` — the reference clearance the fix matches: **"5 Coins earned"**
  clears **"You Win"** with a gap; **Claim** + **"Claim 2x · Watch ad"**, no
  premature **Next/Home**. Unchanged by this pass.

## Content identity (this pass)

- projectHash        `sha256-e68a636aedcc7353295f4213e83f8cc5ee68d661d8b8aa045ec1f0c164754e7a`
- assetCatalogHash   `sha256-567fb5c6661910d22e498da0eaeca86d91e7b018c1d0b9ae0747d632a87de11e` (unchanged)
- publicationId      `sha256-a28631ac4776dbc7ba09968ab9ae5d4bcd0ae0fee7819f639fef922999f1f5f1`

Supersedes the prior projection publication `sha256-caa4b5a7…` /
projectHash `sha256-61e6c508…`. An A1 accept must republish with **both**
`--expected-project-hash` and `--expected-asset-catalog-hash` above. Human
accept/reject and any device proof remain conductor/A1-owned; U4 stays locked
until Batu explicitly accepts.
