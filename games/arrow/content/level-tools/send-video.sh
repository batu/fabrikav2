#!/usr/bin/env bash
#
# Record a short gameplay video on device and upload to Telegram.
#
# Usage:
#   tools/send-video.sh CAPTION [DURATION_SECONDS]
#
# Default duration 10 seconds. Output saved to todos/refdiff/
# alongside ref-compare outputs.

set -euo pipefail

CAPTION="${1:?caption required}"
DURATION="${2:-10}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/todos/refdiff"
mkdir -p "$OUT_DIR"

LABEL="$(date +%Y%m%d-%H%M%S)"
LOCAL_MP4="${OUT_DIR}/video-${LABEL}.mp4"
DEVICE_MP4="/sdcard/arrow-rec-${LABEL}.mp4"

echo "[send-video] starting $DURATION s screenrecord on device"
adb shell screenrecord --time-limit "$DURATION" --size 540x1200 "$DEVICE_MP4" &
SR_PID=$!
sleep 0.5
# Foreground our app.
adb shell am start -n com.utolye.arrow/.MainActivity >/dev/null
wait $SR_PID || true

echo "[send-video] pulling → $LOCAL_MP4"
adb pull "$DEVICE_MP4" "$LOCAL_MP4" >/dev/null
adb shell rm "$DEVICE_MP4" >/dev/null

if command -v ccbot >/dev/null 2>&1; then
  ccbot send --session arrow --media "$LOCAL_MP4" "$CAPTION"
  echo "[send-video] sent via Telegram."
else
  echo "[send-video] ccbot not on PATH — video saved locally at $LOCAL_MP4"
fi
