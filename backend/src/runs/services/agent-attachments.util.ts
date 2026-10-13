import * as fs from 'fs';
import * as path from 'path';
import { safeFetch } from './url-safety.util';

export type AttachmentKind = 'image' | 'audio' | 'document';

export interface ResolvedAttachment {
  kind: AttachmentKind;
  mimeType: string;
  filename: string;
  /** base64 payload (local files, data URLs, or downloaded remote files) */
  base64?: string;
  /** remote http(s) URL (not downloaded yet) */
  url?: string;
}

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentError';
  }
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
};

const DEFAULT_MIME_BY_KIND: Record<AttachmentKind, string> = {
  image: 'image/png',
  audio: 'audio/mpeg',
  document: 'application/pdf',
};

function kindFromMime(mimeType: string): AttachmentKind | null {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'document';
  return null;
}

function supportedExtensions(): string {
  return Object.keys(MIME_BY_EXT).join(', ');
}

export function getMaxAttachmentBytes(): number {
  const n = Number(process.env.AGENT_ATTACHMENT_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 20 * 1024 * 1024;
}

/**
 * Directories local attachment paths may be read from. Defaults to the app's `files/`
 * directory (screenshots, extracted files). Override with AGENT_ATTACHMENT_ROOTS
 * (path-delimiter separated list of absolute directories).
 */
export function getAttachmentRoots(): string[] {
  const fromEnv = String(process.env.AGENT_ATTACHMENT_ROOTS || '')
    .split(path.delimiter)
    .map((p) => p.trim())
    .filter(Boolean);
  const candidates = fromEnv.length
    ? fromEnv
    : [
        path.resolve(process.cwd(), '..', 'files'),
        path.resolve(process.cwd(), 'files'),
        path.resolve(__dirname, '..', '..', '..', '..', 'files'),
        path.resolve(__dirname, '..', '..', '..', 'files'),
      ];
  const roots = new Set<string>();
  for (const dir of candidates) {
    try {
      roots.add(fs.realpathSync(dir));
    } catch {
      // directory does not exist (yet)
    }
  }
  return Array.from(roots);
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' ? false : !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Resolve a local attachment path, following symlinks, and ensure it stays inside an allowed root. */
export function resolveAllowedLocalPath(filePath: string, roots: string[] = getAttachmentRoots()): string {
  let real: string;
  try {
    real = fs.realpathSync(path.resolve(filePath));
  } catch {
    throw new AttachmentError(`Attachment file not found: "${filePath}"`);
  }
  if (!roots.some((root) => isInside(root, real))) {
    throw new AttachmentError(
      `Attachment path "${filePath}" is outside the allowed attachment directories. ` +
        `Only files under ${roots.length ? roots.join(', ') : 'the app files/ directory'} can be attached (configure AGENT_ATTACHMENT_ROOTS to change this).`,
    );
  }
  return real;
}

function applyTypeHint(kind: AttachmentKind, hint: string, source: string): AttachmentKind {
  if (!hint || hint === 'auto' || hint === kind) return kind;
  throw new AttachmentError(`Attachment "${source}" was detected as ${kind}, but Media Type is set to "${hint}".`);
}

function shortSource(value: string): string {
  return value.startsWith('data:') ? `${value.slice(0, 30)}...` : value;
}

/**
 * Flatten the resolved `attachment` config value into individual sources.
 * Accepts a string (newline-separated for several), an array, or objects with path/url/dataUrl.
 */
export function flattenAttachmentSources(value: any): Array<string> {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((v) => flattenAttachmentSources(v));
  if (typeof value === 'object') {
    const source = value.path || value.url || value.dataUrl || value.data_url;
    return typeof source === 'string' && source.trim() ? [source.trim()] : [];
  }
  const str = String(value).trim();
  if (!str) return [];
  if (str.startsWith('data:')) return [str];
  if (str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) return flattenAttachmentSources(parsed);
    } catch {
      // not a JSON array
    }
  }
  return str
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function resolveAttachment(source: string, typeHint = 'auto', roots?: string[]): ResolvedAttachment {
  const maxBytes = getMaxAttachmentBytes();

  if (source.startsWith('data:')) {
    const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(source);
    if (!match || !match[2]) throw new AttachmentError(`Unsupported data URL attachment (must be base64): ${shortSource(source)}`);
    const mimeType = match[1].toLowerCase();
    const kind = kindFromMime(mimeType);
    if (!kind) throw new AttachmentError(`Unsupported attachment type "${mimeType}". Supported: images, audio (mp3/wav), PDF.`);
    if ((match[3].length * 3) / 4 > maxBytes) throw new AttachmentError(`Attachment exceeds the ${maxBytes} byte limit.`);
    return { kind: applyTypeHint(kind, typeHint, 'data URL'), mimeType, base64: match[3], filename: `attachment.${mimeType.split('/')[1]}` };
  }

  if (/^https?:\/\//i.test(source)) {
    const pathname = (() => {
      try {
        return new URL(source).pathname;
      } catch {
        throw new AttachmentError(`Invalid attachment URL: "${source}"`);
      }
    })();
    const ext = path.extname(pathname).toLowerCase();
    const filename = path.basename(pathname) || 'attachment';
    if (MIME_BY_EXT[ext]) {
      const mimeType = MIME_BY_EXT[ext];
      return { kind: applyTypeHint(kindFromMime(mimeType)!, typeHint, source), mimeType, url: source, filename };
    }
    // No recognizable extension (e.g. CDN image URLs): trust the Media Type, default to image
    const kind: AttachmentKind = typeHint && typeHint !== 'auto' ? (typeHint as AttachmentKind) : 'image';
    return { kind, mimeType: DEFAULT_MIME_BY_KIND[kind], url: source, filename };
  }

  const realPath = resolveAllowedLocalPath(source, roots);
  const ext = path.extname(realPath).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) throw new AttachmentError(`Unsupported attachment file type "${ext || '(none)'}". Supported: ${supportedExtensions()}.`);
  const stat = fs.statSync(realPath);
  if (stat.size > maxBytes) throw new AttachmentError(`Attachment "${source}" is ${stat.size} bytes, exceeding the ${maxBytes} byte limit.`);
  return {
    kind: applyTypeHint(kindFromMime(mimeType)!, typeHint, source),
    mimeType,
    base64: fs.readFileSync(realPath).toString('base64'),
    filename: path.basename(realPath),
  };
}

/** Download a remote attachment (SSRF-guarded) so it can be sent inline as base64. */
export async function ensureInlineAttachment(att: ResolvedAttachment, signal?: AbortSignal): Promise<ResolvedAttachment> {
  if (att.base64 || !att.url) return att;
  const maxBytes = getMaxAttachmentBytes();
  const res = await safeFetch(att.url, { method: 'GET', signal });
  if (!res.ok) throw new AttachmentError(`Failed to download attachment "${att.url}" (HTTP ${res.status}).`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) throw new AttachmentError(`Attachment "${att.url}" exceeds the ${maxBytes} byte limit.`);
  const headerMime = String(res.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
  const mimeType = headerMime && kindFromMime(headerMime) === att.kind ? headerMime : att.mimeType;
  return { ...att, mimeType, base64: buffer.toString('base64') };
}

export function toDataUrl(att: ResolvedAttachment): string {
  if (!att.base64) throw new AttachmentError('Attachment has no inline data');
  return `data:${att.mimeType};base64,${att.base64}`;
}

export function audioFormat(att: ResolvedAttachment): 'mp3' | 'wav' {
  return att.mimeType.includes('wav') ? 'wav' : 'mp3';
}
