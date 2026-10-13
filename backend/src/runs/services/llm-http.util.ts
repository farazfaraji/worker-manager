import { Logger } from '@nestjs/common';

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const MAX_BACKOFF_MS = 30000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function retryDelayMs(res: any, attempt: number): number {
  const header = res?.headers?.get?.('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(MAX_BACKOFF_MS, Math.max(0, seconds * 1000));
    const date = Date.parse(header);
    if (!isNaN(date)) return Math.min(MAX_BACKOFF_MS, Math.max(0, date - Date.now()));
  }
  const base = 1000 * 2 ** attempt;
  return Math.min(MAX_BACKOFF_MS, base + Math.floor(Math.random() * 250));
}

export function getLlmMaxRetries(): number {
  const n = Number(process.env.LLM_MAX_RETRIES);
  return Number.isFinite(n) && n >= 0 ? Math.min(6, Math.floor(n)) : 2;
}

/**
 * POST a JSON body to an LLM endpoint, retrying 429/5xx responses with exponential backoff
 * (honoring Retry-After). Returns the parsed JSON body or throws `${label} error (status): message`.
 */
export async function postLlmJson(
  url: string,
  headers: Record<string, string>,
  body: any,
  options: { signal?: AbortSignal; label: string; logger?: Logger; maxRetries?: number },
): Promise<any> {
  const maxRetries = options.maxRetries ?? getLlmMaxRetries();
  for (let attempt = 0; ; attempt++) {
    const res: any = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });

    let json: any;
    try {
      json = await res.json();
    } catch (parseErr: any) {
      if (res.ok) {
        throw new Error(
          `Failed to parse ${options.label} response JSON (connection may have timed out or aborted): ${parseErr.message}`,
        );
      }
      json = {};
    }

    if (res.ok) return json;

    if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
      const delay = retryDelayMs(res, attempt);
      options.logger?.warn(
        `   ⏳ ${options.label} returned HTTP ${res.status}; retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
      );
      await sleep(delay, options.signal);
      continue;
    }

    options.logger?.error(`   ❌ ${options.label} returned HTTP ${res.status}: ${JSON.stringify(json)}`);
    const err: any = new Error(`${options.label} error (${res.status}): ${json?.error?.message || res.statusText || 'request failed'}`);
    err.status = res.status;
    throw err;
  }
}
