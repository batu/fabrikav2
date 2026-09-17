#!/bin/zsh
# Rolling judge/refit/regenerate: each pass picks any level whose extraction landed and has no summary yet.
set -a; source /Users/base/dev/appletolye/.env; set +a; export TIER_PRIMARY=openrouter
SP=/private/tmp/claude-501/-Users-base-dev-appletolye/2f9393c2-39fc-407d-a147-16a09b23e1f6/scratchpad/intake
LV=/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/.levelbuilder/levels
cd /Users/base/dev/appletolye/fabrikav2/docs/solutions/2026-09-16-ftb-sticker-tiers-refit-regen
while true; do
  ran=0
  for id in $(cat $SP/ids60.txt); do
    [ -f $SP/$id/summary.json ] && continue
    [ -f $LV/$id/intake_2026-09-16/extract_result.json ] || continue
    mkdir -p $SP/$id; mkdir $SP/$id/.claim 2>/dev/null || continue   # one worker per level
    echo "=== $id $(date -u +%T)"
    uv run --project /Users/base/dev/appletolye/fabrikav2/tools/level-editor python intake_run.py $id 2>&1 | tail -6
    ran=1
  done
  left=$(for id in $(cat $SP/ids60.txt); do [ -f $SP/$id/summary.json ] || echo $id; done | wc -l)
  # a claim without a summary and no worker = a killed run; release it
  for id in $(cat $SP/ids60.txt); do [ -d $SP/$id/.claim ] && [ ! -f $SP/$id/summary.json ] && ! pgrep -f "intake_run.py $id" >/dev/null && rmdir $SP/$id/.claim 2>/dev/null; done
  [ "$left" -eq 0 ] && { echo "LOOP DONE $(date -u +%T)"; break; }
  [ $ran -eq 0 ] && sleep 60
done
