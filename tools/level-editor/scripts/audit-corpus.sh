#!/usr/bin/env bash
# Reachability gate for a whole corpus: every bundled level must be completable.
# Needs the game dev server running (GAME_URL, default localhost:5177).
#
#   scripts/audit-corpus.sh [game]
#
# Exits non-zero if any level has an unreachable bird. This is the check the
# unit suite cannot make — it drives the real game through its own harness.
set -u
GAME="${1:-find_the_bird}"
GAME_URL="${GAME_URL:-http://localhost:5177}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MANIFEST="$ROOT/games/$GAME/public/levels/bundled-manifest.json"
[ -f "$MANIFEST" ] || { echo "no bundled manifest for $GAME"; exit 1; }

fail=0
while IFS= read -r id; do
  if GAME_URL="$GAME_URL" LEVEL_ID="$id" node "$(dirname "$0")/tap-audit.mjs" >/dev/null 2>&1; then
    echo "PASS  $id"
  else
    echo "FAIL  $id"
    fail=1
  fi
done < <(python3 -c "import json,sys;print('\n'.join(l['id'] for l in json.load(open('$MANIFEST'))['levels']))")
exit $fail
