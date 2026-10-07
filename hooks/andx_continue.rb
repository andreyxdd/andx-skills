#!/usr/bin/ruby
# Stop hook (Claude format; Cursor maps decision=block to followup_message).
# Blocks the agent from ending its turn while an andx run ledger written in
# this conversation is non-terminal. Fail-open on any error.
require "json"
require "shellwords"
require "time"

TERMINAL = %w[DONE ABORTED ESCALATED AWAITING_USER].freeze
MAX_CONTINUES = 5
STALE_SECONDS = 24 * 3600

def ledger_paths(dirs)
  dirs.flat_map do |dir|
    next [] unless dir && File.directory?(dir)
    top = `git -C #{dir.shellescape} rev-parse --show-toplevel 2>/dev/null`.strip
    roots = [dir, top].reject(&:empty?).uniq
    roots.flat_map do |r|
      ["", "*/", "*/*/", "*/*/*/"].flat_map { |d| Dir.glob(File.join(r, d, ".worktrees/.andx-run/*.json")) }
    end
  end.uniq
end

def decide(input, now: Time.now)
  transcript = input["transcript_path"].to_s
  return nil unless File.file?(transcript)
  log = File.read(transcript)
  dirs = [input["cwd"], *Array(input["workspace_roots"])].compact
  ledger_paths(dirs).each do |path|
    data = JSON.parse(File.read(path)) rescue next
    next if TERMINAL.include?(data["terminal"].to_s)
    next if data["continues"].to_i >= MAX_CONTINUES
    next if now - File.mtime(path) > STALE_SECONDS
    next unless log.include?(".andx-run/#{File.basename(path)}")
    data["continues"] = data["continues"].to_i + 1
    File.write(path, JSON.pretty_generate(data))
    return {
      "decision" => "block",
      "reason" => "andx run '#{data['slug']}' (mode #{data['mode']}) is at phase #{data['phase']}, not terminal. " \
                  "Continue to the Definition of done. If blocked on the user, set \"terminal\": \"AWAITING_USER\" " \
                  "(or ESCALATED/ABORTED) in #{path} and say why. Continue #{data['continues']}/#{MAX_CONTINUES}."
    }
  end
  nil
end

if $PROGRAM_NAME == __FILE__
  begin
    out = decide(JSON.parse($stdin.read))
    puts JSON.generate(out) if out
  rescue StandardError
    nil
  end
  exit 0
end
