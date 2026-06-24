#!/usr/bin/env bash
# Install optional companion skills (external; not symlinked from andx-skills).
set -euo pipefail

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
}

install_target "$HOME/.cursor/skills"
install_target "$HOME/.claude/skills"

META="$HOME/.cursor/skills/$SKILL/metadata.json"
if [[ -f "$META" ]]; then
  python3 -c "import json; print('react-best-practices version:', json.load(open('$META')).get('version', '?'))" 2>/dev/null \
    || grep -E '"version"' "$META" || true
fi

echo "Done. Companion skills installed."
