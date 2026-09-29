import { Injectable, Logger } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';

@Injectable()
export class LoopPlugin implements ToolPlugin {
  readonly toolType = 'loop';
  private readonly logger = new Logger(LoopPlugin.name);

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput } = ctx;
    const config = node?.data?.config || {};
    const rawItems = Array.isArray(nodeInput)
      ? nodeInput
      : Array.isArray(nodeInput?.items)
      ? nodeInput.items
      : Array.isArray(config.items)
      ? config.items
      : [];

    const limit = Math.min(rawItems.length, Number(config?.maxIterations || 100));
    const results = rawItems.slice(0, limit).map((item: any, index: number) => ({ index, item }));

    return {
      status: 'completed',
      result: {
        items: results,
        count: results.length,
        truncated: rawItems.length > limit,
      },
      items: results,
      count: results.length,
      truncated: rawItems.length > limit,
    };
  }

  getValidHandles(_config?: any, _outputs?: any[], _nodeData?: any, _nodeName?: string): Set<string> {
    return new Set(['items', 'count', 'truncated', 'result']);
  }

  getProducedPaths(nodeName: string, _config?: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>();
    for (const key of ['items', 'count', 'truncated', 'result']) {
      paths.add(`${nodeName}.${key}`);
    }
    return paths;
  }
}
