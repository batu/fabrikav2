# Adversarial geometry-model review

Verdict: the model is directionally sound, but it currently contains two internal contradictions:

1. A stored radius cannot be the “real tap radius” while runtime may shrink it using a neighbor-dependent clamp.
2. CL-5 derives restoration from paint-diff, while CL-9 later says restoration derives from sprite bounds. Paint-diff must remain authoritative; sprite masks are only exclusion/protection inputs.

The current runtime demonstrates both traps: it dynamically transforms stored radii in [hitboxGeometry.ts](/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/src/scenes/hitboxGeometry.ts:29), resolves overlap by nearest center in [GameScene.ts](/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/src/scenes/GameScene.ts:1396), and constructs cleanup from sprite rectangles in [GameScene.ts](/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/src/scenes/GameScene.ts:3010).

## Ranked attacks

### P0 — The 2× bake does not reproduce current tap behavior

**Real failure:** Yes—migration corruption if implemented as `newR = oldR × 2`.

Current behavior is not uniformly 2×:

- Square levels apply `max(r, floor) × 2`, then a neighbor-distance clamp, then let the floor override that clamp.
- Non-square levels apply `r × GAMEPLAY.TOLERANCE_MULTIPLIER`, currently 3×.
- Close pairs may therefore have effective radii equal to the floor, half-distance clamp, or 2× radius depending on geometry.

A literal 2× bake changes live tap behavior for rectangular levels, floored birds, and close pairs.

**Invariant:** For every bird and a dense set of sampled tap points, pre-migration and post-migration hit resolution must return the same bird or miss:

```text
legacyWinner(level, point) == migratedWinner(level, point)
```

Include boundaries and pairwise bisectors.

**Cheapest amendment:** Bake each bird’s **resolved legacy effective radius**, using the complete old formula and original full neighbor set. Do not bake by multiplying the raw radius.

Then remove all radius multiplication and minimum-floor logic from runtime.

More importantly, clarify “neighbor bisector clamp”:

- Keep the nearest-center arbitration, which implicitly limits each bird to its Voronoi cell.
- Delete any neighbor-dependent scalar-radius shrinkage.

Otherwise the stored circle still is not the actual tap area shown by the editor.

---

### P0 — Restoration ownership can permanently strand paint

**Real failure:** Yes, depending on what “components Voronoi-assigned” means.

Assigning an entire connected component to the bird nearest its centroid is unsafe. One component can contain:

- two touching birds;
- a bird plus a shared prop;
- thin repaint bridges caused by compression or antialiasing;
- global tint noise connecting most of the scene.

The assigned component may cross several Voronoi cells. CL-9 then intersects it with its owner’s cell, but no other bird owns the removed portion. Those pixels can become unreachable and survive after every pickup.

**Invariant:**

```text
union(final dissolve regions for all birds) == accepted paint-diff footprint
```

within a small alpha/color tolerance. No diff pixel may have zero owners.

**Cheapest amendment:** Assign ownership per diff pixel—or split every connected component by the global Voronoi partition before attaching pieces to birds. Components may remain an optimization/diagnostic unit, but they must not be the indivisible ownership unit.

---

### P0 — Diff noise can turn restoration into scene-wide repaint

**Real failure:** Yes. WebP drift, resampling, color-management differences, global repaint tint, shadows, or generation-wide tone shifts can make most of the image nonzero under a naïve scene-minus-background comparison.

Nearest-bird assignment will then confidently attach unrelated foliage, lighting, or global tint to birds. Picking birds may reveal large clean-background wedges unrelated to the selected object.

**Invariant:** Diff quality must pass corpus-level plausibility gates before automatic restoration is accepted:

- changed-pixel ratio below a configured ceiling;
- no giant component above an area/diameter ceiling unless manually approved;
- sufficient local concentration around birds;
- residual energy outside expanded bird neighborhoods below a threshold.

**Cheapest amendment:** Add a diff-normalization and rejection stage:

1. Align dimensions and color space.
2. Estimate/remove low-frequency global color shift.
3. Threshold perceptual delta rather than byte inequality.
4. Remove tiny isolated components.
5. Refuse automatic derivation when the remaining footprint is globally distributed.

Fail closed to “needs restoration review”; never publish a dubious automatic region.

---

### P1 — Pickup-order independence is not guaranteed

**Real failure:** Yes for intermediate visuals; potentially yes for the final scene if ownership is incomplete.

CL-9 subtracts only **still-unfound** neighbors’ sprite footprints. Therefore the same bird has different dissolve geometry depending on pickup order. That is intentional protection, but it creates two obligations:

