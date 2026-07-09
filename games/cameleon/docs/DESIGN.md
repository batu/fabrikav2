# CAMELEON — Level 1 "Sunwash Lido" — Design

Conductor-authored, 2026-07-08. This document is the binding design for the fabrikav2
implementation. Inputs: FABLE_PROMPT.md (old repo, binding brief), the old repo's research
corpus and AESTH-2 adversarial review (read in full), and the fresh reference pull in
`../refs/` (see refs/INDEX.md). Workers implement this document; they do not redesign it.

## 0. The one-sentence fantasy

You scroll a sunny public pool and slowly realize the place is infested with white ragdoll
people painted to look like towels, signs, and pool junk — and every time you catch one,
the paint flakes off and a guy falls out of the scenery.

## 1. The core design problem this level solves

The v2 adversarial review (AESTH-2) found the found-moment landed but the HIDDEN state
didn't: painted sprites that preserve a full humanoid silhouette read as "that is a guy"
*before* the tap. Paint alone cannot fix a silhouette problem. This design attacks the
silhouette structurally, three ways:

1. **Pose-first silhouettes (revised 2026-07-09, Batu directive).** Every hide's
   locked silhouette IS a person — a doughboy body in one of the CANONICAL POSES
   from the original game's pose wheel (see the pose registry in LEVELS.md §8):
   standing, standing-arms-up, crouch, curl, prone, wall-flat, backbend, slanted.
   The misread comes from PAINT + CONTEXT (the body is painted in the surface's
   own pattern and placed against that surface), never from distorting the body
   into an object shape. The earlier pose-as-object doctrine over-corrected:
   object-shaped silhouettes made white-mode reveals read as blobs, not guys.
2. **Decoy population.** The scene legitimately contains printed humanoid figures —
   safety pictograms, a swim-school poster, a kiosk mascot. Spotting "a humanoid shape"
   is therefore NOT an instant win; the player must verify *which figure is a body*.
   This imports MECCHA's real tension engine (limited shots, verification cost) into
   single-player 2D: decoys are what bullets get wasted on.
3. **Partial occlusion.** Up to ~40% of a body may sit behind a foreground prop
   (lounger edge, railing, float pile) — the humanoid contour is broken by real
   geometry, not paint tricks. The hitbox still covers the visible mass.

QA test for every hide: in `?bodies=white` the sprite must read "obviously a guy in a
pose" at phone scale; in `?bodies=painted` it must first read as the object. The delta
IS the game. Both sprites share ONE alpha silhouette (silhouette-lock, non-negotiable).

## 2. Setting: the Sunwash Lido — and why it beats two named alternatives

A municipal open-air pool complex, summer midday. Wide horizontal scene, 5 zones ×
960 px = 4800×1440 world, portrait phone viewport scrolls left/right.

**Why the lido wins on medium-fit** (the law from the old repo: flat sprites disguise as
FLAT things — signs, towels, posters, patches; never volumetric):

- **The medium's weakness is this world's native language.** Our known failure mode is
  the flat sprite that reads "pasted/printed." A lido is FULL of legitimately printed
  figures: ISO-style safety pictograms (refs/pictograms/W008 — a humanoid mid-fall on a
  sign panel), swim-school posters, flags, depth markers. The sticker-read becomes
  diegetic instead of a defect.
- **Body-shaped soft goods everywhere**: towels, robes, floats, lane ropes — flat,
  drapeable, and plausible in curl/prone/wall-flat poses.
- **Safety red is already in-world** (lifebuoys, warning signs, lane ropes) — the bold
  red found-slam belongs to the palette instead of fighting it.
- **Natural occluders**: loungers, railings, parasols, the pool edge.

