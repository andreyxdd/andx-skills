#!/usr/bin/env ruby
# Postcondition: babysit never resolves human-authored review threads.
#   thread_guard.rb BEFORE.json AFTER.json [--bots a,b,c]
# Each file: [{"id":"...","author":"login","resolved":false}, ...] (normalize gh/glab output to this shape).
# Exit 1 and list ids when a human thread unresolved in BEFORE is resolved in AFTER.
require "json"

BOTS = %w[cursor bugbot aikido coderabbitai sonarcloud gitlab-bot github-actions].freeze

def bot?(author, bots)
  a = author.to_s.downcase.sub(/\[bot\]\z/, "")
  bots.any? { |b| a == b || a.start_with?("#{b}-") }
end

def violations(before, after, bots = BOTS)
  open_human = before.reject { |t| t["resolved"] || bot?(t["author"], bots) }.map { |t| t["id"] }
  now_resolved = after.select { |t| t["resolved"] }.map { |t| t["id"] }
  open_human & now_resolved
end

if $PROGRAM_NAME == __FILE__
  before, after = ARGV[0, 2].map { |f| JSON.parse(File.read(f)) }
  i = ARGV.index("--bots")
  bots = i ? BOTS + ARGV[i + 1].split(",") : BOTS
  bad = violations(before, after, bots)
  if bad.empty?
    puts "thread-guard: PASS"
  else
    puts "thread-guard: FAIL human threads resolved by agent: #{bad.join(', ')}"
    exit 1
  end
end
