import { Project, GraphSummary, GraphData, NodeDefinition, RunResult, ArtifactItem, ArtifactRelationItem, NodeCacheItem } from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:6300/api';

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${API_BASE}/projects`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch projects: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchProjectById(id: string): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects/${id}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch project with id ${id}: ${res.statusText}`);
  }
  return res.json();
}

export async function createProject(data: {
  name: string;
  description?: string;
  color?: string;
  metadata?: any;
}): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      formatApiError(errorData, `Failed to create project: ${res.statusText}`),
    );
  }
  return res.json();
}

export async function updateProject(
  id: string,
  data: Partial<Project>,
): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      formatApiError(errorData, `Failed to update project: ${res.statusText}`),
    );
  }
  return res.json();
}

export async function deleteProject(
  id: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/projects/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      formatApiError(errorData, `Failed to delete project: ${res.statusText}`),
    );
  }
  return res.json();
}

export async function fetchNodeDefinitions(): Promise<NodeDefinition[]> {
  const res = await fetch(`${API_BASE}/node-definitions`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch node definitions: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchAgents(): Promise<any[]> {
  try {
    const res = await fetch(`${API_BASE}/agents`, { cache: 'no-store' });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fetchGraphs(projectId?: string): Promise<GraphSummary[]> {
  const url = projectId
    ? `${API_BASE}/graphs?projectId=${encodeURIComponent(projectId)}`
    : `${API_BASE}/graphs`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch graphs: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchGraphById(id: string): Promise<GraphData> {
  const res = await fetch(`${API_BASE}/graphs/${id}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch graph with id ${id}: ${res.statusText}`);
  }
  return res.json();
}

/** Structured API error — carries raw backend error payload alongside the formatted message */
export class ApiError extends Error {
  public readonly data: any;
  constructor(message: string, data: any) {
    super(message);
    this.name = 'ApiError';
    this.data = data;
  }
}

function formatApiError(errorData: any, fallback: string): string {
  if (!errorData) return fallback;

  // Edge / handle validation errors — show full from→to context
  if (errorData?.reason) {
    let msg = errorData.reason;
    // If the reason doesn't already embed the source/target labels, append them
    const extra: string[] = [];
    if (errorData.sourceHandle && !msg.includes(errorData.sourceHandle)) {
      extra.push(`handle: "${errorData.sourceHandle}"`);
    }
    if (errorData.validHandles?.length && !msg.includes(errorData.validHandles[0])) {
      extra.push(`valid: [${errorData.validHandles.join(', ')}]`);
    }
    if (extra.length) msg += ` (${extra.join(', ')})`;
    return msg;
  }

  if (errorData?.message && errorData?.path) {
    return `${errorData.message}: "${errorData.path}"`;
  }
  if (Array.isArray(errorData?.message)) {
    return errorData.message.join(', ');
  }
  return errorData?.message || fallback;
}

export async function createGraph(data: {
  name: string;
  projectId?: string;
  nodes: any[];
  edges: any[];
  flow?: any;
  layout?: any;
  viewport?: any;
  metadata?: any;
}): Promise<GraphData> {
  const payload = {
    ...data,
    projectId: data.projectId || 'default',
  };
  const res = await fetch(`${API_BASE}/graphs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new ApiError(
      formatApiError(errorData, `Failed to create graph: ${res.statusText}`),
      errorData,
    );
  }
  return res.json();
}

export async function updateGraph(
  id: string,
  data: {
    name?: string;
    projectId?: string;
    nodes?: any[];
    edges?: any[];
    flow?: any;
    layout?: any;
    viewport?: any;
    metadata?: any;
  },
): Promise<GraphData> {
  const res = await fetch(`${API_BASE}/graphs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new ApiError(
      formatApiError(errorData, `Failed to update graph: ${res.statusText}`),
      errorData,
    );
  }
  return res.json();
}

export async function validateGraph(data: {
  name?: string;
  nodes: any[];
  edges: any[];
}): Promise<{ valid: boolean }> {
  const res = await fetch(`${API_BASE}/graphs/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      formatApiError(errorData, `Validation failed: ${res.statusText}`),
    );
  }
  return res.json();
}

export async function deleteGraph(
  id: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/graphs/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      errorData.message || `Failed to delete graph: ${res.statusText}`,
    );
  }
  return res.json();
}

export async function fetchUpstreamVariables(
  graphId: string,
  blockId: string,
): Promise<{ graphId: string; blockId: string; variables: any[] }> {
  const res = await fetch(
    `${API_BASE}/graphs/${graphId}/blocks/${blockId}/variables`,
    { cache: 'no-store' },
  );
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      errorData.message ||
        `Failed to fetch upstream variables: ${res.statusText}`,
    );
  }
  return res.json();
}

export async function runGraph(
  id: string,
  input?: any,
  options?: { debugMode?: boolean; useCache?: boolean },
): Promise<RunResult> {
  const res = await fetch(`${API_BASE}/graphs/${id}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: input !== undefined ? input : {},
      ...(options?.debugMode ? { debugMode: true } : {}),
      ...(options?.useCache ? { useCache: true } : {}),
    }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      formatApiError(errorData, `Execution failed: ${res.statusText}`),
    );
  }
  return res.json();
}

export async function validateGraphById(
  id: string,
  data?: {
    nodes?: any[];
    edges?: any[];
  },
): Promise<{ valid: boolean }> {
  const res = await fetch(`${API_BASE}/graphs/${id}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data || {}),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      formatApiError(errorData, `Validation failed: ${res.statusText}`),
    );
  }
  return res.json();
}

export async function fetchRunById(runId: string): Promise<RunResult> {
  const res = await fetch(`${API_BASE}/runs/${runId}`, { cache: 'no-store' });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      formatApiError(errorData, `Failed to fetch run: ${res.statusText}`),
    );
  }
  return res.json();
}

export async function fetchRuns(projectId?: string, graphId?: string): Promise<RunResult[]> {
  const params = new URLSearchParams();
  if (projectId) params.append('projectId', projectId);
  if (graphId) params.append('graphId', graphId);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${API_BASE}/runs${query}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch runs: ${res.statusText}`);
  return res.json();
}

export async function deleteRun(runId: string): Promise<{ success: boolean; runId: string }> {
  const res = await fetch(`${API_BASE}/runs/${runId}`, { method: 'DELETE' });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(formatApiError(errorData, `Failed to delete run: ${res.statusText}`));
  }
  return res.json();
}

export async function rerunFromNode(runId: string, nodeId: string): Promise<RunResult> {
  const res = await fetch(`${API_BASE}/runs/${runId}/rerun`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(formatApiError(errorData, `Failed to rerun node: ${res.statusText}`));
  }
  return res.json();
}

export async function resumeRun(runId: string, payload: any): Promise<RunResult> {
  const res = await fetch(`${API_BASE}/runs/${runId}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(formatApiError(errorData, `Failed to resume run: ${res.statusText}`));
  }
  return res.json();
}
export async function cancelRun(runId: string): Promise<RunResult> {
  const res = await fetch(`${API_BASE}/runs/${runId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(formatApiError(errorData, `Failed to cancel run: ${res.statusText}`));
  }
  return res.json();
}

export async function fetchRunState(runId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/runs/${runId}/state`, { cache: 'no-store' });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(formatApiError(errorData, `Failed to fetch run state: ${res.statusText}`));
  }
  return res.json();
}

export async function fetchModels(): Promise<any[]> {
  try {
    const res = await fetch(`${API_BASE}/models`, { cache: 'no-store' });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function createModel(model: any): Promise<any> {
  const res = await fetch(`${API_BASE}/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(model),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      formatApiError(errorData, `Failed to create model: ${res.statusText}`),
    );
  }
  return res.json();
}