**Alternative A — Grand Hotel interior** (v2's level, considered and rejected): its best
hides were already flat textiles, but its identity objects (statues, furniture, luggage)
are volumetric — exactly where v2 failed (`ch-l1-01`), and re-using the hotel would make
this a copy, which the brief forbids.

**Alternative B — Night market street** (considered and rejected): high pattern variety
and banner/lantern language are attractive, but its signature objects (hanging lanterns,
produce, cookware) are volumetric and glossy; its palette variety risks mud at phone
scale (old research: mid-value chaos needs structure); and it has few native printed
HUMANOIDS, so the decoy-population mechanic — the strongest idea available — has nothing
to hang on.

## 3. The body (carried spec, binding)

White doughboy ragdoll per the v2 art bible: ~4 head-units tall, round head, no neck,
sloped shoulders, pill limbs, no fingers/toes/clothes/hair, matte white with soft gray
contact shading. Face appears ONLY in the found beat: black dot eyes + "!!" shock. Poses
from the researched wheel: standing, crouch, curl, prone, wall-flat, backbend, slanted.
Starfish is a documented anti-pattern — excluded.

## 4. Hide roster — 10 hides, 5 zones

Format per hide: pose | disguise | borrowed pattern | why missed | the ONE fair tell |
difficulty. Coordinates are authored in `level.json` by the implementer to match the
generated zone art; zone assignment and reading order are binding.

**Zone 1 — ENTRANCE & TURNSTILES (x 0–960).** Teaching zone: ticket booth, turnstiles,
rules-board, towel rail. Decoys: rules-board pictograms (legit), stacked towels.

- `li-01` — curl | **towel draped on the entrance rail** | aqua/white stripe rhythm of
  the neighboring towels | one more towel on a rail full of towels | the towel has a
  round head-bump end and a sagging pill arm | EASY (near spawn, slightly higher
  contrast — the tutorial find).
- `li-02` — slanted (dive pose) | **"NO DIVING" pictogram figure** on the yellow warning
  panel by the turnstiles | black-figure-on-yellow sign language (refs: ISO W008) | signs
  legitimately show humanoid figures, and other real signs exist in-scene | his feet
  overflow the sign's printed border | MEDIUM (teaches the decoy grammar: some figures
  are real).

**Zone 2 — CHANGING TENTS (960–1920).** Striped changing tents, hook wall with robes,
bench. Decoys: real robes/towels on hooks, tent stripes.

- `li-03` — standing wall-flat | **stripe of a red/white changing tent** | vertical
  stripe rhythm continues across his body | the eye reads the tent as one striped
  surface | stripes bulge and break alignment around the belly | MEDIUM.
- `li-04` — wall-flat (hanging) | **robe on a hook** among real robes | cream robe color
  + belt line painted across the waist | a hanging robe is body-shaped BY DESIGN —
  maximum plausibility | it has feet below the hem; robes don't | HARD.

**Zone 3 — POOL DECK (1920–2880).** The pool itself, loungers, parasols, deck wall with
swim-school poster, lane ropes. Decoys: real towels on other loungers, the poster's
legitimate figures, real lane rope.

- `li-05` — prone | **towel laid on a lounger** | sun-faded towel stripes | every lounger
  has a towel on it | the towel's corner hangs off the edge as a mitt hand | EASY-MED.
- `li-06` — prone (stretched) | **lane-rope segment** along the pool's near edge |
  red/white bead rhythm continuing the actual rope | the line continues believably | two
  "beads" (head, hip) are larger and rounder — the rhythm breaks | MEDIUM.
- `li-07` — wall-flat | **swim-school poster demonstrator** ("STROKE IN 4 STEPS" poster
  on the deck wall) | the poster's flat printed-figure style | the poster legitimately
  contains numbered demonstration figures | there are FIVE figures and his has no step
  number | HARD (the roster's thesis hide).

**Zone 4 — DIVING TOWER (2880–3840).** Tower, ladder, wet-floor signage, float pile.
Decoys: a REAL wet-floor A-frame in zone 3 (planted earlier so the shape is familiar),
real rings/noodles in the pile.

- `li-08` — crouch/slanted | **slipping-man pictogram on a wet-floor A-frame** at the
  tower base | yellow A-frame sign language | the same sign appeared in zone 3 as real
  furniture | he casts a small contact shadow; printed figures don't | MEDIUM.
- `li-09` — curl (ball) | **two stacked swim rings** in the float pile | ring colors +
  highlight banding | a pile of round things absorbs one more round thing | the "rings"
  have no holes — solid centers (his torso) | HARD.

**Zone 5 — KIOSK & LAWN (3840–4800).** Snack kiosk with menu boards, parasol tables,
lawn strip. Decoys: a SECOND, real printed mascot on the kiosk's other panel (decoy
pairing), parasols, picnic blankets.

- `li-10` — backbend/standing | **soft-serve mascot on the kiosk menu board**, arms up
  as the swirl | the kiosk's printed mascot style, duplicated from the real panel | a
  mascot is expected on a kiosk, and there IS a real one beside it | compare the pair:
  his "swirl" ends in blunt pill hands and his head tilts | MED-HARD (the finale
  spot-the-difference).

