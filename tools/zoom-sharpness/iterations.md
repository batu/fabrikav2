# Max-zoom quality iterations

Fitness authority: `node tools/zoom-sharpness/eval.mjs` against the committed 15-level corpus. Device confirmation is conductor-owned and runs only after the two-accepted-iteration plateau rule fires.

## Accepted baseline

| Revision | maxZoom median | maxZoom worstDecile | zoom1 median | zoom1 worstDecile |
| --- | ---: | ---: | ---: | ---: |
| `c4c0da54` (DSF 1, superseded) | 75.457942 | 74.412557 | 76.135316 | 75.175864 |
| `c4c0da54` at DSF 3 (authoritative) | 72.918229 | 68.915045 | 76.421022 | 75.099246 |

All scores below are at deviceScaleFactor 3 (iPhone geometry); the eval was corrected after DSF 1 was found to minify at max zoom, muting the texture-resolution signal.

## Iterations

| # | Change | maxZoom median | maxZoom worstDecile | zoom1 median | zoom1 worstDecile | Load | Texture memory | 30fps | Disposition |
| ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | Replace the fixed 2560 runtime cap with the active WebGL `MAX_TEXTURE_SIZE`; retain 2560 for Canvas/unknown renderers, so lower-capability Android contexts remain bounded by their measured GL limit. | 74.341841 | 73.126430 | 77.879436 | 76.257952 | unchanged (shipped assets untouched) | capability bounded; shipped 2560 WebPs unchanged | deferred to plateau | ACCEPTED (+1.42 median, +4.21 worst-decile, zoom1 guard up; DSF-3 rescore at 866237ed) |
| 2 | When the bundled source-resolution `color.png` fits within the measured WebGL limit and adds detail beyond 2560, load it instead of the 2560-long-edge `color.webp`; retain WebP for Canvas, insufficient measured limits, remote/object URLs, and source images without additional detail. Generate grayscale from the selected texture through the unchanged runtime path. | 77.926871 | 74.149595 | 78.352456 | 77.839710 | build+load unchanged for <=2560-capability devices; larger PNG decode on capable ones (fast-tier build ~unchanged) | color.png resident on capable devices (up to 2560x5600 RGBA ~57MB vs ~29MB) — device-tier memory check required at plateau | deferred to plateau | ACCEPTED (+3.59 median vs iter1, zoom1 guard up; DSF-3 rescore at 7fb7a5a6) |
| 3a | WebGL1 cannot mipmap the shipped non-power-of-two level textures, so use its explicit fallback: generate one high-quality canvas-prefiltered color tier at the zoom-1 display footprint, derive a matching grayscale tier, and switch both to the source-resolution tier at the geometric sampling midpoint. | 20.20 | 17.18 | 81.25 | not recorded | one extra in-memory canvas downscale plus grayscale generation during setup | source tiers remain resident and add one prefiltered color+grayscale pair | deferred to plateau | REJECTED — tier switching let Phaser replace source-frame dimensions without restoring display size, changing level geometry and evaluator/gameplay coordinate mapping |
| 3b | Keep iteration 3's prefiltered tiers, but preserve the level-derived display width and height across each color/grayscale texture swap so resident resolution is transparent to world coordinates. | 82.93 | 79.72 | not reported | not reported | same as 3a; pending measurement | same as 3a; pending decoded-residency guard | deferred to plateau | REJECTED — geometry and max-zoom matched iteration 2, but zoom-1 regressed on every 2560x3840 level because the light-minification class was downscaled and then resampled |
| 3c | Size the zoom-1 prefilter from each level's source dimensions and exact level-derived display footprint, never below that footprint; create and use it only for the heavily minified 2560x5600 class, while the lightly minified 2560x3840 class remains on the source tier. | pending conductor scoring | pending conductor scoring | pending conductor scoring | pending conductor scoring | one extra prefilter only for qualifying heavily minified levels; pending measurement | removes the extra color+grayscale pair for non-qualifying levels; pending decoded-residency guard | deferred to plateau | PENDING — conductor runs `node tools/zoom-sharpness/eval.mjs --out /tmp/zoom-2-iteration-3c` |

Rejected attempts do not update the accepted comparison base or the sub-1.0 plateau streak. Device results remain pending until the fast-tier plateau fires.
