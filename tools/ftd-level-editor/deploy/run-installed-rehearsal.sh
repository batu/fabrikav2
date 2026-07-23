#!/usr/bin/env bash
set -euo pipefail

exec "__PYTHON__" "__EDITOR_ROOT__/scripts/run_rehearsal.py" \
  --source-authoring "__SOURCE_AUTHORING__" \
  --root "__DATA_ROOT__" \
  --env-file "__ENV_FILE__" \
  --port 5192
