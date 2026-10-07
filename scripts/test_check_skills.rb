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
end
