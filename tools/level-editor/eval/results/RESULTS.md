# Hitbox Hillclimb Results

Golden: 22 levels / 412 hitboxes (`golden-hitboxes-2026-08-05`). Target: recall >=0.97, precision >=0.95, center err <=25px(4096), $0, <30s/level.

| run | recall | precision | center px | radius fit | dup | cands | notes |
|---|---|---|---|---|---|---|---|
| selftest-golden | 1.0000 | 1.0000 | 0.0 | 0.000 | 0 | 412 | golden vs golden sanity |
| local-diff-default | 0.0704 | 0.0090 | 88.8 | 0.302 | 4 | 3647 | detect_painted_subjects defaults t40/a400/d4, centroid, r87 |
| local-diff-t100-a1500 | 0.2500 | 0.0284 | 45.8 | 0.294 | 32 | 4751 | local-diff t100 a1500 |
| local-diff-t150-a1500 | 0.3398 | 0.0406 | 45.4 | 0.288 | 29 | 4133 | local-diff t150 a1500 |
| yoloworld-c008-conf0.05 | 0.7913 | 0.7759 | 37.7 | 0.138 | 48 | 482 | yoloworld conf>=0.05 tiled |
| yoloworld-c008-conf0.1 | 0.7913 | 0.7759 | 37.7 | 0.138 | 48 | 482 | yoloworld conf>=0.1 tiled |
| yoloworld-c008-conf0.15 | 0.7330 | 0.8131 | 38.2 | 0.139 | 33 | 412 | yoloworld conf>=0.15 tiled |
| yoloworld-c008-conf0.2 | 0.7330 | 0.8131 | 38.2 | 0.139 | 33 | 412 | yoloworld conf>=0.2 tiled |
| yoloworld-c008-conf0.3 | 0.6456 | 0.8551 | 39.2 | 0.134 | 29 | 345 | yoloworld conf>=0.3 tiled |
| vlm-raw | 0.9757 | 0.9326 | 33.3 | 0.151 | 0 | 430 | gemini-3.6-flash boxes via OpenRouter, r87 uniform |
| vlm-snap | 0.9806 | 0.9372 | 31.9 | 0.151 | 0 | 430 | gemini VLM + local-diff snap (shipped incumbent combo) |
