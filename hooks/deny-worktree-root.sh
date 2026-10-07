#!/usr/bin/env bash
# Cursor preToolUse + beforeMCPExecution guard: deny move_agent_to_root into an
# andx exec worktree (it opens a second Cursor workspace). Fail-open otherwise.
input=$(cat)
case "$input" in
  *move_agent_to_root*)
    printf '%s\n' "$input" > /tmp/andx-guard-last-stdin.json 2>/dev/null
    case "$input" in
      */.worktrees/*)
        printf '%s\n' '{"permission":"deny","user_message":"andx: workers use absolute WORKTREE_DIR paths; do not move the workspace root into .worktrees/.","agent_message":"Denied: never move_agent_to_root into .worktrees/. Use absolute $WORKTREE_DIR paths or Shell working_directory instead."}'
        exit 2
        ;;
    esac
    ;;
esac
exit 0