- No order may expose a still-unfound neighbor.
- Every complete pickup permutation must converge to the same clean scene.

A bird entirely inside another bird’s restore region illustrates this. If outer A is picked first, B’s sprite is protected. If B is picked first, A may later clear the overlap. This is acceptable only if B owns or can later clear every protected pixel. A sprite footprint alone does not establish that ownership.

**Invariants:**

```text
after any prefix:
  pixels belonging to every unfound sprite remain covered

after any complete permutation:
  rendered scene == clean background
  and final mask is permutation-independent
```

**Cheapest amendment:** Precompute a static, exhaustive restoration ownership partition. Dynamic sprite subtraction may protect an unfound body, but every subtracted pixel must have a named later owner. If no later owner exists, reject the level or expand that neighbor’s restoration ownership.

Test all permutations for small overlap clusters and representative/random permutations for larger clusters.

---

### P1 — Manual overrides conflict with automatic DAG re-derivation

**Real failure:** Yes. “Manual override flagged” and “DAG re-derives on hitbox/sprite/scene moves” are incompatible unless staleness behavior is explicit.

Silently regenerating an override destroys a human decision. Silently retaining it after its inputs move can produce misplaced restoration. Treating it as fresh is worse than either.

**Invariant:** Every manual region records the exact revisions/hashes of:

- clean background;
- painted scene;
- bird hitbox set;
- relevant sprite geometry/mask.

Any dependency change must make the override `STALE_MANUAL`, never silently `VALID` or silently replaced.

**Cheapest amendment:** Preserve the override bytes, mark them stale, show the geometric/source diff, and block publish until the operator chooses:

- rederive automatically;
- keep/reconfirm the override;
- edit it again.

This also preserves the project’s human-review contract across representation changes.

---

### P1 — A moved hitbox invalidates more than the plan currently admits

**Real failure:** Yes.

A hitbox center participates in:

- tap arbitration;
- restoration Voronoi ownership;
- generation crop;
- recomputed sprite anchor;
- dissolve half-spaces;
- potentially component-to-bird attribution.

Moving it after restoration derivation changes all those functions. Continuing to use the old restoration region can erase the wrong content even if the sprite itself did not move.

**Invariant:** No derived artifact may be consumed unless its provenance key equals the current dependency key:

```text
derived.inputRevision ==
hash(scene, cleanBg, complete hitbox set, sprite geometry, derivation recipe)
```

The **complete hitbox set** matters because moving B changes A’s Voronoi cell.

**Cheapest amendment:** Make restoration a set-level derivation, not an independently cached per-bird calculation. Any center add/remove/move invalidates the restoration partition for the connected overlap cluster—or, simplest initially, for the entire level.

---

### P1 — Uniform tap radii can make visible large birds untappable

**Real failure:** Yes. This is precisely why current runtime introduced the 2× leniency in [hitboxGeometry.ts](/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/src/scenes/hitboxGeometry.ts:10).

A single uniform circle can work as a product constraint, but it cannot simultaneously mean “all visibly bird-like pixels are tappable” when sprite sizes vary substantially. A large or elongated bird may have obvious body pixels outside the circle.

Nearest-center arbitration does not help a point that lies outside every accepted radius.

**Invariant:** For each bird, a required percentage of its visible/semantic body mask must lie within its tap circle—preferably measured after excluding long props, shadows, and decorative spill:

```text
area(bodyMask ∩ tapCircle) / area(bodyMask) >= requiredCoverage
```

Also measure the maximum distance from any core-body pixel to the center.

**Cheapest amendment:** Keep a narrow uniform-radius band, not exact equality. Derive a recommended radius from the core sprite mask and flag outliers. For an outlier, require one of:

- resize/reposition the sprite;
- reposition the center;
- explicitly approve a larger radius.

Do not silently introduce a second runtime multiplier.

---

### P2 — Three-way overlap is mathematically safe, but implementation details can reintroduce order dependence

**Real failure:** Not in the ideal model.

Intersecting A’s half-space against every other relevant site is exactly A’s convex Voronoi cell. Pairwise clipping is sufficient for 3, 4, or more mutually overlapping birds. Because half-space intersection is commutative, neighbor iteration order does not change the mathematical result.

The current Sutherland–Hodgman implementation at [GameScene.ts](/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/src/scenes/GameScene.ts:3048) can nevertheless differ slightly by order because of floating-point intersections, near-collinear edges, duplicate vertices, and zero/near-zero center distances.

