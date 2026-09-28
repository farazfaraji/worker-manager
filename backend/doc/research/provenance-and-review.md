# Research provenance and quality review

## Finding contract

Research Agents should return a JSON object with `findings: ResearchFinding[]` and enable **Validate Research Findings** on the Agent node. This is an opt-in runtime check because ordinary Agent JSON outputs use other shapes. The Agent's `outputType` prompt is advisory; enabling the checkbox applies actual validation. Invalid outputs fail the node with `INVALID_RESEARCH_FINDINGS` and field paths such as `findings[2].sources[0].url`. The validator returns no valid findings when any finding is invalid. It never fills missing metadata or rewrites evidence.

Each finding requires `id` (stable and unique within the result), `claim`, `evidence`, `sources` (at least one), `confidence`, `limitations` (empty string when none known), `researchArea`, and `questionIds` (IDs from the research plan; can be empty). Optional `contradictsFindingIds` names other finding IDs. Each source requires `url` (HTTP or HTTPS), `title`, `publishedAt` (a date or `null`), `accessedAt` (ISO 8601 timestamp), `type`, `evidence` (source-specific excerpt, data, or faithful summary), and `role` (`supports`, `qualifies`, or `contradicts`). `publisher` and `originalSourceUrl` are optional source metadata. Keep tool-provided URLs, titles, dates, and evidence intact. Do not manufacture missing titles, publication dates, quotes, or excerpts. A finding needs at least one `supports` source; qualifying and conflicting sources can be included as well.

Source types: `official_documentation`, `academic_paper`, `government`, `company`, `news`, `other`. Confidence is a number from 0 to 1: 0 means very uncertain, 0.5 means tentative, and 1 means strongly supported by checked evidence. It is an assessment, never a substitute for checking a source. Repetitions of the same original source do not increase confidence independently.

```json
{
  "findings": [
    {
      "id": "market-size-2026-01",
      "claim": "The agency reported 42 registered providers in 2026.",
      "evidence": "The agency's 2026 register lists 42 providers.",
      "sources": [
        {
          "url": "https://example.org/2026-register",
          "title": "2026 provider register",
          "publishedAt": "2026-09-01",
          "accessedAt": "2026-09-25T10:00:00Z",
          "type": "government",
          "evidence": "The register's total row shows 42 providers.",
          "role": "supports",
          "publisher": "Example Agency"
        }
      ],
      "confidence": 0.85,
      "limitations": "The register may exclude providers that have not filed.",
      "researchArea": "market",
      "questionIds": ["q-provider-count"]
    }
  ]
}
```

The default maximum length is 2,000 characters for both finding-level and source-level evidence. Set `evidenceLimit` to another positive integer on the Agent and reviewer when needed. Validation reports missing claims/evidence, malformed URLs and dates, missing timestamps, invalid source types/roles, confidence outside 0..1, duplicate IDs, missing sources, no supporting source, and overlong evidence. A malformed Agent JSON result is rejected by research validation rather than converted into a successful research result.

## Review contract and source rubric

Connect the Agent's `findings` output and planner's `{id, question}[]` to the **Research Quality Reviewer** node. It evaluates field validation, plan coverage, explicit conflicts, and source concerns. `assessment` is optional structured reviewer input: `unsupportedClaims` (`findingId`, `reason`), `weakSources` (`findingId`, `sourceUrl`, `reason`), `contradictions` (`findingIds`, `sourceUrls`, `reason`), `gaps` (`questionId`, `reason`), and `revisionRequests` (`findingId`, `request`). These are reviewer judgments, not evidence. They should cite existing IDs and explain the concern. Semantic contradictions that are not explicitly marked in findings or assessment require a human or model reviewer to add an assessment; the deterministic node does not infer them from prose.

Evaluate each source in relation to the specific claim: Is it primary or secondary? Is it the official or original record? Is its publication or update date suitable for changing information? Is the author or publisher competent on this subject? Does the cited passage directly support the claim? Is promotional bias or a conflict of interest present? Do independent original sources corroborate an important claim? Company and news sources remain usable; explain any weakness in `weakSources` rather than rejecting them by category. The reviewer flags `other` and sources that point to a different original URL for closer inspection. Claims with only qualifying or contradicting sources are unsupported.

The result contains `decision`, `status`, `coverage` (`questionId`, `question`, `status`, `findingIds`), `unsupportedClaims`, `weakSources`, `contradictions`, `gaps`, `revisionRequests`, `validationErrors`, `reviewCycle`, `maxReviewCycles`, and `summary`. Coverage statuses are `answered`, `partially_answered`, and `unanswered`. A low-confidence or limited finding makes coverage partial. Validation and unsupported claims take precedence (`revise_findings`); gaps, weak sources, or contradictions yield `needs_more_research`; otherwise the decision is `pass`. A review result records concerns but does not alter findings.

```json
{
  "decision": "needs_more_research",
  "status": "complete",
  "coverage": [
    { "questionId": "q-provider-count", "question": "How many providers are registered?", "status": "answered", "findingIds": ["market-size-2026-01"] },
    { "questionId": "q-growth", "question": "How fast is the market growing?", "status": "unanswered", "findingIds": [] }
  ],
  "unsupportedClaims": [],
  "weakSources": [],
  "contradictions": [],
  "gaps": [{ "questionId": "q-growth", "reason": "No finding addresses this question" }],
  "revisionRequests": [],
  "validationErrors": [],
  "reviewCycle": 1,
  "maxReviewCycles": 3,
  "summary": "More research is needed to resolve gaps or source concerns."
}
```

## Workflow routing and reports

The reviewer has four branch handles. `pass` goes to synthesis. `needs_more_research` goes to the planner with gaps, unanswered questions, and conflicts. `revise_findings` goes to the responsible researcher with validation and revision requests. `incomplete_needs_human_review` goes to a human review or incomplete-result path. On the maximum unsuccessful review cycle, the latter branch wins even though `decision` retains the reason (`needs_more_research` or `revise_findings`). The default maximum is 3. The node tracks its cycle count in run context by node ID so a fixed form value cannot reset it on every graph traversal. The graph runner also has a general step ceiling; that is a separate safety limit. The existing `loop` block maps over items and does not implement this research cycle.

For reports, use `buildResearchReport(findings, conclusions)` from `src/research/research-review.ts`, or preserve the same shape in an Agent prompt: each conclusion has `findingIds`, a label (`supported`, `estimate`, `assumption`, `unresolved`, `low_confidence`), and the supporting source URLs and titles. The helper rejects unknown finding IDs and labels conclusions based on low confidence or explicit conflicts. It retains the original findings and source metadata. An assumption or estimate should be labelled by the synthesizer; a claim repeated by agents that cite one original source is still one line of provenance.
