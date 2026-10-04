import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { StateGraph, START, END, CompiledStateGraph, BaseCheckpointSaver, Command } from '@langchain/langgraph';
import { ToolPluginRegistry } from '../plugins/tool-plugin.registry';
import { VariableResolverService, RuntimeNode } from '../services/variable-resolver.service';
import { RunTopologyService } from '../services/run-topology.service';
import { FlowGraphState, FlowGraphStateType } from './graph-state';
import { usesBooleanBranch } from '../services/branch-routing.util';
import { MongoCheckpointSaver } from './mongo-checkpoint-saver';

export type CompiledFlowGraph = CompiledStateGraph<any, any, any, any, any, any>;

export interface CompileGraphOptions {
  checkpointer?: BaseCheckpointSaver;
  requestedStartNodeId?: string;
  interruptBefore?: string[];
  interruptAfter?: string[];
}

export interface ExecuteGraphOptions {
  runId: string;
  initialInput?: any;
  initialContext?: Record<string, any>;
  threadId?: string;
}

@Injectable()
export class GraphCompilerService {
  private readonly logger = new Logger(GraphCompilerService.name);

  constructor(
    @Inject(forwardRef(() => ToolPluginRegistry))
    private readonly registry: ToolPluginRegistry,
    private readonly variableResolver: VariableResolverService,
    @Optional() private readonly checkpointer?: MongoCheckpointSaver,
    @Optional() private readonly runTopologyService?: RunTopologyService,
  ) {}

  /**
   * Compiles canvas nodes and edges into a LangGraph StateGraph.
   */
  compile(
    nodes: RuntimeNode[],
    edges: any[],
    options: CompileGraphOptions = {},
  ): CompiledFlowGraph {
    const builder = new StateGraph(FlowGraphState);
    const validNodeIds = new Set<string>(nodes.map((n) => n.id));

    // 1. Add all nodes to the StateGraph
    for (const node of nodes) {
      const type = String(node.data?.definitionType || node.type || '').toLowerCase();
      const nodeName = String(node.data?.name || node.data?.nodeName || node.id);
      const plugin = this.registry.get(type, node);

      if (!plugin) {
        throw new Error(`Unsupported node type "${type}" for node "${node.id}" ($${nodeName})`);
      }

      builder.addNode(node.id, async (state: FlowGraphStateType) => {
        this.logger.log(`▶️ [LangGraph Engine] Executing node "${node.id}" ($${nodeName}) [type: ${type}]`);
        const startTime = Date.now();

        // Resolve inputs from global context
        const nodeInput = this.variableResolver.resolveNodeInput(
          node,
          state.context || {},
          state.initialInput,
        );

        let output: any;
        try {
          // Execute tool plugin
          output = await plugin.run({
            node,
            nodeInput,
            context: state.context || {},
            initialInput: state.initialInput,
            runId: state.runId,
          });
        } catch (err: any) {
          // If interrupt was triggered by LangGraph (e.g. human gate), rethrow so Pregel suspends
          if (
            err.name === 'GraphInterrupt' ||
            err.constructor?.name === 'GraphInterrupt' ||
            err?.message?.includes('interrupt')
          ) {
            throw err;
          }
          throw err;
        }

        // Construct context update keyed by ID and Name
        const contextUpdate: Record<string, any> = {
          [node.id]: output,
          [nodeName]: output,
        };

        // If the tool produced direct state modifications (e.g. set-variable)
        if (state.context?.state) {
          contextUpdate.state = state.context.state;
        }

        const record = {
          nodeId: node.id,
          nodeName,
          nodeType: type,
          status: 'completed',
          input: nodeInput,
          output,
          durationMs: Date.now() - startTime,
          attempt: 1,
          startedAt: new Date(startTime),
          finishedAt: new Date(),
        };

        return {
          context: contextUpdate,
          lastOutput: output,
          nodeRecords: [record],
        };
      });
    }

    // 2. Determine Entry Points
    const adjacency = this.runTopologyService
      ? this.runTopologyService.buildAdjacency(nodes, edges)
      : this.buildSimpleAdjacency(nodes, edges);

    const startNodeIds = this.runTopologyService
      ? this.runTopologyService.determineStartNodes(
          nodes,
          adjacency.incoming,
          adjacency.nodeById,
          options.requestedStartNodeId,
        )
      : this.determineSimpleStartNodes(nodes, adjacency.incoming);

    for (const startId of startNodeIds) {
      if (validNodeIds.has(startId)) {
        builder.addEdge(START, startId as any);
      }
    }

    // 3. Compile Edges & Branching
    for (const node of nodes) {
      const nodeType = String(node.data?.definitionType || node.type || '').toLowerCase();
      const nodeName = String(node.data?.name || node.data?.nodeName || node.id);
      const outEdges = edges.filter(
        (e) => e.source === node.id && validNodeIds.has(e.target),
      );

      // Node has no outgoing edges -> end of flow branch
      if (outEdges.length === 0 || nodeType === 'output') {
        builder.addEdge(node.id as any, END);
        continue;
      }

      // Check if node has conditional / branching output handles
      const isConditionalNode =
        nodeType === 'condition' ||
        nodeType === 'router' ||
        nodeType === 'human-gate' ||
        nodeType === 'humangate' ||
        nodeType === 'research-review' ||
        nodeType === 'artifact';

      if (isConditionalNode) {
        builder.addConditionalEdges(node.id as any, (state: FlowGraphStateType) => {
          const nodeOutput = state.context[node.id] ?? state.context[nodeName];

          const targets = this.runTopologyService
            ? this.runTopologyService.resolveNextTargets(node, nodeOutput, outEdges)
            : this.defaultResolveTargets(node, nodeOutput, outEdges);

          if (!targets || targets.length === 0) {
            return END;
          }
          return targets as any;
        });
      } else {
        // Standard linear / parallel fan-out edges
        for (const edge of outEdges) {
          builder.addEdge(edge.source as any, edge.target as any);
        }
      }
    }

    // 4. Compile the state machine
    const checkpointer = options.checkpointer !== undefined ? options.checkpointer : this.checkpointer;

    return builder.compile({
      checkpointer: checkpointer || undefined,
      interruptBefore: options.interruptBefore as any,
      interruptAfter: options.interruptAfter as any,
    });
  }

