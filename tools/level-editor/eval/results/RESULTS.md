# Hitbox Hillclimb Results

Golden: 21 labeled levels / 412 hitboxes (`golden-hitboxes-2026-08-05`, sha ea1e958d05be; 1 unlabeled level(s) excluded). Target: recall >=0.97, precision >=0.95, center err <=25px(4096), $0, <30s/level. Rows scored against a different golden sha are not comparable.

| run | recall | precision | center px | radius fit | dup | cands | min lvl R | golden | notes |
|---|---|---|---|---|---|---|---|---|---|
| ens2-neg | 0.9539 | 0.7529 | 35.1 | 0.146 | 54 | 522 | 0.50 | ea1e958d05be | vote>=2 of [owlv2-neg-c008:0.15,gdino-neg-c020:0.25,yoloworld-neg-c005:0.05] r87 |
| ens2-neg-hi | 0.9442 | 0.8172 | 35.1 | 0.148 | 45 | 476 | 0.50 | ea1e958d05be | vote>=2 of [owlv2-neg-c008:0.3,gdino-neg-c020:0.35,yoloworld-neg-c005:0.05] r87 |
| ens2-ow-gd-yw | 0.9660 | 0.7316 | 35.0 | 0.147 | 60 | 544 | 0.50 | ea1e958d05be | vote>=2 of [owlv2-c008:0.15,gdino-c020:0.25,yoloworld-c008:0.08] r87 |
| ens2-ow-gd-yw-y4 | 0.9709 | 0.6908 | 33.1 | 0.149 | 70 | 579 | 0.54 | ea1e958d05be | vote>=2 of [owlv2-c008:0.15,gdino-c020:0.25,yoloworld-c008:0.08,yolo11s-v4-c010:0.1] r87 |
| ens3-neg | 0.9296 | 0.8254 | 33.0 | 0.143 | 38 | 464 | 0.50 | ea1e958d05be | vote>=3 of [owlv2-neg-c008:0.15,gdino-neg-c020:0.25,yoloworld-neg-c005:0.05,yolo11s-v4-c010:0.1] r87 |
| ens3-ow-gd-yw-y4 | 0.9345 | 0.8122 | 32.8 | 0.144 | 39 | 474 | 0.50 | ea1e958d05be | vote>=3 of [owlv2-c008:0.15,gdino-c020:0.25,yoloworld-c008:0.08,yolo11s-v4-c010:0.1] r87 |
| ensF2 | 0.9709 | 0.6969 | 31.9 | 0.149 | 70 | 574 | 0.54 | ea1e958d05be | vote>=2 of [yolo-folds-composite:0.1,owlv2-neg-c008:0.15,gdino-neg-c020:0.25,yoloworld-neg-c005:0.05] r87 |
| ensF2hi | 0.9684 | 0.7615 | 31.8 | 0.148 | 59 | 524 | 0.54 | ea1e958d05be | vote>=2 of [yolo-folds-composite:0.1,owlv2-neg-c008:0.3,gdino-neg-c020:0.35,yoloworld-neg-c005:0.1] r87 |
| ensF2hi-snap | 0.9636 | 0.7576 | 30.7 | 0.149 | 74 | 524 | 0.54 | ea1e958d05be | recall-lean free ensemble (2-vote hi-conf) + snap t120 |
| ensF3 | 0.9442 | 0.8104 | 31.9 | 0.143 | 47 | 480 | 0.50 | ea1e958d05be | vote>=3 of [yolo-folds-composite:0.1,owlv2-neg-c008:0.15,gdino-neg-c020:0.25,yoloworld-neg-c005:0.05] r87 |
| ensF3hi | 0.9320 | 0.8440 | 31.8 | 0.145 | 40 | 455 | 0.50 | ea1e958d05be | vote>=3 of [yolo-folds-composite:0.1,owlv2-neg-c008:0.3,gdino-neg-c020:0.35,yoloworld-neg-c005:0.1] r87 |
| ensF3hi-snap | 0.9272 | 0.8396 | 30.9 | 0.146 | 47 | 455 | 0.50 | ea1e958d05be | best free ensemble (3-vote hi-conf) + snap t120 |
| ensV2 | 0.9733 | 0.7972 | 30.0 | 0.149 | 51 | 503 | 0.54 | ea1e958d05be | vote>=2 of [vlm-gemini36flash:0,yolo-folds-composite:0.1,owlv2-neg-c008:0.3,gdino-neg-c020:0.35] r87 |
| ensV3 | 0.9684 | 0.8453 | 30.7 | 0.148 | 41 | 472 | 0.54 | ea1e958d05be | vote>=3 of [vlm-gemini36flash:0,yolo-folds-composite:0.1,owlv2-neg-c008:0.3,gdino-neg-c020:0.35,yoloworld-neg-c005:0.1] r87 |
| gdino-c020-conf0.2 | 0.9782 | 0.3943 | 37.0 | 0.151 | 171 | 1022 | 0.67 | ea1e958d05be | gdino conf>=0.2 tiled |
| gdino-c020-conf0.25 | 0.9733 | 0.5108 | 37.0 | 0.149 | 138 | 785 | 0.62 | ea1e958d05be | gdino conf>=0.25 tiled |
| gdino-c020-conf0.3 | 0.9733 | 0.5108 | 37.0 | 0.149 | 138 | 785 | 0.62 | ea1e958d05be | gdino conf>=0.3 tiled |
| gdino-c020-conf0.35 | 0.9515 | 0.6759 | 37.2 | 0.148 | 95 | 580 | 0.50 | ea1e958d05be | gdino conf>=0.35 tiled |
| gdino-c020-conf0.4 | 0.9515 | 0.6759 | 37.2 | 0.148 | 95 | 580 | 0.50 | ea1e958d05be | gdino conf>=0.4 tiled |
| gdino-neg-c020-conf0.25 | 0.9490 | 0.6138 | 36.7 | 0.148 | 123 | 637 | 0.50 | ea1e958d05be | gdino conf>=0.25 tiled |
| gdino-neg-c020-conf0.3 | 0.9490 | 0.6138 | 36.7 | 0.148 | 123 | 637 | 0.50 | ea1e958d05be | gdino conf>=0.3 tiled |
| gdino-neg-c020-conf0.35 | 0.9345 | 0.7319 | 36.6 | 0.149 | 85 | 526 | 0.50 | ea1e958d05be | gdino conf>=0.35 tiled |
| local-diff-default | 0.0704 | 0.0083 | 88.8 | 0.302 | 4 | 3502 | 0.00 | ea1e958d05be | detect_painted_subjects defaults t40/a400/d4, centroid, r87 |
| local-diff-t100-a1500 | 0.2500 | 0.0226 | 45.8 | 0.294 | 32 | 4566 | 0.00 | ea1e958d05be | local-diff t100 a1500 |
| local-diff-t150-a1500 | 0.3374 | 0.0356 | 45.4 | 0.288 | 29 | 3905 | 0.00 | ea1e958d05be | local-diff t150 a1500 |
| local-diff-t150-a4000 | 0.3180 | 0.0730 | 45.2 | 0.286 | 5 | 1795 | 0.00 | ea1e958d05be | local-diff t150 a4000 |
| local-diff-t200-a1500 | 0.3981 | 0.0482 | 47.7 | 0.262 | 17 | 3400 | 0.00 | ea1e958d05be | local-diff t200 a1500 |
| local-diff-t200-a4000 | 0.3689 | 0.0873 | 43.8 | 0.261 | 6 | 1741 | 0.00 | ea1e958d05be | local-diff t200 a4000 |
| owlv2-c008-conf0.1 | 0.9854 | 0.3745 | 34.4 | 0.152 | 283 | 1084 | 0.75 | ea1e958d05be | owlv2 conf>=0.1 tiled |
| owlv2-c008-conf0.1-diff0.5 | 0.9587 | 0.4093 | 33.9 | 0.147 | 266 | 965 | 0.62 | ea1e958d05be | owlv2-c008 conf>=0.1 + diff-frac>=0.5 (t40) |
| owlv2-c008-conf0.1-diff0.65 | 0.7354 | 0.4185 | 33.7 | 0.130 | 205 | 724 | 0.29 | ea1e958d05be | owlv2-c008 conf>=0.1 + diff-frac>=0.65 (t40) |
| owlv2-c008-conf0.1-diff0.75 | 0.4515 | 0.4208 | 38.9 | 0.123 | 121 | 442 | 0.12 | ea1e958d05be | owlv2-c008 conf>=0.1 + diff-frac>=0.75 (t40) |
| owlv2-c008-conf0.1-diff0.85 | 0.1966 | 0.4500 | 53.2 | 0.121 | 42 | 180 | 0.00 | ea1e958d05be | owlv2-c008 conf>=0.1 + diff-frac>=0.85 (t40) |
| owlv2-c008-conf0.15 | 0.9733 | 0.5729 | 34.8 | 0.149 | 151 | 700 | 0.58 | ea1e958d05be | owlv2 conf>=0.15 tiled |
| owlv2-c008-conf0.2 | 0.9733 | 0.5729 | 34.8 | 0.149 | 151 | 700 | 0.58 | ea1e958d05be | owlv2 conf>=0.2 tiled |
| owlv2-c008-conf0.3 | 0.9684 | 0.6809 | 34.9 | 0.148 | 107 | 586 | 0.54 | ea1e958d05be | owlv2 conf>=0.3 tiled |
| owlv2-c008-conf0.4 | 0.9563 | 0.7434 | 35.0 | 0.145 | 86 | 530 | 0.50 | ea1e958d05be | owlv2 conf>=0.4 tiled |
| owlv2-c03-snap | 0.9684 | 0.6809 | 32.7 | 0.149 | 125 | 586 | 0.58 | ea1e958d05be | OWLv2 conf0.3 + local-diff snap |
| owlv2-neg-c008-conf0.1 | 0.9782 | 0.3939 | 34.1 | 0.150 | 276 | 1023 | 0.67 | ea1e958d05be | owlv2 conf>=0.1 tiled |
| owlv2-neg-c008-conf0.15 | 0.9709 | 0.5755 | 34.6 | 0.149 | 151 | 695 | 0.54 | ea1e958d05be | owlv2 conf>=0.15 tiled |
| owlv2-neg-c008-conf0.2 | 0.9709 | 0.5755 | 34.6 | 0.149 | 151 | 695 | 0.54 | ea1e958d05be | owlv2 conf>=0.2 tiled |
| owlv2-neg-c008-conf0.3 | 0.9684 | 0.6821 | 34.9 | 0.148 | 107 | 585 | 0.54 | ea1e958d05be | owlv2 conf>=0.3 tiled |
| owlv2-neg-clip-c0.1-p0.7 | 0.0000 | - | - | - | 0 | 0 | 0.00 | ea1e958d05be | owlv2-neg conf>=0.1 + siglip bird-prob>=0.7 |
| owlv2-neg-clip-c0.1-p0.85 | 0.0000 | - | - | - | 0 | 0 | 0.00 | ea1e958d05be | owlv2-neg conf>=0.1 + siglip bird-prob>=0.85 |
| owlv2-neg-clip-c0.15-p0.5 | 0.0000 | - | - | - | 0 | 0 | 0.00 | ea1e958d05be | owlv2-neg conf>=0.15 + siglip bird-prob>=0.5 |
| owlv2-neg-clip-c0.15-p0.7 | 0.0000 | - | - | - | 0 | 0 | 0.00 | ea1e958d05be | owlv2-neg conf>=0.15 + siglip bird-prob>=0.7 |
| owlv2-neg-clip-c0.15-p0.85 | 0.0000 | - | - | - | 0 | 0 | 0.00 | ea1e958d05be | owlv2-neg conf>=0.15 + siglip bird-prob>=0.85 |
| owlv2-neg-clip-c0.3-p0.5 | 0.0000 | - | - | - | 0 | 0 | 0.00 | ea1e958d05be | owlv2-neg conf>=0.3 + siglip bird-prob>=0.5 |
| owlv2-neg-nms07-conf0.15 | 0.9709 | 0.4662 | 31.9 | 0.149 | 282 | 858 | 0.54 | ea1e958d05be | owlv2 conf>=0.15 tiled |
| owlv2-neg-nms07-conf0.2 | 0.9709 | 0.4662 | 31.9 | 0.149 | 282 | 858 | 0.54 | ea1e958d05be | owlv2 conf>=0.2 tiled |
| owlv2-neg-nms07-conf0.3 | 0.9684 | 0.5668 | 32.7 | 0.148 | 206 | 704 | 0.54 | ea1e958d05be | owlv2 conf>=0.3 tiled |
| vlm-gemini36flash | 0.9733 | 0.9733 | 33.3 | 0.151 | 0 | 412 | 0.62 | ea1e958d05be |  |
| vlm-r58 | 0.9733 | 0.9733 | 33.3 | 0.388 | 0 | 412 | 0.62 | ea1e958d05be |  |
| vlm-r58-snap | 0.9539 | 0.9539 | 31.2 | 0.390 | 0 | 412 | 0.62 | ea1e958d05be | fidelity check: shipped defaults (raw r=58) + snap |
| vlm-rescue | 0.9757 | 0.8914 | 33.2 | 0.150 | 12 | 451 | 0.62 | ea1e958d05be | VLM + >=2-vote free rescue clusters |
| vlm-rescue-snap | 0.9733 | 0.8891 | 30.8 | 0.150 | 19 | 451 | 0.58 | ea1e958d05be | VLM + >=2-vote free rescue clusters + snap |
| vlm-snap | 0.9782 | 0.9782 | 31.9 | 0.151 | 0 | 412 | 0.67 | ea1e958d05be | gemini VLM + local-diff snap (shipped incumbent combo) |
| vlm-snap-t120-d2-a900 | 0.9684 | 0.9684 | 31.7 | 0.151 | 0 | 412 | 0.58 | ea1e958d05be | VLM + snap t120 d2 a900 |
| vlm-snap-t120-d5-a900 | 0.9684 | 0.9684 | 31.1 | 0.151 | 0 | 412 | 0.58 | ea1e958d05be | VLM + snap t120 d5 a900 |
| vlm-snap-t160-d2-a600 | 0.9684 | 0.9684 | 31.9 | 0.151 | 0 | 412 | 0.58 | ea1e958d05be | VLM + snap t160 d2 a600 |
| vlm-snap-t160-d5-a900 | 0.9709 | 0.9709 | 32.0 | 0.151 | 0 | 412 | 0.62 | ea1e958d05be | VLM + snap t160 d5 a900 |
| vlm-snap-t200-d2-a400 | 0.9709 | 0.9709 | 34.2 | 0.151 | 0 | 412 | 0.62 | ea1e958d05be | VLM + snap t200 d2 a400 |
| vlm-yolosnap-08 | 0.9709 | 0.9709 | 38.5 | 0.151 | 0 | 412 | 0.62 | ea1e958d05be | VLM centers snapped to yolo11s-v4 conf0.05 within 0.8r |
| vlm-yolosnap-12 | 0.9587 | 0.9587 | 39.7 | 0.154 | 0 | 412 | 0.67 | ea1e958d05be | VLM centers snapped to yolo11s-v4 conf0.05 within 1.2r |
| yolo-folds-composite-conf0.05 | 0.9393 | 0.2429 | 32.7 | 0.154 | 327 | 1593 | 0.75 | ea1e958d05be | yolo11m LOFO composite conf>=0.05 tiled |
| yolo-folds-composite-conf0.1 | 0.9393 | 0.2429 | 32.7 | 0.154 | 327 | 1593 | 0.75 | ea1e958d05be | yolo11m LOFO composite conf>=0.1 tiled |
| yolo-folds-composite-conf0.15 | 0.8155 | 0.4800 | 34.1 | 0.154 | 114 | 700 | 0.46 | ea1e958d05be | yolo11m LOFO composite conf>=0.15 tiled |
| yolo-folds-composite-conf0.2 | 0.8155 | 0.4800 | 34.1 | 0.154 | 114 | 700 | 0.46 | ea1e958d05be | yolo11m LOFO composite conf>=0.2 tiled |
| yolo11m-foldA-golden-conf0.1 | 0.8592 | 0.4121 | 34.8 | 0.151 | 213 | 859 | 0.56 | ea1e958d05be | yolo-custom conf>=0.1 tiled |
| yolo11m-foldA-golden-conf0.2 | 0.6893 | 0.7030 | 37.4 | 0.156 | 36 | 404 | 0.29 | ea1e958d05be | yolo-custom conf>=0.2 tiled |
| yolo11m-foldA-golden-conf0.3 | 0.5461 | 0.8182 | 37.4 | 0.174 | 14 | 275 | 0.17 | ea1e958d05be | yolo-custom conf>=0.3 tiled |
| yolo11m-foldA-golden-conf0.4 | 0.3956 | 0.8670 | 38.0 | 0.193 | 7 | 188 | 0.12 | ea1e958d05be | yolo-custom conf>=0.4 tiled |
| yolo11m-foldB-golden-conf0.1 | 0.9393 | 0.2263 | 33.0 | 0.154 | 265 | 1710 | 0.71 | ea1e958d05be | yolo-custom conf>=0.1 tiled |
| yolo11m-foldC-golden-conf0.1 | 0.9320 | 0.2981 | 34.1 | 0.149 | 310 | 1288 | 0.54 | ea1e958d05be | yolo-custom conf>=0.1 tiled |
| yolo11m-foldD-golden-conf0.1 | 0.9272 | 0.2472 | 30.8 | 0.151 | 357 | 1545 | 0.72 | ea1e958d05be | yolo-custom conf>=0.1 tiled |
| yolo11s-v1-c010-conf0.1 | 0.8883 | 0.2432 | 35.2 | 0.146 | 305 | 1505 | 0.54 | ea1e958d05be | yolo-custom conf>=0.1 tiled |
| yolo11s-v1-c010-conf0.2 | 0.7961 | 0.3966 | 36.2 | 0.149 | 166 | 827 | 0.42 | ea1e958d05be | yolo-custom conf>=0.2 tiled |
| yolo11s-v1-c010-conf0.3 | 0.4029 | 0.6510 | 40.3 | 0.153 | 20 | 255 | 0.04 | ea1e958d05be | yolo-custom conf>=0.3 tiled |
| yolo11s-v1-c010-conf0.4 | 0.1408 | 0.7733 | 41.9 | 0.199 | 2 | 75 | 0.00 | ea1e958d05be | yolo-custom conf>=0.4 tiled |
| yolo11s-v1-c010-conf0.5 | 0.0558 | 1.0000 | 35.2 | 0.292 | 0 | 23 | 0.00 | ea1e958d05be | yolo-custom conf>=0.5 tiled |
| yolo11s-v1-c010-conf0.6 | 0.0073 | 1.0000 | 46.3 | 0.341 | 0 | 3 | 0.00 | ea1e958d05be | yolo-custom conf>=0.6 tiled |
| yolo11s-v4-c010-conf0.1 | 0.8447 | 0.3042 | 39.7 | 0.154 | 204 | 1144 | 0.62 | ea1e958d05be | yolo-custom conf>=0.1 tiled |
| yolo11s-v4-c010-conf0.15 | 0.7985 | 0.3945 | 40.4 | 0.156 | 134 | 834 | 0.55 | ea1e958d05be | yolo-custom conf>=0.15 tiled |
| yolo11s-v4-c010-conf0.2 | 0.7985 | 0.3945 | 40.4 | 0.156 | 134 | 834 | 0.55 | ea1e958d05be | yolo-custom conf>=0.2 tiled |
| yolo11s-v4-c010-conf0.3 | 0.6505 | 0.5572 | 40.0 | 0.165 | 55 | 481 | 0.25 | ea1e958d05be | yolo-custom conf>=0.3 tiled |
| yolo11s-v4-c010-conf0.4 | 0.4782 | 0.6864 | 39.7 | 0.169 | 23 | 287 | 0.24 | ea1e958d05be | yolo-custom conf>=0.4 tiled |
| yolo11s-v4-c010-conf0.5 | 0.2913 | 0.8333 | 38.7 | 0.194 | 7 | 144 | 0.00 | ea1e958d05be | yolo-custom conf>=0.5 tiled |
| yoloworld-c008-conf0.05 | 0.7913 | 0.7133 | 37.7 | 0.138 | 48 | 457 | 0.32 | ea1e958d05be | yoloworld conf>=0.05 tiled |
| yoloworld-c008-conf0.1 | 0.7913 | 0.7133 | 37.7 | 0.138 | 48 | 457 | 0.32 | ea1e958d05be | yoloworld conf>=0.1 tiled |
| yoloworld-c008-conf0.15 | 0.7330 | 0.7763 | 38.2 | 0.139 | 33 | 389 | 0.26 | ea1e958d05be | yoloworld conf>=0.15 tiled |
| yoloworld-c008-conf0.2 | 0.7330 | 0.7763 | 38.2 | 0.139 | 33 | 389 | 0.26 | ea1e958d05be | yoloworld conf>=0.2 tiled |
| yoloworld-c008-conf0.3 | 0.6456 | 0.8160 | 39.2 | 0.134 | 29 | 326 | 0.20 | ea1e958d05be | yoloworld conf>=0.3 tiled |
| yoloworld-neg-c005-conf0.05 | 0.8277 | 0.6806 | 37.2 | 0.137 | 63 | 501 | 0.32 | ea1e958d05be | yoloworld conf>=0.05 tiled |
| yoloworld-neg-c005-conf0.1 | 0.8277 | 0.6806 | 37.2 | 0.137 | 63 | 501 | 0.32 | ea1e958d05be | yoloworld conf>=0.1 tiled |
| yoloworld-neg-c005-conf0.15 | 0.7427 | 0.8074 | 37.5 | 0.140 | 31 | 379 | 0.26 | ea1e958d05be | yoloworld conf>=0.15 tiled |
| shipped-rev8-voronoi-2026-08-07 | 0.0000 | - | - | - | 0 | 0 | 0.00 | ea1e958d05be | shipped catalog after Voronoi close-pair recentre + 48px margins (CDN rev 8 / builds 19-22) |
| shipped-rev8-voronoi-2026-08-07 | 0.8422 | 0.8382 | 37.5 | 0.000 | 2 | 414 | 0.58 | ea1e958d05be | shipped catalog after Voronoi close-pair recentre + 48px margins (CDN rev 8, builds 19-22) |
