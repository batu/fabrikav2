# 2026-07-13 — U3 dock + win/fail projection repair (card qrVosoLc, U3)

Repairs the aesthetics P1 bounce (Trello comments 43/44): the U3 semantic data
was rewired to the merged U1 seven-page contract, but the P0 seed projected the
pre-rewire visual structure and omitted required source-grounded facts. The only
source change is `tools/grapes-shell/src/shared/project.ts` (`createStarterProject`
authoring overrides); the P0 `project.json`, immutable publication, and Playwright
previews were regenerated from it. No colors or fonts were restyled; every
override stays inside its role's geometry caps, safe bounds, and copy limits, so
editor and portable project identically (same `projectSemanticLayout`).

Frames are the regenerated **portable publication** previews (Playwright Chromium,
390x844, DPR 1, animations disabled) — the exact bytes hashed into the immutable
publication. They are a **web-canvas** capture, **not a device claim**.

- `menu.png` — the bottom **menu.nav** dock now reads **Shop** (left), **Play**
  (center, accent-filled and dominant), **Settings** (right). Before this pass
  Shop and Settings rendered as top-right header icons (their U1 role anchor);
  their geometry now seats them on the dock bar. Currency stays in the header and
  the progression map stays above the dock.
- `win.png` — the reward readout now shows **"5 Coins earned"** and the double
  claim shows **"Claim 2x · Watch ad"** (the rewarded-ad seam). **Claim** is the
  primary action; no premature **Next/Home** is introduced.
- `fail.png` — the coin balance **"25 Coins"**, the priced continue
  **"Continue · 10 Coins"**, a free **Retry**, and the priced IAP
  **"Rescue bundle · $4.99"** are all visible. No **Home**.

Source of the win/fail values: the U1 Find-the-Dog shell reference in
`../2026-07-13-ftd-structure-rewire/` (win 5 coins earned, fail 25-coin balance,
continue · 10 coins, rescue bundle · $4.99).

## Content identity (this pass)

- projectHash        `sha256-1291aa4c1699e52cda18c9fe8b67a14a6b37c8159266df8713add14d927ba38b`
- assetCatalogHash   `sha256-567fb5c6661910d22e498da0eaeca86d91e7b018c1d0b9ae0747d632a87de11e` (unchanged)
- publicationId      `sha256-d2912a61c007d2b5ac511f25f5b2a5a2314f1b06621f991a654126c911fed5df`

An A1 accept must republish with **both** `--expected-project-hash` and
`--expected-asset-catalog-hash` above. Human accept/reject and any device proof
remain conductor/A1-owned; U4 stays locked until Batu explicitly accepts.
