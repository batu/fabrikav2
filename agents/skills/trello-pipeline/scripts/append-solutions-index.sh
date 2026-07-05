#!/usr/bin/env bash
# Append a one-line entry to docs/solutions/INDEX.md for a newly-created
# solution doc. Reads `date`, `topic`, and (optionally) `tags` from the
# doc's YAML frontmatter; falls back to filename + mtime if frontmatter
# is missing.
#
# Usage:
#   scripts/append-solutions-index.sh docs/solutions/2026-04-14-foo.md
#   scripts/append-solutions-index.sh docs/solutions/2026-04-14-foo.md "one-line hook"
#
# Idempotent — refuses to add a duplicate entry if the doc path already
# appears in INDEX.md.
#
# Workaround until /ce:compound itself maintains the index upstream.

set -euo pipefail

doc_path="${1:-}"
custom_hook="${2:-}"

if [[ -z "$doc_path" ]]; then
  echo "usage: $0 <doc-path> [hook-text]" >&2
  exit 2
fi

if [[ ! -f "$doc_path" ]]; then
  echo "error: $doc_path not found" >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
index_path="$repo_root/docs/solutions/INDEX.md"

# Doc path relative to the solutions dir, for clean linking
solutions_dir="$repo_root/docs/solutions"
mkdir -p "$solutions_dir"

# Make doc_path absolute so realpath comparisons work
abs_doc="$(cd "$(dirname "$doc_path")" && pwd)/$(basename "$doc_path")"
case "$abs_doc" in
  "$solutions_dir"/*) ;;
  *)
    echo "error: $doc_path is not under docs/solutions/" >&2
    exit 1 ;;
esac

filename="${abs_doc##*/}"

# Idempotency: skip if the file is already linked
if [[ -f "$index_path" ]] && grep -qF "($filename)" "$index_path"; then
  echo "INDEX.md already has an entry for $filename — skipping"
  exit 0
fi

# Extract YAML frontmatter fields (between leading --- delimiters)
extract_field() {
  local field="$1"
  awk -v field="$field" '
    /^---[[:space:]]*$/ { if (in_fm) exit; in_fm=1; next }
    in_fm && $0 ~ "^"field":" {
      sub("^"field":[[:space:]]*", ""); gsub(/^["\047]|["\047]$/, ""); print; exit
    }
  ' "$abs_doc"
}

date_field="$(extract_field date)"
topic_field="$(extract_field topic)"

if [[ -z "$date_field" ]]; then
  date_field="$(date +%Y-%m-%d)"
fi
if [[ -z "$topic_field" ]]; then
  # Strip leading YYYY-MM-DD- and trailing .md from the filename for a topic guess
  topic_field="$(echo "$filename" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-//' | sed -E 's/\.md$//')"
fi

# Hook text: argument > first H1 line > topic
hook="$custom_hook"
if [[ -z "$hook" ]]; then
  hook="$(awk '/^# / { sub(/^# /, ""); print; exit }' "$abs_doc" || true)"
fi
if [[ -z "$hook" ]]; then
  hook="$topic_field"
fi

# Initialize INDEX.md if missing
if [[ ! -f "$index_path" ]]; then
  cat > "$index_path" <<'EOF'
# Solutions Index

<!-- Auto-maintained by `scripts/append-solutions-index.sh` (bundled with the
     trello-pipeline skill). One line per solution doc, sorted append-only.
     Removing entries: edit by hand if a doc is renamed/deleted. -->

EOF
fi

# Append the entry
printf -- "- %s — [%s](%s) — %s\n" "$date_field" "$topic_field" "$filename" "$hook" >> "$index_path"

echo "Added to INDEX.md: $filename"
