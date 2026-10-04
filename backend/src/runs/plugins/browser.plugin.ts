import { Injectable } from '@nestjs/common';
import {
  ToolPlugin,
  ToolExecutionContext,
  OutputSynthesisContext,
  NodeOutputDefinition,
} from './tool-plugin.interface';
import { BrowserRunnerService } from '../services/browser-runner.service';

@Injectable()
export class BrowserPlugin implements ToolPlugin {
  readonly toolType = ['browser', 'app', 'brower'];

  constructor(private readonly browserRunner: BrowserRunnerService) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context, runId } = ctx;
    return this.browserRunner.executeBrowserNode(node, nodeInput, context, runId);
  }

  getValidHandles(_config?: any, _outputs?: any[], _nodeData?: any, _nodeName?: string): Set<string> {
    return new Set(['done', 'failed', 'onfailed', 'screenshot', 'text', 'result']);
  }

  getProducedPaths(nodeName: string, _config?: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>();
    const browserKeys = ['screenshot', 'text', 'url', 'title', 'html', 'css', 'path', 'actions'];
    for (const k of browserKeys) {
      paths.add(`${nodeName}.${k}`);
    }
    return paths;
  }

  synthesizeOutputs(ctx: OutputSynthesisContext): NodeOutputDefinition[] {
    const existing = ctx.data?.definitionOutputs || ctx.def?.outputs || ctx.data?.outputs || [];
    const hasLegacyResult = existing.some((o: NodeOutputDefinition) => o.name === 'result') || existing.length === 0;
    if (hasLegacyResult && ctx.def?.outputs?.length) {
      return ctx.def.outputs;
    }
    return existing;
  }
}
