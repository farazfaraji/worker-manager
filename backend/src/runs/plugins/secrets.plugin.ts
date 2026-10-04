import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { SecretsService } from '../../secrets/secrets.service';
import { registerResolvedSecret } from '../services/redaction.util';

@Injectable()
export class SecretsPlugin implements ToolPlugin {
  readonly toolType = 'secrets';

  constructor(@Optional() private readonly secrets?: SecretsService) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context, runId } = ctx;
    const config = node?.data?.config || {};
    const payload = { ...config, ...(nodeInput && typeof nodeInput === 'object' ? nodeInput : {}) };
    const op = String(payload.operation || 'get').toLowerCase();
    const projectId = String(context?.projectId || '');
    if (!projectId) throw new BadRequestException('secrets requires a projectId on the run');
    if (!this.secrets) throw new BadRequestException('SecretsService is not available');
    const name = String(payload.name || payload.secret || '');

    if (op === 'list') {
      const secrets = await this.secrets.list(projectId);
      return { status: 'completed', result: { secrets } };
    }
    if (op === 'exists') {
      const exists = name ? await this.secrets.exists(projectId, name) : false;
      return { status: 'completed', conditionMet: exists, result: { name, exists } };
    }
    if (op === 'set') {
      const stored = payload.value === undefined || payload.value === null
        ? ''
        : typeof payload.value === 'string'
          ? payload.value
          : JSON.stringify(payload.value);
      const meta = await this.secrets.set(projectId, name, stored, payload.description);
      return { status: 'completed', result: meta };
    }
    if (op === 'delete') {
      const result = await this.secrets.delete(projectId, name);
      return { status: 'completed', result };
    }

    const value = await this.secrets.resolve(projectId, name);
    if (value !== undefined) registerResolvedSecret(runId, value);
    return {
      status: 'completed',
      result: { name, exists: value !== undefined, secret: value ?? null },
    };
  }

  getValidHandles(): Set<string> {
    return new Set(['result', 'true', 'false']);
  }

  getProducedPaths(nodeName: string): Set<string> {
    return new Set([`${nodeName}.result`, `${nodeName}.result.secret`, `${nodeName}.result.exists`]);
  }
}
