# GOAL: Design & build CAMELEON on fabrika v2 — the design-skills test

You are Claude Fable, CONDUCTOR and — this run only — DESIGNER. Batu is testing your design skills:
the design decisions are YOURS (scene, hide roster, art directions, found-beat, difficulty curve).
Workers build; they never design. Full autonomy granted: decide, document, ship; post taste artifacts
to Gallery as a record, not as blocking questions. Ledger: games/cameleon/.work/run-ledger.md.

## The game (brief: /Users/base/dev/appletolye/cameleon/FABLE_PROMPT.md — binding)
Mobile portrait 2D hidden-object. One WIDE horizontal scene, scroll left/right. Hidden = white doughboy
humanoids PAINTED as scenery (never lizards, never invisible — visible-but-misread). 8–12 hides, each a
sprite-pair (painted disguise + white body, ONE locked alpha silhouette) over a clean background. 3
switchable visual directions (shared silhouettes; palette/texture/light differ). 3 interaction modes:
tap / shoot-limited-bullets / confirm-shoot. Found beat: red slam → paint-peel → white body in same
silhouette → ragdoll collapse → collection lane. Debug: ?bodies=painted|white|off, ?dir=, ?mode=.

## Phase 0 — RESEARCH BEFORE LOCKING (new refs + old refs)
Old (READ-ONLY): /Users/base/dev/appletolye/cameleon — research/ (premise, postures, level-art,
image-gen), experiments/ (A/B/C/JUDGE/V2 + spend), REPORT.md (v1 lizard failure; medium-fit law: flat
sprites disguise as FLAT things — signs/towels/runners/posters, never volumetric; silhouette-lock;
per-hide fairness rationale; HYBRID-2 gen recipe). Carry the lessons; do NOT copy the hotel.
New: pull fresh visual references — MECCHA CHAMELEON feel, Hidden Folks/print-style seek-scenes, safety
pictograms, flat-print poster/riso art for candidate settings. Save to games/cameleon/refs/ with
provenance. THEN write docs/DESIGN.md: setting choice + why it beats 2 named alternatives on medium-fit;
full hide roster (per hide: disguise, pose, borrowed pattern, why-missed, the ONE fair tell); 3
directions; found-beat choreography; difficulty order. Design doc is conductor-authored, ~2 hours max.

## Iron laws (AGENTS.md — binding)
Device-first: verify on the iPhone via verify-device; a web/simulator render is NEVER evidence. Autonomy
in agents, not tools. Per-hide VISUAL inspection by conductor (crops, eyes) — worker self-QA killed v1.
First live run is part of the build. Never filter landing output; verify SHA in main before device runs.
Spawn workers as own background tasks. Commit-per-unit.

## Build (fabrikav2, this repo)
create-game cameleon; Phaser; kernel flow + game.config.ts; testkit harness (snapshot/verbs/capture,
solver-bound revealHide/winLevel, tour states for verify-device); design/ tokens + asset-identity.json
from day one. Bundle ID com.basegamelab.cameleon.dev. Workers: codex gpt-5.5 ONLY (capacity → wait,
never reroute); `command codex exec ... </dev/null`; direct-to-work cards.

## Art budget: $50 HARD CAP, fal.ai OFF
pixelsmith generate (OpenRouter) + judge. Try/document 3+ generation approaches. Log every spend in
docs/gen-ledger.md (running total). Envelope: ≤$12 backgrounds (3 directions), ≤$25 hide pairs,
≥$10 reserve for fix rounds. Judge every hide against the recurring-defect checklist + fairness.

## Done means
Playable on the iPhone: wide scene scrolls, 8+ hides findable in all 3 directions and all 3 modes,
found-beat lands (captured on-device, per-hide crops in evidence/), typecheck+unit+audit green,
verify-device green. Report with design rationale + spend + on-device captures. Unverified = say so.
