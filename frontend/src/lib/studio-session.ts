export const ACTIVE_PROJECT_KEY = 'flow_builder_active_project_id';

const RETURN_FLOW_KEY = 'flow_builder_return_flow_id';
const DRAFT_KEY = 'flow_builder_studio_draft';

export interface StudioDraft {
  graphId: string | null;
  graphName: string;
  nodes: any[];
  edges: any[];
  isDirty: boolean;
}

export function readActiveProjectId(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(ACTIVE_PROJECT_KEY) || '';
}

export function writeActiveProjectId(projectId: string) {
  if (typeof window === 'undefined' || !projectId) return;
  localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
}

export function rememberFlow(graphId: string | null) {
  if (typeof window === 'undefined') return;
  if (graphId) sessionStorage.setItem(RETURN_FLOW_KEY, graphId);
  else sessionStorage.removeItem(RETURN_FLOW_KEY);
}

export function getBoardHref(): string {
  if (typeof window === 'undefined') return '/';
  const id = sessionStorage.getItem(RETURN_FLOW_KEY);
  return id ? `/flow/${encodeURIComponent(id)}` : '/';
}

export function readStudioDraft(): StudioDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StudioDraft;
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStudioDraft(draft: StudioDraft) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // A very large board can exceed the session quota. Navigation still keeps the flow id.
  }
}

export function clearStudioDraft() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(DRAFT_KEY);
}

export function persistStudioSession(snapshot: StudioDraft) {
  rememberFlow(snapshot.graphId);
  if (snapshot.isDirty) {
    writeStudioDraft(snapshot);
    return;
  }
  const existing = readStudioDraft();
  if (!existing || existing.graphId === snapshot.graphId) {
    clearStudioDraft();
  }
}
