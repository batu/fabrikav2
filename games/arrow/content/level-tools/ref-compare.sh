#!/usr/bin/env bash
#
# Reference-comparison gate. Pulls a screenshot from both
# `com.ecffri.arrows` (the reference) and `com.utolye.arrow` (our
# build), stacks them side-by-side via ffmpeg, optionally uploads
# the diff to Telegram.
#
# Usage:
#   tools/ref-compare.sh [LABEL]
#
# LABEL defaults to the current timestamp; it becomes the diff
# filename under `todos/refdiff/diff-LABEL.png`.
#
# Prereqs:
#   - adb connected to the device (both apps installed)
#   - ffmpeg on PATH
#   - Optional: ccbot for Telegram upload
#
# The script launches each app in sequence, waits a moment for the
# UI to settle, and captures. Switch the reference to the level
# you want to compare BEFORE running — the Unity app doesn't accept
# a level query param.

set -euo pipefail

LABEL="${1:-$(date +%Y%m%d-%H%M%S)}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/todos/refdiff"
mkdir -p "$OUT_DIR"

REF_PKG="com.ecffri.arrows"
OURS_PKG="com.utolye.arrow"
REF_ACT="${REF_PKG}/com.unity3d.player.UnityPlayerActivity"
OURS_ACT="${OURS_PKG}/.MainActivity"

REF_PNG="${OUT_DIR}/ref-${LABEL}.png"
OURS_PNG="${OUT_DIR}/ours-${LABEL}.png"
DIFF_PNG="${OUT_DIR}/diff-${LABEL}.png"

echo "[ref-compare] capturing reference ($REF_PKG)"
adb shell am start -n "$REF_ACT" >/dev/null
sleep 3
adb exec-out screencap -p > "$REF_PNG"

echo "[ref-compare] capturing our build ($OURS_PKG)"
adb shell am start -n "$OURS_ACT" >/dev/null
sleep 3
adb exec-out screencap -p > "$OURS_PNG"

echo "[ref-compare] hstacking → $DIFF_PNG"
ffmpeg -y \
  -i "$REF_PNG" \
  -i "$OURS_PNG" \
  -filter_complex "[0:v]scale=540:-1[a];[1:v]scale=540:-1[b];[a][b]hstack=inputs=2" \
  "$DIFF_PNG" \
  >/dev/null 2>&1

echo "[ref-compare] done."
echo "  reference: $REF_PNG"
echo "  ours:      $OURS_PNG"
echo "  diff:      $DIFF_PNG"

if command -v ccbot >/dev/null 2>&1; then
  echo "[ref-compare] uploading to Telegram via ccbot (session=arrow)"
  ccbot send --session arrow --media "$DIFF_PNG" "ref-compare [$LABEL] — reference LEFT, ours RIGHT. From tools/ref-compare.sh."
fi
