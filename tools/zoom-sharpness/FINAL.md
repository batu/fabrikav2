# Max-zoom quality — final report (2026-07-20)

Goal: maximize fully-zoomed-in fidelity vs the source-art ceiling, iterate to
plateau. Metric: colored captures, deviceScaleFactor 3 (iPhone geometry),
15-level corpus, reference-anchored composite (see GOAL.md).

## Result

| | maxZoom median | maxZoom worst-decile | zoom-1 guard |
| --- | ---: | ---: | ---: |
| baseline (`c4c0da54`) | 79.98 | 78.17 | 81.25 |
| **final (`24ff2244`, on main)** | **82.93** | **79.72** | **81.25** |

Shipped changes: capability-based runtime texture cap (real GL
`MAX_TEXTURE_SIZE`, 2560 fallback kept for Canvas/low-capability Android) and
a source-resolution color tier (`color.png` loaded when the device cap allows,
grayscale derived from it). Max zoom now samples the full source art at
~1.13× magnification — effectively the ceiling for code-only levers.

Rejected after three attempts and reverted: zoom-band prefiltered tier
(WebGL1 NPOT rules out true mipmaps; every prefilter variant was net-negative
— details in iterations.md).

Device confirmation: final build (sha 24ff2244) installed and launched on
iPhone 00008101-000410EC3EF9001E via the gated installer, 2026-07-20.

## Open levers (product decisions, not code)

- Raise `PINCH.maxZoom` beyond 2.5 — now viable since the source tier holds
  detail past 2.5×, but changes game feel.
- Source-art escalation (regenerate/SR-upscale level art beyond 2560×5600) —
  only worthwhile if maxZoom is raised; current reference is not the
  bottleneck at 2.5×.

Trail with visuals: https://portal.basegamelab.com/c/req_786a00
