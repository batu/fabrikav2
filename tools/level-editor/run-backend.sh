#!/usr/bin/env bash
set -euo pipefail

set -a
source /Users/base/dev/appletolye/.env
set +a

# Main checkout: the reskin worktree merged to main on 2026-08-03 and was
# removed; portal's /tools/ftd-editor gateway launches this script.
cd /Users/base/dev/appletolye/fabrikav2/tools/level-editor
export MERCEKA_FORCE_OPENROUTER="${MERCEKA_FORCE_OPENROUTER:-1}"  # Google prepay depleted 2026-08-04; route via OpenRouter
export FTD_SAM2_URL="${FTD_SAM2_URL:-http://localhost:8977}"

# The portal serves the editor UI from ui/dist as static files. dist is a
# build artifact nothing else refreshes, so a "restart" that skips this step
# serves yesterday's UI against today's backend — that silent skew has bitten
# three times (2026-07-29 x2, 2026-08-12). Build on every start; a build
# failure must stop the launch loudly, never fall back to a stale UI.
if ! command -v npm >/dev/null 2>&1; then
  echo "FATAL: npm not on PATH; cannot build the editor UI (stale-dist guard)" >&2
  exit 1
fi
echo "Building editor UI (stale-dist guard)..."
npm --prefix ui run build

# Game selection persists across restarts so the UI switcher survives the
# exec cycle (operator, 2026-08-14). Default stays find_the_bird.
SELECTED_GAME=$(cat "$(dirname "$0")/.selected-game" 2>/dev/null || echo find_the_bird)
exec uv run python -m levelbuilder.api.server --game "$SELECTED_GAME" --port 5196
