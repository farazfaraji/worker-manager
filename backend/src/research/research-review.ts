import { DEFAULT_EVIDENCE_LIMIT, FieldError, ResearchFinding, ResearchQuestion, ReviewDecision, validateResearchFindings } from './research.contract';

export interface ReviewAssessment {
  unsupportedClaims?: Array<{ findingId: string; reason: string }>;
  weakSources?: Array<{ findingId: string; sourceUrl: string; reason: string }>;
  contradictions?: Array<{ findingIds: [string, string]; sourceUrls: string[]; reason: string }>;
  gaps?: Array<{ questionId: string; reason: string }>;
  revisionRequests?: Array<{ findingId: string; request: string }>;
}
export interface ResearchReview {
  decision: ReviewDecision;
  status: 'complete' | 'incomplete_needs_human_review';
  coverage: Array<{ questionId: string; question: string; status: 'answered' | 'partially_answered' | 'unanswered'; findingIds: string[] }>;
  unsupportedClaims: Array<{ findingId: string; reason: string }>;
  weakSources: Array<{ findingId: string; sourceUrl: string; reason: string }>;
  contradictions: Array<{ findingIds: [string, string]; sourceUrls: string[]; reason: string }>;
  gaps: Array<{ questionId: string; reason: string }>;
  revisionRequests: Array<{ findingId: string; request: string }>;
  validationErrors: FieldError[];
  reviewCycle: number;
  maxReviewCycles: number;
  summary: string;
}
const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const unique = <T>(items: T[]) => [...new Set(items)];

