import { Injectable, Logger, Optional, BadRequestException } from '@nestjs/common';
import {
  ToolPlugin,
  ToolExecutionContext,
  OutputSynthesisContext,
  NodeOutputDefinition,
} from './tool-plugin.interface';
import { SubgraphRunnerService } from '../services/subgraph-runner.service';
import { VariableResolverService } from '../services/variable-resolver.service';
import { normalizeCollectionInput } from '../utils/collection-input.util';

@Injectable()
export class ForeachPlugin implements ToolPlugin {
  readonly toolType = 'foreach';
  private readonly logger = new Logger(ForeachPlugin.name);

  constructor(
    @Optional() private readonly subgraphRunner?: SubgraphRunnerService,
    @Optional() private readonly variableResolver?: VariableResolverService,
  ) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context, runId } = ctx;
    const config = node?.data?.config || {};
    const nodeName = node?.data?.name || node?.data?.nodeName || node.id;

    this.logger.log(`🔁 [ForeachPlugin] Executing Foreach node "${node.id}" ($${nodeName})`);

    // 1. If SubgraphRunnerService is available and nodes/edges are passed, run full canvas/subgraph execution
    if (this.subgraphRunner && context.__allNodes) {
      return this.subgraphRunner.executeForeachNode(
        node,
        nodeInput,
        runId,
        0,
        [],
        undefined as any,
        {
          context,
          nodes: context.__allNodes || [],
          edges: context.__allEdges || [],
        },
      );
    }

    // 2. Self-contained execution for LangGraph StateGraph branch
    const rawItems = config.items !== undefined ? config.items : nodeInput?.items;
    let items = rawItems;
    if (this.variableResolver && typeof rawItems === 'string') {
      items = this.variableResolver.resolveValue(rawItems, context);
    }
    if (typeof items === 'string') {
      try {
        items = JSON.parse(items);
      } catch {}
    }

    const itemsToProcess = normalizeCollectionInput(items) ?? [];
    const maxIterations = Math.min(100, Math.max(1, Number(config.maxIterations || 100)));
    const sliced = itemsToProcess.slice(0, maxIterations);
    const isTruncated = itemsToProcess.length > maxIterations;

    const results = sliced.map((item, index) => ({
      index,
      item,
      status: 'completed' as const,
      result: item,
    }));

    const outputPayload = {
      status: 'completed',
      count: itemsToProcess.length,
      processed: sliced.length,
      truncated: isTruncated,
      items: results,
      result: results,
    };

    return outputPayload;
  }

  getValidHandles(_config?: any, _outputs?: any[], _nodeData?: any, _nodeName?: string): Set<string> {
    return new Set(['item', 'done', 'partial', 'failed', 'result']);
  }

  getProducedPaths(nodeName: string, _config?: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>([
      `${nodeName}.item`,
      `${nodeName}.index`,
      `${nodeName}.total`,
      `${nodeName}.result`,
    ]);
    for (const k of ['status', 'count', 'processed', 'truncated', 'items', 'errors']) {
      paths.add(`${nodeName}.result.${k}`);
    }
    return paths;
  }

  synthesizeOutputs(ctx: OutputSynthesisContext): NodeOutputDefinition[] {
    const mode = String(ctx.config.mode || 'canvas').toLowerCase();
    if (mode !== 'subgraph') {
      return [
        { name: 'item', label: 'Item (Loop)', type: 'branch' },
        { name: 'done', label: 'Done', type: 'branch' },
        { name: 'partial', label: 'Partial', type: 'branch' },
        { name: 'failed', label: 'Failed', type: 'branch' },
        { name: 'result', label: 'Foreach Result', type: 'object' },
      ];
    }
    return [
      { name: 'done', label: 'Done', type: 'branch' },
      { name: 'partial', label: 'Partial', type: 'branch' },
      { name: 'failed', label: 'Failed', type: 'branch' },
      { name: 'result', label: 'Foreach Result', type: 'object' },
    ];
  }
}
