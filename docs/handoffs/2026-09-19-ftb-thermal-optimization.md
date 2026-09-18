# GOAL: Make Find the Bird run cooler on the phone, measured

## Objective

Reduce the iPhone's temperature and battery draw while playing Find the Bird,
verified by measurement on the device, across **at least five** measure →
change → re-measure cycles. Do not stop after one win.

## Done when

- A baseline and at least five subsequent measurements exist, all captured the
  same way, all written into `docs/evidence/2026-09-19-ftb-thermal/`.
- The final measurement is meaningfully cooler than baseline under the same
  scenario, or you state plainly which cycles failed to move it and why.
- `npm run typecheck` and `npm run test:unit -w @fabrikav2/find_the_bird` are
  green (808 passing as of 4b6d272c0).
- No visual or gameplay change the player would notice has been made without
  the operator approving that specific change first.

## Step 0 — MEASURE BEFORE YOU CHANGE ANYTHING

This is the first action. Do not read code, plan, or optimise before there is a
baseline number. A change without a before-number is not an optimisation, it is
a guess.

The phone reports its own thermals over USB:

```sh
pymobiledevice3 diagnostics battery single
# Temperature / VirtualTemperature are centi-degrees C  (3359 = 33.59 C)
# InstantAmperage / Amperage are mA; NEGATIVE while discharging
```

Verified working on Batu's iPhone 12 (UDID 00008101-000410EC3EF9001E) on
2026-09-19; idle reading was 33.59 C. Amperage reads ~0 while charging, so
**unplug the phone from power for every measurement**, or the draw number is
meaningless. It must stay connected for data — use a cable that carries data
with charging disabled if available, otherwise sample immediately after
unplugging and be consistent about it.

Build a small sampler that logs `Temperature` and `InstantAmperage` every 5s to
CSV, and define ONE repeatable scenario, e.g.:

1. Cold start the app, sit on level 1 without touching it — 5 min.
2. Pan and pinch continuously — 2 min.
3. Sit on the home menu — 5 min.

Run the same scenario every cycle. Record ambient conditions and starting
battery percentage; both move the numbers.

**Two builds are already on the phone and this is the first thing to compare:**
`com.basegamelab.findthebird` is a Release build, `com.basegamelab.findthebird.debug`
("FTB Debug") is a Debug build. Debug is unoptimised and links a debug dylib. If
Release is much cooler, a large part of the perceived warmth was never real, and
that reframes everything below. Measure both before touching code.

## The loop — repeat at least five times

1. Pick the single highest-expected-win candidate not yet tried.
2. State the hypothesis and the number you expect to move, before changing code.
3. Make the smallest change that tests it.
4. Build and install to the device. Re-run the identical scenario.
5. Record before/after in the evidence folder. Keep it if it won, revert it if
   it did not — a change that does not move the number is not free, it is
   risk with no payoff.
6. Commit wins individually with the measurement in the commit message.

## Candidates, ranked by expected win per unit of risk

Found by a sweep on 2026-09-19; none are verified against a thermal number yet,
which is exactly what this goal is for.

1. **Render-on-demand in GameScene.** The loop is capped at 30fps, but a
   hidden-object game is static while the player scans, so most frames redraw an
   identical image. Sleep the loop while nothing changes, wake on pointer-down
   and on tween start. `game.loop.sleep()`/`wake()` is already proven in
   `src/platform/gameLifecycle.ts:121,145`. RISK: `scene.start()` is processed
   inside the game step, so a sleeping loop means a transition that never fires.
   Every wake path must be audited — pointer, tweens, timers, tutorial, ad
   callbacks. A missed one is a frozen game. Visually a no-op when correct.
2. **Same trick on HomeScene, which is easier.** `HomeScene.create()` adds zero
   Phaser display objects — the entire home and every meta page is DOM. So the
   renderer clears and presents a full-screen framebuffer 30 times a second to
   show nothing. Fewer wake paths than the game scene.
3. **The home screen's infinite CSS animations.** About eight run concurrently
   (`homePawDrift` 24s, `homeFeatherDrift` 26s, `homePlayButtonIdle`,
   `homeCurrentNodeBreath`, `homeCurrentNodeHalo`, `lockedTileSparkle`, plus
   conditional no-ads and claim pulses). Together they hold the compositor awake
   indefinitely. NEEDS OPERATOR APPROVAL — this is deliberate juice, and turning
   any of it off is a visible change. Measure the cost first, then ask with the
   number in hand.
4. **`backdrop-filter: blur(10px)` on the in-game HUD** (`styles.css:92,260,275`).
   Live blur regions recomputed during every pan and pinch. Also a visible
   change; same rule as 3.
5. **Texture resolution.** `FALLBACK_RUNTIME_TEXTURE_LONG_EDGE = 2560` in
   `RuntimeTexturePolicy.ts`. Fewer pixels to sample per frame, at a cost in
   sharpness when zoomed. Visible change; measure before proposing.

## Already done — do not redo

- Loop capped at 30fps, `disablePreFX: true`, background sleep via three
  channels, AudioContext suspend/resume, Sanctuary WAAPI animations torn down
  with `cancel()` + `effect = null`. All verified present.
- The completion panorama's infinite camera tween was bounded (209484754). It
  panned forever under a full-screen `backdrop-filter`, so the blur could never
  be cached. This was the one unambiguous win and it is already in.
- No self-perpetuating `requestAnimationFrame`, no per-frame canvas readback,
  no persistent particle emitter exists in `src/`.

## Constraints

- **Device-first is non-negotiable** (root `CLAUDE.md`). A desktop browser or
  simulator reading is not evidence for this goal. Every number comes from the
  phone.
- Do not change gameplay feel, animation the player is meant to see, or visual
  quality without explicit approval for that specific change.
- Deferred by the operator on 2026-09-18, do not pick these up here: the
  exporter's authoring back-paths (`corpus_migration.py` rejects non-PNG sprite
  paths; `export_adoption.py` writes WebP bytes into a `.png` name and
  re-corrupts on every adopt), and `find_the_dog`/`shell_template` still
  hardcoding `'image/png'` in `data/levels.ts`.
- 1.2.9 build 30 is in App Store Connect awaiting submission. Do not touch the
  store listing, and do not merge anything into this release.

## Repo

`/Users/base/dev/appletolye/fabrikav2`, branch off `origin/main` at `4b6d272c0`.
Device install: `node tools/native-shell/install.mjs --game find_the_bird
--bundle-id com.basegamelab.findthebird --env-file
~/fabrika-keys/find-the-bird.env.ios.local`. For a Release-config build, see
the archive recipe in `docs/handoffs/` and the memory note on the side-by-side
lane for installing a second copy under its own bundle id.
