# Cameleon - design brief

Game id: `cameleon`

Full binding design: [DESIGN.md](DESIGN.md). Product brief source:
`/Users/base/dev/appletolye/cameleon/FABLE_PROMPT.md` (read-only reference repo).

## What it is
A portrait hidden-object game: you scroll one wide sunny lido (public pool) scene
left/right and hunt white doughboy ragdoll people painted to look like towels, signs,
robes, and pool junk — visible but misread, never invisible. Tap (or spend limited
paint-darts on) a suspect; on a hit the paint flakes off, the white body is exposed in
the same silhouette, panics, ragdolls off its perch, and joins the collection bench.
One level, 10 hides, win at 8. A session is one 3–8 minute sweep, replayable across 3
visual directions and 3 interaction modes.

## Feel
Sunny, sneaky, deadpan-funny, print-crafted, punchy-on-find. Motion references: the
found beat in DESIGN.md §7 (hit-stop → red slam → paint-peel → shock → ragdoll);
MECCHA CHAMELEON camo-peel reveals in `refs/meccha/`.

## Constraints
- iPhone-first (WKWebView, portrait); device verification via verify-device only.
- Bundle ID `com.basegamelab.cameleon.dev`.
- Silhouette-lock: painted and white sprites of a hide share ONE alpha (DESIGN.md §1).
- All hides pass the medium-fit law (flat disguises only) and the fairness format
  (one fair tell each). Win-at-8, feedback on every tap, no pixel hunts (≥72 px).
- Image generation: $50 hard cap, fal.ai OFF, every call in docs/gen-ledger.md.
- No monetization in this milestone; analytics events per DESIGN.md §10.
