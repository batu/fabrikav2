---
status: passed
subject: Find game AdMob identity isolation
created: 2026-09-02
mode: pipeline
---

# Evidence: Find game AdMob identity isolation

## Verdict
Both production validators and runtime composition paths are bound to their own committed AdMob tuple, and both production iOS bundles contain only the owning game's tuple.

## What Changed
- Loaded each release identity from its committed `config/admob.public.json`.
- Rejected cross-game, mixed, and arbitrary well-shaped production identities.
- Corrected only the four AdMob identity fields in the ignored FTD owner environment while preserving all other content and mode `0600`.

## Evidence Captured
| Type | Artifact / Command | Result |
|------|--------------------|--------|
| RED test | Focused `game-env`, AdMob config, and SDK composition regressions before implementation | failed for missing tuple binding as expected |
| GREEN test | `npx vitest run tools/game-env/test/game-env.test.mjs` | 61 passed |
| game test | `npm run test:unit -w @fabrikav2/find_the_dog` | 315 passed |
| game test | `npm run test:unit -w @fabrikav2/find_the_bird` | 396 passed |
| SDK test | `npm run test:unit -w @fabrikav2/sdk` | 343 passed |
| native-shell test | `npm run test:unit -w @fabrikav2/native-shell` | 15 passed |
| static checks | FTD, FTB, and SDK typechecks; FTD, FTB, SDK, and native-shell lints | passed; one pre-existing SDK lint warning |
| release validation | Real iOS `game-env` validators for both games | passed with no missing, invalid, or empty override keys |
| native validation | FTB generated-shell validation | passed; FTD generated Android shell validation is blocked by pre-existing `origin/main` package-identity drift (`com.basegamelab.find_the_dog.dev` expected versus `com.basegamelab.findthedog` declared) |
| production build | `npm run build:ios` for both game workspaces | passed |
| bundle scan | Exact four-value tuple scan of both generated `dist` trees | each own tuple fully present; other tuple fully absent |
| owner env | Ignored-file, permission, and exact committed-tuple checks | both ignored, mode `0600`, exact match |
| repository checks | `git diff --check` and high-confidence added-lines secret scan | passed |

## Reviewer Assessments
No specialized reviewer was needed for this non-visual configuration and policy change.

## Gaps
- No external provider mutation or device release was attempted during this evidence capture.
- FTD's generated Android shell currently has a pre-existing package-identity drift on `origin/main`; this evidence does not claim that Android validator passed. The iOS environment validator and iOS production build passed.

## Next Action
None.
