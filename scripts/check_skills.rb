#!/usr/bin/ruby
# Validate SKILL.md files: YAML frontmatter, name == folder, description present,
# relative links resolve (in-repo broken = error, external companion = warning).
#   ruby check_skills.rb [ROOT]            # default: this repo; exit 1 on errors
#   ruby check_skills.rb --budget          # catalog cost report across installed skill dirs
require "yaml"
require "json"

INSTALL = File.expand_path("~/.cursor/skills")

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
    Dir.glob(File.join(dir, "*.md")).each do |md|
      links(md).each do |l|
        next if resolve(l, dir, folder)
        first = l.sub(%r{\A\.\./}, "").split("/").first
        local = !l.start_with?("../", "~") || in_repo.include?(first)
        (local ? errors : warnings) << "#{folder}/#{File.basename(md)}: unresolved link #{l}"
      end
    end
  end
  [errors, warnings]
end

def visible_skills
  dirs = %w[~/.cursor/skills ~/.cursor/skills-cursor ~/.claude/skills].map { |d| File.expand_path(d) }
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

def budget
  seen = visible_skills
  # Cursor dedupes same-name skills across skill dirs but not across plugin caches.
  rows = seen.map { |n, v| [n, v.first[1], v.map(&:first)] }
  dups = rows.select { |_, _, paths| paths.size > 1 && paths.any? { |p| p.include?("/plugins/cache/") } }
  long = rows.select { |_, d, _| d.size > 250 }
  late = rows.select { |n, d, _| n.start_with?("andx-") && !d[0, 90].include?("/#{n}") }
  puts "visible (model-invocable) skills: #{rows.size}"
  puts "description chars: #{rows.sum { |_, d, _| d.size }}"
  puts "duplicate visible names (plugin vs skill dir): #{dups.map(&:first).sort.join(' ')}"
  puts "descriptions > 250 chars: #{long.size}"
  long.sort_by { |_, d, _| -d.size }.first(15).each { |n, d, _| puts "  #{d.size}\t#{n}" }
  puts "andx descriptions without /name in first 90 chars: #{late.map(&:first).sort.join(' ')}"
  puts "visible andx skills: #{rows.count { |n, _, _| n.start_with?('andx-') }}"
  cp = Dir.glob(File.expand_path("~/.cursor/plugins/cache/*/*/*/skills*/*/SKILL.md")).group_by { |p| p.split("/plugins/cache/")[1].split("/")[1] }
  puts "cursor plugin cache skills (enable state lives in Cursor Settings > Plugins, not counted above): " +
       cp.map { |k, v| "#{k}=#{v.size}" }.join(" ")
end

if $PROGRAM_NAME == __FILE__
  if ARGV.first == "--budget"
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
