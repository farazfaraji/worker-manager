/** Shared research contract. Confidence is 0..1: 0 uncertain, 1 strongly supported. */
export const SOURCE_TYPES = ['official_documentation', 'academic_paper', 'government', 'company', 'news', 'other'] as const;
export type SourceType = typeof SOURCE_TYPES[number];
export type ReviewDecision = 'pass' | 'needs_more_research' | 'revise_findings';
export interface ResearchSource {
  url: string;
  title: string;
  publishedAt: string | null;
  accessedAt: string;
  type: SourceType;
  evidence: string;
  role: 'supports' | 'qualifies' | 'contradicts';
  publisher?: string;
  originalSourceUrl?: string;
}
export interface ResearchFinding {
  id: string;
  claim: string;
  evidence: string;
  sources: ResearchSource[];
  confidence: number;
  limitations: string;
  researchArea: string;
  questionIds: string[];
  contradictsFindingIds?: string[];
}
export interface ResearchQuestion { id: string; question: string }
export interface FieldError { findingIndex: number; findingId?: string; path: string; code: string; message: string }
export interface ValidationResult { valid: boolean; findings: ResearchFinding[]; errors: FieldError[] }
export const DEFAULT_EVIDENCE_LIMIT = 2000;
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
const timestamp = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
const url = (v: unknown) => {
  if (!nonEmpty(v)) return false;
  try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && !!u.hostname; } catch { return false; }
};

export function validateResearchFindings(input: unknown, evidenceLimit = DEFAULT_EVIDENCE_LIMIT): ValidationResult {
  const errors: FieldError[] = [];
  if (!Number.isInteger(evidenceLimit) || evidenceLimit < 1) throw new Error('evidenceLimit must be a positive integer');
  const findings = record(input) ? input.findings : input;
  if (!Array.isArray(findings)) {
    return { valid: false, findings: [], errors: [{ findingIndex: -1, path: 'findings', code: 'required_array', message: 'Expected a findings array' }] };
  }
  const ids = new Set<string>();
  findings.forEach((finding, i) => {
    const f = record(finding) ? finding : {};
    const add = (path: string, code: string, message: string) => errors.push({ findingIndex: i, findingId: nonEmpty(f.id) ? f.id : undefined, path: `findings[${i}].${path}`, code, message });
    if (!nonEmpty(f.id)) add('id', 'required', 'Stable finding ID is required');
    else if (ids.has(f.id)) add('id', 'duplicate', 'Finding ID must be unique');
    else ids.add(f.id);
    for (const field of ['claim', 'evidence', 'researchArea']) if (!nonEmpty(f[field])) add(field, 'required', `${field} is required`);
    if (typeof f.evidence === 'string' && f.evidence.length > evidenceLimit) add('evidence', 'too_long', `Evidence exceeds ${evidenceLimit} characters`);
    if (typeof f.confidence !== 'number' || !Number.isFinite(f.confidence) || f.confidence < 0 || f.confidence > 1) add('confidence', 'invalid', 'Confidence must be a number from 0 to 1');
    if (typeof f.limitations !== 'string') add('limitations', 'required', 'Use an empty string when no limitation is known');
    if (!Array.isArray(f.questionIds) || f.questionIds.some((v: unknown) => !nonEmpty(v))) add('questionIds', 'invalid', 'questionIds must be an array of question IDs');
    if (f.contradictsFindingIds !== undefined && (!Array.isArray(f.contradictsFindingIds) || f.contradictsFindingIds.some((v: unknown) => !nonEmpty(v)))) add('contradictsFindingIds', 'invalid', 'Expected an array of finding IDs');
    if (!Array.isArray(f.sources) || f.sources.length === 0) add('sources', 'missing_provenance', 'At least one source is required');
    else f.sources.forEach((source: unknown, j: number) => {
      const s = record(source) ? source : {};
      const prefix = `sources[${j}]`;
      if (!url(s.url)) add(`${prefix}.url`, 'invalid_url', 'HTTP(S) source URL is required');
      if (!nonEmpty(s.title)) add(`${prefix}.title`, 'required', 'Source title is required; do not invent one');
      if (s.publishedAt !== null && !date(s.publishedAt)) add(`${prefix}.publishedAt`, 'invalid_date', 'Use a publication date or null');
      if (!timestamp(s.accessedAt)) add(`${prefix}.accessedAt`, 'invalid_timestamp', 'Access timestamp is required in ISO 8601 form');
      if (!SOURCE_TYPES.includes(s.type)) add(`${prefix}.type`, 'invalid_source_type', `Use one of: ${SOURCE_TYPES.join(', ')}`);
      if (!nonEmpty(s.evidence)) add(`${prefix}.evidence`, 'required', 'Source-specific evidence is required');
      if (typeof s.evidence === 'string' && s.evidence.length > evidenceLimit) add(`${prefix}.evidence`, 'too_long', `Evidence exceeds ${evidenceLimit} characters`);
      if (!['supports', 'qualifies', 'contradicts'].includes(s.role)) add(`${prefix}.role`, 'invalid', 'Role must be supports, qualifies, or contradicts');
    });
    if (Array.isArray(f.sources) && !f.sources.some((s: any) => s?.role === 'supports')) add('sources', 'unsupported_claim', 'Claim needs at least one supporting source');
  });
  return { valid: errors.length === 0, findings: errors.length ? [] : findings, errors };
}
