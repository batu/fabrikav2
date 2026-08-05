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
| local-diff-t200-a1500 | 0.4005 | 0.0490 | 47.7 | 0.262 | 17 | 3696 | local-diff t200 a1500 |
| local-diff-t200-a4000 | 0.3714 | 0.0832 | 43.8 | 0.261 | 6 | 1899 | local-diff t200 a4000 |
| local-diff-t150-a4000 | 0.3204 | 0.0711 | 45.2 | 0.286 | 5 | 1913 | local-diff t150 a4000 |
| owlv2-c008-conf0.1 | 0.9854 | 0.6070 | 34.4 | 0.152 | 283 | 1135 | owlv2 conf>=0.1 tiled |
| owlv2-c008-conf0.15 | 0.9733 | 0.7500 | 34.8 | 0.149 | 151 | 736 | owlv2 conf>=0.15 tiled |
| owlv2-c008-conf0.2 | 0.9733 | 0.7500 | 34.8 | 0.149 | 151 | 736 | owlv2 conf>=0.2 tiled |
| owlv2-c008-conf0.3 | 0.9684 | 0.8228 | 34.9 | 0.148 | 107 | 615 | owlv2 conf>=0.3 tiled |
| owlv2-c008-conf0.4 | 0.9563 | 0.8649 | 35.0 | 0.145 | 86 | 555 | owlv2 conf>=0.4 tiled |
| owlv2-c03-snap | 0.9684 | 0.8520 | 32.7 | 0.149 | 125 | 615 | OWLv2 conf0.3 + local-diff snap |
| gdino-c020-conf0.2 | 0.9806 | 0.5349 | 37.0 | 0.151 | 171 | 1073 | gdino conf>=0.2 tiled |
| gdino-c020-conf0.25 | 0.9757 | 0.6549 | 37.0 | 0.149 | 138 | 823 | gdino conf>=0.25 tiled |
| gdino-c020-conf0.3 | 0.9757 | 0.6549 | 37.0 | 0.149 | 138 | 823 | gdino conf>=0.3 tiled |
| gdino-c020-conf0.35 | 0.9515 | 0.8050 | 37.2 | 0.148 | 95 | 605 | gdino conf>=0.35 tiled |
| gdino-c020-conf0.4 | 0.9515 | 0.8050 | 37.2 | 0.148 | 95 | 605 | gdino conf>=0.4 tiled |
| yolo11s-v1-c010-conf0.1 | 0.8932 | 0.4189 | 35.2 | 0.146 | 305 | 1602 | yolo-custom conf>=0.1 tiled |
| yolo11s-v1-c010-conf0.2 | 0.8010 | 0.5665 | 36.2 | 0.149 | 166 | 872 | yolo-custom conf>=0.2 tiled |
| yolo11s-v1-c010-conf0.3 | 0.4029 | 0.6966 | 40.3 | 0.153 | 20 | 267 | yolo-custom conf>=0.3 tiled |
| yolo11s-v1-c010-conf0.4 | 0.1408 | 0.7692 | 41.9 | 0.199 | 2 | 78 | yolo-custom conf>=0.4 tiled |
| yolo11s-v1-c010-conf0.5 | 0.0558 | 0.9583 | 35.2 | 0.292 | 0 | 24 | yolo-custom conf>=0.5 tiled |
| yolo11s-v1-c010-conf0.6 | 0.0073 | 1.0000 | 46.3 | 0.341 | 0 | 3 | yolo-custom conf>=0.6 tiled |
| owlv2-c008-conf0.1-diff0.5 | 0.9587 | 0.6551 | 33.9 | 0.147 | 266 | 1009 | owlv2-c008 conf>=0.1 + diff-frac>=0.5 (t40) |
| owlv2-c008-conf0.1-diff0.65 | 0.7354 | 0.6658 | 33.7 | 0.130 | 205 | 763 | owlv2-c008 conf>=0.1 + diff-frac>=0.65 (t40) |
| owlv2-c008-conf0.1-diff0.75 | 0.4515 | 0.6588 | 38.9 | 0.123 | 121 | 466 | owlv2-c008 conf>=0.1 + diff-frac>=0.75 (t40) |
| owlv2-c008-conf0.1-diff0.85 | 0.1966 | 0.6578 | 53.2 | 0.121 | 42 | 187 | owlv2-c008 conf>=0.1 + diff-frac>=0.85 (t40) |
