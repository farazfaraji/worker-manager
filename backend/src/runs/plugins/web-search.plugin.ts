import { Injectable, Optional } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { WebSearchRunnerService } from '../services/web-search-runner.service';

@Injectable()
export class WebSearchPlugin implements ToolPlugin {
  readonly toolType = ['web-search', 'websearch', 'web_search'];

  constructor(@Optional() private readonly webSearchRunner?: WebSearchRunnerService) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context, runId } = ctx;
    if (!this.webSearchRunner) {
      throw new Error('WebSearchRunner is not available');
    }
    return this.webSearchRunner.executeWebSearchNode(node, nodeInput, context, runId);
  }

  getValidHandles(_config?: any, _outputs?: any[], _nodeData?: any, _nodeName?: string): Set<string> {
    return new Set(['done', 'onfailed', 'results', 'answer', 'query', 'text', 'result']);
  }

  getProducedPaths(nodeName: string, _config?: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>();
    const webSearchKeys = [
      'results',
      'query',
      'provider',
      'resultsCount',
      'title',
      'url',
      'originalUrl',
      'resolvedUrl',
      'accessedAt',
      'publishedAt',
      'text',
      'answer',
      'responseTime',
      'status',
      'html',
      'links',
      'result',
    ];
    for (const k of webSearchKeys) {
      paths.add(`${nodeName}.${k}`);
    }
    return paths;
  }
}
