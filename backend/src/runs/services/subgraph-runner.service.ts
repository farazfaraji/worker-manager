import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { isValidObjectId } from 'mongoose';
import { RuntimeNode } from './variable-resolver.service';
import { ForEachResult, ForEachItemResult } from '../../blocks/block.types';

export type RunGraphDelegate = (
  graphId: string,
  initialInput?: any,
  options?: any,
) => Promise<any>;

@Injectable()
export class SubgraphRunnerService {
  private readonly logger = new Logger(SubgraphRunnerService.name);

  async executeSubgraphNode(
    node: RuntimeNode,
    nodeInput: any,
    runId: string,
    currentDepth: number,
    visitedArtifactLogicalIds: string[] = [],
    runGraph: RunGraphDelegate,
  ): Promise<any> {
    const data = node.data || {};
    const config = data.config || {};
    const nodeName = data.name || data.nodeName || node.id;
    const targetGraphId = String(nodeInput?.graphId || config.graphId || '').trim();

    if (!targetGraphId) {
      throw new BadRequestException(`Subgraph node "${nodeName}" requires a valid target graphId`);
    }

    let childInput: any = {};
    if (nodeInput?.input !== undefined && nodeInput.input !== null && nodeInput.input !== '') {
      childInput = nodeInput.input;
    } else if (nodeInput?.inputMapping !== undefined && nodeInput.inputMapping !== null && nodeInput.inputMapping !== '') {
      childInput = nodeInput.inputMapping;
    } else if (config.input !== undefined && config.input !== null && config.input !== '') {
      childInput = config.input;
    } else if (config.inputMapping !== undefined && config.inputMapping !== null && config.inputMapping !== '') {
      childInput = config.inputMapping;
    }

    if (typeof childInput === 'string') {
      const trimmed = childInput.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          childInput = JSON.parse(trimmed);
        } catch {}
      }
    }

    this.logger.log(`🔗 [Subgraph Execution] Invoking "${targetGraphId}" (Parent: ${runId}, Depth: ${currentDepth + 1})`);

    const childRun = await runGraph(targetGraphId, childInput, {
      parentRunId: runId,
      subgraphDepth: currentDepth + 1,
      visitedArtifactLogicalIds,
    });

    if (childRun.status === 'waiting') {
      return {
        status: 'waiting',
        result: childRun.output,
        childRunId: childRun.runId,
      };
    }

    if (childRun.status === 'failed') {
      throw new Error(childRun.error?.message || `Child run ${childRun.runId} failed`);
    }

    const outputMode = String(nodeInput?.outputMode || config.outputMode || 'result').toLowerCase();
    if (outputMode === 'state') {
      return {
        result: childRun.output,
        state: childRun.nodes,
        childRunId: childRun.runId,
      };
    }

    return {
      result: childRun.output,
      childRunId: childRun.runId,
      ...(typeof childRun.output === 'object' && childRun.output !== null ? childRun.output : {}),
    };
  }

  async executeForeachNode(
    node: RuntimeNode,
    nodeInput: any,
    runId: string,
    currentDepth = 0,
    visitedArtifactLogicalIds: string[] = [],
    runGraph: RunGraphDelegate,
  ): Promise<any> {
    const data = node.data || {};
    const config = data.config || {};
    const nodeName = data.name || data.nodeName || node.id;
    const targetGraphId = String(nodeInput?.graphId || config.graphId || '').trim();

    if (!targetGraphId || !isValidObjectId(targetGraphId)) {
      const err = `Foreach node "${nodeName}" requires a valid target graphId`;
      const result: ForEachResult = {
        status: 'failed',
        count: 0,
        processed: 0,
        truncated: false,
        items: [],
        errors: [{ index: -1, error: err }],
      };
      return { result, ...result, error: err };
    }

    let rawItemsInput = nodeInput?.items !== undefined ? nodeInput.items : config.items;
    if (typeof rawItemsInput === 'string') {
      const trimmed = rawItemsInput.trim();
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        try {
          rawItemsInput = JSON.parse(trimmed);
        } catch {}
      }
    }

    let itemsArray: any[] | null = null;
    if (Array.isArray(rawItemsInput)) {
      itemsArray = rawItemsInput;
    } else if (rawItemsInput && typeof rawItemsInput === 'object') {
      if (Array.isArray(rawItemsInput.items)) {
        itemsArray = rawItemsInput.items;
      } else if (rawItemsInput.result && Array.isArray(rawItemsInput.result.items)) {
        itemsArray = rawItemsInput.result.items;
      }
    }

    if (itemsArray === null) {
      const err = `Foreach node "${nodeName}" items must be an array or an object containing an items array`;
      const result: ForEachResult = {
        status: 'failed',
        count: 0,
        processed: 0,
        truncated: false,
        items: [],
        errors: [{ index: -1, error: err }],
      };
      return { result, ...result, error: err };
    }

    let baseInput = nodeInput?.baseInput !== undefined ? nodeInput.baseInput : config.baseInput;
    if (typeof baseInput === 'string' && baseInput.trim()) {
      const trimmed = baseInput.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          baseInput = JSON.parse(trimmed);
        } catch {}
      }
    }

    if (baseInput !== undefined && baseInput !== null && (typeof baseInput !== 'object' || Array.isArray(baseInput))) {
      const err = `Foreach node "${nodeName}" baseInput must resolve to an object when provided`;
      const result: ForEachResult = {
        status: 'failed',
        count: itemsArray.length,
        processed: 0,
        truncated: false,
        items: [],
        errors: [{ index: -1, error: err }],
      };
      return { result, ...result, error: err };
    }
    const resolvedBaseInput = (baseInput && typeof baseInput === 'object') ? baseInput : {};

    const rawMaxIterations = nodeInput?.maxIterations !== undefined ? nodeInput.maxIterations : config.maxIterations;
    let maxIterations = 25;
    if (rawMaxIterations !== undefined && rawMaxIterations !== null && rawMaxIterations !== '') {
      const parsed = Number(rawMaxIterations);
      if (isNaN(parsed) || parsed < 1 || parsed > 100) {
        const err = `Foreach node "${nodeName}" maxIterations must be a number between 1 and 100`;
        const result: ForEachResult = {
          status: 'failed',
          count: itemsArray.length,
          processed: 0,
          truncated: false,
          items: [],
          errors: [{ index: -1, error: err }],
        };
        return { result, ...result, error: err };
      }
      maxIterations = Math.floor(parsed);
    }

    const rawConcurrency = nodeInput?.concurrency !== undefined ? nodeInput.concurrency : config.concurrency;
    let concurrency = 1;
    if (rawConcurrency !== undefined && rawConcurrency !== null && rawConcurrency !== '') {
      const parsed = Number(rawConcurrency);
      if (!isNaN(parsed)) {
        concurrency = Math.min(10, Math.max(1, Math.floor(parsed)));
      }
    }

    const stopOnError = Boolean(nodeInput?.stopOnError ?? config.stopOnError ?? false);
    const outputMode = String(nodeInput?.outputMode || config.outputMode || 'result').toLowerCase();

    const originalItemCount = itemsArray.length;
    const truncated = originalItemCount > maxIterations;
    const itemsToProcess = itemsArray.slice(0, maxIterations);

    if (itemsToProcess.length === 0) {
      const result: ForEachResult = {
        status: 'completed',
        count: 0,
        processed: 0,
        truncated: false,
        items: [],
        errors: [],
      };
      return { result, ...result };
    }

    let nextIndex = 0;
    let hasErrorOccurred = false;
    const indexedResults: ForEachItemResult[] = new Array(itemsToProcess.length);

    const numWorkers = Math.min(concurrency, itemsToProcess.length);
    const workers = Array.from({ length: numWorkers }, async () => {
      while (nextIndex < itemsToProcess.length) {
        if (stopOnError && hasErrorOccurred) break;
        const currentIndex = nextIndex++;
        const currentItem = itemsToProcess[currentIndex];

        const childInput = {
          ...resolvedBaseInput,
          item: currentItem,
          index: currentIndex,
          total: originalItemCount,
        };

        try {
          const childRun = await runGraph(targetGraphId, childInput, {
            parentRunId: runId,
            subgraphDepth: currentDepth + 1,
            visitedArtifactLogicalIds,
          });

          if (childRun.status === 'waiting') {
            indexedResults[currentIndex] = {
              index: currentIndex,
              item: currentItem,
              status: 'failed',
              childRunId: childRun.runId,
              error: {
                message: 'Child graph returned waiting status which is unsupported in foreach',
                errorCode: 'FOREACH_CHILD_WAITING_UNSUPPORTED',
              },
            };
            if (stopOnError) hasErrorOccurred = true;
          } else if (childRun.status === 'failed') {
            indexedResults[currentIndex] = {
              index: currentIndex,
              item: currentItem,
              status: 'failed',
              childRunId: childRun.runId,
              error: childRun.error || 'Child run failed',
            };
            if (stopOnError) hasErrorOccurred = true;
          } else {
            const itemResultValue = outputMode === 'state' ? childRun.nodes : childRun.output;
            indexedResults[currentIndex] = {
              index: currentIndex,
              item: currentItem,
              status: 'completed',
              result: itemResultValue,
              childRunId: childRun.runId,
            };
          }
        } catch (err: any) {
          indexedResults[currentIndex] = {
            index: currentIndex,
            item: currentItem,
            status: 'failed',
            error: err?.message || String(err),
          };
          if (stopOnError) hasErrorOccurred = true;
        }
      }
    });

    await Promise.all(workers);

    const completedItems: ForEachItemResult[] = [];
    const errorsList: Array<{ index: number; childRunId?: string; error: any }> = [];
    for (let i = 0; i < indexedResults.length; i++) {
      if (indexedResults[i] !== undefined) {
        completedItems.push(indexedResults[i]);
        if (indexedResults[i].status === 'failed') {
          errorsList.push({
            index: indexedResults[i].index,
            childRunId: indexedResults[i].childRunId,
            error: indexedResults[i].error,
          });
        }
      }
    }

    const status: 'completed' | 'partial' | 'failed' =
      errorsList.length === 0
        ? 'completed'
        : (stopOnError ? 'failed' : 'partial');

    const foreachResult: ForEachResult = {
      status,
      count: originalItemCount,
      processed: completedItems.length,
      truncated,
      items: completedItems,
      errors: errorsList,
    };

    return {
      result: foreachResult,
      ...foreachResult,
    };
  }
}