Pose coverage: curl ×2, prone ×2, wall-flat ×3, slanted/crouch ×2, backbend ×1 —
seven researched poses, no starfish. Sign-family hides (li-02, li-07, li-08, li-10):
four; soft-goods hides (li-01, li-04, li-05): three; pattern-rhythm hides (li-03,
li-06, li-09): three. No hide requires volume.

## 5. Difficulty flow & fairness valves

- Difficulty rises left→right; zone 1 teaches both grammars (soft-goods via li-01,
  sign-decoy via li-02).
- **Win at 8/10** ("find enough, not everything" — Hidden Folks fairness law). Finding
  all 10 = "SPOTLESS" bonus stamp on the win screen.
- Every tap/shot gets feedback (hit, decoy-hit, or miss) — silence is forbidden.
- Idle valve: after 60s with no find, the nearest unfound hide gets a one-shot subtle
  shimmer (2 frames). Never repeats for the same hide within 45s.
- No pixel-hunting: minimum hide bounding box ≥ 72 px in world space (≈ 9 mm on device).
- Contrast is the difficulty dial (easy hides carry one higher-contrast mismatch; hard
  hides live in low-contrast clusters but keep their tell unoccluded).

## 6. Interaction modes (3, selectable at level start; `?mode=` override)

- **tap** — relaxed default. Wrong tap: grey "SPLASH?" ripple stamp + haptic tick; three
  wrong taps within 10 s dims the HUD hint button as gentle mockery, nothing else.
- **shoot** — 14 paint-darts for 10 hides. Decoys and misses each eat a dart. Out of
  darts with <8 found = fail (retry). Ammo UI: dart row in HUD. This is the MECCHA
  tension engine: scarcity makes verification the game.
- **confirm** — drag a reticle (with a 2× magnifier lens over the reticle), release,
  then CONFIRM button fires. A confirmed miss costs 2 darts of a 16-dart budget.
  Precision-player mode; also the accessibility-friendly mode (no fat-finger misses).

## 7. Found beat (~1.4 s, interruptible after 0.9 s)

1. **Hit-stop** 80 ms + camera micro-punch centered on the hide.
2. **Red slam**: rotated red "FOUND!" stamp + radial burst anchored to the body,
   position clamped to keep ≥48 px from HUD chrome (v2's stamp/HUD collision fix,
   designed-in). 120 ms red edge-vignette pulse.
3. **Paint-peel**: 8–14 flake particles in the disguise palette fly off (250 ms) while
   the painted sprite crossfades to the white sprite under it — same silhouette.
4. **Shock**: dot eyes + "!!" pop in, micro-shake 200 ms.
5. **Ragdoll**: deterministic keyframed tumble (1–2 rotations, squash on deck-line
   landing, 500 ms). Deterministic > simulated: testable, and never blocks the HUD.
6. **Collect**: body shrinks and slides into the bottom **collection bench** — a fixed
   12-slot bench of seated mini white bodies (fixed slot size = no v2 pile crowding).

Miss beat: grey ripple + "SPLASH?" stamp (tap), dart thunk + ammo decrement (shoot),
double-cost flash (confirm). Decoy hit: the printed figure wobbles like cardboard —
"IT'S JUST A SIGN" micro-stamp — reinforcing the fiction that decoys are real objects.

## 8. Visual directions (3, switchable; shared silhouettes & layout)

AESTH-2's deepest visual lesson: flat sprite bodies fight rendered/painterly light.
So all three directions live in the FLAT PRINT family — they differ in ink, palette,
and paper, never in rendering model. Light is expressed as palette zones, not gradients.

- **A. Poster Pop** (production anchor): flat screenprint, 6 inks — aqua, deep teal,
  sun-cream, coral-red, black, paper-white. Hard shapes, sparse halftone in shadows.
  Refs: WPA poster tiles (refs/print-posters), v2 Screenprint verdict.
- **B. Riso Duotone**: two-ink risograph — aqua + fluorescent coral on warm paper,
  visible grain, 1–2 px misregistration on accents. The risk pick: strongest print
  identity, and the duotone constraint makes body-vs-scene blending trivially coherent.
- **C. Night Swim**: closing time. Indigo paper, the pool a flat glowing-turquoise
  shape, kiosk neon as flat sign colors, warm lamp tints on deck zones. Flat treatment
  throughout — mood shift via palette, zero rendered glow.

Direction switch: menu + `?dir=poster|riso|night`. Painted sprites are generated PER
DIRECTION (same alpha, different paint) so each direction's bodies borrow its own inks —
the structural fix for v2's "pasted in gouache/roughrender" failure.

