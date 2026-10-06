import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  access,
  appendFile,
  copyFile,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'fs/promises';
import { existsSync, realpathSync } from 'fs';
import { isValidObjectId, Model } from 'mongoose';
import * as path from 'path';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export type FileStorageScopeOptions = {
  folder?: string;
};

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

  constructor(
    @Optional() @InjectModel(Project.name) private readonly projectModel?: Model<ProjectDocument>,
  ) {}

  /** Test hook. Production uses files/projects under the repo. */
  setBaseOverride(dir: string): void {
    this.baseOverride = dir;
  }

  rootFor(projectId: string): string {
    const safe = this.safeProjectId(projectId);
    return path.join(this.baseDir(), safe);
  }

  async read(
    projectId: string,
    rel: string,
    options: FileStorageScopeOptions & { encoding?: string; maxBytes?: number; allowedExtensions?: string[] } = {},
  ) {
    const { target, root } = await this.resolveSafe(projectId, rel, { allowMissing: false, folder: options.folder });
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
    return { path: this.displayPath(root, target), content, size: info.size, mimeType: this.mime(target) };
  }

  /**
   * Reads a sandboxed file as raw base64 plus its detected mime type.
   * Used by consumers that need the bytes themselves (e.g. LLM attachments).
   */
  async readBuffer(
    projectId: string,
    rel: string,
    options: FileStorageScopeOptions & { maxBytes?: number } = {},
  ) {
    const { target, root } = await this.resolveSafe(projectId, rel, { allowMissing: false, folder: options.folder });
    const info = await stat(target);
    if (info.isDirectory()) throw new BadRequestException('readBuffer expects a file, not a directory');
    this.assertSize(info.size, options.maxBytes);
    const buffer = await readFile(target);
    return {
      path: this.displayPath(root, target),
      base64: buffer.toString('base64'),
      size: info.size,
      mimeType: this.mime(target),
    };
  }

  async write(
    projectId: string,
    rel: string,
    content: any,
    options: FileStorageScopeOptions & {
      mode?: string;
      encoding?: string;
      maxBytes?: number;
      allowedExtensions?: string[];
    } = {},
  ) {
    const { target, root } = await this.resolveSafe(projectId, rel, { allowMissing: true, folder: options.folder });
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
    return { path: this.displayPath(root, target), size: info.size, mimeType: this.mime(target), mode };
  }

  async list(
    projectId: string,
    rel = '.',
    options: FileStorageScopeOptions & { glob?: string; recursive?: boolean } = {},
  ) {
    const { target, root } = await this.resolveSafe(projectId, rel || '.', {
      allowMissing: false,
      folder: options.folder,
    });
    const info = await stat(target);
    const dir = info.isDirectory() ? target : path.dirname(target);
    const entries: Array<{ path: string; size: number; modifiedAt: string; isDir: boolean }> = [];
    await this.walk(root, dir, options.recursive === true, options.glob, entries);
    return entries.slice(0, 1000);
  }

  async remove(projectId: string, rel: string, recursive = false, folder?: string) {
    const { target, root } = await this.resolveSafe(projectId, rel, { allowMissing: false, folder });
    if (path.resolve(target) === path.resolve(root)) {
      throw new BadRequestException('Refusing to delete the project file root');
    }
    await rm(target, { recursive: recursive === true, force: false });
    return { path: this.displayPath(root, target), deleted: true };
  }

  async move(projectId: string, from: string, to: string, folder?: string) {
    const source = await this.resolveSafe(projectId, from, { allowMissing: false, folder });
    const dest = await this.resolveSafe(projectId, to, { allowMissing: true, folder });
    await mkdir(path.dirname(dest.target), { recursive: true });
    await rename(source.target, dest.target);
    return {
      from: this.displayPath(source.root, source.target),
      to: this.displayPath(dest.root, dest.target),
    };
  }

  async copy(projectId: string, from: string, to: string, folder?: string) {
    const source = await this.resolveSafe(projectId, from, { allowMissing: false, folder });
    const dest = await this.resolveSafe(projectId, to, { allowMissing: true, folder });
    await mkdir(path.dirname(dest.target), { recursive: true });
    await copyFile(source.target, dest.target);
    return {
      from: this.displayPath(source.root, source.target),
      to: this.displayPath(dest.root, dest.target),
    };
  }

  async exists(projectId: string, rel: string, folder?: string): Promise<boolean> {
    try {
      const { target } = await this.resolveSafe(projectId, rel, { allowMissing: true, folder });
      await access(target);
      return true;
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      return false;
    }
  }

  async stat(projectId: string, rel: string, folder?: string) {
    const { target, root } = await this.resolveSafe(projectId, rel, { allowMissing: false, folder });
    const info = await stat(target);
    return {
      path: this.displayPath(root, target),
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      createdAt: info.birthtime.toISOString(),
      isDir: info.isDirectory(),
      mimeType: info.isDirectory() ? 'inode/directory' : this.mime(target),
    };
  }

  async parse(
    projectId: string,
    rel: string,
    format?: string,
    maxBytes?: number,
    folder?: string,
  ) {
    const file = await this.read(projectId, rel, { encoding: 'utf8', maxBytes, folder });
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

  async resolveSafe(
    projectId: string,
    rel: string,
    options: { allowMissing: boolean; folder?: string },
  ): Promise<{ target: string; root: string }> {
    if (typeof rel !== 'string' || !rel.trim()) throw new BadRequestException('A file path is required');
    if (rel.includes('\0')) throw new BadRequestException('Invalid file path');
    const root = await this.resolveRoot(projectId, options.folder);
    const normalizedRel = this.normalizeRelativePath(root, rel);
    const target = path.resolve(root, normalizedRel);
    this.assertInside(root, target);
    if (existsSync(target)) {
      const real = realpathSync(target);
      this.assertInside(root, real);
      return { target: real, root };
    }
    if (!options.allowMissing) throw new BadRequestException(`File not found: ${rel}`);
    const parent = path.dirname(target);
    if (existsSync(parent)) {
      const realParent = realpathSync(parent);
      this.assertInside(root, realParent);
      return { target: path.join(realParent, path.basename(target)), root };
    }
    return { target, root };
  }

  private async resolveRoot(projectId: string, folderOverride?: string): Promise<string> {
    const defaultRoot = this.rootFor(projectId);
    const project = await this.loadProject(projectId);
    const configuredRoot = String(project?.metadata?.fileStoragePath || '').trim();
    const baseRoot = configuredRoot
      ? await this.ensureDirectory(configuredRoot)
      : defaultRoot;

    const rawOverride = String(folderOverride || '').trim();
    if (rawOverride) {
      const resolvedOverride = await this.ensureDirectory(rawOverride);
      const allowedRoots = await this.allowedRoots(project, baseRoot);
      const hasExplicitAllowlist = Boolean(
        configuredRoot
        || (Array.isArray(project?.metadata?.allowedFileRoots) && project.metadata.allowedFileRoots.length > 0),
      );
      if (
        hasExplicitAllowlist
        && !allowedRoots.some((allowedRoot) => this.isWithin(allowedRoot, resolvedOverride))
      ) {
        throw new BadRequestException('Folder is outside allowed file roots');
      }
      return resolvedOverride;
    }

    await mkdir(baseRoot, { recursive: true });
    return realpathSync(baseRoot);
  }

  private async allowedRoots(project: Record<string, any> | null, defaultRoot: string): Promise<string[]> {
    const primary = String(project?.metadata?.fileStoragePath || '').trim();
    const additional = Array.isArray(project?.metadata?.allowedFileRoots)
      ? project.metadata.allowedFileRoots
      : [];
    const configured = primary
      ? [...new Set([primary, ...additional])]
      : [...new Set([defaultRoot, ...additional])];
    const roots = await Promise.all(
      configured.map(async (root) => {
        if (typeof root !== 'string' || !path.isAbsolute(root)) {
          throw new BadRequestException('Allowed file roots must be absolute paths');
        }
        if (primary && root === primary) return this.ensureDirectory(root);
        return this.resolveDirectory(root, 'An allowed file root does not exist');
      }),
    );
    return [...new Set(roots)];
  }

  private async loadProject(projectId: string) {
    if (!this.projectModel || !projectId || !isValidObjectId(projectId)) return null;
    return this.projectModel.findById(projectId).lean().exec();
  }

  private async ensureDirectory(rawPath: string): Promise<string> {
    if (!path.isAbsolute(rawPath)) {
      throw new BadRequestException('File folders must be absolute paths');
    }
    await mkdir(rawPath, { recursive: true });
    const resolved = await realpath(rawPath);
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      throw new BadRequestException('File folders must be directories');
    }
    return resolved;
  }

  private async resolveDirectory(rawPath: string, missingMessage: string): Promise<string> {
    if (!path.isAbsolute(rawPath)) {
      throw new BadRequestException('File folders must be absolute paths');
    }
    const resolved = await realpath(rawPath).catch(() => {
      throw new BadRequestException(missingMessage);
    });
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      throw new BadRequestException('File folders must be directories');
    }
    return resolved;
  }

  private normalizeRelativePath(root: string, rel: string): string {
    const trimmed = rel.trim();
    if (!path.isAbsolute(trimmed)) return trimmed;
    const absolute = this.canonicalPath(trimmed);
    const canonicalRoot = this.canonicalPath(root);
    if (!this.isWithin(canonicalRoot, absolute)) return trimmed;
    return path.relative(canonicalRoot, absolute) || '.';
  }

  private canonicalPath(target: string): string {
    const resolved = path.resolve(target);
    if (existsSync(resolved)) return realpathSync(resolved);
    return resolved;
  }

  private isWithin(root: string, candidate: string): boolean {
    const relative = path.relative(this.canonicalPath(root), this.canonicalPath(candidate));
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }

  private async walk(
    root: string,
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
      const display = this.displayPath(root, full);
      const isDir = info.isDirectory();
      if (!glob || matchGlob(glob, display)) {
        out.push({ path: display, size: info.size, modifiedAt: info.mtime.toISOString(), isDir });
      }
      if (recursive && isDir) await this.walk(root, full, true, glob, out);
    }
  }

  private displayPath(root: string, absolute: string): string {
    const rel = path.relative(this.canonicalPath(root), this.canonicalPath(absolute));
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BadRequestException('Path escapes the project file sandbox');
    }
    return rel.split(path.sep).join('/');
  }

  private assertInside(root: string, target: string) {
    const relative = path.relative(this.canonicalPath(root), this.canonicalPath(target));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new BadRequestException('Path escapes the project file sandbox');
    }
  }

  private safeProjectId(projectId: string): string {
    return String(projectId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
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
