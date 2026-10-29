#!/usr/bin/ruby
# Validate SKILL.md files: YAML frontmatter, name == folder, description present,
# relative links resolve (in-repo broken = error, external companion = warning).
#   ruby check_skills.rb [ROOT]            # default: this repo; exit 1 on errors
#   ruby check_skills.rb --budget          # catalog cost per harness (cursor:, claude:) across installed skill dirs
#   ruby check_skills.rb --prose           # line counts, duplicated clauses, unresolved links (report only)
#   ruby check_skills.rb --tokens          # read-chain tokens per composer/agent + catalog tokens per turn
require "yaml"
require "json"

INSTALL = File.expand_path("~/.cursor/skills")

# Documented frontmatter keys, union of Cursor and Claude Code; anything else is a typo or drift.
SKILL_KEYS = %w[name description paths globs disable-model-invocation icon color metadata
                allowed-tools argument-hint when_to_use model effort context agent hooks
                user-invocable version license arguments].freeze
AGENT_KEYS = %w[name description model readonly is_background tools disallowedTools skills effort
                autoCompactWindow permissionMode mcpServers hooks memory isolation color maxTurns
                background].freeze

def frontmatter(path)
  text = File.read(path)
  return [nil, "no frontmatter"] unless text.start_with?("---")
  [YAML.safe_load(text.split(/^---\s*$/, 3)[1]) || {}, nil]
rescue Psych::Exception => e
  [nil, e.message.lines.first.strip]
end

