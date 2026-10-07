#!/usr/bin/ruby
# Idempotent install/uninstall of andx hooks.
#   Claude ~/.claude/settings.json  Stop -> hooks/andx_continue.rb (Cursor runs it too)
#   Cursor ~/.cursor/hooks.json     preToolUse + beforeMCPExecution -> hooks/deny_worktree_root.rb
# Preserves unknown keys and other hooks; backs up before write; atomic rename.
# Usage: ruby install_hooks.rb install|uninstall [--home DIR]
require "json"
require "fileutils"

ROOT = File.expand_path("..", __dir__)
MARK = "andx-skills/hooks/"
CONTINUE = "/usr/bin/ruby #{ROOT}/hooks/andx_continue.rb"
GUARD = "/usr/bin/ruby #{ROOT}/hooks/deny_worktree_root.rb"

def load(path, default)
  File.exist?(path) ? JSON.parse(File.read(path)) : default
end

def save(path, data)
  FileUtils.mkdir_p(File.dirname(path))
  FileUtils.cp(path, "#{path}.bak-#{Time.now.strftime('%Y%m%d-%H%M%S')}") if File.exist?(path)
  tmp = "#{path}.tmp-#{$$}"
  File.write(tmp, JSON.pretty_generate(data) + "\n")
  JSON.parse(File.read(tmp))
  File.rename(tmp, path)
end

def ours?(cmd)
  cmd.to_s.include?(MARK)
end

def claude(path, install)
  data = load(path, {})
  stop = ((data["hooks"] ||= {})["Stop"] ||= [])
  stop.reject! { |g| Array(g["hooks"]).any? { |h| ours?(h["command"]) } }
  stop << { "hooks" => [{ "type" => "command", "command" => CONTINUE, "timeout" => 10 }] } if install
  save(path, data)
end

def cursor(path, install)
  data = load(path, { "version" => 1, "hooks" => {} })
  hooks = (data["hooks"] ||= {})
  %w[preToolUse beforeMCPExecution].each do |ev|
    list = (hooks[ev] ||= [])
    list.reject! { |h| ours?(h["command"]) }
    list << { "command" => GUARD, "timeout" => 5 } if install
    hooks.delete(ev) if list.empty?
  end
  save(path, data)
end

if $PROGRAM_NAME == __FILE__
  mode = ARGV.shift
  home = ARGV.include?("--home") ? ARGV[ARGV.index("--home") + 1] : Dir.home
  abort "usage: install_hooks.rb install|uninstall [--home DIR]" unless %w[install uninstall].include?(mode)
  claude(File.join(home, ".claude/settings.json"), mode == "install")
  cursor(File.join(home, ".cursor/hooks.json"), mode == "install")
  puts "andx hooks #{mode}ed (#{home})"
end
