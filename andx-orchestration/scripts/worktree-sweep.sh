#!/usr/bin/env bash
# List agent worktrees and remove the safe ones.
#   worktree-sweep.sh [--apply] [--target BRANCH] [REPO]
# Safe = clean tree AND branch tip merged into TARGET (default: current branch) or origin's default.
# Dry-run by default. Dirty or unmerged worktrees are never removed; the exact manual command is printed.
# ponytail: ancestry check only, so squash/rebase-merged MRs show as "unmerged" (kept). Upgrade: ask host API for merged MR by branch.
set -euo pipefail

apply=0
target=""
repo="."
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) apply=1 ;;
    --target) target="$2"; shift ;;
    *) repo="$1" ;;
  esac
  shift
done

repo=$(git -C "$repo" rev-parse --show-toplevel)
cd "$repo"
git worktree prune
[ -n "$target" ] || target=$(git branch --show-current)
remote_default=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || true)

merged() {
  git merge-base --is-ancestor "$1" "$target" 2>/dev/null && return 0
  [ -n "$remote_default" ] && git merge-base --is-ancestor "$1" "$remote_default" 2>/dev/null
}

removed=0; kept=0
path=""; head=""; branch=""
flush() {
  [ -n "$path" ] || return 0
  if [ "$path" = "$repo" ]; then path=""; return 0; fi
  case "$path" in
    "$repo"/.worktrees/*|*-exec*|*/restack-*|*/review-*|*/exec-*) ;;
    *) path=""; return 0 ;;
  esac
  local state="clean" merge="unmerged" action="keep"
  [ -d "$path" ] && [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ] && state="dirty"
  merged "$head" && merge="merged"
  if [ "$state" = clean ] && [ "$merge" = merged ]; then action="remove"; fi
  printf '%-7s %-6s %-8s %s %s\n' "$action" "$state" "$merge" "${branch:-detached}" "$path"
  if [ "$action" = remove ] && [ "$apply" = 1 ]; then
    git worktree remove "$path"
    [ -n "$branch" ] && git branch -d "$branch" >/dev/null 2>&1 || true
    removed=$((removed + 1))
  elif [ "$action" = keep ]; then
    kept=$((kept + 1))
    echo "        manual: git worktree remove --force '$path'${branch:+ && git branch -D '$branch'}  # only after you confirm"
  fi
  path=""; head=""; branch=""
}

while IFS= read -r line; do
  case "$line" in
    "worktree "*) flush; path="${line#worktree }" ;;
    "HEAD "*) head="${line#HEAD }" ;;
    "branch "*) branch="${line#branch refs/heads/}" ;;
    "") flush ;;
  esac
done < <(git worktree list --porcelain; echo)

echo "target=$target removed=$removed kept=$kept apply=$apply"
