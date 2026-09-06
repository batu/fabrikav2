# Physical iPhone evidence — 2026-09-06

Device: iPhone 12 (`iPhone13,2`), iOS 26.6.1. Runtime: the installed Capacitor app's native WKWebView, portrait. Bundle: `com.basegamelab.hilltodieon`, displayed as **My Hill**. No browser or simulator rendering was used for visual acceptance.

## Verified behavior

The native XCTest suite uses actual screen touches, reads the repository testkit's accessibility marker, and retains screenshots with matching state. **Player build 11 passed** after the integer-health correction: firing before input, right- and left-hand aiming, continued fire after release, pause/resume, automatic pause after backgrounding, two completed waves, ranked card picks, repaired structures, and salvage persistence after process relaunch. Its markers match the exact packaged build timestamp, `2026-09-06T15:58:27.077Z`, with the ordinary player profile and stress disabled. The save increased from 66 to 99 normally earned salvage. [Raw state](player-flow.json), [build/source fingerprints](player-provenance.json), [combat](combat.png), [cards](cards.png), [ready](ready.png), [pause](pause.png), [reloaded save](save-reloaded.png).

The separate QA profile passed permanent upgrade purchases, both character unlocks/selections, all weapon unlocks, three-tower placement, moving a wall, and save persistence across process relaunch. It then cleared all ten waves through real-time combat: **5,018 kills, 335 salvage earned**, victory, level-two unlock, and starting Ember Ridge. This used a 1,000-salvage setup balance in a separate storage namespace and native aim/card inputs; it did not force wave outcomes. [Raw state samples](meta-and-level.json), [stronghold](stronghold.png), [upgrades](upgrades.png), [characters](characters.png), [victory](victory.png), [level two](level-two.png).

An earlier two-tower attempt died on wave ten with 243 salvage retained. Its [defeat capture](defeat.png) is from build 6; the completed meta/level suite is build 7. The initial shop test exposed a clipped-row XCTest tap; requiring the whole row to be visible fixed that test, and the complete purchase/layout rerun passed. Capture review also exposed and corrected the initially squashed battlefield; current combat is square.

## Crowd performance

The final stress pass, build 9, kept **8,192 enemies** moving across the battlefield for approximately 45 seconds, recycling them to the perimeter. Player flamethrower plus rivet, arc, and mortar towers were active. It recorded **2,732 frames**, **17 ms median**, **17 ms p95**, **20 ms p99**, **3 ms p95 CPU**, four intervals over 33.4 ms, and no rejected enemy spawns. Worst interval including startup/capture overhead was 123 ms. [Raw metrics](stress-8192.json), [packaged asset hashes](stress-provenance.json), [crowd screenshot](8192-stress-45s.png).

Three consecutive native screenshots are retained in [crowd-sequence](crowd-sequence/). They show advancing crowds, hit feedback, lightning and mortar effects. They are a sampled frame sequence, not a high-frame-rate recording. The raw XCTest result contains all twelve sequence images. The earlier [2,000-enemy result](stress-2000.json) allowed attackers to cluster at structures and is not directly comparable to the continuously moving 8,192-enemy scenario.

These are WKWebView RAF intervals; CPU time excludes GPU completion. The stress fixture disables base damage and reward banking, keeps enemies durable, and does not increment attempts. This is a capacity measurement, not a difficulty test or a claim about other phones, prolonged thermal conditions, or maximum possible hardware capacity. The later player-build health fix rounds maximum health to an integer; renderer, pools, and crowd algorithms are unchanged from the final stress pass.

## Reproduce and inspect

See [native test instructions](../../tests/ios/README.md). Raw local XCTest results remain in `/Users/base/dev/appletolye/hill-to-die-on/games/hill_to_die_on/.work/`: `meta-and-level-2.xcresult`, `stress-final.xcresult`, and `player-final-11.xcresult`. Promoted images and JSON here are the durable evidence; `.work/` remains disposable. The retained images were inspected at device resolution, including consecutive stress frames.

Code checks: 27 unit/DOM tests, game TypeScript, and game ESLint pass. The repository audit passes with existing shared-code/reference warnings. ESLint is configured per workspace; the repository root has no ESLint config. This work was developed in `/Users/base/dev/appletolye/hill-to-die-on`, branch `feat/hill-to-die-on`. No publication, store submission, or remote deployment is part of this slice.
