#!/usr/bin/env bash
set -euo pipefail

EDITOR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$EDITOR_ROOT/../.." && pwd)"
SOURCE_AUTHORING="${FTD_V1_AUTHORING_ROOT:-/Users/base/dev/appletolye/fabrika/games/find_the_dog/pipeline/levelbuilder/levels}"
DATA_ROOT="${FTD_EDITOR_DATA_ROOT:-$HOME/.ftd-editor-rehearsal}"
ENV_FILE="${FTD_EDITOR_ENV_FILE:-/Users/base/dev/appletolye/.env}"
PYTHON="$(realpath "$EDITOR_ROOT/.venv/bin/python")"
LABEL="com.appletolye.ftd-editor-rehearsal"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"

test -d "$REPO_ROOT/.git" || test -f "$REPO_ROOT/.git"
test -d "$SOURCE_AUTHORING"
test -f "$ENV_FILE"
test -x "$PYTHON"

(cd "$EDITOR_ROOT" && npm run build:live)
mkdir -p "$DATA_ROOT/logs" "$HOME/Library/LaunchAgents"

sed \
  -e "s#__PYTHON__#$PYTHON#g" \
  -e "s#__EDITOR_ROOT__#$EDITOR_ROOT#g" \
  -e "s#__SOURCE_AUTHORING__#$SOURCE_AUTHORING#g" \
  -e "s#__DATA_ROOT__#$DATA_ROOT#g" \
  -e "s#__ENV_FILE__#$ENV_FILE#g" \
  "$EDITOR_ROOT/deploy/com.appletolye.ftd-editor-rehearsal.plist" > "$PLIST_DEST"

UID_NUM="$(id -u)"
if launchctl print "gui/$UID_NUM" >/dev/null 2>&1; then
  DOMAIN="gui/$UID_NUM"
else
  DOMAIN="user/$UID_NUM"
fi
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST_DEST"
launchctl kickstart -k "$DOMAIN/$LABEL"
