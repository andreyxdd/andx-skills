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

def test_hot_read_chains_stay_in_budget
  root = File.expand_path("..", __dir__)
  { "worker" => 1_200, "execute" => 6_000, "execute-and-review" => 11_000 }.each do |name, max|
    assert_operator chain_tokens(root, CHAINS[name]), :<=, max, "#{name} read chain over budget"
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