More serious: conditionally including neighbors based on rectangular overlap does **not** necessarily construct the true Voronoi cell. A neighbor excluded by the broad-phase test can still own part of an irregular paint-diff restoration region.

**Invariant:**

- Random permutations of neighbor order produce equivalent polygons/masks within epsilon.
- Every retained point is no farther from its owner than from every relevant neighbor.
- Coincident or near-coincident centers are rejected.

**Cheapest amendment:** Build one global Voronoi partition from all bird centers, deterministically sorted by stable bird ID. Intersect restoration regions with those precomputed cells. Use overlap checks only as performance acceleration after proving they cannot exclude a geometrically relevant neighbor.

Rasterizing at source-image resolution is likely cheaper and more robust than maintaining exact polygon topology for irregular paint-diff masks.

---

### P2 — Equidistant props have no semantically correct nearest-center owner

**Real failure:** Yes, but it is an ambiguity rather than a geometry error.

A flower, bucket, or shared shadow exactly on a bisector can be equally related to two birds. Floating-point and component iteration order may assign it differently across runs. If the prop should remain until both birds are gone, ordinary single-owner Voronoi semantics are insufficient.

**Invariant:** Tie-zone assignment is deterministic, and no tie-zone pixel is erased while any bird declared as its protector remains unfound.

**Cheapest amendment:** Define an epsilon-wide tie band. Within it:

- assign a deterministic primary owner by stable ID for eventual cleanup;
- attach all tied birds as protectors;
- dissolve only when the primary owner is picked and all protectors are found.

If that complexity is not justified, flag sufficiently large tie-zone components for manual review.

---

### P2 — A bird inside another restoration region is safe only under explicit ownership coverage

**Real failure:** Conditional.

The proposed subtraction protects the inner bird’s sprite body when the outer bird is picked. Pairwise bisectors protect the inner bird’s nearer paint spill. But it still fails if:

- centers coincide;
- the inner bird’s own restoration region does not cover all pixels temporarily protected for it;
- the inner sprite footprint and restoration footprint use different masks/transforms;
- the “sprite footprint” is only a box, causing excessive protected holes.

**Invariant:**

```text
protectedFor(B) ⊆ eventualDissolveCoverage(B or later owners)
```

and the bird center/core mask must survive every other bird’s dissolve while B is unfound.

**Cheapest amendment:** Use the alpha sprite mask, not the sprite box, for subtraction. Validate the protection-to-later-owner subset relation during derivation.

## Required spec corrections

The plan should state these definitions unambiguously:

1. **Hitbox:** stored center and authored tap radius. Runtime performs only circle membership plus deterministic nearest-center arbitration. “Bisector clamp” means arbitration, not mutation of the radius.
2. **Restoration source:** thresholded, quality-gated paint-diff—not sprite bounds.
3. **Restoration ownership:** a complete per-pixel partition of the accepted paint-diff footprint.
4. **Sprite mask:** protects still-unfound visible body pixels; it does not define restoration ownership.
5. **Manual region:** persistent human-authored geometry with dependency provenance and explicit stale state.

Also correct the final CL-9 paragraph in the [plan](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:269), which currently contradicts CL-5 by saying restore regions derive from sprite bounds.

## Five corpus simulator invariants

Ranked by the failures they prevent:

1. **Complete cleanup and permutation convergence**

   For every overlap cluster and tested pickup permutation, the final composite equals the clean background within perceptual tolerance. Final masks must be identical across permutations.

2. **Unfound-bird preservation**

   After every pickup prefix, every unfound bird’s protected alpha mask remains covered. Measure both missing pixels and unintended clean-background exposure around the bird.

3. **Restoration ownership conservation**

   The accepted paint-diff footprint is completely accounted for:

   ```text
   union(owner regions) == accepted diff
   intersection(distinct exclusive owner regions) == empty
   ```

   Protected/shared metadata may overlap, but eventual cleanup ownership may not be missing or ambiguous.

4. **Tap migration and visible-body coverage**

   On a dense point grid, migrated winner/miss results match the legacy runtime’s results unless an explicitly approved behavior change applies. Separately, every bird’s core visible-body mask meets the required tap-circle coverage threshold.

5. **Determinism and provenance freshness**

   Reordering birds, connected components, or neighbor clipping must produce the same ownership and dissolve masks. Every generated result must carry the current full dependency hash; stale automatic or manual geometry must be rejected before export.

No code was changed. This is a spec/runtime review; actual corpus PASS/FAIL counts would require implementing the proposed simulator and running it over the shipped level assets.