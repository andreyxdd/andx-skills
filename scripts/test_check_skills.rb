require "minitest/autorun"
require_relative "check_skills"

class CheckSkillsTest < Minitest::Test
  F = File.expand_path("fixtures/check-skills", __dir__)

  def errors(name)
    check(File.join(F, name)).first
  end

  def test_valid_passes
    assert_empty errors("valid")
  end

  def test_bad_yaml_fails
    assert_match(/invalid frontmatter/, errors("bad-yaml").join)
  end

  def test_wrong_name_fails
    assert_match(/!= folder/, errors("wrong-name").join)
  end

  def test_broken_local_link_fails
    assert_match(/MISSING\.md/, errors("broken-link").join)
  end

  def test_unknown_frontmatter_keys_fail_cli
    out = `ruby #{File.expand_path('check_skills.rb', __dir__)} #{File.join(F, 'unknown-key')}`
    refute $?.success?
    assert_match(/error: demo: unknown frontmatter key 'bogus'/, out)
    assert_match(/error: agents\/demo-agent\.md: unknown frontmatter key 'colour'/, out)
    refute_match(/'color'/, out)
  end

def test_hot_read_chains_stay_in_budget
  root = File.expand_path("..", __dir__)
  { "worker" => 1_200, "execute" => 6_000, "execute-and-review" => 11_000 }.each do |name, max|
    assert_operator chain_tokens(root, CHAINS[name]), :<=, max, "#{name} read chain over budget"
  end
end

  def fake_home(d)
    {
      ".cursor/skills/alpha" => "aaaa", ".agents/skills/beta" => "bb", ".claude/skills/dup" => "cccccc",
      ".claude/plugins/cache/mkt/dup/1.0/skills/dup" => "cc",
      ".claude/plugins/cache/m/off/1.0/skills/offskill" => "zz",
    }.each do |dir, desc|
      FileUtils.mkdir_p(File.join(d, dir))
      File.write(File.join(d, dir, "SKILL.md"), "---\nname: #{File.basename(dir)}\ndescription: #{desc}\n---\n")
    end
    FileUtils.mkdir_p(File.join(d, ".codex/skills/hidden"))
    File.write(File.join(d, ".codex/skills/hidden/SKILL.md"),
               "---\nname: hidden\ndescription: h\ndisable-model-invocation: true\n---\n")
    File.write(File.join(d, ".claude/settings.json"), '{"enabledPlugins":{"dup@mkt":true,"off@m":false}}')
  end

  def test_budget_reports_each_harness_separately
    require "tmpdir"
    require "fileutils"
    out = Dir.mktmpdir do |d|
      fake_home(d)
      `HOME=#{d} ruby #{File.expand_path('check_skills.rb', __dir__)} --budget`
    end
    assert_match(/^cursor: visible=4 description_chars=14 tokens_per_turn=27 duplicates=dup$/, out)
    assert_match(/^claude: visible=2 description_chars=8 tokens_per_turn=13 duplicates=dup$/, out)
  end

  def test_install_companions_adds_frontmatter_paths_once
    require "tmpdir"
    script = File.expand_path("../install-companions.sh", __dir__)
    Dir.mktmpdir do |d|
      skill = File.join(d, "rbp.md")
      File.write(skill, "---\nname: react-best-practices\ndescription: x\n---\n# body\npaths: in body\n")
      out = `HOME=#{d} bash -c 'source #{script} && add_react_paths #{skill} && add_react_paths #{skill}'`
      assert $?.success?, out
      assert_equal "---\nname: react-best-practices\ndescription: x\npaths: \"**/*.tsx, **/*.jsx\"\n---\n# body\npaths: in body\n",
                   File.read(skill)
    end
  end

  def test_prose_reports_cross_file_duplicate
    require "tmpdir"
    out = Dir.mktmpdir do |d|
      clause = "Run the full regression suite on the target branch after merging."
      %w[a b].each do |s|
        Dir.mkdir(File.join(d, s))
        File.write(File.join(d, s, "SKILL.md"), "---\nname: #{s}\ndescription: x\n---\n#{clause}\n")
      end
      capture_io { prose(d) }.first
    end
    assert_match(/duplicated clauses .*: 1/, out)
    assert_match(/unresolved links: 0/, out)
  end
end