def links(path)
  File.read(path).scan(/\]\(([^)\s]+)\)/).flatten.reject { |l| l =~ %r{\A(https?:|mailto:|#|<)} }
end

def resolve(link, skill_dir, name)
  target = link.sub(/#.*\z/, "")
  return true if target.empty?
  return File.exist?(File.expand_path(target)) if target.start_with?("~")
  [skill_dir, File.join(INSTALL, name)].any? { |base| File.exist?(File.expand_path(target, base)) }
end

def check(root)
  errors = []
  warnings = []
  in_repo = Dir.children(root).select { |d| File.file?(File.join(root, d, "SKILL.md")) }
  Dir.glob(File.join(root, "*/SKILL.md")).sort.each do |path|
    dir = File.dirname(path)
    folder = File.basename(dir)
    fm, err = frontmatter(path)
    if err
      errors << "#{folder}: invalid frontmatter (#{err})"
      next
    end
    errors << "#{folder}: name '#{fm['name']}' != folder" unless fm["name"] == folder
    errors << "#{folder}: empty description" if fm["description"].to_s.strip.empty?
    (fm.keys - SKILL_KEYS).each { |k| errors << "#{folder}: unknown frontmatter key '#{k}'" }
    Dir.glob(File.join(dir, "*.md")).each do |md|
      links(md).each do |l|
        next if resolve(l, dir, folder)
        first = l.sub(%r{\A\.\./}, "").split("/").first
        local = !l.start_with?("../", "~") || in_repo.include?(first)
        (local ? errors : warnings) << "#{folder}/#{File.basename(md)}: unresolved link #{l}"
      end
    end
  end
  Dir.glob(File.join(root, "agents/*.md")).sort.each do |path|
    rel = path.sub("#{root}/", "")
    fm, err = frontmatter(path)
    next errors << "#{rel}: invalid frontmatter (#{err})" if err
    (fm.keys - AGENT_KEYS).each { |k| errors << "#{rel}: unknown frontmatter key '#{k}'" }
  end
  [errors, warnings]
end

HARNESS_DIRS = {
  "cursor" => %w[~/.cursor/skills ~/.agents/skills ~/.claude/skills ~/.codex/skills ~/.cursor/skills-cursor],
  "claude" => %w[~/.claude/skills],
}.freeze

def visible_skills(harness = "cursor")
  dirs = HARNESS_DIRS.fetch(harness).map { |d| File.expand_path(d) }
  enabled = (JSON.parse(File.read(File.expand_path("~/.claude/settings.json")))["enabledPlugins"] rescue {})
  plugin_globs = enabled.select { |_, v| v }.keys.map do |k|
    plugin, market = k.split("@")
    File.expand_path("~/.claude/plugins/cache/#{market}/#{plugin}/*/skills")
  end
  seen = {}
  (dirs + plugin_globs.flat_map { |g| Dir.glob(g).max_by { |p| File.mtime(p) } }.compact).each do |d|
    Dir.glob(File.join(d, "*/SKILL.md")).each do |p|
      fm, = frontmatter(p)
      next unless fm
      next if fm["disable-model-invocation"] == true
      (seen[fm["name"] || File.basename(File.dirname(p))] ||= []) << [p, fm["description"].to_s]
    end
  end
  seen
end

# Same-name skills dedupe across skill dirs, but each plugin-cache copy is listed alongside them.
def shown(entries)
  local, plugin = entries.partition { |p, _| !p.include?("/plugins/cache/") }
  local.first(1) + plugin
end

def catalog_copies(seen)
  seen.flat_map { |n, v| shown(v).map { |_, d| [n, d] } }
end

def catalog_tokens(seen)
  catalog_copies(seen).sum { |n, d| n.size + d.size + 20 } / 4
end

def budget
  cursor = nil
  HARNESS_DIRS.each_key do |h|
    seen = visible_skills(h)
    rows = catalog_copies(seen)
    dups = seen.select { |_, v| shown(v).size > 1 }.keys.sort
    puts "#{h}: visible=#{rows.size} description_chars=#{rows.sum { |_, d| d.size }} " \
         "tokens_per_turn=#{catalog_tokens(seen)} duplicates=#{dups.join(',')}"
    cursor ||= rows
  end
  long = cursor.select { |_, d| d.size > 250 }
  late = cursor.select { |n, d| n.start_with?("andx-") && !d[0, 90].include?("/#{n}") }.map(&:first).uniq
  puts "cursor descriptions > 250 chars: #{long.size}"
  long.sort_by { |_, d| -d.size }.first(15).each { |n, d| puts "  #{d.size}\t#{n}" }
  puts "andx descriptions without /name in first 90 chars: #{late.sort.join(' ')}"
  puts "visible andx skills: #{cursor.count { |n, _| n.start_with?('andx-') }}"
  cp = Dir.glob(File.expand_path("~/.cursor/plugins/cache/*/*/*/skills*/*/SKILL.md")).group_by { |p| p.split("/plugins/cache/")[1].split("/")[1] }
  puts "cursor plugin cache skills (enable state lives in Cursor Settings > Plugins, not counted above): " +
       cp.map { |k, v| "#{k}=#{v.size}" }.join(" ")
end

# ponytail: chains are hand-maintained; derive from links if they drift from what agents actually read.
CHAINS = {
  "execute" => %w[andx-execute/SKILL.md andx-orchestration/SKILL.md andx-orchestration/HARNESS.md andx-plan/PARSE.md],
  "execute-and-review" => %w[andx-execute-and-review/SKILL.md andx-execute/SKILL.md andx-orchestration/SKILL.md
                             andx-orchestration/HARNESS.md andx-orchestration/SKILL-MAP.md andx-plan/PARSE.md
                             andx-mr-review/FINDINGS-SCHEMA.md andx-security-review/VERIFIER.md],
  "worker" => %w[agents/andx-worker.md andx-execute/WORKER.md],
  "analyst" => %w[agents/andx-analyst.md andx-debug-and-fix/SKILL.md],
  "plan" => %w[andx-plan/SKILL.md andx-plan/PLAN-FORMAT.md andx-plan/PARSE.md andx-orchestration/SKILL-MAP.md],
  "mr-review" => %w[andx-mr-review/SKILL.md andx-mr-review/HOSTS.md andx-mr-review/FINDINGS-SCHEMA.md
                    andx-mr-review/COMMENT-STYLE.md andx-mr-review/REPORT-FORMAT.md andx-mr-review/EXAMPLES.md],
  "mr-babysit" => %w[andx-mr-babysit/SKILL.md andx-mr-review/HOSTS.md],
}

def chain_tokens(root, files)
  files.sum { |f| File.size(File.join(root, f)) } / 4
end

def tokens(root)
  CHAINS.each { |name, files| puts "  #{chain_tokens(root, files)}\t#{name}" }
  puts "catalog tokens per turn (visible skills): #{catalog_tokens(visible_skills)}"
end

# Report only: SKILL.md line counts, clauses repeated across files, unresolved links.
def prose(root)
  mds = Dir.glob(File.join(root, "*/**/*.md")).reject { |p| p.include?("/references/") || p.include?("/templates/") }
  Dir.glob(File.join(root, "*/SKILL.md")).map { |p| [File.foreach(p).count, File.basename(File.dirname(p))] }
     .sort.reverse.each { |n, s| puts "  #{n}\t#{s}" }
  puts "total lines (skill docs, excl. vendored/templates): #{mds.sum { |p| File.foreach(p).count }}"
  clauses = Hash.new { |h, k| h[k] = [] }
  mds.each do |p|
    File.read(p).split(/(?<=[.!?])\s+|\n/).map { |c| c.downcase.gsub(/[^a-z0-9 ]/, " ").squeeze(" ").strip }
        .select { |c| c.split.size >= 8 }.uniq.each { |c| clauses[c] << p.sub("#{root}/", "") }
  end
  dup = clauses.select { |_, f| f.size > 1 }
  puts "duplicated clauses (>= 8 words, in >1 file): #{dup.size}"
  dup.sort_by { |_, f| -f.size }.first(10).each { |c, f| puts "  #{f.size}x #{c[0, 70]} (#{f.first(3).join(', ')})" }
  errors, warnings = check(root)
  puts "unresolved links: #{(errors + warnings).count { |m| m.include?('unresolved link') }}"
end

if $PROGRAM_NAME == __FILE__
  if ARGV.first == "--tokens"
    tokens(File.expand_path("..", __dir__))
  elsif ARGV.first == "--prose"
    prose(File.expand_path("..", __dir__))
  elsif ARGV.first == "--budget"
    budget
  else
    root = File.expand_path(ARGV.first || File.expand_path("..", __dir__))
    errors, warnings = check(root)
    warnings.each { |w| puts "warn: #{w}" }
    errors.each { |e| puts "error: #{e}" }
    puts "check-skills: #{errors.size} errors, #{warnings.size} warnings"
    exit(errors.empty? ? 0 : 1)
  end
end
