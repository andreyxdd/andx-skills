#!/usr/bin/ruby
# Cursor preToolUse + beforeMCPExecution guard: deny move_agent_to_root /
# move_agent_to_cloned_root into an andx worktree (it opens a second Cursor workspace).
# Decides on the tool name only; file contents mentioning these words are ignored. Fail-open.
require "json"

MOVE = /move_agent_to_(cloned_)?root\z/

def decide(raw)
  input = JSON.parse(raw)
  name = input["tool_name"].to_s
  args = input["tool_input"]
  if name.end_with?("CallDynamicTool") && args.is_a?(Hash)
    name = args["toolName"].to_s
    args = args["arguments"]
  end
  return :allow unless name.match?(MOVE)
  File.write("/tmp/andx-guard-last-stdin.json", raw) rescue nil
  (args.is_a?(String) ? args : JSON.generate(args)).include?("/.worktrees/") ? :deny : :allow
rescue StandardError
  :allow
end

if $PROGRAM_NAME == __FILE__
  if decide($stdin.read) == :deny
    puts JSON.generate(
      permission: "deny",
      user_message: "andx: workers use absolute WORKTREE_DIR paths; do not move the workspace root into .worktrees/.",
      agent_message: "Denied: never move_agent_to_root into .worktrees/. Use absolute $WORKTREE_DIR paths or Shell working_directory instead."
    )
    exit 2
  end
end
