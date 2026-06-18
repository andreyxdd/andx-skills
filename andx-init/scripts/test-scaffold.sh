#!/usr/bin/env bash
# Smoke tests for andx-init scaffold.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCAFFOLD="$ROOT/scripts/scaffold.sh"
TMPBASE="${TMPDIR:-/tmp}/andx-init-test-$$"
PASS=0
FAIL=0

assert() {
  local desc="$1"
  shift
  if "$@"; then
    echo "PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc" >&2
    FAIL=$((FAIL + 1))
  fi
}

is_file() { [[ -f "$1" ]]; }
is_dir() { [[ -d "$1" ]]; }
file_contains() { grep -q "$2" "$1"; }

cleanup() { rm -rf "$TMPBASE"; }
trap cleanup EXIT
mkdir -p "$TMPBASE"

for preset in app data content; do
  dir="$TMPBASE/${preset}-fresh"
  mkdir -p "$dir"
  "$SCAFFOLD" "$preset" "$dir" >/dev/null

  assert "[$preset] IDENTITY.md" is_file "$dir/IDENTITY.md"
  assert "[$preset] ROUTING.md" is_file "$dir/ROUTING.md"
  assert "[$preset] knowledge/index.md" is_file "$dir/knowledge/index.md"
  assert "[$preset] glossary" is_file "$dir/knowledge/domain/glossary.md"
  assert "[$preset] glossary frontmatter" file_contains "$dir/knowledge/domain/glossary.md" "type: Glossary"
  assert "[$preset] gitignore pipeline output" file_contains "$dir/.gitignore" 'pipeline/\*/output/'
  assert "[$preset] gitignore plans" file_contains "$dir/.gitignore" '.cursor/plans/'
  assert "[$preset] .cursor/plans dir" is_dir "$dir/.cursor/plans"

  case "$preset" in
    app)
      assert "[$preset] 01-discover" is_file "$dir/pipeline/01-discover/CONTEXT.md"
      assert "[$preset] 04-verify" is_file "$dir/pipeline/04-verify/CONTEXT.md"
      assert "[$preset] apis subtree" is_dir "$dir/knowledge/apis"
      assert "[$preset] output dir" is_dir "$dir/pipeline/01-discover/output"
      ;;
    data)
      assert "[$preset] 01-catalog" is_file "$dir/pipeline/01-catalog/CONTEXT.md"
      assert "[$preset] datasets subtree" is_dir "$dir/knowledge/datasets"
      ;;
    content)
      assert "[$preset] 01-research" is_file "$dir/pipeline/01-research/CONTEXT.md"
      assert "[$preset] voice subtree" is_dir "$dir/knowledge/voice"
      ;;
  esac
done

brown="$TMPBASE/brownfield"
mkdir -p "$brown"
echo "ORIGINAL README" > "$brown/README.md"
"$SCAFFOLD" app "$brown" >/dev/null
assert "brownfield README preserved" file_contains "$brown/README.md" "ORIGINAL README"
assert "brownfield scaffolds new files" is_file "$brown/IDENTITY.md"

echo "---"
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
