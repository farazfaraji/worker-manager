import type { MemoryService } from '../../blocks/memory.service';
import type { EmbeddingService } from '../../blocks/embedding.service';
import type { VectorStoreService } from '../../blocks/vector-store.service';
import type { AgentToolDefinition } from './agent-tool-registry.service';
import { redactSecrets } from './redaction.util';

/**
 * Per-run memory tools for the Agent node ("memory as a tool"):
 *   - search_memory:   semantic search over embedded artifacts + keyword recall over key/value memories
 *   - remember_memory: save a durable fact to the key/value memory store (optional)
 */

export const MEMORY_TOOL_NAMES = ['search_memory', 'remember_memory'];

export type MemorySourceSetting = 'all' | 'artifacts' | 'memories';

/** How the Agent node uses project memory. */
export type AgentMemoryMode = 'off' | 'agent' | 'required';

export interface MemorySearchResult {
  query: string;
  resultsCount: number;
  results: MemoryHit[];
  retrieval: Record<string, string>;
  filteredBy?: string | null;
  notes?: string[];
  hint?: string;
}

export interface MemoryHit {
  id: string;
  source: 'artifact' | 'memory';
  title: string | null;
  text: string;
  score: number;
  retrieval: 'vector' | 'keyword';
  updatedAt?: string | null;
  version?: number;
  key?: string;
}

export interface MemoryToolOptions {
  sources: MemorySourceSetting;
  embeddingModel: string;
  minScore: number;
  maxResults: number;
  namespace: string;
  projectId: string;
  allowWrite: boolean;
  maxWritesPerRun: number;
  nodeId: string;
  runId?: string;
}

export interface MemoryToolDeps {
  memory?: MemoryService;
  embeddings?: EmbeddingService;
  vectors?: VectorStoreService;
  /** Optional relevance filter (LLM judge). Returns the hits to keep. */
  filter?: (query: string, hits: MemoryHit[]) => Promise<{ hits: MemoryHit[]; filteredBy: string; error?: string }>;
}