/** Deterministic checks plus explicit reviewer assessments; never mutates supplied evidence. */
export function reviewResearch(input: {
  findings: unknown;
  questions: ResearchQuestion[];
  assessment?: ReviewAssessment;
  reviewCycle?: number;
  maxReviewCycles?: number;
  evidenceLimit?: number;
}): ResearchReview {
  const maxReviewCycles = input.maxReviewCycles ?? 3;
  const reviewCycle = input.reviewCycle ?? 1;
  if (!Number.isInteger(maxReviewCycles) || maxReviewCycles < 1 || !Number.isInteger(reviewCycle) || reviewCycle < 1) throw new Error('Review cycles must be positive integers');
  if (!Array.isArray(input.questions) || input.questions.length === 0 || input.questions.some(q => !obj(q) || typeof q.id !== 'string' || !q.id.trim() || typeof q.question !== 'string' || !q.question.trim()) || new Set(input.questions.map(q => q.id)).size !== input.questions.length) throw new Error('questions must contain unique, nonempty id and question values');
  const result = validateResearchFindings(input.findings, input.evidenceLimit ?? DEFAULT_EVIDENCE_LIMIT);
  const raw = obj(input.findings) ? input.findings.findings : input.findings;
  const findings: ResearchFinding[] = Array.isArray(raw) ? raw.filter(obj) as ResearchFinding[] : [];
  const byId = new Map(findings.filter(f => typeof f.id === 'string').map(f => [f.id, f]));
  const assessment = input.assessment || {};
  const unsupportedClaims = [...(assessment.unsupportedClaims || [])];
  const weakSources = [...(assessment.weakSources || [])];
  const contradictions = [...(assessment.contradictions || [])];
  const gaps = [...(assessment.gaps || [])];
  const revisionRequests = [...(assessment.revisionRequests || [])];
  const questionIds = new Set(input.questions.map(q => q.id));
  for (const issue of [...unsupportedClaims, ...weakSources, ...revisionRequests]) {
    if (!byId.has(issue.findingId)) revisionRequests.push({ findingId: issue.findingId, request: 'Reviewer issue references an unknown finding ID' });
  }
  for (const conflict of contradictions) {
    if (!Array.isArray(conflict.findingIds) || conflict.findingIds.some(id => !byId.has(id))) revisionRequests.push({ findingId: conflict.findingIds?.[0] || '', request: 'Contradiction references an unknown finding ID' });
  }
  for (const gap of gaps) if (!questionIds.has(gap.questionId)) revisionRequests.push({ findingId: '', request: `Gap references unknown question ID ${gap.questionId}` });
  for (const f of findings) {
    if (!f.id) continue;
    for (const questionId of Array.isArray(f.questionIds) ? f.questionIds : []) if (!questionIds.has(questionId)) revisionRequests.push({ findingId: f.id, request: `Finding references unknown question ID ${questionId}` });
    if (!Array.isArray(f.sources) || !f.sources.some(s => s?.role === 'supports')) unsupportedClaims.push({ findingId: f.id, reason: 'No supporting source' });
    for (const source of Array.isArray(f.sources) ? f.sources : []) {
      if (!source || !source.url) continue;
      if (source.role === 'supports' && source.type === 'other') weakSources.push({ findingId: f.id, sourceUrl: source.url, reason: 'Source category is unspecified; verify publisher and original evidence' });
      if (source.role === 'supports' && source.originalSourceUrl && source.originalSourceUrl !== source.url) weakSources.push({ findingId: f.id, sourceUrl: source.url, reason: 'Secondary source; check original source for this claim' });
      if (source.role === 'contradicts') contradictions.push({ findingIds: [f.id, f.id], sourceUrls: [source.url], reason: 'Source evidence conflicts with this finding' });
    }
    for (const otherId of f.contradictsFindingIds || []) {
      const other = byId.get(otherId);
      if (other) contradictions.push({ findingIds: [f.id, otherId], sourceUrls: unique([...(f.sources || []), ...(other.sources || [])].map(s => s.url).filter(Boolean)), reason: 'Researcher identified conflicting findings' });
      else revisionRequests.push({ findingId: f.id, request: `Resolve unknown conflicting finding ID ${otherId}` });
    }
  }
  for (const error of result.errors) if (error.findingId) revisionRequests.push({ findingId: error.findingId, request: `${error.path}: ${error.message}` });
  const coverage = input.questions.map(q => {
    const matching = findings.filter(f => Array.isArray(f.questionIds) && f.questionIds.includes(q.id));
    const supported = matching.filter(f => Array.isArray(f.sources) && f.sources.some(s => s?.role === 'supports') && !result.errors.some(e => e.findingId === f.id));
    const status = !matching.length ? 'unanswered' : !supported.length || supported.every(f => f.confidence < 0.6 || !!f.limitations) ? 'partially_answered' : 'answered';
    if (status !== 'answered') gaps.push({ questionId: q.id, reason: status === 'unanswered' ? 'No finding addresses this question' : 'Evidence is incomplete, low confidence, or qualified' });
    return { questionId: q.id, question: q.question, status, findingIds: matching.map(f => f.id) } as const;
  });
  const hasRevision = result.errors.length > 0 || unsupportedClaims.length > 0 || revisionRequests.length > 0;
  const needsResearch = gaps.length > 0 || contradictions.length > 0 || weakSources.length > 0;
  const decision: ReviewDecision = hasRevision ? 'revise_findings' : needsResearch ? 'needs_more_research' : 'pass';
  const status = decision !== 'pass' && reviewCycle >= maxReviewCycles ? 'incomplete_needs_human_review' : 'complete';
  return {
    decision, status, coverage, unsupportedClaims, weakSources, contradictions, gaps, revisionRequests,
    validationErrors: result.errors, reviewCycle, maxReviewCycles,
    summary: status === 'incomplete_needs_human_review' ? `Review limit of ${maxReviewCycles} reached; human review required.` : decision === 'pass' ? 'Questions are covered with traceable evidence.' : decision === 'revise_findings' ? 'Findings require evidence or schema corrections.' : 'More research is needed to resolve gaps or source concerns.',
  };
}

export interface ResearchConclusion { text: string; findingIds: string[]; label?: 'supported' | 'estimate' | 'assumption' | 'unresolved' | 'low_confidence' }
export function buildResearchReport(findings: ResearchFinding[], conclusions: ResearchConclusion[]) {
  const validation = validateResearchFindings(findings);
  if (!validation.valid) throw new Error(`Research report requires valid findings: ${validation.errors.map(e => e.path).join(', ')}`);
  const byId = new Map(findings.map(f => [f.id, f]));
  return { conclusions: conclusions.map(c => {
    const supporting = c.findingIds.map(id => byId.get(id));
    if (supporting.some(f => !f)) throw new Error(`Conclusion references an unknown finding ID: ${c.findingIds.filter(id => !byId.has(id)).join(', ')}`);
    const low = supporting.some(f => f!.confidence < 0.6);
    const conflict = supporting.some(f => (f!.contradictsFindingIds || []).length || f!.sources.some(s => s.role === 'contradicts'));
    return { ...c, label: c.label || (conflict ? 'unresolved' : low ? 'low_confidence' : 'supported'), sources: unique(supporting.flatMap(f => f!.sources.map(s => ({ url: s.url, title: s.title, originalSourceUrl: s.originalSourceUrl || s.url }))).map(s => JSON.stringify(s))).map(s => JSON.parse(s)) };
  }), findings };
}
