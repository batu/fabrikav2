# Bird difficulty pilot: provider blocked

The existing frozen-input difficulty scorer now accepts an explicit `game: find_the_bird` manifest. Omitted game remains Find the Dog, with unchanged Dog fingerprints and caches. Bird uses a Bird-only detector prompt; `dogs`, `dogId`, and the report field names remain legacy shared export/schema names, not a claim that these targets are dogs.

## Inputs and intended experiment

- `square_hawaii_waterfall_flash_4k`: an older exported waterfall scene, 15 birds; initially mistaken for the current 19-bird tutorial. The actual bundled tutorial is `hawaii_rainforest_waterfall_bird_0f98`, reviewed separately below.
- `turkey_cappadocia_balloon_dawn_bird_b03c`: outdoor scene from the current public/native bundled manifest.
- `cozy_interiors_cozy_toymaker_workshop_bird_4e44`: indoor scene from that same bundle.
- Five independent detections per scene, maximum image edge 2048, exact `google/gemini-3.8-flash`, $2 hard budget, no provider/model fallback or automatic retry.
- `pilot-manifest.json` freezes level JSON, artwork, sprite sets, catalog, and bundled manifest hashes. `pilot-plan.json` freezes prompt, schema, thumbnail hashes, and call fingerprints. The waterfall tutorial asset exists separately from the five-level public bundled manifest.

## Result

The model catalog preflight succeeded. The first completion request returned **HTTP 400**. The scorer stopped immediately, with one pending call and no completed detections. It did not retry or call another model. Existing scorer behavior does not retain non-200 response bodies, so the provider's detailed rejection reason is unavailable.

There are **no per-bird results or approved hard-bird candidates** from this pilot. No level sequence, published asset, or runtime score was changed.

**Actual cost is unconfirmed**, not $0: the failed request supplied no recorded usage/cost to this run. There are zero completed metered calls. The $1.634304 preflight value is a conservative full-context reservation, not actual spend. The pending call blocks automatic resumption until reconciliation.

Private working output: `/private/tmp/ftb-earned-praise-pilot/results/`. Sanitized preflight and state are retained beside this note as `pilot-preflight.json` and `pilot-state.json`.

## Validation and interpretation

Focused scorer tests: **40 passed**, including explicit Bird prompt/request selection, legacy Dog compatibility, cache reuse, frozen asset enforcement, unsupported game rejection, cost guards, and existing output safety checks.

If completed later, per-bird miss score is `100 × (1 − foundIn / trials)`. This is a detector proxy requiring visual review, not a calibrated human difficulty label. Whole-scene thumbnails differ from the zoomed/panned device view; approximate sprite rectangles can cause matching errors. No unreviewed candidates should drive praise from this blocked pilot.

## Completed subjective visual review

The existing Dog visual-rating methodology was reused after the blocked Gemini attempt: 1–5 per target, half steps, full scene plus every target's context crop. This is an agent visual judgment with known locations, not blind detection or measured human difficulty. No additional provider calls ran.

Reviewed **68 targets across four scenes**: the original exported square waterfall (15), Cappadocia (16), workshop (18), and the actual bundled rainforest waterfall (19). For bundled scenes, the final review uses their **served 2560px WebP**, not the exported 2688px PNG. Context crops map level coordinates to the resized artwork. Both source JSON and served artwork hashes were verified against the current bundle before producing the compact ledger.

`pilot-ratings.json` is the compact integration ledger with `levelId`, `levelJsonHash`, `colorImageHash`, and an ID-to-rating mapping. `pilot-visual-ratings.json` retains every individual rationale. The failed Gemini manifest remains frozen and is not silently replaced with the visual-review inputs.

**No target reached 4/5.** The actual waterfall's `dog_04` and `dog_11` are the most concealed at 3.5: most of their bodies are behind rock/leaves, but native-source context crops show conspicuous red faces and clear eyes. Color and recognition cues prevent a severe rating. Physical-device zoom confirmation remains pending; do not describe this as player calibration. No top-percentage quota was used to manufacture hard candidates.

Visual evidence files `pilot-overview-N.jpg` and `pilot-sheet-N-START.jpg` map N=0 square waterfall, 1 Cappadocia, 2 workshop, 3 actual rainforest waterfall. The per-target labels use the game's legacy `dog_XX` IDs.

## Runtime threshold decision after review

The parent review inspected both partially occluded birds and the actual iPhone scene. The initial runtime threshold is **3.5/5**, capped at the highest-rated 20% of a scene (rounded down). This selects only rainforest waterfall `dog_04` and `dog_11`; the other reviewed scenes have no eligible hard finds. The earlier 4/5 diagnostic in `pilot-visual-ratings.json` remains an historical pilot threshold, not the runtime policy. Ratings themselves were not inflated or changed to meet a quota.

Physical iPhone evidence confirms the served waterfall hashes match the ledger and that its hard-find and combo feedback work. This still does not constitute measured player calibration. All unreviewed or hash-mismatched artwork fails closed for hard-find praise; combos work independently across levels.
