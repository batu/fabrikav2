---
title: "feat: MRV2-3 asset port with two-way inventory manifest"
date: 2026-07-22
type: feat
origin: Trello card yAjYXpmj (MRV2-3) — card description is the product contract
trello: https://trello.com/c/yAjYXpmj
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
depth: standard
---

# feat: Asset port sugar3d → marble_run with two-way inventory manifest

## Summary

Copy every real asset from v1 `fabrika/games/marble_run/sugar3d` into v2 `games/marble_run`, byte-identical, and check in `games/marble_run/docs/asset-manifest.json` (per asset: v1 path, v2 path, bytes, sha256) plus a vitest check that recomputes hashes and fails on any missing/extra/changed file in either direction. No gameplay or code wiring — this card is asset transport + proof only.

## Ground truth (surveyed 2026-07-22)

- v1 asset inventory: **57 files, ~6.5 MB**, all under `src/ui/assets/**` (42, incl. `fonts/` ×3, `source/` ×7, `vida/**` ×17) and `native-resources/android-res/**` (15 launcher mipmaps). v1 has **no `public/` directory** and no models/audio files — despite the card mentioning them, the extension sweep (png/webp/jpg/svg/glb/gltf/hdr/mp3/ogg/wav/m4a/ttf/otf/woff/woff2/ico) found only images + 3 fonts. `dist/`, `android/`, `ios/`, `node_modules/`, `test-results/`, `refs/` are excluded per card.
- v2 `games/marble_run` exists (MRV2-1 scaffold from shell_template) with placeholder shell_template art under `public/ui/**`, `public/fonts/`, `public/audio/`, and shell iOS resources under `native-resources/ios/`.

## Design decisions

1. **Asset definition = extension allowlist** above, applied to `src/`, `public/` (absent), `native-resources/` of v1. Deterministic, checkable, matches the card's exclusions.
2. **v2 destination mapping** (follow shell_template layout: runtime art lives in `public/`):
   - `src/ui/assets/<x>` → `games/marble_run/public/v1/ui/<x>` (preserving `fonts/`, `source/`, `vida/**` subtrees). A dedicated `public/v1/` root keeps the ported set cleanly separable from scaffold placeholders — later MRV2 cards rewire code to these paths; this card does not touch code.
   - `native-resources/android-res/**` → `games/marble_run/native-resources/android-res/**` (same relative path; v2 currently has only `ios/`, no collision).
3. **Manifest**: `games/marble_run/docs/asset-manifest.json` — sorted array of `{ v1Path, v2Path, bytes, sha256 }`, paths repo-root-relative (v1 paths relative to the fabrika v1 checkout root, recorded with a `v1Root` note in a header object so the check can locate them).
4. **Two-way check**: vitest file `games/marble_run/tests/unit/asset-manifest.test.ts` that:
   - Recomputes the v1 inventory from disk with the same allowlist/exclusion rules → fails if any v1 asset is missing from the manifest (v1 extra) or a manifest entry has no v1 file (v1 missing).
   - For each entry, verifies the v2 file exists, `bytes` and `sha256` match on **both** sides.
   - Scans `games/marble_run/public/v1/**` and `native-resources/android-res/**` for files not in the manifest → fails on v2 extras. Scaffold placeholder dirs (`public/ui`, `public/fonts`, `public/audio`, …) are outside the scanned roots, so they are untouched and unflagged.
   - Skips gracefully (with an explicit `it.skip` + console note) if the v1 checkout is absent (CI without fabrika v1), so the unit lane stays green elsewhere; locally it must run fully.
5. **Copy mechanics**: a small one-shot generator script `games/marble_run/scripts/build-asset-manifest.mjs` does copy + manifest emission (node, no deps, `crypto` sha256). Checked in so the port is reproducible; the test remains the enforcement.

## Steps

1. Write `scripts/build-asset-manifest.mjs` (inventory rules → copy → manifest write).
2. Run it; eyeball the manifest (57 entries expected, ~6.5 MB total).
3. Write `tests/unit/asset-manifest.test.ts` two-way check.
4. Run `npm run typecheck` and the unit lane for marble_run; run the manifest test explicitly.
5. Commit assets + manifest + script + test.

## Exit bar (verification)

- Manifest check passes: **0 missing, 0 extra, 0 mismatched in both directions**; paste total asset count and total bytes into the handoff/card.
- `typecheck` + `test:unit` green for `games/marble_run`.
- `git status` clean outside `games/marble_run/**` (scope fence).

## Risks / notes

- Card text mentions models/audio; v1 has none outside build output — the manifest is the proof of "nothing missing, nothing invented", so 57 image/font files is the honest total. Flag in handoff.
- `src/ui/assets/source/*.png` are design sources for the sibling `.webp` runtime files; card says 1:1 port of everything, so they are included.
- Later cards must repoint v2 code to `public/v1/...` paths; that is explicitly out of scope here.
