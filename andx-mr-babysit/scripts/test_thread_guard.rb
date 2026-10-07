require "minitest/autorun"
require_relative "thread_guard"

class ThreadGuardTest < Minitest::Test
  BEFORE = [
    { "id" => "h1", "author" => "alice", "resolved" => false },
    { "id" => "b1", "author" => "cursor[bot]", "resolved" => false },
    { "id" => "b2", "author" => "aikido-security-bot", "resolved" => false },
    { "id" => "h2", "author" => "bob", "resolved" => true }
  ].freeze

  def after(resolved_ids)
    BEFORE.map { |t| t.merge("resolved" => t["resolved"] || resolved_ids.include?(t["id"])) }
  end

  def test_bot_threads_may_be_resolved
    assert_empty violations(BEFORE, after(%w[b1 b2]))
  end

  def test_human_thread_resolution_is_flagged
    assert_equal ["h1"], violations(BEFORE, after(%w[b1 h1]))
  end

  def test_extra_bot_allowlist
    before = [{ "id" => "x", "author" => "renovate", "resolved" => false }]
    resolved = [{ "id" => "x", "author" => "renovate", "resolved" => true }]
    assert_equal ["x"], violations(before, resolved)
    assert_empty violations(before, resolved, BOTS + ["renovate"])
  end
end
