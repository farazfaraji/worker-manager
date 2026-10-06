import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { isValidObjectId } from 'mongoose';
import { RuntimeNode } from './variable-resolver.service';
import { ForEachResult, ForEachItemResult } from '../../blocks/block.types';
import { redactSecrets } from './redaction.util';
import { normalizeCollectionInput } from '../utils/collection-input.util';
import { RunTopologyService } from './run-topology.service';

interface CanvasBranchContext {
  startNodeId: string;
  nodeById: Map<string, RuntimeNode>;
  outgoing: Map<string, any[]>;
}

export type RunGraphDelegate = (
  graphId: string,
  initialInput?: any,
  options?: any,
) => Promise<any>;

export interface ForeachExecutionOptions {
  context?: Record<string, any>;
  nodes?: RuntimeNode[];
  edges?: any[];
  executeNode?: (node: RuntimeNode, nodeInput: any, context: Record<string, any>, initialInput?: any) => Promise<any>;
  resolveInput?: (node: RuntimeNode, context: Record<string, any>, initialInput?: any) => any;
  normalizeOutput?: (node: RuntimeNode, rawOutput: any) => any;
}

@Injectable()
export class SubgraphRunnerService {
  private readonly logger = new Logger(SubgraphRunnerService.name);
  private readonly topologyService: RunTopologyService;

  constructor(@Optional() topologyService?: RunTopologyService) {
    this.topologyService = topologyService || new RunTopologyService();
  }

