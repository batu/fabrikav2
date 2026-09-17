# Find the Bird: Collection + Sanctuary continuation (handoff, 2026-09-18)

Read this whole file before touching anything. The human (Batu) will not restate context.

## Where the work lives

- Repo: `/Users/base/dev/appletolye/fabrikav2` (monorepo). Game: `games/find_the_bird`.
- Worktree in use: `/Users/base/dev/appletolye/fabrikav2/.worktrees/ftd-collection` on branch `feat/ftd-collection-sanctuary`, 84 commits ahead of `origin/main`, rebased onto main on 2026-09-17. Work ONLY in this worktree. Tree is clean at `9c65f57fc`.
- Do not push. Do not open a PR. Do not merge. Batu tests on his phone and says what changes next.
- Scratch files of the previous session (capture scripts, composites) were in a session scratchpad under `/private/tmp/claude-501/…/scratchpad`; treat them as gone and rebuild from the recipes below.

## What the feature is

Two meta pages reached from the home nav bar: **Collection** (bird cards) and **Sanctuary** (coin sink: buy/upgrade a nest box, place birds). Three birds in a chain: sparrow "Chirpy", robin "Rusty", bluebird "Skye". Each bird has a 3-rung ladder (card unlock / hat / full costume) driven by pickups of that species during levels. Robin opens when the sparrow claims rung 2; bluebird when the robin claims rung 2. Collection gate: 10 completed levels. Sanctuary gate: 15 levels plus sparrow rung 1 claimed.

Key files: `src/collection/{birds,ladders,thresholds,cardModel,config}.ts`, `src/ui/{CollectionPage,SanctuaryPage,HUD,metaNavBar}.ts`, `src/sanctuary/{layout,accrual}.ts`, `src/core/GameState.ts` (ladders, sanctuary, bird counts), `src/scenes/GameScene.ts` (`countCollectedBird`), `src/data/birdTypes.ts` (tag loader), `src/config/remoteConfigSchema.ts` (all tunables), `src/testing/TestHarness.ts` (tour states), `public/levels/bird-types.json` (species tag per sprite), `public/ui/sanctuary/manifest.json`.

## Standing constraints from Batu (do not relitigate)

1. **No unit tests until the end.** Test files only get minimal compile shims. Tests come as the final step (gating, collection state, tease/selected/chain, frame geometry, bundle tag file).
2. **Every phone build goes to FTB Nest** (`com.basegamelab.findthebird.nest`, display name "FTB Nest"), never the regular Find The Bird slot. Recipe in `~/.claude/projects/-Users-base-dev-appletolye/memory/ftb-side-by-side-install-lane.md`: real env `~/fabrika-keys/find-the-bird.env.ios.local`, `npm run build:ios`, `npx cap sync ios`, `node tools/native-shell/apply.mjs --game find_the_bird`, PlistBuddy display name, sed bundle id in pbxproj, unsigned xcodebuild, manual codesign of every nested Mach-O INCLUDING root `App.debug.dylib`, wildcard profile, `devicectl install` + launch. Set `VITE_FTB_DEV_TOOLS=true` for Nest builds (5-tap title tier cycle). Assert `App.app/public/build-info.json` sha == HEAD; Settings shows "Build <sha>".
3. **Phone screenshots while Batu is playing are useless** (they capture his session). Verify in Chrome/Playwright (dev server: `VITE_ENABLE_TEST_HARNESS=true VITE_ADMOB_IOS_ENABLED=false npx vite --port 5178`, then `window.__FIND_DOG_HARNESS__.driveTo('<state>')`) or on the iOS Simulator, and say which you used. Device-first policy in `fabrikav2/.claude/CLAUDE.md` still applies for final claims.
4. **Money from meters only.** OpenRouter: `curl https://openrouter.ai/api/v1/auth/key` (`usage_daily`). merceka: `uv run python -m merceka_core.costs --since <ts>`. Never estimate.
5. Art style source of truth: `games/find_the_bird/design/style-guide.json`. Images via merceka (`openai/gpt-image-2.5-sunburst`), reports and every image to Portal: `portal report --stream ftb-collection-sanctuary <files>`.
6. Pacing beats species precision: "we are not a bird watching support group, we are an arcade game". The sparrow verification pass was retired for that reason.
7. Batu's phone is an iPhone 12 (`iPhone13,2`, iOS 26.6.1). Its save can be edited directly: memory `ftb-device-save-edit-lane.md`.
8. Communication voice: flat, precise, no enthusiasm, lead with the action.

## State of the last session (2026-09-17)

