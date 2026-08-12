# Two-stage level review evidence

- Date: 2026-08-10
- Scope: Find the Bird level editor hitbox blessing and final-cutout blessing
- Result: PASS, with one disclosed stale aggregate smoke test

## Contract verified

1. `Save Image` is absent from Gallery cards and the focused review modal.
2. Hitbox review and final-cutout review are separate, checksum-backed metadata stages.
3. Current hitbox blessing is required before cutout creation, auto-placement, regeneration, or final cutout blessing.
4. Hitbox edits revoke hitbox and final-cutout currency; sprite, placement, flip, or human-confirmation edits revoke final-cutout currency.
5. The author CLI stops at a human-review checkpoint and can resume after hitbox blessing.

## Automated checks

From `tools/level-editor`:

```text
uv run pytest -q
328 passed, 3 warnings in 10.24s
```

From `tools/level-editor/ui`:

```text
npm run build
113 modules transformed; production build completed in 540ms

npm run test:cutout-review-panel
PASS
```

Repository diff validation:

```text
git diff --check -- tools/level-editor CONTEXT.md
PASS
```

## Rendered UI inspection

The current UI and backend were exercised together at `127.0.0.1:5201` and `127.0.0.1:5200`, then the canonical Portal backend was restarted on `127.0.0.1:5196`.

- Gallery DOM: `Save Image=0`, `HB ✓=5`, `CUT ★=5`.
- Reviewed modal: `Save Image=0`; `✓ Hitboxes blessed` and `★ Cutouts final` both rendered.
- Unreviewed modal: `Bless hitboxes` enabled; `Final-bless cutouts` disabled; title says `Bless the current hitboxes before final-blessing cutouts.`
- API sample `american_southwest_sw_adobe_courtyard_bird_419b`: both review stages current, final readiness true, zero missing cutouts.
- API sample `ad_campaigns_ad_treehouse_village_bird_24d4`: neither stage blessed, final readiness false, 20 missing cutouts.

Screens inspected during the run:

- `/tmp/ftb-two-stage-gallery-final.png`
- `/tmp/ftb-two-stage-modal-final.png`

## Disclosed gap

`npm run test:gallery-retired-actions` remains stale and fails while waiting for the retired `Add to Lineup` button on its synthetic missing-asset card. It fails before reaching this change's review-state assertions. This is a test-fixture maintenance issue, not evidence for or against the two-stage blessing behavior.

No provider generation or other paid API was invoked during this verification.
