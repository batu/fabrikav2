#!/usr/bin/env bash
#
# Pre-commit hook: if the staged diff touches any file matching
# src/game/render.* or src/game/hud.*, require that a fresh
# todos/refdiff/diff-*.png exists with an mtime newer than all
# staged render/hud files. Otherwise block the commit with a
# pointer to `tools/ref-compare.sh`.
#
# Install with:
#   ln -s ../../tools/pre-commit-refdiff.sh .git/hooks/pre-commit
#
# OR wire it into a husky / lefthook setup if one lands.

set -euo pipefail

STAGED=$(git diff --cached --name-only --diff-filter=ACMR)

VISUAL_CHANGED=0
LATEST_VISUAL_MTIME=0
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  case "$f" in
    games/arrow/src/game/render.*|games/arrow/src/game/hud.*|games/arrow/src/game/title-card.*|games/arrow/src/game/tutorial.*|games/arrow/src/game/fx/*)
      VISUAL_CHANGED=1
      if [[ -f "$f" ]]; then
        mtime=$(stat -c %Y "$f")
        if (( mtime > LATEST_VISUAL_MTIME )); then
          LATEST_VISUAL_MTIME=$mtime
        fi
      fi
      ;;
  esac
done <<< "$STAGED"

if (( VISUAL_CHANGED == 0 )); then
  exit 0
fi

REFDIFF_DIR="games/arrow/todos/refdiff"
if [[ ! -d "$REFDIFF_DIR" ]]; then
  echo "[pre-commit] render/hud change detected but $REFDIFF_DIR does not exist."
  echo "[pre-commit] Run tools/ref-compare.sh first, then retry the commit."
  exit 1
fi

LATEST_DIFF=$(ls -t "$REFDIFF_DIR"/diff-*.png 2>/dev/null | head -1 || true)
if [[ -z "$LATEST_DIFF" ]]; then
  echo "[pre-commit] render/hud change detected but no diff-*.png in $REFDIFF_DIR."
  echo "[pre-commit] Run tools/ref-compare.sh first, then retry the commit."
  exit 1
fi

DIFF_MTIME=$(stat -c %Y "$LATEST_DIFF")
if (( DIFF_MTIME < LATEST_VISUAL_MTIME )); then
  echo "[pre-commit] render/hud change is NEWER than the latest refdiff."
  echo "[pre-commit]   latest render/hud mtime: $(date -d @$LATEST_VISUAL_MTIME)"
  echo "[pre-commit]   latest refdiff mtime:    $(date -d @$DIFF_MTIME)"
  echo "[pre-commit] Re-run tools/ref-compare.sh then retry the commit."
  exit 1
fi

echo "[pre-commit] refdiff gate passed ($LATEST_DIFF)."
exit 0