  /** Runs a saved child graph once per research round without adding graph cycles. */
  async executeIterativeLoopNode(
    node: RuntimeNode,
    nodeInput: any,
    runId: string,
    currentDepth: number,
    visitedArtifactLogicalIds: string[],
    runGraph: RunGraphDelegate,
    isCancelled?: () => Promise<boolean>,
  ): Promise<any> {
    // A dotted path such as "review.decision" can resolve to undefined while
    // preparing nodeInput. Do not let that erase the saved literal path.
    const resolvedInput = Object.fromEntries(
      Object.entries(nodeInput || {}).filter(([, value]) => value !== undefined),
    );
    const config = { ...(node.data?.config || {}), ...resolvedInput };
    const graphId = String(config.graphId || '').trim();
    if (!isValidObjectId(graphId)) throw new BadRequestException('Research Loop requires a saved child graph');
    const maxIterations = Number(config.maxRounds ?? 3);
    if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10) throw new BadRequestException('Research Loop maxRounds must be an integer from 1 to 10');
    const maxHandoffChars = Number(config.maxHandoffChars ?? 12000);
    if (!Number.isInteger(maxHandoffChars) || maxHandoffChars < 1000 || maxHandoffChars > 16000) throw new BadRequestException('Research Loop maxHandoffChars must be from 1,000 to 16,000');
    const completionPath = String(config.completionPath || 'decision');
    if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(completionPath)) throw new BadRequestException('Research Loop completionPath must be a property path');
    const completionValue = config.completionValue ?? 'pass';
    const gapPath = String(config.gapPath || 'gaps');
    if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(gapPath)) throw new BadRequestException('Research Loop gapPath must be a property path');
    const readPath = (value: any, path: string) => path.split('.').reduce((current, key) => current?.[key], value);
    let suppliedInput = config.initialInput;
    let suppliedGaps = config.initialGaps;
    if (typeof suppliedInput === 'string') {
      try { suppliedInput = JSON.parse(suppliedInput); } catch { throw new BadRequestException('Research Loop initialInput must be a JSON object'); }
    }
    if (typeof suppliedGaps === 'string') {
      try { suppliedGaps = JSON.parse(suppliedGaps); } catch { throw new BadRequestException('Research Loop initialGaps must be a JSON array'); }
    }
    if (suppliedInput !== undefined && (typeof suppliedInput !== 'object' || suppliedInput === null || Array.isArray(suppliedInput))) throw new BadRequestException('Research Loop initialInput must be an object');
    if (suppliedGaps !== undefined && !Array.isArray(suppliedGaps)) throw new BadRequestException('Research Loop initialGaps must be an array');
    const initialInput = suppliedInput || {};
    const rounds: any[] = [];
    let gaps = suppliedGaps ?? [];
    let priorResult: any = null;
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      if (await isCancelled?.()) {
        const error: any = new Error(`Research Loop cancelled before round ${iteration}`);
        error.code = 'RUN_CANCELLED';
        throw error;
      }
      const childInput = { ...initialInput, iteration, gaps, priorResult };
      // Idempotency keeps a completed child round from being rerun on parent recovery.
      const childRun = await runGraph(graphId, childInput, {
        parentRunId: runId,
        subgraphDepth: currentDepth + 1,
        visitedArtifactLogicalIds,
        idempotencyKey: `research-loop:${runId}:${node.id}:${iteration}`,
      });
      if (await isCancelled?.()) {
        const error: any = new Error(`Research Loop cancelled after round ${iteration}`);
        error.code = 'RUN_CANCELLED';
        throw error;
      }
      if (childRun.status === 'waiting') {
        return { status: 'waiting', childRunId: childRun.runId, resumeToken: childRun.resumeToken, waitingDescriptor: childRun.waitingDescriptor, result: childRun.output };
      }
      if (childRun.status !== 'completed') {
        const code = 'RESEARCH_LOOP_CHILD_FAILED';
        const detail = redactSecrets(String(childRun.error || childRun.status)).slice(0, 500);
        const error: any = new Error(`Research Loop round ${iteration} (child run ${childRun.runId}) failed: ${detail}`);
        error.code = code;
        throw error;
      }
      const output = childRun.output;
      const serialized = JSON.stringify(output ?? null);
      if (serialized.length > 32000) {
        const error: any = new Error(`Research Loop round ${iteration} output exceeds 32,000 characters; save large documents as artifacts and return their IDs`);
        error.code = 'RESEARCH_LOOP_OUTPUT_TOO_LARGE';
        throw error;
      }
      rounds.push({ iteration, childRunId: childRun.runId, output });
      const completion = readPath(output, completionPath);
      const nextGaps = readPath(output, gapPath);
      if (completion === undefined) throw new BadRequestException(`Research Loop completionPath "${completionPath}" was not found in child round ${iteration} output`);
      if (!Array.isArray(nextGaps)) throw new BadRequestException(`Research Loop gapPath "${gapPath}" must resolve to an array in child round ${iteration} output`);
      if (completion === completionValue) {
        const result = { status: 'completed', decision: completion, iterations: rounds, count: iteration, stopReason: 'condition_met', limitReached: false, gaps: nextGaps, output };
        return { status: 'completed', result, ...result };
      }
      gaps = nextGaps;
      // Only the prior round is passed to the next child; keep the handoff bounded.
      priorResult = serialized.length <= maxHandoffChars ? output : { truncated: true, excerpt: serialized.slice(0, maxHandoffChars) };
    }
    const result = { status: 'incomplete', decision: 'incomplete_needs_human_review', iterations: rounds, count: rounds.length, stopReason: 'iteration_limit', limitReached: true, gaps, output: rounds[rounds.length - 1]?.output };
    return { status: 'completed', result, ...result };
  }

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

    const resolvedChildInput =
      typeof childInput === 'object' && childInput !== null
        ? childInput
        : { value: childInput };

    const childRun = await runGraph(targetGraphId, resolvedChildInput, {
      parentRunId: runId,
      subgraphDepth: currentDepth + 1,
      visitedArtifactLogicalIds,
    });

    if (childRun.status === 'waiting') {
      return {
        status: 'waiting',
        childRunId: childRun.runId,
        waitingNodeId: childRun.waitingNodeId,
        waitingTokenId: childRun.waitingTokenId,
        resumeToken: childRun.resumeToken,
        waitingDescriptor: childRun.waitingDescriptor,
        result: childRun.output,
        output: childRun.output,
      };
    }

    if (childRun.status === 'failed') {
      const err: any = new Error(childRun.error || `Subgraph execution failed for node "${nodeName}"`);
      err.code = childRun.errorCode || 'SUBGRAPH_EXECUTION_FAILED';
      throw err;
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
    options?: ForeachExecutionOptions,
  ): Promise<any> {
    const data = node.data || {};
    const config = data.config || {};
    const nodeName = data.name || data.nodeName || node.id;
    const targetGraphId = String(nodeInput?.graphId || config.graphId || '').trim();
    const explicitMode = String(nodeInput?.mode || config.mode || '').toLowerCase();
    const isCanvasMode =
      explicitMode === 'canvas' ||
      (!explicitMode && !targetGraphId && Boolean(options?.edges?.some((e) => e.source === node.id)));
    const mode = isCanvasMode ? 'canvas' : 'subgraph';
    const executionType = String(nodeInput?.executionType || config.executionType || 'sync').toLowerCase();
    const isAsync = executionType === 'async';

    if (mode === 'subgraph' && (!targetGraphId || !isValidObjectId(targetGraphId))) {
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

    const itemsArray = normalizeCollectionInput(rawItemsInput);

    if (itemsArray === null) {
      const err = `Foreach node "${nodeName}" items must be an array or an object containing an items or files array`;
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

    // In-Canvas Mode: Identify the loop iteration branch starting from 'item' handle
    let canvasBranch: CanvasBranchContext | null = null;
    if (mode !== 'subgraph') {
      const loopStartEdge = (options?.edges || []).find(
        (e: any) => e.source === node.id && String(e.sourceHandle || '').toLowerCase() === 'item',
      );
      const fallbackEdge = (options?.edges || []).find(
        (e: any) =>
          e.source === node.id &&
          !['done', 'partial', 'failed'].includes(String(e.sourceHandle || '').toLowerCase()),
      );
      const startNodeId = loopStartEdge?.target || fallbackEdge?.target;

      if (startNodeId) {
        const nodeMap = new Map((options?.nodes || []).map((n) => [n.id, n]));
        const outgoingMap = new Map<string, any[]>();
        for (const e of (options?.edges || [])) {
          if (!outgoingMap.has(e.source)) outgoingMap.set(e.source, []);
          outgoingMap.get(e.source)!.push(e);
        }

        const branchNodes: RuntimeNode[] = [];
        const visited = new Set<string>();
        const q = [startNodeId];
        visited.add(startNodeId);

        while (q.length > 0) {
          const currId = q.shift()!;
          const currNode = nodeMap.get(currId);
          if (!currNode) continue;
          branchNodes.push(currNode);

          const currType = String(currNode.data?.definitionType || currNode.type || '').toLowerCase();
          if (currType === 'output') {
            continue; // Output node is the branch boundary
          }

          const outEdges = outgoingMap.get(currId) || [];
          for (const edge of outEdges) {
            if (edge.target === node.id) continue;
            if (!visited.has(edge.target)) {
              visited.add(edge.target);
              q.push(edge.target);
            }
          }
        }

        if (branchNodes.some((branchNode) => {
          const branchType = String(branchNode.data?.definitionType || branchNode.type || '').toLowerCase();
          return branchType === 'human-gate' || branchType === 'humangate' || (branchType === 'telegram' && branchNode.data?.config?.mode === 'question');
        })) throw new BadRequestException('Human gates inside a foreach item branch are not supported. Place the gate after foreach.');

        canvasBranch = {
          startNodeId,
          nodeById: new Map(branchNodes.map((branchNode) => [branchNode.id, branchNode])),
          outgoing: outgoingMap,
        };
      } else {
        this.logger.warn(`Foreach node "${nodeName}" in canvas mode has no connected item branch edges.`);
      }
    }

    let nextIndex = 0;
    let hasErrorOccurred = false;
    const indexedResults: ForEachItemResult[] = new Array(itemsToProcess.length);

    const numWorkers = Math.min(concurrency, itemsToProcess.length);
    const runWorkerLoop = async () => {
      while (nextIndex < itemsToProcess.length) {
        if (stopOnError && hasErrorOccurred) break;
        const currentIndex = nextIndex++;
        const currentItem = itemsToProcess[currentIndex];

        // 1. IN-CANVAS EXECUTION
        if (mode !== 'subgraph') {
          if (!canvasBranch) {
            indexedResults[currentIndex] = {
              index: currentIndex,
              item: currentItem,
              status: 'completed',
              result: currentItem,
            };
            continue;
          }

          const itemContext: Record<string, any> = {
            ...(options?.context || {}),
            [nodeName]: {
              item: currentItem,
              index: currentIndex,
              total: originalItemCount,
              ...resolvedBaseInput,
            },
            item: currentItem,
            index: currentIndex,
            total: originalItemCount,
          };

          let lastOutput: any = undefined;
          let capturedResult: any = undefined;
          const executedRecords: any[] = [];
          let itemFailed = false;

          const executionQueue = [canvasBranch.startNodeId];
          const executedNodeIds = new Set<string>();

          while (executionQueue.length > 0) {
            const currId = executionQueue.shift()!;
            if (executedNodeIds.has(currId)) continue;
            executedNodeIds.add(currId);

            const currNode = canvasBranch.nodeById.get(currId);
            if (!currNode) continue;

            const currNodeName = currNode.data?.name || currNode.data?.nodeName || currNode.id;
            try {
              const currInput = options?.resolveInput
                ? options.resolveInput(currNode, itemContext, currentItem)
                : currNode.data?.config || {};

              const raw = options?.executeNode
                ? await options.executeNode(currNode, currInput, itemContext, currentItem)
                : null;

              const normalized = options?.normalizeOutput
                ? options.normalizeOutput(currNode, raw)
                : raw;

              itemContext[currNodeName] = normalized;
              lastOutput = normalized;
              executedRecords.push({ nodeId: currNode.id, nodeName: currNodeName, output: normalized });

              const currType = String(currNode.data?.definitionType || currNode.type || '').toLowerCase();
              if (currType === 'output') {
                capturedResult = normalized?.result !== undefined ? normalized.result : (normalized?.value !== undefined ? normalized.value : normalized);
                break;
              }

              const nodeEdges = (canvasBranch.outgoing.get(currId) || []).filter(
                (edge) => canvasBranch!.nodeById.has(edge.target),
              );
              const nextNodeIds = this.topologyService.resolveNextTargets(currNode, normalized, nodeEdges);
              for (const nextNodeId of nextNodeIds) {
                if (!executedNodeIds.has(nextNodeId)) {
                  executionQueue.push(nextNodeId);
                }
              }
            } catch (err: any) {
              itemFailed = true;
              indexedResults[currentIndex] = {
                index: currentIndex,
                item: currentItem,
                status: 'failed',
                error: err?.message || String(err),
              };
              if (stopOnError) hasErrorOccurred = true;
              break;
            }
          }

          if (!itemFailed) {
            const finalItemResult = capturedResult !== undefined ? capturedResult : lastOutput;
            indexedResults[currentIndex] = {
              index: currentIndex,
              item: currentItem,
              status: 'completed',
              result: finalItemResult,
              nodes: executedRecords,
            } as any;
          }
        } else {
          // 2. CHILD SUBGRAPH EXECUTION
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
              idempotencyKey: `foreach:${runId}:${node.id}:${currentIndex}`,
            });

            if (childRun.status === 'waiting') {
              if (isAsync || concurrency !== 1) throw new BadRequestException('A foreach child with a human gate requires synchronous execution and concurrency 1');
              throw { status: 'waiting', childRunId: childRun.runId, resumeToken: childRun.resumeToken, waitingDescriptor: childRun.waitingDescriptor, result: childRun.output };
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
            if (err?.status === 'waiting') throw err;
            indexedResults[currentIndex] = {
              index: currentIndex,
              item: currentItem,
              status: 'failed',
              error: err?.message || String(err),
            };
            if (stopOnError) hasErrorOccurred = true;
          }
        }
      }
    };

    const workers = Array.from({ length: numWorkers }, () => runWorkerLoop());

    // ASYNC MODE: Non-blocking fire-and-forget dispatch
    if (isAsync) {
      (async () => {
        try {
          await Promise.all(workers);
          this.logger.log(`⚡ [Async Foreach] Completed background execution for node "${nodeName}" (${itemsToProcess.length} items)`);
        } catch (err: any) {
          this.logger.error(`❌ [Async Foreach] Background worker error in node "${nodeName}": ${err.message}`);
        }
      })();

      const asyncResult: ForEachResult = {
        status: 'completed',
        count: originalItemCount,
        processed: 0,
        truncated,
        items: [],
        errors: [],
      };

      return {
        result: asyncResult,
        ...asyncResult,
        async: true,
      };
    }

    // SYNC MODE: Await all workers
    try {
      await Promise.all(workers);
    } catch (error: any) {
      if (error?.status === 'waiting') return error;
      throw error;
    }

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
