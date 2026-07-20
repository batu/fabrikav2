# Max-zoom quality iterations

Fitness authority: `node tools/zoom-sharpness/eval.mjs` against the committed 15-level corpus. Device confirmation is conductor-owned and runs only after the two-accepted-iteration plateau rule fires.

## Accepted baseline

| Revision | maxZoom median | maxZoom worstDecile | zoom1 median | zoom1 worstDecile |
| --- | ---: | ---: | ---: | ---: |
| `c4c0da54` | 75.457942 | 74.412557 | 76.135316 | 75.175864 |

## Iterations

| # | Change | maxZoom median | maxZoom worstDecile | zoom1 median | zoom1 worstDecile | Load | Texture memory | 30fps | Disposition |
| ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | Replace the fixed 2560 runtime cap with the active WebGL `MAX_TEXTURE_SIZE`; retain 2560 for Canvas/unknown renderers, so lower-capability Android contexts remain bounded by their measured GL limit. | 76.053044 | 74.412557 | 76.476416 | 74.768759 | unchanged (shipped assets untouched) | capability bounded; shipped 2560 WebPs unchanged | deferred to plateau | ACCEPTED (+0.60 median, zoom1 guard +0.34, worst-decile unchanged; conductor fast-tier run 2026-07-20 at 866237ed) |
| 2 | When the bundled source-resolution `color.png` fits within the measured WebGL limit and adds detail beyond 2560, load it instead of the 2560-long-edge `color.webp`; retain WebP for Canvas, insufficient measured limits, remote/object URLs, and source images without additional detail. Generate grayscale from the selected texture through the unchanged runtime path. | pending conductor fast-tier | pending conductor fast-tier | pending conductor fast-tier | pending conductor fast-tier | pending conductor measurement | pending conductor measurement | deferred to plateau | PENDING — run `node tools/zoom-sharpness/eval.mjs --out /tmp/zoom-2-iteration-2` |

Rejected attempts do not update the accepted comparison base or the sub-1.0 plateau streak. Device results remain pending until the fast-tier plateau fires.
