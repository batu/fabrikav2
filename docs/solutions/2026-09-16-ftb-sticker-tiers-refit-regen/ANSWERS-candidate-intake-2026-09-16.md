# Answers: sticker-tier / refit / regen loop on unexported candidate sessions

From the session that ran the shipped-44 loop (2026-09-16, late evening). Facts checked in the repo
where stated; opinions marked as such.

## Q1. Authoritative geometry
The RUNTIME uses `dog.x/dog.y + anchorX/anchorY` (GameScene spawns the pickup image at the dog point
with origin = anchor; `sprite.x/sprite.y` are never read by the game). `sprite.x/y` record where the
sticker was cut. In the shipped exports both agree because export re-derives them together.
In an unexported session `level.json`, a sprite record that sits 300-590 px from its own hitbox is a
STALE record: the hitboxes were re-minted/reordered after the stickers were materialized (the
"rev-17 renumbering" trap in memory `ftb-residue-scan-lane`). Judging cutout quality from
`sprite.x/y` is sound (it is where the sticker was cut). Shipping needs the pairing fixed, see Q2.

## Q2. Cross-pairing and export
Export does NOT re-pair. It runs a containment check (session.py ~4115-4140: hitbox must lie inside
the sprite box and within `radius * max_offset_fraction` of its centre) and reports/blocks misfits;
`repair-sprites` is the CLI face of that check. Nothing re-assigns stickers to hitboxes by proximity.
Opinion: do not repair the pairing at all. Every one of these sessions predates tonight's keying and
crop fixes, and the judge on the shipped 44 sent 25-35% of stickers to regeneration anyway. Re-run
Extract All (`bulk_extract`, `force`) on the session with
`FTD_FLATKEY_MODEL=openai/gpt-image-2.5-sunburst` and quality low: it materializes one sticker per
CURRENT hitbox (pairing correct by construction), through `flatkey.finalize_cutout` and the
painted-extent crop growth, ~$0.0082/bird -> ~$8 for 950 birds, about the price of a judge pass plus
the regenerations it would trigger. Then judge + refit as a check, not as the driver.

## Q3. Order for a never-exported session
(a), with one correction: the fresh restoration is not a separate step, export writes it
(`_write_birdless_restore_bg` is called inside export after `_require_local_alignment`,
session.py ~5957). So: hitboxes final -> Extract All (sunburst) -> `verify-cutouts` -> human
cutout review in the UI -> `export` (writes level.json, color/bg webp, restoration) -> then the
judge/refit loop can run on the export exactly as it did on the 44. Caveat you should know: the
shipped-44 work tonight edited `public/levels/` directly; those sessions are now BEHIND their
exports. For new levels do the sticker work in-session, before bless, so session and export agree.

## Q4. Final-cutout review at scale
Manual, one UI approval per level, server-enforced (`cmd_bless_cutouts` 403 for anything but the
editor UI; memory `ftb-cutout-hillclimb-2026-09-08`: do NOT bypass; the delegated actor exists for
hitboxes only). No batch path exists and I did not build one. The click itself is one button after
looking at the flagged/amber birds; I have no timing for Batu per level. Report it as 48 approvals
and let him price it.

## Q5. Restoration trigger
Inside export (see Q3). The function is plain: `_write_birdless_restore_bg(sdir, dst, raw, level_data)`;
I called it standalone this morning to re-export the 44 restorations (recipe in memory
`ftb-stale-restorations-root-cause`, 89 s for 44 levels). Fine to call per session; diff against the
old bg_00 as you planned.

## Q6. common.py
No session-id variant exists. Parameterize ROOT/SCRATCH and add id addressing; keep the rest.

## Q7. Missing scripts
Now in `docs/solutions/2026-09-16-ftb-sticker-tiers-refit-regen/`: `tier_openrouter.py`,
`manifest.py`, `regen44.py`, `apply_regen44.py` (committed tonight). `manifest.py` rebuilds
`bundled-manifest.json` with every level `bundled: true` and bumps `manifestRevision`; the vite
native-bundle validator refuses to build if any level.json changed without it.

## Q8. Judge
Confirmed: `google/gemini-3.8-flash` via OpenRouter, reasoning off, 4-tier prompt, two-class use
(keep = 1/2, regenerate = 3/4). Metered tonight: $2.67 for 894 calls = $0.003/bird, not $0.002.
This path never emits T1 or T4 (everything is 2 or 3), fine for the action, useless for a 4-tier
report. agy (Antigravity) is out of quota and was 3-min timeouts by 18:20; do not use it.
ALSO: a bird the refit refuses (pop > 45 or hitbox outside the fit) must join the regenerate class
regardless of the judge; the judge called three wrong-bird stickers on level 8 "T2" and refit was
the only signal that caught them (found 2026-09-16 21:00).

## Q9. What bit me
- Editor `despill` greyed every green/magenta-ish pixel (fixed, `flatkey.py` on the branch); do not
  trust any sticker made before commit 256a059f2.
- The bare 182 px crop cuts big birds; 34/41 regenerated birds on levels 1-8 touched the edge.
  Fixed for Extract All via painted extent (`inpaint.py` on the branch), the scratch regen scripts
  do it with `cropcheck.py`.
- gpt-image-2.5 edits: minimum size ~1024x768 px (192 px requests are rejected); every sticker
  call bills as 1024², $0.0082 at low. flare == sunburst on price; sunburst wins on pop.
- Portal: one post over ~6 MB times out on upload; split or shrink. Direct page URL is
  https://portal.basegamelab.com/media/<post id>/01_report.html, give Batu that.
- Never run refit/apply (they rewrite level.json) while `install.mjs`/vite is building; and rebuild
  the manifest before every build or the validator fails with "asset changed after approval".
- The disk hit 0 bytes tonight from another session's xcresult/DerivedData; a refit process died
  mid-write. Check `df` before long batches; level.json writes are not atomic in the scratch scripts.
- Keys: `OPENAI_API_KEY`, `OPENROUTER_API_KEY` live in `~/dev/appletolye/.env`, not in fabrikav2.
- `git checkout <other branch>` happened under me once tonight (another session in the same
  checkout); verify `git branch --show-current` before every commit.
