Read docs/handoffs/2026-09-16-ftb-candidate-intake.md first — it is your full brief.
Batu will not restate context. Then read, in order:
  docs/research/2026-09-16-ftb-candidate-levels-intake.md          (the original ask)
  docs/solutions/2026-09-16-ftb-sticker-tiers-refit-regen/ANSWERS-candidate-intake-2026-09-16.md
  docs/solutions/2026-09-16-ftb-sticker-tiers-refit-regen/README.md

Mission: take the 54 Find the Bird levels in
docs/handoffs/2026-09-16-ftb-candidate-intake/candidates-54.txt — painted, hitboxed, not
in the game — through re-extraction, refit, judge, regeneration, export, manifest and a
device build, and report to Batu on Portal.

Repo:     /Users/base/dev/appletolye/fabrikav2
Branch:   fix/ftb-banner-suppression-measured
Worktree: .worktrees/ftb-banner (sparse; node_modules and .levelbuilder are symlinks)
Backend:  ALREADY RUNNING at http://127.0.0.1:5196 (PID 83744). Do not restart it — it is
          single-instance, owns the job lock, and another session may be using it.

Constraints:
- Never touch the 44 shipped levels. Another session refit them on 2026-09-16.
- Do NOT bypass the final-cutout review gate. 48 of the 54 need one manual UI approval
  each. Batu has not yet given an explicit yes to the API path — ask before using it.
- uv run for all Python; most level-editor imports need LEVEL_EDITOR_GAME=find_the_bird.
- Read cost from ~/.merceka/costs.jsonl (field `usd`), never estimate. Batu approved ~$13
  for the re-extraction; ask before exceeding $10 beyond that.
- Other sessions share the main checkout and move its branch. Run `git branch --show-current`
  before every commit.

Already done: full inventory (134 ids classified); banner occlusion audit and a committed
fix adding 4 levels to levelBannerPolicy.ts; extraction validated end-to-end on
cozy_interiors_cozy_greenhouse_conservatory_bird_73c9 (8/8, $0.0138/bird, refit 6 apply /
2 regenerate, computed but not applied).

Key decision, do not re-litigate: do NOT repair the sprite/hitbox pairing in these
sessions. Re-run Extract All — it materializes one sticker per current hitbox, correct by
construction. The handoff doc explains why.

Definition of done: the 54 levels (minus anything Batu drops) extracted, refit, judged,
regenerated where refit or the judge refused them, exported, appended after the existing 44
in bundled-manifest.json without reordering, installed on the phone with `install: OK` in
the log, reported on Portal with before/after tier splits and metered spend, Findings
appended to the research brief, and committed.

First action: run Extract All on the 6 levels that already have exports and therefore need
no UI approval (listed under "Open questions" in the handoff doc), and report the wall-clock
and metered cost per level before scaling to the rest.

Then iterate until the definition of done is met. If you hit a blocker you cannot resolve —
in particular the cutout-review gate — stop and report the blocker. Do not report done
unless it is actually done.
