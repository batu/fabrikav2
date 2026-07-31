#!/usr/bin/env bash
set -euo pipefail

set -a
source /Users/base/dev/appletolye/.env
set +a

cd /Users/base/dev/appletolye/fabrikav2/.worktrees/feat-find-the-bird-reskin/tools/level-editor
exec uv run python -m levelbuilder.api.server --game find_the_bird --port 5196
