# Find the Bird: hidden-object level-design research

Date: 2026-07-30  
Purpose: turn established hidden-object practice, mobile guidance, and visual-search research into generation and acceptance rules for the 36-cell magenta experiment and the additional best-level budget.

## Executive direction

The best levels should not maximize concealment. They should create a readable scene in which each bird is locally camouflaged but globally fair: the player can form a useful search plan, inspect distinct visual regions, and eventually explain why the bird belonged where it was.

For this project, the practical design target is:

- **Easy:** recognizable bird silhouette, low local clutter, weak occlusion, generous separation.
- **Medium:** one controlled camouflage dimension at a time — color, texture, or partial occlusion.
- **Hard:** two controlled dimensions, never disappearance through tiny scale, clipping, or undifferentiated noise.
- **All difficulties:** a fully tappable center, one bird per hitbox, no bird on critical UI/safe-area boundaries, and no accidental duplicate bird-like shapes immediately beside a target.

That is an application of the sources below, not a claim that the sources prescribe these exact game rules.

## Actionable principles

### 1. Make difficulty local, not uniformly noisy

Human search accuracy declines as set size and target eccentricity increase; the interaction becomes worse at higher loads. In a preregistered eye-tracking study, accuracy decreased across both eccentricity and set size, reaching 91.3% in the most demanding reported condition versus 97.8% in the easiest conditions ([Greenwood et al., 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8164367/)). Separate active-search work found that detection was governed by the local density of relevant, target-like stimuli rather than raw scene population alone ([Motter & Holsapple, 2000](https://doi.org/10.1016/S0042-6989(99)00218-7)).

**Apply it:** distribute complexity into alternating calm and busy regions. Put at most a minority of birds in the busiest clusters. Do not make every square centimeter equally detailed. Measure density in a neighborhood around each bird, not only total edge density for the whole image.

### 2. Control target–background similarity deliberately

Experiments with real-world objects found that increasing target–distractor similarity impaired both search guidance and target verification ([Alexander & Zelinsky, 2012](https://doi.org/10.1016/j.visres.2011.12.004)). Controlled color-search experiments likewise found a nonlinear relationship: high similarity slowed search, while improvement plateaued after moderate separation ([Chapman et al., 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9290316/)).

**Apply it:** define each bird's concealment mechanism in the manifest:

- silhouette contrast;
- color contrast;
- texture contrast;
- occlusion fraction;
- local look-alike count.

Easy birds should differ on at least two of silhouette, color, and texture. Medium birds may closely match one. Hard birds may closely match two, but must retain a readable silhouette fragment and tappable center.

### 3. Use semantic placement as a fair clue

Searchers use scene context and object co-occurrence to predict likely target locations. A real-scene study found that agreement about where an absent target ought to appear correlated with neural representations of that expected location ([Harel et al., 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC3968772/)). Eye tracking across more than 900 natural scenes likewise supported contributions from target appearance and the learned relationship between target location and scene context ([Ehinger et al., 2009](https://pmc.ncbi.nlm.nih.gov/articles/PMC2790194/)).

**Apply it:** place birds where birds plausibly perch or shelter — rails, branches, rigging, roof edges, crates, reeds, signs, and openings. Use implausible placements sparingly as surprise, not as the default difficulty mechanism. A player should be rewarded for searching perch-shaped geometry.

### 4. Preserve useful silhouettes under occlusion

Crowding is an identification failure caused by nearby flankers, and its cost varies with target eccentricity and feature relationships ([Greenwood et al., 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8164367/)). This means “partly hidden” and “surrounded by similar contours” compound each other.

**Apply it:** cap occlusion by difficulty and require the head, torso, or another diagnostic bird contour to remain visible:

- easy: 0–10% occluded;
- medium: 10–25%;
- hard: 25–40%;
- reject: center occluded, silhouette severed into unrelated fragments, or visibility dependent on one or two stray pixels.

Do not place a heavily occluded bird in the densest cluster or at an extreme screen edge.

### 5. Make apparent scale a bounded difficulty variable

Target eccentricity and size both affect natural-scene search, while crowding worsens peripheral identification ([COCO-Search18 dataset paper](https://pubmed.ncbi.nlm.nih.gov/33888734/); [Greenwood et al., 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8164367/)). On mobile, visual size and interaction size are separate constraints.

**Apply it:** keep bird apparent area within a narrow band inside a level; the current proposed 25% diameter variation is a sound experimental bound. Use scene composition and camouflage for difficulty before shrinking birds. Reject generated birds whose size difference makes them look like a different gameplay class.

### 6. Design hitboxes for fingers, not for artwork bounds

Apple's game guidance recommends a 44 × 44 point default touch target on iPhone and iPad, warns that small or tightly spaced controls frustrate players, and recommends accommodating safe areas and varied aspect ratios ([Apple HIG: Designing for games](https://developer.apple.com/design/human-interface-guidelines/designing-for-games/); [WWDC24: Design advanced games](https://developer.apple.com/videos/play/wwdc2024/10085/?time=325)).

**Apply it:** after recognition, center a forgiving hitbox on the visible bird and expand it to a minimum mobile tap footprint in screen space. Keep neighboring hitboxes disjoint enough to avoid ambiguous taps. Validate at the smallest supported phone viewport and at the initial zoom, not only in source-image pixels.

### 7. Treat the scene as a sequence of search regions

Research shows that context guides eye movements in real scenes ([Harel et al., 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC3968772/)). Established hidden-object products also frame the activity as relaxed observation embedded in a longer narrative loop: Wooga describes *June's Journey* around relaxing play, careful observation, story, regular content, and long-term engagement ([Wooga company overview](https://www.wooga.com/press); [Wooga game overview](https://www.wooga.com/junes-journey)). In the GDC postmortem for *The Shape of Us*, hidden-object scenes were connected to story/feed progression with diegetic breadcrumbs indicating the next action ([Siegel & Scott, GDC 2022 slides](https://media.gdcvault.com/GDC%2B2022/Speaker%2BSlides/TheDesignOf_Siegel_Scott.pdf)).

**Apply it:** compose 4–7 visually named regions per scene — for example bow, camp, tide pools, rigging, cave mouth. Distribute birds so a systematic sweep is possible. Use environment storytelling and a small reveal/progression beat after completion; replayability should come from alternate valid bird placements or subsets, not merely rerolling noise.

## Generation rules for the “best levels” budget

Use the paid comparison to choose a reliable model/scale lane, then spend the discretionary budget on **designed scene concepts**, not more undirected permutations.

1. Generate backgrounds with a strong visual route: foreground entry, midground landmark, background payoff, and 4–7 distinct search regions.
2. Request plausible perch and shelter opportunities throughout the frame, with alternating calm and detailed zones.
3. Generate/reconcile birds against an explicit difficulty roster, such as 4 easy, 7 medium, 4 hard for a 15-bird level.
4. Reject structural unfairness automatically: missing/extra birds, clipping, residual magenta, dead-pixel silhouettes, out-of-range scale, unsafe edges, or empty hitboxes.
5. Rank survivors using measured correctness first, then human visual judgment for atmosphere, regional variety, semantic placement, and “one more scene” appeal.

## Suggested measurable acceptance gates

These thresholds are project recommendations derived from the evidence, to be tuned with actual device playtests:

- exact expected bird count;
- one recognized bird matched to one hitbox;
- bird center inside its hitbox;
- minimum 44 × 44 pt effective tap area at the smallest supported iPhone viewport;
- bird apparent diameter within ±25% of the level median;
- no bird clipped by the image boundary or initial safe-area crop;
- no hard bird combining more than two of: high color similarity, high texture similarity, heavy occlusion, dense local flankers, extreme eccentricity;
- at least four distinct search regions represented;
- no more than two hard birds in the same visual region;
- zero unexplained changes outside the intended magenta regions.

## Replayability without cheapening fairness

- Maintain a curated pool of validated perches per background and choose a balanced subset per run.
- Preserve regional coverage and difficulty mix when swapping targets.
- Rotate bird color/species only when the cue shown to the player matches the actual target.
- Do not reuse a location immediately after it was found; contextual learning makes repeated locations easier, which can be useful for progression but poor for consecutive replay.
- Track first-find time, last-find time, hint usage, mis-taps, zoom usage, and abandonment by target. Those observations can distinguish satisfying concealment from a defective target better than aggregate completion time.

## Limits of this research

- The peer-reviewed studies establish visual-search effects under controlled or natural-scene experiments; the numeric game thresholds above are implementation hypotheses, not universal psychophysical laws.
- Public first-party hidden-object developer material is stronger on product framing, narrative loops, and engagement than on exact scene-authoring formulas. The 36-cell matrix and physical-device playtests should therefore validate the thresholds before they become permanent generation rules.
- Automatic recognition quality remains part of the acceptance system. A detector disagreement should fail a cell for review; it should not silently move a hitbox onto uncertain scenery.
