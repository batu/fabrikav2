# Bird cutout-to-scene registration: options and recommended experiment

**Question.** How should a generated transparent bird cutout be positioned and scaled over the painted version when the two depictions may differ in color, texture, outline, pose, or even identity?

## Recommendation

Do not replace the current color fitter with one large neural model. Run a small cascade, beginning from the human hitbox and fitting only a constrained transform:

1. **Mask-first candidate:** segment the painted bird inside the hitbox crop with SAM 2, then fit the cutout alpha mask by translation plus independent X/Y scale. Optimize a boundary distance plus mask overlap, not RGB. This directly addresses the voted failure modes (mostly size, then offset) and ignores harmless style/color changes.
2. **Semantic-correspondence candidate:** extract DINOv2 patch features from the cutout and painted crop, keep mutual nearest-neighbor correspondences, and robustly fit a similarity or axis-aligned affine transform. DINOv2 explicitly exposes patch features and demonstrates dense matching; it is a better first neural test for cross-style correspondence than photometric registration. [DINOv2 paper and official code](https://github.com/facebookresearch/dinov2)
3. **Reject rather than distort:** accept an automatic result only when the segmentation and correspondence candidates agree, the transform is plausible, and the fitted cutout improves held-out human preference. Otherwise preserve the current geometry and flag it for regeneration/review.

Use the Ubuntu GPU for batched SAM 2 and DINOv2 inference. Transform search, distance transforms, and robust fitting remain CPU work. Cache masks/features per bird so subsequent transform experiments are cheap.

This is deliberately not an unrestricted affine or dense warp. A shear can improve pixel overlap while turning the bird into a tax problem. Independent X/Y scale is reasonable as an experiment; shear and projective distortion are not justified by this pickup animation.

## Candidate methods

### 1. Classical photometric registration

- **Masked template matching:** the existing color fitter is this family. OpenCV's `matchTemplate` slides a template over an image and returns a score at each location. It is fast and deterministic, but assumes comparable local appearance; a redrawn bird with changed markings violates that assumption. [OpenCV template-matching documentation](https://docs.opencv.org/4.11.0/d4/dc6/tutorial_py_template_matching.html)
- **ECC alignment:** OpenCV's `findTransformECC` directly optimizes an image-warp correlation objective and supports translation, Euclidean, affine, or homography motion models. It can refine a good initialization, but it is still an intensity-based objective and can converge badly when the subject was redrawn or the crop contains textured scenery. It is worth one cheap grayscale/edge-map benchmark, not the primary solution. [OpenCV ECC sample](https://docs.opencv.org/4.3.0/dd/d93/samples_2cpp_2image_alignment_8cpp-example.html)
- **Distance-transform / chamfer fitting:** convert the cutout alpha and painted segmentation to contours; minimize bidirectional contour distance while searching translation and X/Y scale. OpenCV provides distance transforms and contour/shape primitives. This is robust to color changes and gives interpretable residuals, but depends on obtaining a usable painted-bird mask. [OpenCV shape-analysis API](https://docs.opencv.org/4.x/d3/dc0/group__imgproc__shape.html), [OpenCV distance-transform API](https://docs.opencv.org/4.x/d7/d1b/group__imgproc__misc.html)

**Fit here:** strongest low-cost next step once a target mask exists. It is also the cleanest way to test truly unlocked axes without confusing improved geometry with improved color similarity.

### 2. Sparse feature matching

- **SIFT/ORB + robust transform:** detect local features in the sprite and crop, match descriptors, then estimate a transform from inliers. OpenCV's `estimateAffinePartial2D` fits translation, rotation, and uniform scale with RANSAC or LMedS; a full `estimateAffine2D` permits independent axes/shear. [OpenCV calibration API](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html)
- **SuperPoint + LightGlue:** LightGlue matches sparse learned features and exposes match confidence plus adaptive depth/width pruning. Its official benchmark reports GPU and CPU throughput and supports FlashAttention/mixed precision. [LightGlue paper](https://openaccess.thecvf.com/content/ICCV2023/html/Lindenberger_LightGlue_Local_Feature_Matching_at_Light_Speed_ICCV_2023_paper.html), [official repository](https://github.com/cvg/LightGlue)

**Fit here:** useful as a cheap secondary candidate, especially where internal markings survive the redraw. The risk is fundamental: tiny cartoon birds may contain few repeatable corners, and background features can dominate unless matching is masked to the subject.

### 3. Dense neural correspondence

- **LoFTR:** produces coarse pixel-wise matches and refines them, avoiding a separate feature detector; its stated advantage is matching low-texture areas where detector-based methods struggle. It was developed and evaluated for indoor/outdoor geometric image pairs, not separately redrawn semantic instances. [LoFTR paper](https://openaccess.thecvf.com/content/CVPR2021/html/Sun_LoFTR_Detector-Free_Local_Feature_Matching_With_Transformers_CVPR_2021_paper.html), [official repository](https://github.com/zju3dv/LoFTR)
- **RoMa:** combines frozen DINOv2 features with fine ConvNet features and predicts dense warps with certainty. It is more robust to large appearance changes than classical local features and provides useful confidence, but its task is still two views of a scene. Use its matches to estimate the small allowed transform; never apply its dense warp directly to the pickup sprite. [RoMa paper](https://arxiv.org/abs/2305.15404), [official repository](https://github.com/Parskatt/RoMa)
- **Raw DINOv2 correspondence:** compare intermediate patch tokens between the masked cutout and crop. The model was designed to produce general-purpose visual features and the project demonstrates dense matching without task-specific fine-tuning. Its coarser localization should be refined with contour fitting after it supplies the approximate correspondence. [DINOv2 paper and official code](https://github.com/facebookresearch/dinov2)

**Fit here:** DINOv2 is the best first GPU experiment because the mismatch is partly semantic/style-level. RoMa is the next benchmark if raw patch correspondence is too coarse. LoFTR is lower priority because its learned invariances are aimed more at viewpoint/illumination than two different drawings of a bird.

### 4. Segmentation- and silhouette-guided fitting

The cutout already supplies a high-quality source alpha. The missing artifact is a target mask for the painted bird. SAM 2 accepts point, box, or mask prompts for static-image prediction, and its official implementation supports CUDA autocast. The human hitbox center is a natural positive point; the local crop or a detector box constrains the prompt. [SAM 2 paper](https://arxiv.org/abs/2408.00714), [official repository and image API](https://github.com/facebookresearch/sam2)

For every candidate target mask:

- choose the component containing the hitbox center;
- search translation, scale X, scale Y, and optionally a very small rotation;
- score symmetric boundary distance, mask IoU/Dice, and hitbox containment;
- penalize aspect distortion, but record unconstrained optima first so the acceptable bound comes from the vote set rather than guesswork.

SAM 2 can return multiple valid masks for an ambiguous prompt, so retain the best few masks and let geometric/semantic confidence choose among them instead of trusting the first mask. Segmentation may still absorb branches or omit stylized tail/wing details; disagreement with DINO correspondence is therefore a useful rejection signal, not an inconvenience.

## Confidence and outlier rejection

Every method should return a candidate plus evidence, never merely a box. Recommended acceptance features:

- robust inlier count/ratio and spatial coverage of correspondences;
- median and high-percentile reprojection error after fitting;
- forward/backward mutual-match or cycle consistency;
- target-mask IoU and symmetric contour distance;
- agreement between mask-fit and DINO-fit transforms;
- transform plausibility: hitbox contained, crop bounds respected, no reflection/shear, and learned limits for X/Y scale and aspect change.

Fit correspondence transforms with RANSAC initially, then compare MAGSAC++ if threshold sensitivity is visible. MAGSAC++ marginalizes over noise scale rather than relying on one hard inlier threshold and reports stronger robust-estimation results in its evaluation. [MAGSAC++ paper](https://openaccess.thecvf.com/content_CVPR_2020/html/Barath_MAGSAC_a_Fast_Reliable_and_Accurate_Robust_Estimator_CVPR_2020_paper.html)

Calibrate the final accept/reject threshold against the Portal votes. The present automatic score reportedly agrees with decisive human choices only about 70%, so it must not label its own training or validation data. Treat `Needs regeneration` as a separate class: when the cutout depicts the wrong bird or excludes the subject, no legal transform can repair it.

## Prioritized experiment

1. Freeze the reviewed birds and votes as the benchmark; split threshold tuning from final evaluation by level/family.
2. On the GPU server, cache SAM 2 masks and DINOv2 features for each sprite/crop pair.
3. Generate exactly three read-only candidates: current Previous Color, SAM-mask contour fit with free X/Y scale, and DINOv2-correspondence transform refined by contour fit.
4. Gate candidates using method agreement and the evidence above; outliers remain unchanged and are flagged.
5. Put only genuinely different candidates in Portal and measure pairwise acceptance, regeneration recall, residual error tags, runtime, and GPU memory.

The likely production answer is a cascade, not a winner-take-all model: cheap color/mask fitting handles ordinary cases, semantic correspondence rescues cross-style cases, and high-confidence rejection protects the game from the cases where the sticker is simply not the painted bird.
