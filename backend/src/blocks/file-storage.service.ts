import { BadRequestException, Injectable } from '@nestjs/common';
import {
  access,
  appendFile,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'fs/promises';
import { existsSync, realpathSync } from 'fs';
import * as path from 'path';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export const MIME_BY_EXT: Record<string, string> = {
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

export function mimeFromPath(filePath: string): string {
  return MIME_BY_EXT[path.extname(String(filePath || '')).toLowerCase()] || 'application/octet-stream';
}

@Injectable()
export class FileStorageService {
  private baseOverride?: string;

  /** Test hook. Production uses files/projects under the repo. */
  setBaseOverride(dir: string): void {
    this.baseOverride = dir;
  }

  rootFor(projectId: string): string {
    const safe = String(projectId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
    return path.join(this.baseDir(), safe);
  }

  async read(projectId: string, rel: string, options: { encoding?: string; maxBytes?: number; allowedExtensions?: string[] } = {}) {
    const target = await this.resolveSafe(projectId, rel, { allowMissing: false });
    this.assertExtension(target, options.allowedExtensions);
    const info = await stat(target);
    if (info.isDirectory()) throw new BadRequestException('read expects a file, not a directory');
    this.assertSize(info.size, options.maxBytes);
    const encoding = String(options.encoding || 'utf8').toLowerCase();
    const buffer = await readFile(target);
    let content: any;
    if (encoding === 'base64') content = buffer.toString('base64');
    else if (encoding === 'json') content = JSON.parse(buffer.toString('utf8'));
    else content = buffer.toString('utf8');
    return { path: this.displayPath(projectId, target), content, size: info.size, mimeType: this.mime(target) };
  }

  /**
   * Reads a sandboxed file as raw base64 plus its detected mime type.
   * Used by consumers that need the bytes themselves (e.g. LLM attachments).
   */
  async readBuffer(projectId: string, rel: string, options: { maxBytes?: number } = {}) {
    const target = await this.resolveSafe(projectId, rel, { allowMissing: false });
    const info = await stat(target);
    if (info.isDirectory()) throw new BadRequestException('readBuffer expects a file, not a directory');
    this.assertSize(info.size, options.maxBytes);
    const buffer = await readFile(target);
    return { path: this.displayPath(projectId, target), base64: buffer.toString('base64'), size: info.size, mimeType: this.mime(target) };
  }

  async write(
    projectId: string,
    rel: string,
    content: any,
    options: { mode?: string; encoding?: string; maxBytes?: number; allowedExtensions?: string[] } = {},
  ) {
    const target = await this.resolveSafe(projectId, rel, { allowMissing: true });
    this.assertExtension(target, options.allowedExtensions);
    const mode = String(options.mode || 'overwrite').toLowerCase();
    const exists = await this.pathExists(target);
    if (mode === 'createonly' || mode === 'create') {
      if (exists) throw new BadRequestException('File already exists');
    }
    const encoding = String(options.encoding || 'utf8').toLowerCase();
    const buffer = this.toBuffer(content, encoding);
    this.assertSize(buffer.length, options.maxBytes);
    await mkdir(path.dirname(target), { recursive: true });
    if ((mode === 'append') && exists) await appendFile(target, buffer);
    else await writeFile(target, buffer);
    const info = await stat(target);
    return { path: this.displayPath(projectId, target), size: info.size, mimeType: this.mime(target), mode };
  }

  async list(projectId: string, rel = '.', options: { glob?: string; recursive?: boolean } = {}) {
    const target = await this.resolveSafe(projectId, rel || '.', { allowMissing: false });
    const info = await stat(target);
    const dir = info.isDirectory() ? target : path.dirname(target);
    const entries: Array<{ path: string; size: number; modifiedAt: string; isDir: boolean }> = [];
    await this.walk(projectId, dir, options.recursive === true, options.glob, entries);
    return entries.slice(0, 1000);
  }

  async remove(projectId: string, rel: string, recursive = false) {
    const target = await this.resolveSafe(projectId, rel, { allowMissing: false });
    const root = this.rootFor(projectId);
    if (path.resolve(target) === path.resolve(root)) {
      throw new BadRequestException('Refusing to delete the project file root');
    }
    await rm(target, { recursive: recursive === true, force: false });
    return { path: this.displayPath(projectId, target), deleted: true };
  }

  async move(projectId: string, from: string, to: string) {
    const source = await this.resolveSafe(projectId, from, { allowMissing: false });
    const dest = await this.resolveSafe(projectId, to, { allowMissing: true });
    await mkdir(path.dirname(dest), { recursive: true });
    await rename(source, dest);
    return { from: this.displayPath(projectId, source), to: this.displayPath(projectId, dest) };
  }

  async copy(projectId: string, from: string, to: string) {
    const source = await this.resolveSafe(projectId, from, { allowMissing: false });
    const dest = await this.resolveSafe(projectId, to, { allowMissing: true });
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(source, dest);
    return { from: this.displayPath(projectId, source), to: this.displayPath(projectId, dest) };
  }

  async exists(projectId: string, rel: string): Promise<boolean> {
    try {
      const target = await this.resolveSafe(projectId, rel, { allowMissing: true });
      await access(target);
      return true;
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      return false;
    }
  }

  async stat(projectId: string, rel: string) {
    const target = await this.resolveSafe(projectId, rel, { allowMissing: false });
    const info = await stat(target);
    return {
      path: this.displayPath(projectId, target),
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      createdAt: info.birthtime.toISOString(),
      isDir: info.isDirectory(),
      mimeType: info.isDirectory() ? 'inode/directory' : this.mime(target),
    };
  }

  async parse(projectId: string, rel: string, format?: string, maxBytes?: number) {
    const file = await this.read(projectId, rel, { encoding: 'utf8', maxBytes });
    const kind = String(format || path.extname(rel).slice(1) || 'text').toLowerCase();
    if (kind === 'json') {
      return { ...file, parsed: JSON.parse(String(file.content)) };
    }
    if (kind === 'csv') {
      return { ...file, parsed: parseCsv(String(file.content)) };
    }
    if (kind === 'markdown' || kind === 'md') {
      return { ...file, parsed: parseMarkdown(String(file.content)) };
    }
    return { ...file, parsed: file.content };
  }

  async resolveSafe(projectId: string, rel: string, options: { allowMissing: boolean }): Promise<string> {
    if (typeof rel !== 'string' || !rel.trim()) throw new BadRequestException('A file path is required');
    if (rel.includes('\0')) throw new BadRequestException('Invalid file path');
    const root = await this.canonicalRoot(projectId);
    const target = path.resolve(root, rel);
    this.assertInside(root, target);
    if (existsSync(target)) {
      const real = realpathSync(target);
      this.assertInside(root, real);
      return real;
    }
    if (!options.allowMissing) throw new BadRequestException(`File not found: ${rel}`);
    const parent = path.dirname(target);
    if (existsSync(parent)) {
      const realParent = realpathSync(parent);
      this.assertInside(root, realParent);
      return path.join(realParent, path.basename(target));
    }
    return target;
  }

  private async canonicalRoot(projectId: string): Promise<string> {
    const root = this.rootFor(projectId);
    await mkdir(root, { recursive: true });
    return realpathSync(root);
  }

  private async walk(
    projectId: string,
    dir: string,
    recursive: boolean,
    glob: string | undefined,
    out: Array<{ path: string; size: number; modifiedAt: string; isDir: boolean }>,
  ) {
    if (out.length >= 1000) return;
    const names = await readdir(dir);
    for (const name of names) {
      if (out.length >= 1000) return;
      const full = path.join(dir, name);
      const info = await stat(full);
      const display = this.displayPath(projectId, full);
      const isDir = info.isDirectory();
      if (!glob || matchGlob(glob, display)) {
        out.push({ path: display, size: info.size, modifiedAt: info.mtime.toISOString(), isDir });
      }
      if (recursive && isDir) await this.walk(projectId, full, true, glob, out);
    }
  }

  private displayPath(projectId: string, absolute: string): string {
    const root = this.rootFor(projectId);
    const base = existsSync(root) ? realpathSync(root) : path.resolve(root);
    const rel = path.relative(base, absolute);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BadRequestException('Path escapes the project file sandbox');
    }
    return rel.split(path.sep).join('/');
  }

  private assertInside(root: string, target: string) {
    const relative = path.relative(path.resolve(root), path.resolve(target));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new BadRequestException('Path escapes the project file sandbox');
    }
  }

  private assertExtension(target: string, allowed?: string[]) {
    if (!allowed || allowed.length === 0) return;
    const ext = path.extname(target).toLowerCase();
    const normalized = allowed.map((item) => {
      const value = String(item).toLowerCase();
      return value.startsWith('.') ? value : `.${value}`;
    });
    if (!normalized.includes(ext)) throw new BadRequestException(`Extension ${ext || '(none)'} is not allowed`);
  }

  private assertSize(size: number, maxBytes?: number) {
    const limit = Number(maxBytes) > 0 ? Number(maxBytes) : DEFAULT_MAX_BYTES;
    if (size > limit) throw new BadRequestException(`File exceeds the ${limit} byte limit`);
  }

  private mime(target: string): string {
    return mimeFromPath(target);
  }

  private toBuffer(content: any, encoding: string): Buffer {
    if (Buffer.isBuffer(content)) return content;
    if (encoding === 'base64' && typeof content === 'string') return Buffer.from(content, 'base64');
    if (typeof content === 'string') return Buffer.from(content, 'utf8');
    return Buffer.from(JSON.stringify(content ?? ''), 'utf8');
  }

  private async pathExists(target: string): Promise<boolean> {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  }

  private baseDir(): string {
    if (this.baseOverride) return path.resolve(this.baseOverride);
    const parentFiles = path.resolve(process.cwd(), '..', 'files');
    const localFiles = path.resolve(process.cwd(), 'files');
    if (existsSync(parentFiles)) return path.join(parentFiles, 'projects');
    if (existsSync(localFiles)) return path.join(localFiles, 'projects');
    return path.join(parentFiles, 'projects');
  }
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const header = rows.shift() || [];
  return rows
    .filter((cells) => cells.some((value) => value !== ''))
    .map((cells) => {
      const record: Record<string, string> = {};
      header.forEach((key, index) => {
        record[key || `col_${index + 1}`] = cells[index] ?? '';
      });
      return record;
    });
}

function parseMarkdown(text: string): { frontMatter: Record<string, string>; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontMatter: {}, body: text };
  const frontMatter: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    frontMatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return { frontMatter, body: match[2] };
}

function matchGlob(glob: string, displayPath: string): boolean {
  const pattern = String(glob).split('*').map(escapeRegex).join('.*');
  return new RegExp(`^${pattern}$`).test(displayPath) || new RegExp(`^${pattern}$`).test(path.posix.basename(displayPath));
}

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}
