require "minitest/autorun"
require "tmpdir"
require "json"
require "fileutils"
require "open3"
require_relative "andx_continue"

class AndxContinueTest < Minitest::Test
  def setup
    @dir = Dir.mktmpdir
    @run = File.join(@dir, ".worktrees/.andx-run")
    FileUtils.mkdir_p(@run)
    @transcript = File.join(@dir, "t.jsonl")
  end

  def teardown
    FileUtils.rm_rf(@dir)
  end

  def ledger(slug, extra = {})
    path = File.join(@run, "#{slug}.json")
    File.write(path, JSON.generate({ "slug" => slug, "mode" => "review", "phase" => "C", "continues" => 0, "terminal" => nil }.merge(extra)))
    path
  end

  def input
    { "cwd" => @dir, "transcript_path" => @transcript }
  end

  def test_non_terminal_ledger_in_transcript_blocks_and_counts
    path = ledger("feat")
    File.write(@transcript, "wrote .worktrees/.andx-run/feat.json")
    out = decide(input)
    assert_equal "block", out["decision"]
    assert_equal 1, JSON.parse(File.read(path))["continues"]
  end

  def test_terminal_allows
    ledger("feat", "terminal" => "DONE")
    File.write(@transcript, ".andx-run/feat.json")
    assert_nil decide(input)
  end

  def test_cap_allows
    ledger("feat", "continues" => 5)
    File.write(@transcript, ".andx-run/feat.json")
    assert_nil decide(input)
  end

  def test_other_conversation_ledger_ignored
    ledger("other")
    File.write(@transcript, "nothing about it")
    assert_nil decide(input)
  end

  def test_missing_transcript_fails_open
    ledger("feat")
    assert_nil decide({ "cwd" => @dir })
  end
end

class DenyWorktreeRootTest < Minitest::Test
  SCRIPT = File.expand_path("deny-worktree-root.sh", __dir__)

  def run_hook(stdin)
    _out, status = Open3.capture2("bash", SCRIPT, stdin_data: stdin)
    status.exitstatus
  end

  def test_worktree_target_denied
    stdin = JSON.generate({ "tool_name" => "CallDynamicTool", "tool_input" => { "toolName" => "move_agent_to_root", "arguments" => { "rootPath" => "/r/.worktrees/exec-x" } } })
    assert_equal 2, run_hook(stdin)
  end

  def test_repo_target_allowed
    stdin = JSON.generate({ "tool_name" => "move_agent_to_root", "tool_input" => "{\"rootPath\":\"/r/app\"}" })
    assert_equal 0, run_hook(stdin)
  end

  def test_malformed_stdin_allowed
    assert_equal 0, run_hook("not json {{")
  end
end
