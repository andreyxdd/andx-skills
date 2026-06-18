#!/usr/bin/env bash
# Scaffold OKF + ICM hybrid layout into a target repo (additive, no overwrite).
set -euo pipefail

usage() {
  echo "Usage: scaffold.sh <preset> <repo_root>" >&2
  echo "  preset: app | data | content" >&2
  exit 1
}

[[ $# -eq 2 ]] || usage
PRESET="$1"
REPO="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE_ROOT="$(cd "$SCRIPT_DIR/../templates" && pwd)"
TEMPLATE="$TEMPLATE_ROOT/$PRESET"

if [[ ! -d "$TEMPLATE" ]]; then
  echo "Unknown preset: $PRESET" >&2
  exit 1
fi

if [[ ! -d "$REPO" ]]; then
  echo "Repo root does not exist: $REPO" >&2
  exit 1
fi

copy_if_missing() {
  local src="$1"
  local dest="$2"
  if [[ -e "$dest" ]]; then
    echo "skip (exists): $dest"
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "created: $dest"
}

while IFS= read -r -d '' file; do
  rel="${file#"$TEMPLATE"/}"
  copy_if_missing "$file" "$REPO/$rel"
done < <(find "$TEMPLATE" -type f -print0)

# Ensure output dirs exist (not always in template as files)
for stage in "$REPO/pipeline"/*/; do
  if [[ -d "$stage" ]]; then
    mkdir -p "${stage}output"
    touch "${stage}output/.gitkeep" 2>/dev/null || true
  fi
done

mkdir -p "$REPO/.cursor/plans"

GITIGNORE="$REPO/.gitignore"
LINES=(
  "pipeline/*/output/"
  ".cursor/plans/"
)
if [[ -f "$GITIGNORE" ]]; then
  for line in "${LINES[@]}"; do
    if ! grep -qxF "$line" "$GITIGNORE" 2>/dev/null; then
      echo "$line" >> "$GITIGNORE"
      echo "appended .gitignore: $line"
    fi
  done
else
  printf '%s\n' "${LINES[@]}" > "$GITIGNORE"
  echo "created .gitignore"
fi

echo "Scaffold complete: preset=$PRESET root=$REPO"
