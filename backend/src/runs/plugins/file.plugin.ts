import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { FileStorageService } from '../../blocks/file-storage.service';

@Injectable()
export class FilePlugin implements ToolPlugin {
  readonly toolType = 'file';
  private readonly storage: FileStorageService;

  constructor(@Optional() storage?: FileStorageService) {
    this.storage = storage || new FileStorageService();
  }

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context } = ctx;
    const config = node?.data?.config || {};
    const payload = { ...config, ...(nodeInput && typeof nodeInput === 'object' ? nodeInput : {}) };
    const op = String(payload.operation || 'read').toLowerCase();
    const projectId = String(context?.projectId || 'default');
    const rel = String(payload.path || payload.file || '');
    const folder = stringOrUndefined(payload.folder || payload.root || payload.directory);
    const limits = {
      maxBytes: numberOrUndefined(payload.maxBytes),
      allowedExtensions: arrayOfStrings(payload.allowedExtensions),
      folder,
    };

    if (op === 'read') {
      const result = await this.storage.read(projectId, rel, { encoding: payload.encoding, ...limits });
      return { status: 'completed', result };
    }
    if (op === 'write') {
      const result = await this.storage.write(projectId, rel, payload.content, {
        mode: payload.mode,
        encoding: payload.encoding,
        ...limits,
      });
      return { status: 'completed', result };
    }
    if (op === 'list') {
      const result = await this.storage.list(projectId, payload.path || '.', {
        glob: payload.glob ? String(payload.glob) : undefined,
        recursive: payload.recursive === true || payload.recursive === 'true',
        folder,
      });
      return { status: 'completed', result: { files: result } };
    }
    if (op === 'delete') {
      const result = await this.storage.remove(
        projectId,
        rel,
        payload.recursive === true || payload.recursive === 'true',
        folder,
      );
      return { status: 'completed', result };
    }
    if (op === 'move' || op === 'copy') {
      const to = String(payload.to || payload.destination || '');
      const result = op === 'move'
        ? await this.storage.move(projectId, rel, to, folder)
        : await this.storage.copy(projectId, rel, to, folder);
      return { status: 'completed', result };
    }
    if (op === 'exists') {
      const exists = await this.storage.exists(projectId, rel, folder);
      return { status: 'completed', conditionMet: exists, result: { path: rel, exists } };
    }
    if (op === 'stat') {
      return { status: 'completed', result: await this.storage.stat(projectId, rel, folder) };
    }
    if (op === 'parse') {
      return {
        status: 'completed',
        result: await this.storage.parse(projectId, rel, payload.format, limits.maxBytes, folder),
      };
    }
    if (op === 'download') {
      return { status: 'completed', result: await this.download(projectId, payload, limits) };
    }
    throw new BadRequestException(`Unknown file operation: ${op}`);
  }

  getValidHandles(): Set<string> {
    return new Set(['result', 'true', 'false']);
  }

  getProducedPaths(nodeName: string): Set<string> {
    return new Set([
      `${nodeName}.result`,
      `${nodeName}.result.path`,
      `${nodeName}.result.content`,
      `${nodeName}.result.files`,
    ]);
  }

  private async download(
    projectId: string,
    payload: any,
    limits: { maxBytes?: number; allowedExtensions?: string[] },
  ) {
    const url = String(payload.url || '');
    if (!/^https?:\/\//i.test(url)) throw new BadRequestException('file.download requires an http(s) URL');
    const hostname = new URL(url).hostname;
    const allowedHosts = arrayOfStrings(payload.allowedHosts);
    const allowAny = payload.allowAnyHost === true || payload.allowAnyHost === 'true';
    if (!allowedHosts.includes(hostname) && !allowAny) {
      return { dryRun: true, blocked: true, reason: 'Host is not in allowedHosts', url };
    }
    const response = await fetch(url);
    if (!response.ok) throw new BadRequestException(`Download failed with status ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const filename = String(payload.path || payload.filename || new URL(url).pathname.split('/').pop() || 'download.bin');
    return this.storage.write(projectId, filename, bytes, { mode: 'overwrite', ...limits });
  }
}

function stringOrUndefined(value: any): string | undefined {
  const parsed = String(value ?? '').trim();
  return parsed || undefined;
}

function numberOrUndefined(value: any): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function arrayOfStrings(value: any): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}