const MAX_SNIPPET_CHARS = 1200;
const MAX_MEMORY_VALUE_CHARS = 4000;
const CANDIDATE_POOL = 20;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}... [truncated]` : text;
}

function stringifyValue(value: any): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toIso(value: any): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Rejects values that look like personal or payment data (emails, IBANs, card numbers).
 * Heuristic guard only; memory must never be used to store merchant/customer personal data.
 */
export function detectPersonalData(text: string): string | null {
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return 'an email address';
  if (/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/.test(text)) return 'an IBAN';
  const cardCandidates: string[] = text.match(/\b(?:\d[ -]?){13,19}\b/g) || [];
  if (cardCandidates.some((c) => luhnValid(c.replace(/\D/g, '')))) return 'a payment card number';
  return null;
}

function sanitizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function searchArtifacts(
  deps: MemoryToolDeps,
  opts: MemoryToolOptions,
  query: string,
): Promise<{ hits: MemoryHit[]; method: 'vector' | 'keyword' | 'unavailable'; note?: string }> {
  if (!deps.vectors) return { hits: [], method: 'unavailable', note: 'Artifact index is not available in this runtime.' };

  let embedding: number[] | undefined;
  let note: string | undefined;
  if (deps.embeddings) {
    try {
      embedding = await deps.embeddings.embed(query, opts.embeddingModel ? { embeddingModel: opts.embeddingModel } : {});
    } catch (err: any) {
      note = `Semantic search unavailable (${err?.message || err}); used keyword search instead.`;
    }
  }

  const toHit = (r: any, score: number, retrieval: 'vector' | 'keyword'): MemoryHit => ({
    id: `artifact:${r.vectorId || `${r.artifactId}:${r.chunkId}`}`,
    source: 'artifact',
    title: r.metadata?.title || null,
    text: truncate(String(r.text || ''), MAX_SNIPPET_CHARS),
    score: Math.round(score * 1000) / 1000,
    retrieval,
    updatedAt: toIso(r.updatedAt),
    version: r.version,
  });

  if (embedding?.length) {
    const results = await deps.vectors.search({ embedding, projectId: opts.projectId, limit: CANDIDATE_POOL });
    const hits = results.filter((r: any) => Number(r.score) >= opts.minScore).map((r: any) => toHit(r, Number(r.score), 'vector'));
    if (!hits.length && results.length && results.every((r: any) => Number(r.score) === 0)) {
      note = 'All artifact similarity scores were 0: the selected embedding model probably differs from the one used to index the artifacts.';
    }
    return { hits, method: 'vector', note };
  }

  const keywords = query.split(/\s+/).filter((w) => w.length > 2).slice(0, 8);
  if (!keywords.length) return { hits: [], method: 'keyword', note };
  const results = await deps.vectors.search({ keywords, projectId: opts.projectId, limit: CANDIDATE_POOL });
  const hits = results.map((r: any) => {
    const lower = String(r.text || '').toLowerCase();
    const matched = keywords.filter((k) => lower.includes(k.toLowerCase())).length;
    return toHit(r, matched / keywords.length, 'keyword');
  });
  return { hits, method: 'keyword', note };
}

export function resolveAgentMemoryMode(config: Record<string, any>): AgentMemoryMode {
  const raw = config.memoryMode;
  if (raw === 'off' || raw === 'agent' || raw === 'required') return raw;
  if (config.enableMemory === true) return 'agent';
  return 'off';
}

export function formatPreloadedMemoryBlock(result: MemorySearchResult): string {
  if (!result.results?.length) {
    return (
      'PRELOADED MEMORY: No matching entries were found for the required memory search. ' +
      'If the task still needs project context, say what is missing rather than inventing facts.'
    );
  }
  const lines = result.results.map((h) => {
    const when = h.updatedAt ? `, ${h.updatedAt.slice(0, 10)}` : '';
    const title = h.title ? `${h.title}: ` : '';
    return `- [${h.id}] (${h.source}${when}) ${title}${h.text}`;
  });
  const notes = result.notes?.length ? `\nNotes: ${result.notes.join(' ')}` : '';
  const filter = result.filteredBy ? `\n(Relevance filter: ${result.filteredBy})` : '';
  return `PRELOADED MEMORY (required — ground your answer in these entries and cite their ids):\n${lines.join('\n')}${filter}${notes}`;
}

export async function executeMemorySearch(
  deps: MemoryToolDeps,
  opts: MemoryToolOptions,
  args: { query: string; limit?: number; source?: 'all' | MemorySourceSetting },
): Promise<MemorySearchResult> {
  const allowedSources: Array<'artifacts' | 'memories'> =
    opts.sources === 'artifacts' ? ['artifacts'] : opts.sources === 'memories' ? ['memories'] : ['artifacts', 'memories'];
  const query = String(args.query || '').trim();
  const limit = Math.min(10, Math.max(1, Number(args.limit) || opts.maxResults));
  const source: 'all' | 'artifacts' | 'memories' =
    args.source === 'all' || !args.source
      ? 'all'
      : allowedSources.includes(args.source as 'artifacts' | 'memories')
        ? (args.source as 'artifacts' | 'memories')
        : 'all';
  const sources = source === 'all' ? allowedSources : [source];

  const notes: string[] = [];
  let hits: MemoryHit[] = [];
  let artifactMethod: string | undefined;

  if (sources.includes('artifacts')) {
    const res = await searchArtifacts(deps, opts, query);
    artifactMethod = res.method;
    if (res.note) notes.push(res.note);
    hits.push(...res.hits);
  }
  if (sources.includes('memories')) {
    hits.push(...(await searchMemories(deps, opts, query)));
  }

  hits.sort((a, b) => b.score - a.score);
  let filteredBy: string | null = null;
  if (deps.filter && hits.length) {
    const filtered = await deps.filter(query, hits.slice(0, CANDIDATE_POOL));
    if (filtered.error) notes.push(`Relevance filter failed (${filtered.error}); results are unfiltered.`);
    else filteredBy = filtered.filteredBy;
    hits = filtered.hits;
  }
  hits = hits.slice(0, limit);

  return {
    query,
    resultsCount: hits.length,
    results: hits,
    retrieval: {
      ...(artifactMethod ? { artifacts: artifactMethod } : {}),
      ...(sources.includes('memories') ? { memories: deps.memory ? 'keyword' : 'unavailable' } : {}),
    },
    filteredBy,
    ...(notes.length ? { notes } : {}),
    ...(hits.length ? {} : { hint: 'Nothing relevant found. Try different keywords, or continue without memory.' }),
  };
}

async function searchMemories(deps: MemoryToolDeps, opts: MemoryToolOptions, query: string): Promise<MemoryHit[]> {
  if (!deps.memory) return [];
  // recall() ranks by importance before keyword matching, so ask for a wide pool and trim afterwards
  const records = await deps.memory.recall({ namespace: opts.namespace, projectId: opts.projectId, query, limit: 200 });
  return records.slice(0, CANDIDATE_POOL).map((r: any) => ({
    id: `memory:${r.key}`,
    source: 'memory' as const,
    title: r.key,
    key: r.key,
    text: truncate(stringifyValue(r.value), MAX_SNIPPET_CHARS),
    score: Math.round(Number(r.relevance ?? 1) * 1000) / 1000,
    retrieval: 'keyword' as const,
    updatedAt: toIso(r.updatedAt),
  }));
}

export function createMemoryTools(deps: MemoryToolDeps, opts: MemoryToolOptions): AgentToolDefinition[] {
  const allowedSources: Array<'artifacts' | 'memories'> =
    opts.sources === 'artifacts' ? ['artifacts'] : opts.sources === 'memories' ? ['memories'] : ['artifacts', 'memories'];
  let writes = 0;

  const searchTool: AgentToolDefinition = {
    name: 'search_memory',
    description:
      'Search the project memory: saved artifacts (documents, reports, previous results) and remembered facts. ' +
      'Use it when the task may depend on earlier work, decisions, or project knowledge. Results include ids and dates; prefer newer entries and cite ids you rely on.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you need to know, as a specific natural-language question or keywords.' },
        limit: { type: 'number', description: `Maximum results (1-10, default ${opts.maxResults}).` },
        source: {
          type: 'string',
          enum: ['all', ...allowedSources],
          description: 'Where to search: "artifacts" (saved documents), "memories" (remembered facts) or "all".',
        },
      },
      required: ['query'],
    },
    validateArgs: (args) => {
      const query = typeof args?.query === 'string' ? args.query.trim() : '';
      if (!query) return { isValid: false, error: 'Missing required argument "query".' };
      let limit = Number(args.limit);
      if (!Number.isFinite(limit) || limit < 1) limit = opts.maxResults;
      const source = allowedSources.includes(args.source) ? args.source : 'all';
      return { isValid: true, cleanArgs: { query: query.slice(0, 500), limit: Math.min(10, Math.floor(limit)), source } };
    },
    execute: async (args) =>
      executeMemorySearch(deps, opts, {
        query: args.query,
        limit: args.limit,
        source: args.source,
      }),
    summarizeResult: (res) =>
      `Found ${res?.resultsCount ?? 0} memory result(s) for "${res?.query}"${res?.filteredBy ? ` (filtered by ${res.filteredBy})` : ''}`,
  };

  if (!opts.allowWrite) return [searchTool];

  const rememberTool: AgentToolDefinition = {
    name: 'remember_memory',
    description:
      'Save a durable, reusable fact or decision to project memory so future runs can find it with search_memory. ' +
      'Save only stable, non-personal information (no names, contact details, payment data or secrets). Re-using a key overwrites that memory.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short unique slug, e.g. "pricing-page-launch-date".' },
        value: { type: 'string', description: `The fact to remember, self-contained (max ${MAX_MEMORY_VALUE_CHARS} chars).` },
        importance: { type: 'number', description: 'How important this is for future runs (0-10, default 5).' },
      },
      required: ['key', 'value'],
    },
    validateArgs: (args) => {
      const key = sanitizeKey(typeof args?.key === 'string' ? args.key : '');
      const value = typeof args?.value === 'string' ? args.value.trim() : '';
      if (!key) return { isValid: false, error: 'Missing or invalid "key" (use a short slug like "release-date").' };
      if (!value) return { isValid: false, error: 'Missing required argument "value".' };
      if (value.length > MAX_MEMORY_VALUE_CHARS) {
        return { isValid: false, error: `"value" is too long (${value.length} chars, max ${MAX_MEMORY_VALUE_CHARS}). Summarize it.` };
      }
      const personal = detectPersonalData(value);
      if (personal) {
        return { isValid: false, error: `Refused: the value appears to contain ${personal}. Personal or payment data must not be stored in memory.` };
      }
      let importance = Number(args.importance);
      if (!Number.isFinite(importance)) importance = 5;
      return { isValid: true, cleanArgs: { key, value, importance: Math.min(10, Math.max(0, importance)) } };
    },
    execute: async (args) => {
      if (!deps.memory) throw new Error('Memory store is not available in this runtime.');
      if (writes >= opts.maxWritesPerRun) {
        throw new Error(`Write limit reached (${opts.maxWritesPerRun} memories per run).`);
      }
      writes++;
      // Agent-written keys are prefixed so an agent can never overwrite memories saved by people or flows
      const key = `agent:${args.key}`;
      await deps.memory.remember({
        projectId: opts.projectId,
        namespace: opts.namespace,
        key,
        kind: 'knowledge',
        value: redactSecrets(args.value),
        importance: args.importance,
        metadata: { source: 'agent', nodeId: opts.nodeId, ...(opts.runId ? { runId: opts.runId } : {}), savedAt: new Date().toISOString() },
      });
      return { saved: true, key, namespace: opts.namespace };
    },
    summarizeResult: (res) => `Saved memory "${res?.key}"`,
  };

  return [searchTool, rememberTool];
}
