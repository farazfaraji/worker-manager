# Research Quality Reviewer

`research-review` checks the shared research finding contract, question coverage, contradictions, and source provenance. It routes to `pass`, `needs_more_research`, `revise_findings`, or `incomplete_needs_human_review`.

Set `verifySources` to true (the default) to fetch each distinct source URL and compare each source-specific evidence passage with the extracted page text. The reviewer returns `sourceChecks` with a result for every source reference. Unreachable pages, unmatched passages, and sources beyond `maxSources` are reported as weak sources. This is a retrieval check; it does not prove that an interpretation of a passage is correct.

The node exposes `result`, `decision`, `findings`, `questions`, and `sourceChecks` as output handles. Use `result` when a downstream node needs the complete review envelope; use the named outputs to pass one part of the review.

For a research loop, feed the review decision and gaps into the round graph's output. Keep human gates in the parent graph or in a synchronous child graph that can be resumed.
