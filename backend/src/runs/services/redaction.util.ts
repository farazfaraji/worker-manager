import { createHash, randomUUID } from 'crypto';

const SENSITIVE_KEY_PATTERN =
  /^(api[-_]?key|auth|authorization|bearer|token|secret|password|passwd|cookie|session|credential|access[-_]?token|refresh[-_]?token|private[-_]?key|resumeTokenHash)$/i;

const SENSITIVE_VALUE_PATTERN =
  /^(Bearer\s+[A-Za-z0-9\-._~+/]+=*|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|[A-Za-z0-9+/]{40,}={0,2})$/;

/**
 * Compute single-way SHA-256 hash of a string (such as an opaque resume token)
 */
export function hashToken(token: string): string {
  if (!token) return '';
  return createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Generate an opaque resume token and its stored hash
 */
export function generateResumeToken(): {
  token: string;
  hash: string;
  tokenId: string;
} {
  const token = `rtk_${randomUUID()}`;
  const hash = hashToken(token);
  const tokenId = `tok_${randomUUID().slice(0, 8)}`;
  return { token, hash, tokenId };
}

/**
 * Recursively redact secrets, credentials, tokens, and authorization headers
 */
export function redactSecrets(data: any, seen = new WeakSet()): any {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') {
    if (typeof data === 'string' && SENSITIVE_VALUE_PATTERN.test(data.trim())) {
      return '[REDACTED_SECRET]';
    }
    return data;
  }

  if (seen.has(data)) return '[CIRCULAR]';
  seen.add(data);

  if (Array.isArray(data)) {
    return data.map((item) => redactSecrets(item, seen));
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactSecrets(value, seen);
    }
  }
  return result;
}

/**
 * Sanitize public Run representations to prevent leaking resume token hashes, lease owners, or credentials
 */
export function sanitizeRunForPublic(runDoc: any): any {
  if (!runDoc) return null;
  const raw = typeof runDoc.toObject === 'function' ? runDoc.toObject() : { ...runDoc };

  // Strip sensitive internal fields
  delete raw.resumeTokenHash;
  delete raw.leaseOwner;
  delete raw.leaseExpiresAt;
  delete raw.__v;

  // Clean waiting descriptor if present
  if (raw.waitingDescriptor && typeof raw.waitingDescriptor === 'object') {
    delete raw.waitingDescriptor.token;
    delete raw.waitingDescriptor.resumeToken;
    delete raw.waitingDescriptor.resumeTokenHash;
  }

  // Redact inputs, outputs, errors
  if (raw.input) raw.input = redactSecrets(raw.input);
  if (raw.output) raw.output = redactSecrets(raw.output);
  if (raw.nodes && Array.isArray(raw.nodes)) {
    raw.nodes = raw.nodes.map((node: any) => {
      const sanitizedNode = { ...node };
      delete sanitizedNode.token;
      if (sanitizedNode.input) sanitizedNode.input = redactSecrets(sanitizedNode.input);
      if (sanitizedNode.output) sanitizedNode.output = redactSecrets(sanitizedNode.output);
      return sanitizedNode;
    });
  }

  return raw;
}

/**
 * Calculate size in bytes of an object for logging without dumping entire payloads
 */
export function calculateObjectSize(obj: any): number {
  try {
    return Buffer.byteLength(JSON.stringify(obj || ''));
  } catch {
    return 0;
  }
}
