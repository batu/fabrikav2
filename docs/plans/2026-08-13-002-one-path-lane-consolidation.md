# One-Path Lane: detections are truth (2026-08-13)

Operator mandate (dictated during the walled-garden stress review): "I am more
interested in reducing the number of different paths. We keep using different
things and things are exploding because of that." Doctrine: there should be
one — and preferably only one — obvious way to do it.

Decisions already made (do not relitigate):
- **VLM detection (gemini-3.6-flash) is the spine**, not a repair tool. After
  paint, hitboxes derive FROM detections. (Operator said this in the original
  obligation table: "Gemini snap"; the cheap local-diff localizer was built
  instead and failed on 7 of 7 live levels.)
- **No count gate.** However many birds the model painted and the VLM sees,
  that IS the level. No repaint loop, no tolerance knob.
- **No mutation scrub yet** — proposed, not trusted, parked.
- Placement dots remain only as a composition hint to the paint model.

## Tranches

**T1 — One localizer.** Post-paint obligation stage becomes: detect_birds_vlm
→ assignment-match detections to existing bird ids (ids persist where matched;
unmatched detections become new birds; unmatched dots are pruned) → one
id-carrying replace_set through the geometry service → stamp
`hitboxLocalization method=vlm-snap`. `fix-hitboxes` and local-diff recenter
leave the author lane and the obligation stage (verbs remain, deprecated).

**T2 — One paint executor.** `run_magenta_inpaint_durably` (SSE) delegates
execution to `_run_magenta_inpaint_job` — the job handler is THE executor;
SSE differs only in transport. No third copy can exist.

**T3 — One sprite namespace.** The cutter writes `dogs/<compatibilitySlot>/`
for canonical sessions (index folders only for legacy). Projection and cutter
then agree by construction; the staged-bytes workaround for the index/slot
clobber is deleted.

**T4 — Canonical readers.** sprite-gaps and review readiness read the
canonical snapshot for canonical sessions; legacy walk only for legacy.

## Gate

One live level end-to-end on the consolidated lane. Merge evidence is the
hitbox overlay image: birds under circles, judged by eyes, stored in
docs/reports/. Steps do not succeed; the level does.
