#!/bin/bash
INPUT=$(cat)
TASK_SUBJECT=$(echo "$INPUT" | jq -r '.task_subject')

# A failed git diff outside a repository is not evidence of code changes.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Check for tracked, staged, or untracked changes without assuming HEAD exists.
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  git diff --quiet HEAD 2>/dev/null && \
    git diff --cached --quiet HEAD 2>/dev/null && \
    [ -z "$(git ls-files --others --exclude-standard)" ] && exit 0
else
  git diff --cached --quiet 2>/dev/null && \
    [ -z "$(git ls-files --others --exclude-standard)" ] && exit 0
fi

jq -n --arg task "$TASK_SUBJECT" '{
  hookSpecificOutput: {
    hookEventName: "TaskCompleted",
    additionalContext: ("REMINDER: Task \"" + $task + "\" completed with uncommitted changes. Run the relevant repository checks before committing.")
  }
}'
exit 0
