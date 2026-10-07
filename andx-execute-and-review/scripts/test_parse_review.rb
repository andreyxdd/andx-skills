require "minitest/autorun"
require_relative "parse_review"

class ParseReviewTest < Minitest::Test
  DIR = File.expand_path("../fixtures/bugbot", __dir__)
  EXPECTED = {
    "xml-no-bugs.txt" => "PASS",
    "xml-high.txt" => "BLOCK",
    "verdict-bold-pass.txt" => "PASS",
    "verdict-heading-block.txt" => "BLOCK",
    "template-echo-table.txt" => "BLOCK",
    "verdict-status-pass.txt" => "PASS",
    "prose-no-bugs.txt" => "PASS",
    "unparsed.txt" => "UNPARSED",
    "table-medium.txt" => "FIX"
  }.freeze

  def test_every_fixture_classifies
    EXPECTED.each do |file, want|
      got = parse(File.read(File.join(DIR, file)), "bugbot")[:status]
      assert_equal want, got, file
    end
  end

  def test_xml_findings_normalized
    f = parse(File.read(File.join(DIR, "xml-high.txt")), "bugbot")[:findings]
    assert_equal({ reviewer: "bugbot", severity: "high", location: "src/provider.ts:42", finding: "Race on provider init" }, f.first)
  end
end