export async function updateModel(id: string, model: any): Promise<any> {
  const res = await fetch(`${API_BASE}/models/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(model),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      formatApiError(errorData, `Failed to update model: ${res.statusText}`),
    );
  }
  return res.json();
}

export async function deleteModel(id: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/models/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      formatApiError(errorData, `Failed to delete model: ${res.statusText}`),
    );
  }
  return res.json();
}

export async function fetchEmbeddingModels(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/embedding-models`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch embedding models: ${res.statusText}`);
  return res.json();
}

export async function createEmbeddingModel(model: any): Promise<any> {
  const res = await fetch(`${API_BASE}/embedding-models`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(model) });
  if (!res.ok) throw new Error(`Failed to create embedding model: ${res.statusText}`);
  return res.json();
}

export async function updateEmbeddingModel(id: string, model: any): Promise<any> {
  const res = await fetch(`${API_BASE}/embedding-models/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(model) });
  if (!res.ok) throw new Error(`Failed to update embedding model: ${res.statusText}`);
  return res.json();
}

export async function deleteEmbeddingModel(id: string): Promise<{ success: boolean; id: string }> {
  const res = await fetch(`${API_BASE}/embedding-models/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete embedding model: ${res.statusText}`);
  return res.json();
}

export async function fetchSettings(projectId?: string): Promise<any> {
  try {
    const url = projectId ? `${API_BASE}/settings?projectId=${encodeURIComponent(projectId)}` : `${API_BASE}/settings`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function updateSettings(settings: any, projectId?: string): Promise<any> {
  const url = projectId ? `${API_BASE}/settings?projectId=${encodeURIComponent(projectId)}` : `${API_BASE}/settings`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      formatApiError(errorData, `Failed to update settings: ${res.statusText}`),
    );
  }
  return res.json();
}
export async function revisePrompt(data: {
  prompt: string;
  instruction?: string;
  modelId?: string;
  projectId?: string;
}): Promise<{
  revisedPrompt: string;
  model: string;
  modelId: string;
  provider: string;
}> {
  const res = await fetch(`${API_BASE}/models/revise-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      errorData?.message || `Failed to revise prompt: ${res.statusText}`,
    );
  }
  return res.json();
}

export async function generateSchema(data: {
  description: string;
  schemaType?: string;
  modelId?: string;
  strictMode?: boolean;
  projectId?: string;
}): Promise<{
  schema: string;
  model: string;
  modelId: string;
  provider: string;
}> {
  const res = await fetch(`${API_BASE}/models/generate-schema`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      errorData?.message || `Failed to generate schema: ${res.statusText}`,
    );
  }
  return res.json();
}

export async function fetchArtifacts(query?: {
  projectId?: string;
  type?: string;
  status?: string;
  search?: string;
  artifactId?: string;
  logicalId?: string;
  latestOnly?: boolean;
  limit?: number;
}): Promise<ArtifactItem[]> {
  const params = new URLSearchParams();
  if (query?.projectId) params.set('projectId', query.projectId);
  if (query?.type) params.set('type', query.type);
  if (query?.status) params.set('status', query.status);
  if (query?.search) params.set('search', query.search);
  if (query?.artifactId) params.set('artifactId', query.artifactId);
  if (query?.logicalId) params.set('logicalId', query.logicalId);
  if (query?.latestOnly !== undefined) params.set('latestOnly', String(query.latestOnly));
  if (query?.limit) params.set('limit', String(query.limit));

  const qs = params.toString();
  const res = await fetch(`${API_BASE}/artifacts${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch artifacts: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchArtifactById(id: string, projectId?: string): Promise<ArtifactItem> {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  const qs = params.toString();

  const res = await fetch(`${API_BASE}/artifacts/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(formatApiError(errorData, `Failed to fetch artifact: ${res.statusText}`));
  }
  return res.json();
}

export async function fetchArtifactVersions(id: string, projectId?: string): Promise<ArtifactItem[]> {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  const qs = params.toString();

  const res = await fetch(`${API_BASE}/artifacts/${encodeURIComponent(id)}/versions${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(formatApiError(errorData, `Failed to fetch artifact versions: ${res.statusText}`));
  }
  return res.json();
}

export async function fetchArtifactRelations(id: string, direction = 'both', projectId?: string): Promise<ArtifactRelationItem[]> {
  const params = new URLSearchParams();
  if (direction) params.set('direction', direction);
  if (projectId) params.set('projectId', projectId);
  const qs = params.toString();

  const res = await fetch(`${API_BASE}/artifacts/${encodeURIComponent(id)}/relations${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(formatApiError(errorData, `Failed to fetch relations: ${res.statusText}`));
  }
  return res.json();
}

export async function createArtifactRelation(
  id: string,
  payload: { targetLogicalId: string; relationType: string; projectId?: string; metadata?: any },
): Promise<any> {
  const res = await fetch(`${API_BASE}/artifacts/${encodeURIComponent(id)}/relations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(formatApiError(errorData, `Failed to add relation: ${res.statusText}`));
  }
  return res.json();
}

export async function deleteArtifactRelation(
  id: string,
  relationId: string,
  projectId?: string,
): Promise<{ success: boolean }> {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  const qs = params.toString();

  const res = await fetch(
    `${API_BASE}/artifacts/${encodeURIComponent(id)}/relations/${encodeURIComponent(relationId)}${qs ? `?${qs}` : ''}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(formatApiError(errorData, `Failed to remove relation: ${res.statusText}`));
  }
  return res.json();
}

export async function createArtifact(payload: Partial<ArtifactItem>): Promise<ArtifactItem> {
  const res = await fetch(`${API_BASE}/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(formatApiError(errorData, `Failed to create artifact: ${res.statusText}`));
  }
  return res.json();
}

export async function updateArtifact(id: string, payload: Partial<ArtifactItem>): Promise<ArtifactItem> {
  const res = await fetch(`${API_BASE}/artifacts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(formatApiError(errorData, `Failed to update artifact: ${res.statusText}`));
  }
  return res.json();
}

export async function approveArtifact(id: string): Promise<ArtifactItem> {
  const res = await fetch(`${API_BASE}/artifacts/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(formatApiError(errorData, `Failed to approve artifact: ${res.statusText}`));
  }
  return res.json();
}

export async function deleteArtifact(id: string): Promise<{ success: boolean; artifactId: string }> {
  const res = await fetch(`${API_BASE}/artifacts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(formatApiError(errorData, `Failed to delete artifact: ${res.statusText}`));
  }
  return res.json();
}

export async function getWebserverStatus(graphId: string, nodeId?: string): Promise<{
  status: 'running' | 'stopped';
  port?: number;
  host?: string;
  url?: string;
  nodeId?: string;
  activeRoutes?: any[];
  startedAt?: string;
}> {
  const query = nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : '';
  const res = await fetch(`${API_BASE}/webservers/${encodeURIComponent(graphId)}/status${query}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    return { status: 'stopped' };
  }
  return res.json();
}

export async function startWebserver(graphId: string, nodeId?: string): Promise<{
  status: 'running';
  port: number;
  host: string;
  url: string;
  nodeId: string;
  activeRoutes: any[];
}> {
  const res = await fetch(`${API_BASE}/webservers/${encodeURIComponent(graphId)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData?.message || `Failed to start webserver: ${res.statusText}`);
  }
  return res.json();
}

export async function stopWebserver(graphId: string, nodeId?: string): Promise<{
  status: 'stopped';
  graphId: string;
  nodeId?: string;
}> {
  const res = await fetch(`${API_BASE}/webservers/${encodeURIComponent(graphId)}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData?.message || `Failed to stop webserver: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchCaches(filters?: {
  graphId?: string;
  projectId?: string;
  nodeType?: string;
  search?: string;
}): Promise<NodeCacheItem[]> {
  const params = new URLSearchParams();
  if (filters?.graphId) params.append('graphId', filters.graphId);
  if (filters?.projectId) params.append('projectId', filters.projectId);
  if (filters?.nodeType && filters.nodeType !== 'all') params.append('nodeType', filters.nodeType);
  if (filters?.search && filters.search.trim()) params.append('search', filters.search.trim());

  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${API_BASE}/caches${query}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch node caches: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchNodeCache(graphId: string, nodeId: string): Promise<NodeCacheItem | null> {
  const res = await fetch(`${API_BASE}/caches/${encodeURIComponent(graphId)}/${encodeURIComponent(nodeId)}`, {
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch node cache: ${res.statusText}`);
  }
  return res.json();
}

export async function deleteNodeCache(graphId: string, nodeId: string): Promise<{ deletedCount: number }> {
  const res = await fetch(`${API_BASE}/caches/${encodeURIComponent(graphId)}/${encodeURIComponent(nodeId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Failed to delete node cache: ${res.statusText}`);
  }
  return res.json();
}

export async function clearAllCaches(graphId?: string): Promise<{ deletedCount: number }> {
  const query = graphId ? `?graphId=${encodeURIComponent(graphId)}` : '';
  const res = await fetch(`${API_BASE}/caches${query}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Failed to clear caches: ${res.statusText}`);
  }
  return res.json();
}

export async function updateNodeCache(graphId: string, nodeId: string, result: any): Promise<NodeCacheItem> {
  const res = await fetch(`${API_BASE}/caches/${encodeURIComponent(graphId)}/${encodeURIComponent(nodeId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ result }),
  });
  if (!res.ok) {
    throw new Error(`Failed to update node cache: ${res.statusText}`);
  }
  return res.json();
}
