#!/bin/zsh
# usage: mm-judge.sh CAPTURE.png "spec text" OUT.json — pixelsmith vision judge (needs the workspace-root .env keys)
set -a; source /Users/base/dev/appletolye/.env; set +a
cd /Users/base/dev/appletolye/pixelsmith && uv run pixelsmith judge --capture "$1" --spec "$2" --out "$3" >/dev/null 2>&1
python3 - "$3" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); print("verdict:", d.get("verdict"))
for x in d.get("defects",[])[:8]: print("-", x.get("severity"), "|", (x.get("region") or "")[:40], "|", (x.get("defect") or "")[:170])
PY
