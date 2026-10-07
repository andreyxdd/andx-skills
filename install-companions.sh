#!/usr/bin/env bash
# Install optional companion skills (external; not symlinked from andx-skills).
#   react-best-practices: copied from vercel-labs/agent-skills
#   Matt Pocock skills: symlinked from a pinned clone at ~/Dev/tools/mattpocock-skills
set -euo pipefail

MATT_REPO="https://github.com/mattpocock/skills.git"
MATT_DIR="${MATT_DIR:-$HOME/Dev/tools/mattpocock-skills}"
MATT_PIN="f3fc563"
# Model-invoked (andx consumers) + user-invoked (upstream sets disable-model-invocation).
MATT_SKILLS=(
  productivity/grilling
  engineering/tdd
  engineering/codebase-design
  engineering/diagnosing-bugs
  engineering/wizard
  engineering/pr
  productivity/writing-for-agents
  productivity/grill-me
  productivity/handoff
  engineering/improve-codebase-architecture
  engineering/to-spec
  engineering/to-tickets
  engineering/retro
)

[[ -d "$MATT_DIR/.git" ]] || git clone -q "$MATT_REPO" "$MATT_DIR"
git -C "$MATT_DIR" fetch -q origin || true
git -C "$MATT_DIR" checkout -q "$MATT_PIN"

REPO="https://github.com/vercel-labs/agent-skills.git"
SKILL="react-best-practices"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --depth 1 --filter=blob:none --sparse "$REPO" "$TMP/repo"
(
  cd "$TMP/repo"
  git sparse-checkout set "skills/$SKILL"
)

install_target() {
  local target="$1"
  mkdir -p "$target"
  rm -rf "$target/$SKILL"
  cp -R "$TMP/repo/skills/$SKILL" "$target/$SKILL"
  echo "installed $target/$SKILL"
  for path in "${MATT_SKILLS[@]}"; do
    local name="${path##*/}"
    if [[ -e "$target/$name" && ! -L "$target/$name" ]]; then
      echo "skip $target/$name: real directory (archive it first)" >&2
      continue
    fi
    ln -sfn "$MATT_DIR/skills/$path" "$target/$name"
    echo "linked $target/$name -> $MATT_DIR/skills/$path"
  done
}

install_target "$HOME/.cursor/skills"
install_target "$HOME/.claude/skills"

echo "Done. Matt Pocock skills pinned at $MATT_PIN."
