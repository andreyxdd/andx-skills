#!/usr/bin/ruby
# Normalize one reviewer's raw output into {status, findings[]}.
# Usage: ruby parse_review.rb <reviewer-name> [file]   (stdin when no file)
# status: BLOCK (any critical/high) | FIX (medium only) | PASS | UNPARSED
require "json"

SEV = { "critical" => 4, "high" => 3, "medium" => 2, "low" => 1, "nitpick" => 0 }.freeze

def status_for(findings)
  top = findings.map { |f| SEV[f[:severity]] || 0 }.max || 0
  top >= 3 ? "BLOCK" : top == 2 ? "FIX" : "PASS"
end

def tag(xml, name)
  xml[%r{<#{name}>(.*?)</#{name}>}m, 1].to_s.strip
end

def parse(text, reviewer)
  # 1) Bugbot native XML: <answer></answer> = no bugs.
  if (answer = text[%r{<answer>(.*?)</answer>}m, 1])
    findings = answer.scan(%r{<bug>(.*?)</bug>}m).map do |(bug)|
      { reviewer: reviewer, severity: tag(bug, "severity").downcase,
        location: "#{tag(bug, 'file')}:#{tag(bug, 'start_line')}", finding: tag(bug, "title") }
    end
    return { status: status_for(findings), findings: findings }
  end

  # 2) VERDICT block; ignore echoed template placeholders.
  real = text.gsub(/(?:PASS|BLOCK)\s*\|\s*(?:PASS|BLOCK)/i, "")
  verdicts = real.scan(/VERDICT\W*(?:status:\s*)?\**\s*(PASS|BLOCK)\b/i).flatten
  if verdicts.size == 1
    findings = text.scan(/^\s*-\s*\[(CRITICAL|HIGH|MEDIUM|LOW|NEEDS_VALIDATION)\]\s*(\S+)\s*[—-]\s*(.+)$/i).map do |sev, loc, msg|
      { reviewer: reviewer, severity: sev.downcase, location: loc, finding: msg.strip }
    end
    return { status: verdicts.first.upcase == "BLOCK" ? "BLOCK" : status_for(findings), findings: findings }
  end

  # 3) Severity table rows: | HIGH | `file:line` | finding |
  rows = text.scan(/^\|\s*\**(CRITICAL|HIGH|MEDIUM|LOW)\**\s*\|\s*`?([^|`]+?)`?\s*\|\s*(.+?)\s*\|\s*$/i)
  unless rows.empty?
    findings = rows.map { |s, l, f| { reviewer: reviewer, severity: s.downcase, location: l.strip, finding: f } }
    return { status: status_for(findings), findings: findings }
  end

  # 4) Plain "no bugs" prose.
  return { status: "PASS", findings: [] } if text =~ /no (high-confidence )?bugs|found no bugs|no issues found/i

  { status: "UNPARSED", findings: [] }
end

if $PROGRAM_NAME == __FILE__
  reviewer = ARGV.shift || "reviewer"
  puts JSON.pretty_generate(parse(ARGF.read, reviewer))
end