  /**
   * Executes a compiled LangGraph state machine.
   */
  async execute(
    compiled: CompiledFlowGraph,
    options: ExecuteGraphOptions,
  ): Promise<FlowGraphStateType> {
    const threadId = options.threadId || options.runId;
    const initialContext = options.initialContext || {};

    const result = await compiled.invoke(
      {
        runId: options.runId,
        initialInput: options.initialInput,
        context: initialContext,
        lastOutput: null,
      },
      {
        configurable: {
          thread_id: threadId,
        },
      },
    );

    return result as FlowGraphStateType;
  }

  /**
   * Resumes a paused LangGraph run (e.g. at a Human Gate node) with a decision payload.
   */
  async resume(
    compiled: CompiledFlowGraph,
    runId: string,
    decision: any,
  ): Promise<FlowGraphStateType> {
    this.logger.log(`▶️ [GraphCompilerService] Resuming run "${runId}" with decision: ${JSON.stringify(decision)}`);
    const result = await compiled.invoke(
      new Command({ resume: decision }),
      { configurable: { thread_id: runId } },
    );
    return result as FlowGraphStateType;
  }

  /**
   * Returns current snapshot of graph state for a run.
   */
  async getState(compiled: CompiledFlowGraph, runId: string) {
    return compiled.getState({ configurable: { thread_id: runId } });
  }

  /**
   * Checks if the graph is currently waiting on a human gate interrupt.
   */
  async isWaiting(compiled: CompiledFlowGraph, runId: string): Promise<boolean> {
    const state = await this.getState(compiled, runId);
    return Boolean(
      state.tasks &&
        state.tasks.some(
          (t: any) => t.interrupts && t.interrupts.length > 0,
        ),
    );
  }

  /**
   * Gets the active interrupt payload for a waiting run.
   */
  async getInterruptPayload(compiled: CompiledFlowGraph, runId: string): Promise<any> {
    const state = await this.getState(compiled, runId);
    for (const task of state.tasks || []) {
      if (task.interrupts && task.interrupts.length > 0) {
        return task.interrupts[0].value;
      }
    }
    return null;
  }

  private buildSimpleAdjacency(nodes: RuntimeNode[], edges: any[]) {
    const nodeById = new Map<string, RuntimeNode>(nodes.map((n) => [n.id, n]));
    const incoming = new Map<string, number>();
    for (const node of nodes) incoming.set(node.id, 0);
    for (const edge of edges) {
      if (nodeById.has(edge.source) && nodeById.has(edge.target)) {
        incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
      }
    }
    return { nodeById, incoming };
  }

  private determineSimpleStartNodes(nodes: RuntimeNode[], incoming: Map<string, number>): string[] {
    const triggers = nodes.filter((n) => {
      const type = String(n.data?.definitionType || n.type || '').toLowerCase();
      return type === 'trigger';
    });
    if (triggers.length > 0) return triggers.map((t) => t.id);

    return nodes.filter((n) => (incoming.get(n.id) || 0) === 0).map((n) => n.id);
  }

  private defaultResolveTargets(node: RuntimeNode, output: any, outEdges: any[]): string[] {
    const type = String(node.data?.definitionType || node.type || '').toLowerCase();
    if (usesBooleanBranch(type, node.data?.config || {})) {
      const branch = output?.conditionMet ? 'true' : 'false';
      const match = outEdges.find((e) => String(e.sourceHandle || '').toLowerCase() === branch);
      return match ? [match.target] : [];
    }
    return outEdges.map((e) => e.target);
  }
}
