import { Injectable, Logger, Optional } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { MemoryService } from '../../blocks/memory.service';

@Injectable()
export class MemoryPlugin implements ToolPlugin {
  readonly toolType = 'memory';
  private readonly logger = new Logger(MemoryPlugin.name);

  constructor(@Optional() private readonly memory?: MemoryService) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput } = ctx;
    const config = node?.data?.config || {};
    const payload = { ...config, ...nodeInput };
    const op = String(config.operation || payload.operation || 'recall').toLowerCase();

    if (!this.memory) {
      this.logger.warn('MemoryService is not available');
      return { status: 'completed', result: null };
    }

    const result =
      op === 'remember'
        ? await this.memory.remember(payload)
        : op === 'forget'
        ? await this.memory.forget(payload)
        : await this.memory.recall(payload);

    return { status: 'completed', result };
  }

  getValidHandles(_config?: any, _outputs?: any[], _nodeData?: any, _nodeName?: string): Set<string> {
    return new Set(['result']);
  }

  getProducedPaths(nodeName: string, _config?: any, _nodeData?: any): Set<string> {
    return new Set<string>([`${nodeName}.result`]);
  }
}
