# Max-zoom quality iterations

Fitness authority: `node tools/zoom-sharpness/eval.mjs` against the committed 15-level corpus. Device confirmation is conductor-owned and runs only after the two-accepted-iteration plateau rule fires.

## Accepted baseline

| Revision | maxZoom median | maxZoom worstDecile | zoom1 median | zoom1 worstDecile |
| --- | ---: | ---: | ---: | ---: |
| `c4c0da54` | 75.457942 | 74.412557 | 76.135316 | 75.175864 |

## Iterations

| # | Change | maxZoom median | maxZoom worstDecile | zoom1 median | zoom1 worstDecile | Load | Texture memory | 30fps | Disposition |
| ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | Replace the fixed 2560 runtime cap with the active WebGL `MAX_TEXTURE_SIZE`; retain 2560 for Canvas/unknown renderers, so lower-capability Android contexts remain bounded by their measured GL limit. | pending conductor fast-tier | pending | pending | pending | pending fast-tier comparison | capability bounded; shipped 2560 WebPs unchanged | deferred to plateau | pending `node tools/zoom-sharpness/eval.mjs --out /tmp/zoom-2-iteration-1` |

Rejected attempts do not update the accepted comparison base or the sub-1.0 plateau streak. Device results remain pending until the fast-tier plateau fires.
