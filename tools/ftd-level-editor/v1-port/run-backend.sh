#!/usr/bin/env bash
set -euo pipefail

set -a
source /Users/base/dev/appletolye/.env
set +a

export PYTHONPATH="/Users/base/dev/appletolye/merceka_core:/Users/base/dev/appletolye/fabrika/games/find_the_dog/pipeline${PYTHONPATH:+:$PYTHONPATH}"
export FTD_GALLERY_PREWARM=0

exec uv run --no-project \
  --with fastapi \
  --with uvicorn \
  --with sse_starlette \
  --with pydantic \
  --with pillow \
  --with httpx \
  --with numpy \
  --with python-multipart \
  --with python-dotenv \
  uvicorn levelbuilder.api.server:app \
  --host 127.0.0.1 \
  --port 5195
