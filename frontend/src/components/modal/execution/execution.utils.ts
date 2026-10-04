import { FlowNode, FlowNodeData, RunResult } from '@/lib/types';

export function generateSampleJsonFromRoute(routeNode: FlowNode): Record<string, any> {
  const config = routeNode.data?.config || {};
  const typeStr = String(config.type || '').trim();

  if (typeStr) {
    const sample: Record<string, any> = {};
    const regex = /([a-zA-Z0-9_]+)\s*:\s*z\.([a-zA-Z0-9_]+)/g;
    let match;
    while ((match = regex.exec(typeStr)) !== null) {
      const field = match[1];
      const zType = match[2].toLowerCase();
      if (zType.includes('string')) {
        if (field.toLowerCase().includes('title')) sample[field] = 'Architecture Plan v1';
        else if (field.toLowerCase().includes('content')) sample[field] = 'Comprehensive system design for vector search.';
        else if (field.toLowerCase().includes('email')) sample[field] = 'user@example.com';
        else if (field.toLowerCase().includes('name')) sample[field] = 'Alex Flow';
        else sample[field] = `sample_${field}`;
      } else if (zType.includes('number')) {
        sample[field] = 42;
      } else if (zType.includes('boolean')) {
        sample[field] = true;
      } else if (zType.includes('array')) {
        sample[field] = ['keyword1', 'keyword2'];
      } else {
        sample[field] = 'example';
      }
    }
    if (Object.keys(sample).length > 0) {
      return sample;
    }
  }

  return {
    title: 'Architecture Plan v1',
    content: 'Comprehensive system design for microservices and vector search.',
    category: 'architecture',
    tags: ['system', 'vector'],
  };
}

export function generateSampleQueryFromRoute(routeNode: FlowNode): string {
  const config = routeNode.data?.config || {};
  const queryStr = String(config.querySchema || '').trim();

  if (queryStr) {
    const params: string[] = [];
    const regex = /([a-zA-Z0-9_]+)\s*:\s*z\.([a-zA-Z0-9_]+)/g;
    let match;
    while ((match = regex.exec(queryStr)) !== null) {
      const field = match[1];
      const zType = match[2].toLowerCase();
      if (field === 'q' || field === 'query' || field === 'search') {
        params.push(`${field}=test`);
      } else if (field === 'limit') {
        params.push(`${field}=5`);
      } else if (zType.includes('number')) {
        params.push(`${field}=10`);
      } else if (zType.includes('boolean')) {
        params.push(`${field}=true`);
      } else {
        params.push(`${field}=example`);
      }
    }
    if (params.length > 0) {
      return params.join('&');
    }
  }

  return 'q=test&limit=5';
}

export function buildFullUrl(baseUrl: string, queryStr?: string): string {
  let cleanQuery = String(queryStr || '').trim();
  if (cleanQuery.startsWith('?')) {
    cleanQuery = cleanQuery.slice(1).trim();
  }
  if (cleanQuery.startsWith('{') && cleanQuery.endsWith('}')) {
    try {
      const parsed = JSON.parse(cleanQuery);
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(parsed)) {
        if (v !== undefined && v !== null && v !== '') {
          params.set(k, String(v));
        }
      }
      cleanQuery = params.toString();
    } catch {
      // ignore
    }
  }
  if (!cleanQuery) return baseUrl;
  return baseUrl.includes('?') ? `${baseUrl}&${cleanQuery}` : `${baseUrl}?${cleanQuery}`;
}

export function buildCurlCommand(method: string, url: string, bodyObj?: any): string {
  const isBodyAllowed = method !== 'GET' && method !== 'HEAD';
  if (!isBodyAllowed) {
    return `curl -X ${method} "${url}"`;
  }
  const bodyFormatted = JSON.stringify(bodyObj || {}, null, 2);
  return `curl -X ${method} "${url}" \\\n  -H "Content-Type: application/json" \\\n  -d '${bodyFormatted.replace(/'/g, "'\\''")}'`;
}

export function computeExecutionDuration(runResult: RunResult | null): number | null {
  if (runResult?.createdAt && runResult?.updatedAt) {
    const start = new Date(runResult.createdAt).getTime();
    const end = new Date(runResult.updatedAt).getTime();
    if (!isNaN(start) && !isNaN(end) && end >= start) {
      return end - start;
    }
  }
  return null;
}
