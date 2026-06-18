#!/usr/bin/env bash
# Symlink canonical andx skills into Cursor and Claude skill directories.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SKILLS=(
  andx-init
  andx-plan
  andx-execute
  andx-orchestration
  andx-debug-and-fix
  andx-deploy
  andx-execute-and-deploy
  andx-execute-and-review
)

install_target() {
  local target="$1"
  if [[ ! -d "$target" ]]; then
    mkdir -p "$target"
  fi
  for skill in "${SKILLS[@]}"; do
    if [[ ! -d "$ROOT/$skill" ]]; then
      echo "missing canonical skill: $ROOT/$skill" >&2
      exit 1
    fi
    rm -rf "$target/$skill"
    ln -sfn "$ROOT/$skill" "$target/$skill"
    echo "linked $target/$skill -> $ROOT/$skill"
  done
}

install_target "$HOME/.cursor/skills"
install_target "$HOME/.claude/skills"

echo "Done. Canonical source: $ROOT"
