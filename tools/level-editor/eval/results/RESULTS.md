# Hitbox Hillclimb Results

Golden: 22 levels / 412 hitboxes (`golden-hitboxes-2026-08-05`). Target: recall >=0.97, precision >=0.95, center err <=25px(4096), $0, <30s/level.

| run | recall | precision | center px | radius fit | dup | cands | notes |
|---|---|---|---|---|---|---|---|
| ens2-ow-gd-yw | 0.9660 | 0.8419 | 35.0 | 0.147 | 60 | 544 | vote>=2 of [owlv2-c008:0.15,gdino-c020:0.25,yoloworld-c008:0.08] r87 |
| ens2-ow-gd-yw-y4 | 0.9709 | 0.8117 | 33.1 | 0.149 | 70 | 579 | vote>=2 of [owlv2-c008:0.15,gdino-c020:0.25,yoloworld-c008:0.08,yolo11s-v4-c010:0.1] r87 |
| ens3-ow-gd-yw-y4 | 0.9345 | 0.8945 | 32.8 | 0.144 | 39 | 474 | vote>=3 of [owlv2-c008:0.15,gdino-c020:0.25,yoloworld-c008:0.08,yolo11s-v4-c010:0.1] r87 |
| gdino-c020-conf0.2 | 0.9806 | 0.5616 | 37.0 | 0.151 | 171 | 1022 | gdino conf>=0.2 tiled |
| gdino-c020-conf0.25 | 0.9757 | 0.6866 | 37.0 | 0.149 | 138 | 785 | gdino conf>=0.25 tiled |
| gdino-c020-conf0.3 | 0.9757 | 0.6866 | 37.0 | 0.149 | 138 | 785 | gdino conf>=0.3 tiled |
| gdino-c020-conf0.35 | 0.9515 | 0.8397 | 37.2 | 0.148 | 95 | 580 | gdino conf>=0.35 tiled |
| gdino-c020-conf0.4 | 0.9515 | 0.8397 | 37.2 | 0.148 | 95 | 580 | gdino conf>=0.4 tiled |
| local-diff-default | 0.0704 | 0.0094 | 88.8 | 0.302 | 4 | 3502 | detect_painted_subjects defaults t40/a400/d4, centroid, r87 |
| local-diff-t100-a1500 | 0.2500 | 0.0296 | 45.8 | 0.294 | 32 | 4566 | local-diff t100 a1500 |
| local-diff-t150-a1500 | 0.3398 | 0.0430 | 45.4 | 0.288 | 29 | 3905 | local-diff t150 a1500 |
| local-diff-t150-a4000 | 0.3204 | 0.0758 | 45.2 | 0.286 | 5 | 1795 | local-diff t150 a4000 |
| local-diff-t200-a1500 | 0.4005 | 0.0532 | 47.7 | 0.262 | 17 | 3400 | local-diff t200 a1500 |
| local-diff-t200-a4000 | 0.3714 | 0.0908 | 43.8 | 0.261 | 6 | 1741 | local-diff t200 a4000 |
| owlv2-c008-conf0.1 | 0.9854 | 0.6356 | 34.4 | 0.152 | 283 | 1084 | owlv2 conf>=0.1 tiled |
| owlv2-c008-conf0.1-diff0.5 | 0.9587 | 0.6850 | 33.9 | 0.147 | 266 | 965 | owlv2-c008 conf>=0.1 + diff-frac>=0.5 (t40) |
| owlv2-c008-conf0.1-diff0.65 | 0.7354 | 0.7017 | 33.7 | 0.130 | 205 | 724 | owlv2-c008 conf>=0.1 + diff-frac>=0.65 (t40) |
| owlv2-c008-conf0.1-diff0.75 | 0.4515 | 0.6946 | 38.9 | 0.123 | 121 | 442 | owlv2-c008 conf>=0.1 + diff-frac>=0.75 (t40) |
| owlv2-c008-conf0.1-diff0.85 | 0.1966 | 0.6833 | 53.2 | 0.121 | 42 | 180 | owlv2-c008 conf>=0.1 + diff-frac>=0.85 (t40) |
| owlv2-c008-conf0.15 | 0.9733 | 0.7886 | 34.8 | 0.149 | 151 | 700 | owlv2 conf>=0.15 tiled |
| owlv2-c008-conf0.2 | 0.9733 | 0.7886 | 34.8 | 0.149 | 151 | 700 | owlv2 conf>=0.2 tiled |
| owlv2-c008-conf0.3 | 0.9684 | 0.8635 | 34.9 | 0.148 | 107 | 586 | owlv2 conf>=0.3 tiled |
| owlv2-c008-conf0.4 | 0.9563 | 0.9057 | 35.0 | 0.145 | 86 | 530 | owlv2 conf>=0.4 tiled |
| owlv2-c03-snap | 0.9684 | 0.8942 | 32.7 | 0.149 | 125 | 586 | OWLv2 conf0.3 + local-diff snap |
| vlm-gemini36flash | 0.9757 | 0.9733 | 33.3 | 0.151 | 0 | 412 |  |
| vlm-snap | 0.9806 | 0.9782 | 31.9 | 0.151 | 0 | 412 | gemini VLM + local-diff snap (shipped incumbent combo) |
| yolo11s-v1-c010-conf0.1 | 0.8932 | 0.4458 | 35.2 | 0.146 | 305 | 1505 | yolo-custom conf>=0.1 tiled |
| yolo11s-v1-c010-conf0.2 | 0.8010 | 0.5973 | 36.2 | 0.149 | 166 | 827 | yolo-custom conf>=0.2 tiled |
| yolo11s-v1-c010-conf0.3 | 0.4029 | 0.7294 | 40.3 | 0.153 | 20 | 255 | yolo-custom conf>=0.3 tiled |
| yolo11s-v1-c010-conf0.4 | 0.1408 | 0.8000 | 41.9 | 0.199 | 2 | 75 | yolo-custom conf>=0.4 tiled |
| yolo11s-v1-c010-conf0.5 | 0.0558 | 1.0000 | 35.2 | 0.292 | 0 | 23 | yolo-custom conf>=0.5 tiled |
| yolo11s-v1-c010-conf0.6 | 0.0073 | 1.0000 | 46.3 | 0.341 | 0 | 3 | yolo-custom conf>=0.6 tiled |
| yolo11s-v4-c010-conf0.1 | 0.8447 | 0.4825 | 39.7 | 0.154 | 204 | 1144 | yolo-custom conf>=0.1 tiled |
| yolo11s-v4-c010-conf0.15 | 0.7985 | 0.5552 | 40.4 | 0.156 | 134 | 834 | yolo-custom conf>=0.15 tiled |
| yolo11s-v4-c010-conf0.2 | 0.7985 | 0.5552 | 40.4 | 0.156 | 134 | 834 | yolo-custom conf>=0.2 tiled |
| yolo11s-v4-c010-conf0.3 | 0.6505 | 0.6715 | 40.0 | 0.165 | 55 | 481 | yolo-custom conf>=0.3 tiled |
| yolo11s-v4-c010-conf0.4 | 0.4782 | 0.7666 | 39.7 | 0.169 | 23 | 287 | yolo-custom conf>=0.4 tiled |
| yolo11s-v4-c010-conf0.5 | 0.2913 | 0.8819 | 38.7 | 0.194 | 7 | 144 | yolo-custom conf>=0.5 tiled |
| yoloworld-c008-conf0.05 | 0.7913 | 0.8184 | 37.7 | 0.138 | 48 | 457 | yoloworld conf>=0.05 tiled |
| yoloworld-c008-conf0.1 | 0.7913 | 0.8184 | 37.7 | 0.138 | 48 | 457 | yoloworld conf>=0.1 tiled |
| yoloworld-c008-conf0.15 | 0.7330 | 0.8612 | 38.2 | 0.139 | 33 | 389 | yoloworld conf>=0.15 tiled |
| yoloworld-c008-conf0.2 | 0.7330 | 0.8612 | 38.2 | 0.139 | 33 | 389 | yoloworld conf>=0.2 tiled |
| yoloworld-c008-conf0.3 | 0.6456 | 0.9049 | 39.2 | 0.134 | 29 | 326 | yoloworld conf>=0.3 tiled |
| vlm-snap-t120-d2-a900 | 0.9709 | 0.9684 | 31.7 | 0.151 | 0 | 412 | VLM + snap t120 d2 a900 |
| vlm-snap-t160-d2-a600 | 0.9709 | 0.9684 | 31.9 | 0.151 | 0 | 412 | VLM + snap t160 d2 a600 |
| vlm-snap-t120-d5-a900 | 0.9709 | 0.9684 | 31.1 | 0.151 | 0 | 412 | VLM + snap t120 d5 a900 |
| vlm-snap-t160-d5-a900 | 0.9733 | 0.9709 | 32.0 | 0.151 | 0 | 412 | VLM + snap t160 d5 a900 |
| vlm-snap-t200-d2-a400 | 0.9733 | 0.9709 | 34.2 | 0.151 | 0 | 412 | VLM + snap t200 d2 a400 |
| vlm-yolosnap-08 | 0.9733 | 0.9709 | 38.5 | 0.151 | 0 | 412 | VLM centers snapped to yolo11s-v4 conf0.05 within 0.8r |
| vlm-yolosnap-12 | 0.9612 | 0.9587 | 39.7 | 0.154 | 0 | 412 | VLM centers snapped to yolo11s-v4 conf0.05 within 1.2r |
| owlv2-neg-c008-conf0.1 | 0.9782 | 0.6637 | 34.1 | 0.150 | 276 | 1023 | owlv2 conf>=0.1 tiled |
| owlv2-neg-c008-conf0.15 | 0.9709 | 0.7928 | 34.6 | 0.149 | 151 | 695 | owlv2 conf>=0.15 tiled |
| owlv2-neg-c008-conf0.2 | 0.9709 | 0.7928 | 34.6 | 0.149 | 151 | 695 | owlv2 conf>=0.2 tiled |
| owlv2-neg-c008-conf0.3 | 0.9684 | 0.8650 | 34.9 | 0.148 | 107 | 585 | owlv2 conf>=0.3 tiled |
| gdino-neg-c020-conf0.25 | 0.9490 | 0.8069 | 36.7 | 0.148 | 123 | 637 | gdino conf>=0.25 tiled |
| gdino-neg-c020-conf0.3 | 0.9490 | 0.8069 | 36.7 | 0.148 | 123 | 637 | gdino conf>=0.3 tiled |
| gdino-neg-c020-conf0.35 | 0.9345 | 0.8935 | 36.6 | 0.149 | 85 | 526 | gdino conf>=0.35 tiled |
| yoloworld-neg-c005-conf0.05 | 0.8277 | 0.8064 | 37.2 | 0.137 | 63 | 501 | yoloworld conf>=0.05 tiled |
| yoloworld-neg-c005-conf0.1 | 0.8277 | 0.8064 | 37.2 | 0.137 | 63 | 501 | yoloworld conf>=0.1 tiled |
| yoloworld-neg-c005-conf0.15 | 0.7427 | 0.8892 | 37.5 | 0.140 | 31 | 379 | yoloworld conf>=0.15 tiled |
| ens2-neg | 0.9539 | 0.8563 | 35.1 | 0.146 | 54 | 522 | vote>=2 of [owlv2-neg-c008:0.15,gdino-neg-c020:0.25,yoloworld-neg-c005:0.05] r87 |
| ens2-neg-hi | 0.9442 | 0.9118 | 35.1 | 0.148 | 45 | 476 | vote>=2 of [owlv2-neg-c008:0.3,gdino-neg-c020:0.35,yoloworld-neg-c005:0.05] r87 |
| ens3-neg | 0.9296 | 0.9073 | 33.0 | 0.143 | 38 | 464 | vote>=3 of [owlv2-neg-c008:0.15,gdino-neg-c020:0.25,yoloworld-neg-c005:0.05,yolo11s-v4-c010:0.1] r87 |
| vlm-rescue | 0.9782 | 0.9180 | 33.2 | 0.150 | 12 | 451 | VLM + >=2-vote free rescue clusters |
| vlm-rescue-snap | 0.9757 | 0.9313 | 30.8 | 0.150 | 19 | 451 | VLM + >=2-vote free rescue clusters + snap |
