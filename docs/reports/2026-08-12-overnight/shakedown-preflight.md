# uk_cotswolds_village_bird_3a43 shakedown preflight (item 8)

- Source: public package `uk_cotswolds_village_bird_3a43` (authoring session was
  deleted for cause 2026-08-12; known defect CONFIRMED at preflight: 25 birds,
  only 20 unique sprite files — 5 birds share sprites).
- Source package hash (name+bytes sha256 over 85 files): `6d92f60020d3efae…`
- Isolated rig: scratchpad/shakedown/{workspace,game-root} — the production
  workspace, public/levels, R2, and device are untouched.
- Plan: import_authoring_from_public into the isolated workspace → canonical
  CLI regeneration of the defective birds through tonight's foundations
  (strict loaders, CAS, geometry service) → STAGE result in the rig only.
- Caps: USD $2 (merceka ledger read before/after), wall-clock 30 min,
  attempts = 1, no retry on failure.
- Expected counts: 25 birds, 25 unique sprites post-regen.
- Recipe: canonical-magenta-v1 (hash recorded at run time via
  python -m levelbuilder.recipe).
- Prohibited: republish, lineup mutation, catalog write, device install.
- Gate: runs only after CR-1 P0s are fixed and CR-2 audits this record.
