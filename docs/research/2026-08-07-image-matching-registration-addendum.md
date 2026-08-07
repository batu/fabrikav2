# Image-matching addendum: bird cutout registration

## Decision

The image-matching direction is worth testing, but **grayscale plus a better matcher is not itself the solution**. The useful experiment is to generate correspondences inside the human-owned search region, fit a deliberately limited transform with RANSAC, and reject weak or spatially concentrated consensus. Start with **ORB and SIFT as cheap controls**, then **ALIKED or DISK + LightGlue** on the Ubuntu GPU. Test LoFTR only as a detector-free challenger. Do not add shear until correspondences pass the rejection tests.

This is preferable to optimizing another whole-patch similarity score: correspondences can say which head/wing/body points agree, and RANSAC can ignore scenery. It also exposes an auditable confidence signal rather than merely returning the best bad answer.

## What grayscale changes

Grayscale can suppress misleading palette differences between the flat cutout and painted scene. It cannot repair changed pose, missing anatomy, or a wrong sticker. More importantly, it is already implicit in the obvious baselines: OpenCV's own SIFT/ORB matching example reads grayscale images, ECC requires single-channel inputs, and LoFTR's published interface is grayscale. Therefore “try grayscale” is a useful control, not a new algorithm. [OpenCV feature matching](https://docs.opencv.org/doc/doxygen/html/dc/dc3/tutorial_py_matcher.html) · [OpenCV ECC](https://docs.opencv.org/4.0.0/dc/d6b/group__video__track.html) · [LoFTR paper](https://openaccess.thecvf.com/content/CVPR2021/html/Sun_LoFTR_Detector-Free_Local_Feature_Matching_With_Transformers_CVPR_2021_paper.html)

## Candidate ranking

1. **ALIKED/LightGlue or DISK/LightGlue — best first learned test.** LightGlue matches sparse local features and returns match scores. Its adaptive pruning makes it practical: the official RTX 3080 benchmark reports 150 FPS at 1,024 keypoints, while CPU reaches 20 FPS at 512 keypoints. Fit similarity or affine transforms with USAC/RANSAC; reject on inlier count, inlier ratio, reprojection error, spatial coverage, and disagreement between similarity and affine fits. LightGlue code/weights are Apache-2.0; ALIKED is BSD-3-Clause and DISK follows Apache-2.0. Avoid the bundled SuperPoint lane for production until its separate restrictive license is cleared. [Official repository](https://github.com/cvg/LightGlue) · [ICCV paper](https://openaccess.thecvf.com/content/ICCV2023/papers/Lindenberger_LightGlue_Local_Feature_Matching_at_Light_Speed_ICCV_2023_paper.pdf)
2. **LoFTR — useful second learned test.** It creates semi-dense matches without requiring repeatable keypoint detections and was explicitly designed to help low-texture regions. That may help small cartoon birds, but its indoor/outdoor natural-image training domain is still unlike cutout-to-painted matching. The paper reports 104 ms for its smaller variant on its evaluation hardware; use GPU. The official implementation is Apache-2.0, though its optional optimal-transport path pulls separately licensed SuperGlue code, so use the dual-softmax model. [Official repository](https://github.com/zju3dv/LoFTR) · [CVPR paper](https://openaccess.thecvf.com/content/CVPR2021/html/Sun_LoFTR_Detector-Free_Local_Feature_Matching_With_Transformers_CVPR_2021_paper.html)
3. **SIFT and ORB — necessary CPU controls, not the expected final winner.** They are already available through OpenCV and run in milliseconds on these crops. Their weakness is useful: if a learned method cannot beat their accepted-fit rate and rejection precision, it has added a GPU dependency for decoration. [OpenCV feature APIs](https://docs.opencv.org/5.0/main_modules/features_main.html) · [OpenCV affine RANSAC](https://docs.opencv.org/3.4.14/d9/d0c/group__calib3d.html)
4. **ASpanFormer — lower priority.** Its adaptive attention span and pixel uncertainty are relevant, but it is another natural-scene detector-free matcher, with a less maintained integration path than LightGlue or LoFTR. Its uncertainty is not automatically an application-level rejection score. Benchmark only if LoFTR shows promise but is unstable on scale. [Apple research page](https://machinelearning.apple.com/research/detector-free-image) · [Project page](https://aspanformer.github.io/)
5. **RoMa — capable, but not the clean alternative being requested.** RoMa returns dense warps and certainty and reports strong wide-baseline robustness. It also explicitly uses frozen DINOv2 features, so it is the DINO route under another name. It is heavier, defaults to 560→864 resolution, and its unconstrained warp is more freedom than this pickup problem needs. Code is MIT and DINOv2 is Apache-2.0. Keep it as a later ceiling test, not the first experiment. [Official repository](https://github.com/Parskatt/RoMa) · [CVPR paper](https://openaccess.thecvf.com/content/CVPR2024/papers/Edstedt_RoMa_Robust_Dense_Feature_Matching_CVPR_2024_paper.pdf)

## Local three-bird sanity check

I ran unmodified grayscale SIFT and ORB on `dog_01`, `dog_02`, and `dog_09`: transparent sprite pixels were masked, the scene was cropped to the current box plus 130 px, Lowe ratio was 0.75, and a similarity transform was estimated with RANSAC at 4 px. This is deliberately a matcher test, not a claim of visual acceptance.

- `dog_01`: SIFT produced 3 ratio-test matches / 3 inliers and a plausible 0.835 scale; ORB produced only 2 matches and no transform.
- `dog_02`: SIFT produced 2 matches and no transform; ORB produced 15 matches / 14 inliers and a plausible 0.687 scale.
- `dog_09`: SIFT produced 4 matches / 3 inliers and a plausible 0.796 scale; ORB produced 5 matches / 2 inliers and an absurd 2.155-scale rotation fit.
- Mean local extraction time was 18.1 ms/pair for SIFT and 4.81 ms/pair for ORB on this Mac; matching/RANSAC adds little at these feature counts.

The useful result is not that classic features solve two birds. It is that **different methods succeed on different birds and low-count consensus is dangerous**. `dog_09` demonstrates why “a transform was returned” cannot mean accepted.

## Minimal GPU benchmark

Run four lanes on the 98 already human-reviewed birds: ORB, SIFT, ALIKED/LightGlue (or DISK/LightGlue), and LoFTR. Each lane receives the same alpha-masked sprite and hitbox-centered scene crop. From matches, estimate in order:

1. translation + uniform scale + rotation;
2. independent X/Y scale only when the similarity fit is rejected;
3. affine/shear only as an experimental candidate, never as an automatic fallback.

For every candidate record inlier count/ratio, median and p90 reprojection error, convex-hull coverage over the sprite alpha, determinant, X/Y scales, rotation, shear, and stability under a ±16 px crop perturbation. Reject if consensus is sparse or confined to one small patch, the transform changes materially under crop perturbation, or two competent matchers disagree. Score against the existing human labels using **accepted-fit precision first**, then coverage; a matcher that confidently transforms regeneration cases is worse than one that abstains.

The first Portal comparison only needs three columns: Previous Color, best accepted correspondence fit, and Needs regeneration. Shear should be shown as a separate diagnostic on cases where it materially improves correspondence residuals without moving alpha outside the human hitbox. Otherwise it will repeat ECC's earlier failure with more convincing mathematics.
