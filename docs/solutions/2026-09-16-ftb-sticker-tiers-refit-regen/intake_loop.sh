#!/bin/zsh
# Rolling judge/refit/regenerate over the intake ids: waits for each level's extraction, skips levels with a summary.
set -a; source /Users/base/dev/appletolye/.env; set +a
SP=/private/tmp/claude-501/-Users-base-dev-appletolye/2f9393c2-39fc-407d-a147-16a09b23e1f6/scratchpad/intake
cd /Users/base/dev/appletolye/fabrikav2/docs/solutions/2026-09-16-ftb-sticker-tiers-refit-regen
for id in $(cat $SP/ids60.txt); do
  [ -f $SP/$id/summary.json ] && continue
  while [ ! -f /Users/base/dev/appletolye/fabrikav2/games/find_the_bird/.levelbuilder/levels/$id/intake_2026-09-16/extract_result.json ]; do sleep 30; done
  echo "=== $id $(date -u +%T)"
  uv run --project /Users/base/dev/appletolye/fabrikav2/tools/level-editor python intake_run.py $id 2>&1 | tail -6
done
echo LOOP DONE $(date -u +%T)