Done and on FTB Nest as build `9c65f57fc`:
- Housed birds no longer float (idle lift track removed; breathe + blink + tap hop remain).
- Sparrow card wears its hedge frame + silhouette before rung 1 (was swapping to the "?" locked frame).
- Bird tags regenerated for ALL 92 levels (`levels-index.json` order; the 44-level `bundled-manifest.json` is only the in-binary subset). Pipeline at repo root `tools/birdtypes/`: `build_worklist.py` → `classify_openrouter.py` (gemini-3.8-flash via OpenRouter, key in `/Users/base/dev/appletolye/.env`, output `classified-ranked.jsonl` with FIVE ranked candidates per sprite) → `build_bird_types.py` (top candidate → `public/levels/bird-types.json`). `ladder_report.py [species…]` prints at which level each rung lands, strict and lenient. Run cost 2026-09-17: $3.62 (meter).
- Thresholds are per-bird Remote Config keys now: `sparrow/robin/bluebird` × `UnlockCount/HatCount/CardiganCount`. Defaults: sparrow 10/60/100, robin 10/35/70, bluebird 10/40/60. Resulting cadence (strict counts, level index order): L10 collection opens with sparrow rung 1 banked; L12 sparrow 2 + robin opens (rung 1 instant); L19 robin 2 + bluebird opens (rung 1 instant); L24 sparrow 3; L31 bluebird 2; L40 robin 3; L59 bluebird 3.
- Harness states `collection-store-robin` and `sanctuary-store-house` (nav bar hidden, deck scrolled to robin). Tour builds never raise the OS notification prompt (gate in `NotificationService.createCapacitorNotificationProvider.requestPermission` on `VITE_INSITU_TOUR_STATE`). NOTE: the simulator still showed the prompt after that gate, so something native raises it; it was answered once with a throwaway XCUITest (copy `tools/verify-device/runner`, add a test that launches the bundle and taps `springboard.alerts.firstMatch.buttons["Allow"]`, run with `xcodebuild test … -only-testing:VerifyDeviceRunner/AlertAllowTests CODE_SIGNING_ALLOWED=NO`). The grant persists on the sim as long as the app is not uninstalled.
- App Store: two screenshots appended (not replacing) to version 1.2.7 (PREPARE_FOR_SUBMISSION), en-US, sets APP_IPHONE_67 (1290x2796) and APP_IPHONE_65 (1242x2688): `bird-set-a-07` (tier-3 house, no birds, "BUILD A HOME / FOR YOUR BIRDS") and `bird-set-a-08` (Rusty rung 1, "COLLECT AND / DRESS UP BIRDS"). ASC app id 6796698146; auth helper `/Users/base/dev/appletolye/dresser/deploy/asc_testflight.py` (set `a.APP`), key `/Users/base/fabrika-keys/appstore-connect/AuthKey_52LFXZKXD4.p8`. Captures came from an iPhone 16 Plus simulator ("FTB Store", iOS 26.5) with `simctl status_bar override --time 9:41`; composite = raw capture + plank (wood grain sampled from the live listing shot `bird-set-a-01`, FredokaOne 84px, colour (23,60,66), text centred x≈790-850) + mascot cutout from `/Users/base/dev/appletolye/fabrika-adgen/projects/find-the-bird/assets/mascot/mascot-{searching,celebrate}.png` at 440-520px tall, bottom-left. Portal p_72f313. One of the four assets was still `UPLOAD_COMPLETE` (processing) at hand-off; re-check state.

## Open items, in priority order

1. **Zero-count bug on the phone (unconfirmed).** Batu was at level 18 with `ftb_bird_counts = {}` on FTB Nest although levels 15-18 were tagged in the build he played. Chrome could not reproduce because harness `findDog` taps did not land (returned `found:false`); that probe is inconclusive, not a pass. Next: have Batu play one level on build 9c65f57fc and read the counter; if still zero, enable Web Inspector on the phone (Settings › Safari › Advanced) and use `pymobiledevice3 webinspector js-shell` to evaluate `fetch('levels/bird-types.json')` and `localStorage.ftb_bird_counts` live. Suspects: tag fetch path under capacitor://, or `birdTypeSnapshot()` null at pickup.
2. **Sanctuary pacing (decision pending with Batu).** Current: level reward 45 coins, house prices 150/300/900, accrual 3/6/10 per hour, 4-hour cap; hints cost 250 (single) / 600 (bundle). A non-hint player reaches L15 with ~675 coins, buys tier 1+2 immediately, waits to ~L30 for tier 3, accrual invisible. Proposed: prices 150/800/1200, accrual 15/30/60 per hour, 8-hour cap. Implement only after Batu says yes (keys `housePriceTier1..3`, `sanctuaryCoinsPerHourTier1..3`, `sanctuaryOfflineCapHours` in `remoteConfigSchema.ts`).
3. **Second plot / house line.** Batu wants horizontal platform layout (left slightly raised, right, top) and to pick a material line before regenerating house tiers; locked plot unlock behaviour undefined. Do not regenerate houses until he names the line.
4. Portal review items from p_1bc0f4 not yet taken: first-launch page vanish, distinct claim moments, hand-offs at Complete/max tier, double branch, crowded tier-3 pluses, coin number mid-flight, invisible dots.
5. SFX listen; robin plain sprite recrop if hat look too small.
6. Tests at the very end (constraint 1).

## Verify commands (run from `games/find_the_bird` in the worktree)

- `npx tsc --noEmit -p .` and `npx eslint src` (both clean at 9c65f57fc).
- `node ../../tools/game-env/validate.mjs` (env template contract; values must be `auto|true|false|__X__`).
- Ladder pacing: `python3 ../../tools/birdtypes/ladder_report.py sparrow robin bluebird` from repo root.
- Phone: FTB Nest install recipe above; check Settings › Build sha.

## Definition of done for the next stretch

Batu's phone counts birds on every level (counter moves on a played level), the sanctuary economy values are set to whatever Batu approves, and each shipped iteration is on FTB Nest with its build sha reported. Tests remain deferred until Batu calls for them.
