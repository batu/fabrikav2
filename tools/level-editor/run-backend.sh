#!/usr/bin/env bash
set -euo pipefail

set -a
source /Users/base/dev/appletolye/.env
set +a

# Main checkout: the reskin worktree merged to main on 2026-08-03 and was
# removed; portal's /tools/ftd-editor gateway launches this script.
cd /Users/base/dev/appletolye/fabrikav2/tools/level-editor
export FTD_SAM2_URL="${FTD_SAM2_URL:-http://localhost:8977}"
exec uv run python -m levelbuilder.api.server --game find_the_bird --port 5196
