#!/usr/bin/env bash
# Symlink canonical andx skills into Cursor, Claude, and Codex skill directories.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

if [[ "${1:-}" == "--uninstall-hooks" ]]; then
  node "$ROOT/scripts/install-hooks.mjs" uninstall
  exit 0
fi

node "$ROOT/scripts/check-skills.mjs" "$ROOT" || { echo "check_skills failed; nothing linked" >&2; exit 1; }

SKILLS=(
  andx-init
  andx-plan
  andx-schedule
  andx-execute
  andx-orchestration
  andx-debug-and-fix
  andx-deploy
  andx-deploy-init
  andx-execute-and-deploy
  andx-execute-and-review
  andx-execute-review-and-deploy
  andx-mr-review
  andx-mr-babysit
  andx-mr-create
  andx-security-review
  andx-listen-start
  andx-listen-end
)
RETIRED=(
  andx-pr-review
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
  for skill in "${RETIRED[@]}"; do
    rm -rf "$target/$skill"
  done
}

install_target "$HOME/.cursor/skills"
install_target "$HOME/.claude/skills"
install_target "$HOME/.codex/skills"

# Agents: ~/.claude/agents only; Cursor reads it too (a same-name ~/.cursor/agents file would shadow).
mkdir -p "$HOME/.claude/agents"
for agent in "$ROOT"/agents/*.md; do
  ln -sfn "$agent" "$HOME/.claude/agents/$(basename "$agent")"
  echo "linked $HOME/.claude/agents/$(basename "$agent")"
done

node "$ROOT/scripts/install-hooks.mjs" install

echo "Done. Canonical source: $ROOT"
echo "Run ./install-companions.sh for optional companions (e.g. react-best-practices)."
