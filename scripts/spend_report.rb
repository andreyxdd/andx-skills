#!/usr/bin/ruby
# Token spend per andx run from Claude Code transcripts (~/.claude/projects).
# A run = parent session jsonl + its subagent jsonl files (sibling agent-*.jsonl with the
# same sessionId, or <session>/subagents/*.jsonl), counted only when the parent invokes an
# andx- skill (slash command, slash-prefixed skill name in user text, or Skill tool). The skill catalog
# names every andx skill in every session, so a bare mention does not count.
# Input = uncached + cache write + cache read.
#   ruby spend_report.rb <session.jsonl|dir>   # per-run report
#   ruby spend_report.rb --summary <dir>       # medians + totals; no project names or session ids
require "json"

def andx_run?(path)
  File.foreach(path).any? do |l|
    next false unless l.include?("andx-")
    j = (JSON.parse(l) rescue nil)
    next false unless j.is_a?(Hash)
    c = j.dig("message", "content")
    blocks = c.is_a?(Array) ? c.select { |b| b.is_a?(Hash) } : []
    case j["type"]
    when "user"
      texts = c.is_a?(String) ? [c] : blocks.map { |b| b["text"].to_s }
      texts.any? { |t| t.match?(%r{(?:\A|[\s>])/andx-[a-z]}) }
    when "assistant"
      blocks.any? { |b| b["type"] == "tool_use" && b["name"] == "Skill" && b.dig("input", "skill").to_s.start_with?("andx-") }
    else false
    end
  end
end

# Assistant lines repeat the same usage once per content block; count each message id once.
def usage_of(files)
  s = { requests: 0, input: 0, output: 0, peak: 0, images: 0, tools: Hash.new(0) }
  seen = {}
  names = {}
  files.each do |f|
    File.foreach(f) do |l|
      next if l.start_with?('{"type":"api-')
      next unless l.include?('"usage"') || l.include?('"tool_result"')
      j = (JSON.parse(l) rescue nil)
      m = j.is_a?(Hash) && j["message"]
      next unless m.is_a?(Hash)
      blocks = m["content"].is_a?(Array) ? m["content"].select { |b| b.is_a?(Hash) } : []
      if j["type"] == "assistant"
        blocks.each { |b| names[b["id"]] = b["name"] if b["type"] == "tool_use" }
        u = m["usage"]
        key = m["id"] || j["uuid"]
        next if u.nil? || seen[key]
        seen[key] = true
        ctx = %w[input_tokens cache_creation_input_tokens cache_read_input_tokens].sum { |k| u[k].to_i }
        s[:requests] += 1
        s[:input] += ctx
        s[:output] += u["output_tokens"].to_i
        s[:peak] = ctx if ctx > s[:peak]
      elsif j["type"] == "user"
        blocks.select { |b| b["type"] == "tool_result" }.each do |b|
          parts = b["content"].is_a?(Array) ? b["content"] : [{ "text" => b["content"].to_s }]
          s[:images] += 1 if parts.any? { |p| p["type"] == "image" }
          s[:tools][names[b["tool_use_id"]] || "?"] += parts.sum { |p| p["text"].to_s.size }
        end
      end
    end
  end
  s
end

def sibling_agents(dir)
  (@siblings ||= {})[dir] ||= Dir.glob(File.join(dir, "agent-*.jsonl")).group_by do |f|
    File.foreach(f).lazy.map { |l| l[/"sessionId":"([^"]+)"/, 1] }.find { |x| x }
  end
end

def run_of(path)
  id = File.basename(path, ".jsonl")
  dir = File.dirname(path)
  subs = Dir.glob(File.join(dir, id, "subagents", "*.jsonl")) + (sibling_agents(dir)[id] || [])
  { id: id, parent: usage_of([path]), sub: usage_of(subs) }
end

def runs(arg)
  sessions = File.file?(arg) ? [arg] : Dir.glob(File.join(arg, "**", "*.jsonl")).reject do |f|
    File.basename(f).start_with?("agent-") || f.include?("/subagents/")
  end
  sessions.sort.select { |f| andx_run?(f) }.map { |f| run_of(f) }
end

def print_run(r)
  p, s = r[:parent], r[:sub]
  tools = p[:tools].merge(s[:tools]) { |_, a, b| a + b }.sort_by { |_, v| -v }.first(5)
  puts "run #{r[:id]}"
  puts "  requests parent=#{p[:requests]} subagent=#{s[:requests]}"
  puts "  input parent=#{p[:input]} subagent=#{s[:input]} total=#{p[:input] + s[:input]}"
  puts "  output parent=#{p[:output]} subagent=#{s[:output]}"
  puts "  peak_context parent=#{p[:peak]} subagent=#{s[:peak]}"
  puts "  image_results #{p[:images] + s[:images]}"
  puts "  top_tool_output #{tools.map { |n, c| "#{n}=#{c / 4}" }.join(' ')}"
end

def metrics(r)
  p, s = r[:parent], r[:sub]
  { "input_total" => p[:input] + s[:input], "input_parent" => p[:input], "input_subagent" => s[:input],
    "requests_parent" => p[:requests], "requests_subagent" => s[:requests],
    "output" => p[:output] + s[:output], "peak_context_parent" => p[:peak],
    "image_results" => p[:images] + s[:images] }
end

def median(xs)
  v = xs.sort
  m = v.size.odd? ? v[v.size / 2] : (v[v.size / 2 - 1] + v[v.size / 2]) / 2.0
  m == m.round ? m.round : m.round(1)
end

def summary(dir)
  rows = runs(dir).map { |r| metrics(r) }
  puts "runs #{rows.size}"
  return if rows.empty?
  keys = rows.first.keys
  puts "median " + keys.map { |k| "#{k}=#{median(rows.map { |r| r[k] })}" }.join(" ")
  puts "total " + keys.map { |k| "#{k}=#{rows.sum { |r| r[k] }}" }.join(" ")
end

if $PROGRAM_NAME == __FILE__
  if ARGV.first == "--summary" && ARGV[1]
    summary(File.expand_path(ARGV[1]))
  elsif ARGV.first && File.exist?(ARGV.first)
    runs(File.expand_path(ARGV.first)).each { |r| print_run(r) }
  else
    abort "usage: spend_report.rb <session.jsonl|dir> | --summary <dir>"
  end
end
