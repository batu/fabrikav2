# U3 GrapesJS V2 rehearsal and A1 checkpoint

This run proves the seven-surface constrained editor and prepares the human A1 decision without submitting one.

## Authoritative P0

- Implementation commit: `406c496560cf2f5168475e67756f682ca21f03b2`
- Target game: `shell_proof_grapes`
- Seed-default project hash: `sha256-b60ac1881c21286da7b91ae169c5f57fb7aee3635ab8bc937c905f093dc8407d`
- Reviewed full asset-catalog hash: `sha256-567fb5c6661910d22e498da0eaeca86d91e7b018c1d0b9ae0747d632a87de11e`
- Immutable `dom-css` publication: `sha256-934ccf1fde94482ccfdf93f545d1c1b518a0c1d51d9e42eea98f3458e4fb4a8f`
- Preview fingerprint: `sha256-712a531e72e05febdf5e3af355e9f5723ba42cdb2df6896a58f79470f5535f81`

The P0 project under `authoring/grapesjs/` remains the only editable authority. Its publication and previews are immutable derived records.

## Rehearsal

The self-contained `a1-review.html` ran in isolated Chromium at 1440×900 and exercised all seven surfaces, clean preview, direct drag, direct resize, live copy, palette, layer order, compatible asset replacement, stable duplication, duplicate visibility, browser save, and close/reopen.

The edited rehearsal draft hash is `sha256-716c5462e8b5c7b2a754940ba27c5e171d9278b4d626a128105b1f8f87ace975`. It is usability evidence only; it does not replace or publish over P0.

The capture recorded zero external requests, console errors, page errors, or private-pattern matches. See `u3-v2-a1-capture.json`, the five screenshots, and the WebM recording.

## Human boundary

No A1 verdict was submitted. The embedded checkpoint keeps Accept locked until all nine representative tasks are checked and keeps Reject locked until a written reason is supplied. U4 remains gated on Batu's explicit response.

## Reproduce

```sh
npm run build -w @fabrikav2/grapes-shell
node games/shell_proof_grapes/evidence/2026-07-12-u3-grapes-rehearsal/build-a1-review.mjs
node games/shell_proof_grapes/evidence/2026-07-12-u3-grapes-rehearsal/capture-a1-review.mjs
```
