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

# Cursor loads react-best-practices only when a .tsx/.jsx file is in play.
add_react_paths() {
  /usr/bin/ruby -e '
    f = ARGV[0]
    _, fm, body = File.read(f).split(/^---[ \t]*$/, 3)
    exit if body.nil? || fm =~ /^paths:/
    File.write(f, "---#{fm}paths: \"**/*.tsx, **/*.jsx\"\n---#{body}")' "$1"
}

[[ "${BASH_SOURCE[0]}" == "$0" ]] || return 0

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
  add_react_paths "$target/$SKILL/SKILL.md"
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

# Catalog cost per harness; a non-empty duplicates= list means a skill dir copy shadows an enabled plugin.
/usr/bin/ruby "$(dirname "$0")/scripts/check_skills.rb" --budget

echo "Done. Matt Pocock skills pinned at $MATT_PIN."