## 9. Art & generation plan ($50 hard cap, fal.ai OFF, ledger in docs/gen-ledger.md)

Approaches (≥3, documented with findings + spend):

1. **Authored-vector sign lane** (new vs v1/v2): the four sign-family hides and ALL
   pictogram decoys are authored as flat vector-style sprites (code/SVG-derived, near
   zero cost, perfectly on-medium) — generation is reserved for what authoring can't do.
   Rationale: v1/v2 never exploited that sign art is *supposed* to look authored.
2. **Background-first zone panels**: pixelsmith generate, 960×1440 clean zone panels
   (no bodies), per direction, style-guided by refs; assembled into the 4800 panorama
   with seam-aware overlap prompts (seams killed v1 Cardboard — panels get 64 px overlap
   blend zones).
3. **Silhouette-locked sprite pairs** (HYBRID-2 carried): per soft-goods/pattern hide,
   generate the painted disguise sprite against transparency from a pose-spec prompt;
   derive the white sprite (and reveal face variant) from the SAME alpha by recolor —
   never an independent generation.
4. **Local repaint fusion** (fallback, Poster Pop only): for any hide judged "pasted,"
   HYBRID-2 interior+halo repaint on the composited crop.

Budget envelope: zone panels 15 (~$4–8) + hide pairs 10×≤4 attempts (~$10–16) +
mascot/poster/prop one-offs (~$3) + fix rounds reserve ≥$10. Conductor eyeballs EVERY
hide crop (painted + white + in-context phone crop) before acceptance — worker self-QA
is not acceptance (v1's root-cause lesson). pixelsmith judge runs the recurring-defect
checklist + a fairness check per hide.

No readable text in generated art; sign/poster/menu text is composited programmatically
from authored assets (kills the gibberish-text failure class).

### 9b. Amendment (2026-07-08, conductor, after generation probe 1)

The image model outputs native 1024×1024; non-square requests get stretched. Binding
geometry change: **world = 4320×1440**, composed of **three square panels** (1440×1440
world each, generated at 1024² and uniformly upscaled ×1.406): panel A = zones 1–2
(entrance + changing, x 0–1440), panel B = zone 3 (pool deck, x 1440–2880), panel C =
zones 4–5 (tower + kiosk, x 2880–4320). Zone x-ranges compress accordingly (~864 px
conceptual zones; hide roster and reading order unchanged). Panel seams are made
DIEGETIC: each panel edge carries an architectural divider (wall end, hedge, fence
post) drawn inside its own panel — seams become design instead of inpainting debt
(v1 Cardboard's killer, solved structurally). Prompts lock a shared band layout
(wall band / deck band / water-lawn band at fixed heights) so panels agree at the
divider. All prompts demand full-bleed edge-to-edge art (probe 1 produced margins).

## 10. Tech shape (fabrikav2 conventions; workers implement)

- Phaser, portrait, camera scrolls x ∈ [0, 4800−viewportW]; drag/fling scroll.
- `level.json`: hides (id, zone, pose, disguise, rect, tell-note, difficulty), decoys
  (id, rect, kind), per-direction asset keys. Sprite pairs under
  `public/levels/lido/sprites/`.
- Debug: `?bodies=painted|white|off`, `?dir=`, `?mode=` (brief-mandated).
- Kernel flow: menu → game → win/fail; `game.config.ts` declares screens/saga (single
  node), analytics events (level_start, hide_found, decoy_hit, miss, level_win with
  found-count/mode/dir, mode_selected, dir_selected).
- Testkit harness: `snapshot()` (mode, dir, scroll, per-hide state, ammo),
  verbs `scrollTo`, `tapWorld`, `revealHide(id)` (solver-bound), `winLevel` (reveal to
  8), `failLevel` (exhaust darts), `driveTo(state)`; tour states: menu, zone1…zone5,
  found-beat, win, fail — element-gated for verify-device.
- Bundle ID `com.basegamelab.cameleon.dev`. Device proof: iPhone via verify-device;
  per-hide crops land in `evidence/`.

## 11. What done means (mirrors GOAL_CAMELEON.md)

On the iPhone: scene scrolls, ≥8 hides findable in all 3 directions × all 3 modes,
found beat lands, per-hide on-device crops reviewed by conductor eyes, typecheck/unit/
audit green, verify-device green, spend ≤$50 with ledger. Anything unverified is named
as unverified.
