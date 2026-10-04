/**
 * Utility functions for LLM endpoint resolution, protocol routing,
 * secret masking, and payload sanitization.
 */

export type LlmProtocol = 'openai' | 'anthropic' | 'lmstudio_native';

export interface LlmCompletionTarget {
  url: string;
  provider: string;
  protocol: LlmProtocol;
}

/**
 * Cleanly resolves the full HTTP completion URL and protocol family
 * for any supported LLM provider and user-configured base endpoint.
 */
export function resolveCompletionTarget(
  provider: string,
  rawEndpoint: string,
): LlmCompletionTarget {
  const cleanEndpoint = String(rawEndpoint || '').trim().replace(/\/+$/, '');
  const normalizedProvider = (provider || 'openai').toLowerCase().trim();

  // 1. Anthropic Claude Messages API
  if (normalizedProvider === 'anthropic') {
    let url = cleanEndpoint || 'https://api.anthropic.com/v1';
    if (url.endsWith('/messages')) {
      // Already complete (e.g. https://api.anthropic.com/v1/messages)
    } else if (url.endsWith('/v1')) {
      url = `${url}/messages`;
    } else {
      url = `${url}/v1/messages`;
    }
    return { url, provider: normalizedProvider, protocol: 'anthropic' };
  }

  // 2. LM Studio Native Endpoint (/api/v1/chat)
  if (normalizedProvider === 'lmstudio' && cleanEndpoint.includes('/api/v1/chat')) {
    return { url: cleanEndpoint, provider: normalizedProvider, protocol: 'lmstudio_native' };
  }

  // 3. OpenAI and OpenAI-Compatible APIs (OpenAI, OpenRouter, Ollama, vLLM, LMStudio v1, etc.)
  let url = cleanEndpoint;
  if (!url || url === 'https://api.openai.com') {
    url = 'https://api.openai.com/v1/chat/completions';
  } else if (url.endsWith('/chat/completions') || url.endsWith('/completions')) {
    // Explicit completions path provided
  } else if (url.endsWith('/chat')) {
    url = `${url}/completions`;
  } else if (
    url.endsWith('/v1') ||
    url.endsWith('/v1beta/openai') ||
    url.endsWith('/openai/v1')
  ) {
    url = `${url}/chat/completions`;
  } else {
    // Default standard suffix for OpenAI-compatible gateways
    url = `${url}/v1/chat/completions`;
  }

  return { url, provider: normalizedProvider, protocol: 'openai' };
}

/**
 * Validates that an endpoint is a well-formed HTTP/HTTPS URL.
 */
export function validateEndpointUrl(endpoint: string): boolean {
  if (!endpoint || typeof endpoint !== 'string') return false;
  try {
    const parsed = new URL(endpoint.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Strips markdown code blocks (e.g. ```typescript ... ``` or ```json ... ```)
 * from LLM raw string responses.
 */
export function cleanCodeFences(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();

  if (cleaned.startsWith('```')) {
    const firstLineBreak = cleaned.indexOf('\n');
    const lastFence = cleaned.lastIndexOf('```');

    if (firstLineBreak !== -1 && lastFence > firstLineBreak) {
      cleaned = cleaned.slice(firstLineBreak + 1, lastFence).trim();
    } else if (firstLineBreak !== -1) {
      cleaned = cleaned.slice(firstLineBreak + 1).trim();
    }
  }

  return cleaned;
}

/**
 * Robustly parses a JSON object from LLM output, extracting from
 * enclosing markdown fences or outer brackets if needed.
 */
/**
 * Pulls the "reply" string out of a truncated or otherwise unparseable JSON object.
 * Explanatory answers often echo the whole graph and get cut off before the object closes.
 */
export function salvageReplyText(rawText: string): string | null {
  if (!rawText) return null;
  const cleaned = cleanCodeFences(rawText);
  const keyAt = cleaned.search(/"reply"\s*:/);
  if (keyAt === -1) return null;

  const colonAt = cleaned.indexOf(':', keyAt);
  const start = cleaned.indexOf('"', colonAt + 1);
  if (start === -1) return null;

  let out = '';
  for (let i = start + 1; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '\\') {
      const next = cleaned[i + 1];
      if (next === undefined) break;
      if (next === 'u') {
        const hex = cleaned.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 5;
          continue;
        }
      }
      const escaped: Record<string, string> = {
        n: '\n',
        r: '\r',
        t: '\t',
        b: '\b',
        f: '\f',
        '"': '"',
        '\\': '\\',
        '/': '/',
      };
      out += escaped[next] ?? next;
      i += 1;
      continue;
    }
    if (ch === '"') {
      const trimmed = out.trim();
      return trimmed || null;
    }
    out += ch;
  }

  const trimmed = out.trim();
  return trimmed || null;
}

export function extractJsonPayload<T = any>(rawText: string): T | null {
  if (!rawText) return null;

  const cleaned = cleanCodeFences(rawText);

  // First attempt: direct JSON parse
  try {
    return JSON.parse(cleaned);
  } catch {
    // Second attempt: extract substring between first '{' and last '}'
    const startIdx = cleaned.indexOf('{');
    const endIdx = cleaned.lastIndexOf('}');
    if (startIdx !== -1 && endIdx > startIdx) {
      try {
        return JSON.parse(cleaned.slice(startIdx, endIdx + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Masks an API key for safe public display/DTO serialization.
 * Example: 'sk-proj-1234567890abcdef' -> 'sk-...cdef'
 */
export function maskApiKey(key?: string): string {
  if (!key || typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '••••••••';
  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}

/**
 * Checks whether an incoming key is a masked placeholder (indicating no edit).
 */
export function isMaskedKey(key?: string): boolean {
  if (!key) return false;
  return key.includes('...') || key.includes('••••');
}
