require "minitest/autorun"
require "open3"

class SpendReportTest < Minitest::Test
  SCRIPT = File.expand_path("spend_report.rb", __dir__)
  PROJ = File.expand_path("fixtures/spend/secret-proj", __dir__)

  def run_script(*args)
    out, status = Open3.capture2e("ruby", SCRIPT, *args)
    assert status.success?, out
    out
  end

  def test_single_run_counts_parent_and_both_subagent_layouts
    out = run_script(File.join(PROJ, "s1.jsonl"))
    assert_match(/^run s1$/, out)
    assert_match(/requests parent=2 subagent=2$/, out)
    assert_match(/input parent=2415 subagent=803 total=3218$/, out)
    assert_match(/output parent=70 subagent=15$/, out)
    assert_match(/peak_context parent=1305 subagent=501$/, out)
    assert_match(/image_results 1$/, out)
    assert_match(/top_tool_output Read=100 Bash=20 Grep=10$/, out)
  end

  def test_dir_lists_only_andx_runs
    out = run_script(PROJ)
    assert_equal %w[s1 s2 s4], out.scan(/^run (\S+)$/).flatten.sort
  end

  def test_summary_prints_medians_totals_and_no_project_names
    out = run_script("--summary", File.dirname(PROJ))
    assert_match(/^runs 3$/, out)
    assert_match(/^median .*input_total=3218\b/, out)
    assert_match(/^median .*requests_parent=1\b/, out)
    assert_match(/^total .*input_total=9218\b/, out)
    refute_match(/secret-proj/, out)
    refute_match(/\bs[1-5]\b/, out)
  end

  def test_summary_prints_medians_per_first_invoked_skill
    out = run_script("--summary", File.dirname(PROJ))
    assert_match(/^andx-execute runs=1 median input_total=3218 output=85$/, out)
    assert_match(/^andx-plan runs=2 median input_total=3000 output=1$/, out)
  end

  def test_unreadable_transcript_is_skipped_without_naming_it
    %w[--summary list].each do |mode|
      out = mode == "list" ? run_script(PROJ) : run_script("--summary", File.dirname(PROJ))
      assert_match(/^skipped 1 unreadable files$/, out)
      refute_match(/secret-proj|missing-target/, out)
    end
  end
end
