#!/bin/bash
# Wayfinder map driver: cranks AFK tickets of map #14 with codex gpt-5.6-sol
# (xhigh reasoning), one fresh session per ticket, <=2 parallel lanes.
# Pings Batu via telegram-send when only human-blocked work remains.
# Usage: nohup bash tools/wayfinder-driver/drive.sh > ~/.wayfinder-driver.log 2>&1 &
set -u
REPO=/Users/base/dev/appletolye/fabrikav2
MAP=14
MODEL=gpt-5.6-sol
EFFORT=xhigh
MAX_LANES=2
POLL_S=180
NAG_COOLDOWN_S=7200
cd "$REPO"
last_nag=0

frontier() {
  # Open, unassigned children of the map with no open blockers.
  gh api "repos/batu/fabrikav2/issues/$MAP/sub_issues" --paginate \
    --jq '.[] | select(.state=="open") | select((.assignees|length)==0) | select((.issue_dependencies_summary.blocked_by // 0)==0) | .number' 2>/dev/null
}

open_children() {
  gh api "repos/batu/fabrikav2/issues/$MAP/sub_issues" --paginate \
    --jq '.[] | select(.state=="open") | .number' 2>/dev/null
}

lanes() { pgrep -fl "codex exec .*wayfinder-ticket" | wc -l | tr -d ' '; }

launch() {
  local n="$1"; local mode="${2:-fresh}"
  local wt="$REPO/.worktrees/cutout-lab-$n"
  agency workspace create --repo "$REPO" --path "$wt" \
    --branch "feat/cutout-lab-$n" --base origin/main --profile bird \
    || { echo "$(date '+%H:%M') scoped worktree create/reuse FAILED for #$n"; return 1; }
  echo "$(date '+%H:%M') launching ticket #$n ($MODEL/$EFFORT)"
  ( cd "$wt" && codex exec \
      --dangerously-bypass-approvals-and-sandbox \
      -m "$MODEL" -c model_reasoning_effort="$EFFORT" \
      "wayfinder-ticket $n: You are starting cold; no human will restate context. You are working EXACTLY ONE wayfinder ticket: https://github.com/batu/fabrikav2/issues/$n

Read first, in order: (1) docs/handoffs/2026-08-03-clean-bird-cutouts.md in this directory — the full brief; (2) /Users/base/.claude/skills/wayfinder/SKILL.md — follow 'Work through the map' exactly; (3) the 'Wayfinding operations' section of /Users/base/.claude/skills/setup-matt-pocock-skills/issue-tracker-github.md; (4) the map, ALL its comments, and your ticket: https://github.com/batu/fabrikav2/issues/14

$( [ "$mode" = followup ] && echo "FOLLOWUP MODE: this ticket is already claimed and parked on a Portal request; the human verdict has now arrived in ~/.gallery/verdicts.log — read it (and the Portal request) and resolve the ticket from that verdict." || echo "Claim the ticket FIRST: gh issue edit $n --add-assignee @me. If it is already assigned, stop immediately." )

Hard rules: source assets are READ-ONLY at /Users/base/dev/appletolye/fabrikav2/games/find_the_bird/.levelbuilder/levels/ (not in git; join dogs to hitboxes by id). Your outputs stay in this worktree. OPENAI_API_KEY is in /Users/base/dev/appletolye/.env; OpenRouter has ~\$50 credit for judging/experiments; winning method must be ~free per sprite; GPU via ssh ubuntu-server (SAM2 :8977, open your own tunnel: ssh -f -N -L 8977:localhost:8977 ubuntu-server). Feedback via portal (stream find-the-bird-reskin-0728) + telegram-send; Batu's Portal verdict is the only acceptance authority.

Resolve ONLY this ticket per the wayfinder protocol: resolution comment, close, one-line gist appended to the map's Decisions-so-far, graduate newly-specifiable fog into new child tickets of the map (create then wire blocking). For HITL tickets: build the artifact, post the Portal request, telegram-send Batu the link, comment 'awaiting Portal verdict: <url>' on the ticket, and STOP WITHOUT CLOSING — a later session resolves it from the verdict. If a verdict for this ticket already exists in ~/.gallery/verdicts.log, resolve from it. If blocked, comment the blocker and stop. Never report done unless it is actually done." \
      > "$REPO/tools/wayfinder-driver/ticket-$n.log" 2>&1
    echo "$(date '+%H:%M') ticket #$n session ended (exit $?)" ) &
}

prune_closed() {
  # Completion produces review only; exact removal and branch deletion need approval.
  gh api "repos/batu/fabrikav2/issues/$MAP/sub_issues" --paginate     --jq '.[] | select(.state=="closed") | .number' 2>/dev/null | while read -r n; do
    wt="$REPO/.worktrees/cutout-lab-$n"
    [ -d "$wt" ] || continue
    pgrep -f "wayfinder-ticket $n:" >/dev/null && continue
    agency workspace cleanup-review --repo "$REPO" --path "$wt" --check-pr
  done
}

echo "$(date '+%H:%M') driver up (map #$MAP, $MODEL/$EFFORT, lanes<=$MAX_LANES)"
while true; do
  prune_closed
  open=$(open_children | wc -l | tr -d ' ')
  if [ "$open" -eq 0 ]; then
    telegram-send -m "Wayfinder map #14 has NO open tickets — the way is clear. Driver exiting. Review the map: https://github.com/batu/fabrikav2/issues/14" || true
    echo "$(date '+%H:%M') map complete; exiting"; exit 0
  fi
  # Verdict followups: assigned tickets parked on a Portal request whose verdict arrived.
  for n in $(open_children); do
    [ "$(lanes)" -ge "$MAX_LANES" ] && break
    body=$(gh issue view "$n" --comments --json comments --jq '.comments[].body' 2>/dev/null)
    echo "$body" | grep -q "awaiting Portal verdict" || continue
    req=$(echo "$body" | grep -oE "req_[a-z0-9]+" | tail -1)
    [ -n "$req" ] && grep -q "$req" ~/.gallery/verdicts.log 2>/dev/null || continue
    pgrep -f "wayfinder-ticket $n:" >/dev/null && continue
    launch "$n" followup; sleep 10
  done
  for n in $(frontier); do
    [ "$(lanes)" -ge "$MAX_LANES" ] && break
    pgrep -f "wayfinder-ticket $n:" >/dev/null && continue
    launch "$n"; sleep 10
  done
  if [ "$(lanes)" -eq 0 ] && [ -z "$(frontier)" ]; then
    now=$(date +%s)
    if [ $((now - last_nag)) -gt "$NAG_COOLDOWN_S" ]; then
      pending=$(open_children | tr '\n' ' ')
      telegram-send -m "Wayfinder driver: all remaining tickets need YOU (Portal verdicts or blocked). Open: $pending — check Portal (find-the-bird-reskin-0728) and https://github.com/batu/fabrikav2/issues/14" || true
      last_nag=$now
    fi
  fi
  sleep "$POLL_S"
done
