# CAMELEON

A portrait hidden-object game: scroll wide illustrated scenes and find the white
doughboy people painted into them. Every hide is a person in one of the original
game's canonical poses (see `docs/LEVELS.md` §8), painted in its host surface's
pattern — visible but misread. Tap one: red slam, paint peels, the white body
ragdolls out and joins the bench.

Four levels on a single-path saga: **The Marble Bathhouse → Splashworld Arcade →
The Natatorium Museum → Sunwash Lido.** Win at 8 of 10 hides; find all ten for
SPOTLESS. Three input modes: tap, shoot (14 darts), confirm (reticle + 16).
Art direction: the original Screenprint style (see `docs/LEVELS.md` §7 for the
evaluation that chose it). Shell: `@fabrikav2/ui` kit (HomeMenu + saga, Settings,
ResultCard, PauseOverlay).

## Run

```bash
npm run dev -w @fabrikav2/cameleon        # browser dev
npm run test:unit -w @fabrikav2/cameleon  # 75 unit tests
DEVELOPMENT_TEAM=<team> npm run verify-device -- --game cameleon   # iPhone gate
```

Debug params: `?bodies=painted|white|off`, `?mode=tap|shoot|confirm`, `?dir=screenprint`.

## Where things live

- `docs/DESIGN.md` — day-1 design record; `docs/LEVELS.md` — current binding
  design (levels, rosters, pose registry, evaluation protocol + verdicts).
- `docs/placement-*.json` — conductor placement manifests; `docs/mock-*.jpg` —
  composed panoramas per level.
- `docs/gen-ledger.md` — every image-generation call and its cost.
- `design/asset-identity.json` — provenance for every committed asset.
- `refs/` — reference corpus (MECCHA, pose sheet, at-rest device baselines).
- `evidence/` — device verification evidence per milestone.
