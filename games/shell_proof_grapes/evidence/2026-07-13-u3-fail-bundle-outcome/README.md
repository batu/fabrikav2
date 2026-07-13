# 2026-07-13 — U3 Fail rescue-bundle outcome disclosure (card qrVosoLc, U3)

Repairs the aesthetics P1 bounce (Trello comments 47/48): the Fail rescue bundle
projected its name and price (**"Rescue bundle · $4.99"**) but omitted the
required **outcome/content** the purchase grants. In `shell_proof_phaser` the
bundle is a two-line button — the `fail.bundle` label plus a `fail.bundle.sub`
outcome line (**"Continue this level"**, `games/shell_proof_phaser/design/copy.ts`;
price `$4.99` from `proofShopCatalog` product `rescue_bundle`). The Grapes
`fail.bundle` instance is a single `bottom-secondary-action` leaf with one
editable copy field, so all three facts must read on that one line.

The only source change is `tools/grapes-shell/src/shared/project.ts`
(`SEED_COPY["fail.bundle"]`). Price, purchase action (`data-action` bundle /
`commerce.bundle` binding), asset (`button-surface.secondary`), and semantic
identity are unchanged — only the outcome fact was added. No colors or fonts were
restyled; the copy stays inside the role's 512-code-point copy limit, so the
editor canvas and the portable publication project it identically. The P0
`project.json`, immutable publication, and Playwright previews were regenerated
from the seed.

`fail.png` is the regenerated **portable publication** preview (Playwright
Chromium, 390x844, DPR 1, animations disabled) — the exact bytes hashed into the
immutable publication. It is a **web-canvas** capture, **not a device claim**.

- `fail.png` — the coin balance **"25 Coins"**, the priced continue
  **"Continue · 10 Coins"**, a free **Retry**, and the IAP
  **"Rescue bundle · $4.99 · Continue this level"** are all visible. The bundle
  now discloses its outcome. No **Home**.

`menu.png` / `win.png` are unchanged from the prior pass
(`../2026-07-13-u3-dock-winfail-projection/`); only `fail.bundle` copy changed.

## Content identity (this pass)

- projectHash        `sha256-61e6c508aa28c287c0ea19780508c906a82d6d5f2bc164582d920c6ae6aaebc6`
- assetCatalogHash   `sha256-567fb5c6661910d22e498da0eaeca86d91e7b018c1d0b9ae0747d632a87de11e` (unchanged)
- publicationId      `sha256-caa4b5a78cf92c320f734b0d6cb79aca30d1b6b5368bd8d9d6bd005a13396ece`

Supersedes the prior projection publication `sha256-d2912a61…` /
projectHash `sha256-1291aa4c…`. An A1 accept must republish with **both**
`--expected-project-hash` and `--expected-asset-catalog-hash` above. Human
accept/reject and any device proof remain conductor/A1-owned; U4 stays locked
until Batu explicitly accepts.
