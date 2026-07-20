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

Rejected attempts do not update the accepted comparison base or the sub-1.0 plateau streak. Device results remain pending until the fast-tier plateau fires.
