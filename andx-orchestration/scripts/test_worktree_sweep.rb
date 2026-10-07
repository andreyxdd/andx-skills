require "minitest/autorun"
require "tmpdir"
require "open3"
require "fileutils"

class WorktreeSweepTest < Minitest::Test
  SCRIPT = File.expand_path("worktree-sweep.sh", __dir__)

  def sh(*cmd, dir: @repo)
    out, st = Open3.capture2e(*cmd, chdir: dir)
    assert st.success?, "#{cmd.join(' ')}: #{out}"
    out
  end

  def setup
    @repo = File.realpath(Dir.mktmpdir)
    sh("git", "init", "-q", "-b", "main")
    sh("git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
    %w[merged dirty unmerged].each do |n|
      sh("git", "worktree", "add", "-q", "-b", "andx/exec-#{n}", ".worktrees/exec-#{n}", "main")
    end
    sh("git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "wip", dir: "#{@repo}/.worktrees/exec-unmerged")
    File.write("#{@repo}/.worktrees/exec-dirty/x.txt", "x")
  end

  def teardown
    FileUtils.rm_rf(@repo)
  end

  def test_apply_removes_only_clean_merged
    out = sh("bash", SCRIPT, "--apply", @repo)
    list = sh("git", "worktree", "list")
    refute_includes list, "exec-merged", out
    assert_includes list, "exec-dirty"
    assert_includes list, "exec-unmerged"
    assert_match(/removed=1 kept=2/, out)
  end

  def test_dry_run_removes_nothing
    sh("bash", SCRIPT, @repo)
    assert_includes sh("git", "worktree", "list"), "exec-merged"
  end
end
