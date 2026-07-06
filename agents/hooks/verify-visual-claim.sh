#!/bin/bash
# Claim-gated verify Stop-hook (card elkcIthD). Thin shim: self-disables (exit 0)
# with NO node spawn when the visual toolchain is absent, so it is catalog-safe
# when promoted to non-game projects. All real logic lives in the unit-tested
# node core at tools/verify-gate/. Stdin is the Claude Code Stop-hook JSON; a
# block decision is emitted on stdout by the node core.
INPUT=$(cat)
DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

# Self-disable early: no verify-device tool or no games/ dir -> no-op.
[ -f "$DIR/tools/verify-device/cli.mjs" ] || exit 0
[ -d "$DIR/games" ] || exit 0
[ -f "$DIR/tools/verify-gate/cli.mjs" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

printf '%s' "$INPUT" | node "$DIR/tools/verify-gate/cli.mjs"
# The node core owns the decision (stdout) and always fails open; the shell
# never turns a hook error into a turn-wedging non-zero exit.
exit 0
