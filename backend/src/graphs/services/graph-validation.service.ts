import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { isValidObjectId, Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Graph, GraphDocument } from '../schemas/graph.schema';
import { ToolPluginRegistry } from '../../runs/plugins/tool-plugin.registry';
import { GraphEnrichmentService, NodeDefinition, nodeNameFrom } from './graph-enrichment.service';

export interface ValidationResult {
  valid: boolean;
}

const RESULT_HANDLES = new Set(['done', 'result']);
const ORCHESTRATOR_TYPES = new Set(['orchestrator', 'delegator']);
const CHILD_GRAPH_TYPES = new Set(['subgraph', 'foreach', 'loop']);

interface GraphEdge {
  source: string;
  target: string;
  sourceHandle?: string;
}

type FindGraph = (id: string) => Promise<any>;

@Injectable()
export class GraphValidationService {
  constructor(
    @InjectModel(Graph.name) private readonly graphModel: Model<GraphDocument>,
    private readonly enrichmentService: GraphEnrichmentService,
    @Optional() private readonly pluginRegistry?: ToolPluginRegistry,
  ) {}

  /**
   * A child graph used as a foreach or research round cannot contain a gate
   * when the caller cannot pause and resume it. Visited ids stop cycles and
   * repeated loads of the same graph.
   */
  async assertNoWaitingGatesInChildGraph(
    graphId: string,
    visited = new Set<string>(),
    findGraphFn?: FindGraph,
  ): Promise<void> {
    if (!graphId || !isValidObjectId(graphId) || visited.has(graphId)) return;
    visited.add(graphId);

    const graph = findGraphFn ? await findGraphFn(graphId) : await this.loadGraphById(graphId);
    if (!graph) return;

    const blocks = (graph.flow?.blocks || graph.nodes || []) as any[];
    for (const block of blocks) {
      if (this.isWaitingGate(block)) {
        throw new BadRequestException({
          code: 'NESTED_WAITING_GATE_UNSUPPORTED',
          message:
            'Human gates inside foreach or research-round child graphs are not supported. Place the gate in the parent graph.',
        });
      }

      const nestedId = nodeConfig(block).graphId;
      if (nestedId && CHILD_GRAPH_TYPES.has(nodeType(block))) {
        await this.assertNoWaitingGatesInChildGraph(String(nestedId), visited, findGraphFn);
      }
    }
  }

  /**
   * Canvas foreach: a gate on the item branch cannot pause the loop.
   * Subgraph foreach: a gate is allowed only when the loop runs one item at a
   * time and waits for it, because that run can pause the parent.
   */
  async validateNestedWaitingGates(nodes: any[], edges: any[], findGraphFn?: FindGraph): Promise<void> {
    const graphEdges = asEdges(edges);
    const outgoing = outgoingBySource(graphEdges);
    const byId = new Map(nodes.map((node) => [node.id, node]));

    for (const node of nodes) {
      if (nodeType(node) !== 'foreach') continue;
      const config = nodeConfig(node);
      const mode = String(config.mode || (config.graphId ? 'subgraph' : 'canvas')).toLowerCase();

      if (mode !== 'subgraph') {
        this.assertNoGateOnItemBranch(node.id, byId, outgoing, itemBranchStarts(node.id, graphEdges));
        continue;
      }

      const runsOneAtATime =
        String(config.executionType || 'sync') === 'sync' && Number(config.concurrency ?? 1) === 1;
      if (runsOneAtATime) continue;
      if (typeof config.graphId === 'string' && isValidObjectId(config.graphId)) {
        await this.assertNoWaitingGatesInChildGraph(config.graphId, new Set(), findGraphFn);
      }
    }
  }

  /**
   * Nodes that belong to an orchestrator's jobs: everything reached from a
   * job socket, stopping at the orchestrator itself and at whatever the
   * done/result sockets point to. Those nodes run after the jobs finish.
   */
  getOrchestratedJobNodeIds(orchNodeId: string, _nodes: any[], edges: any[]): Set<string> {
    const outgoing = outgoingBySource(asEdges(edges));
    const fromOrchestrator = outgoing.get(orchNodeId) ?? [];

    const afterJobs = new Set<string>();
    for (const edge of fromOrchestrator) {
      if (isResultHandle(edge.sourceHandle)) afterJobs.add(edge.target);
    }

    const jobs = new Set<string>();
    const queue: string[] = [];
    const seen = new Set<string>();
    const include = (nodeId: string) => {
      if (!nodeId || nodeId === orchNodeId || afterJobs.has(nodeId) || seen.has(nodeId)) return;
      seen.add(nodeId);
      jobs.add(nodeId);
      queue.push(nodeId);
    };

    for (const edge of fromOrchestrator) {
      if (!isResultHandle(edge.sourceHandle)) include(edge.target);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of outgoing.get(current) ?? []) include(edge.target);
    }

    return jobs;
  }

  /**
   * Checks handles, cycles, duplicate wires, and variable references.
   */
  async validateGraphVariables(
    nodes: any[],
    edges: any[],
    preEnrichedNodes?: any[],
    findGraphFn?: FindGraph,
  ): Promise<ValidationResult> {
    if (!Array.isArray(nodes) || nodes.length === 0) return { valid: true };

    const graphEdges = asEdges(edges);
    await this.validateNestedWaitingGates(nodes, graphEdges, findGraphFn);

    const enrichedNodes = preEnrichedNodes || (await this.enrichmentService.enrichNodesWithOutputs(nodes));
    const definitions = await this.enrichmentService.getDefinitionIndex();
    const nodeById = new Map<string, any>(enrichedNodes.map((node) => [node.id, node]));
    const nodeByName = new Map<string, any>(enrichedNodes.map((node) => [nodeNameFrom(node.data || {}), node]));

    this.assertEdges(graphEdges, nodeById);
    this.assertNoDirectedCycles(
      enrichedNodes.map((node) => node.id),
      graphEdges,
      nodeById,
    );
    this.assertNoDuplicateEdges(graphEdges, nodeById);

    const ancestors = this.ancestorsByNode(enrichedNodes, graphEdges, nodeById);
    const itemBranches = this.foreachItemBranches(enrichedNodes, graphEdges, nodeById);
    const producedPaths = this.producedPathsByNode(enrichedNodes);

    this.assertVariableReferences(enrichedNodes, {
      nodeById,
      nodeByName,
      ancestors,
      itemBranches,
      producedPaths,
      definitions,
    });

    return { valid: true };
  }

  private async loadGraphById(graphId: string): Promise<any> {
    if (!graphId || !isValidObjectId(graphId)) return null;
    return this.graphModel.findById(graphId).lean().exec();
  }

  /** Plugin wins when one is registered. Otherwise human-gate, and telegram in question mode. */
  private isWaitingGate(node: any): boolean {
    if (!node) return false;
    const type = nodeType(node);
    const config = nodeConfig(node);
    const plugin = this.pluginRegistry?.get(type, node);
    if (plugin?.isWaitingGate) return plugin.isWaitingGate(config);
    if (type === 'human-gate' || type === 'humangate') return true;
    return type === 'telegram' && config.mode === 'question';
  }

  private assertNoGateOnItemBranch(
    foreachId: string,
    byId: Map<string, any>,
    outgoing: Map<string, GraphEdge[]>,
    starts: string[],
  ): void {
    const seen = new Set<string>();
    const queue = [...starts];

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);

      const child = byId.get(id);
      if (this.isWaitingGate(child)) {
        throw new BadRequestException({
          code: 'NESTED_WAITING_GATE_UNSUPPORTED',
          message:
            'Human gates inside a foreach item branch are not supported. Place the gate after the foreach node.',
        });
      }

      if (nodeType(child) === 'output') continue;
      for (const edge of outgoing.get(id) ?? []) {
        if (edge.target !== foreachId) queue.push(edge.target);
      }
    }
  }

  private assertEdges(edges: GraphEdge[], nodeById: Map<string, any>): void {
    for (const edge of edges) {
      if (edge.source === edge.target) {
        const node = nodeById.get(edge.source);
        const sourceName = shownName(node?.data, edge.source);
        throw new BadRequestException({
          message: 'Self-referencing cycle detected',
          edgeId: (edge as any).id,
          source: edge.source,
          sourceName,
          reason: `Node "${sourceName}" has a direct edge connecting to itself.`,
        });
      }

      const sourceNode = nodeById.get(edge.source);
      if (!sourceNode) {
        throw new BadRequestException({
          message: 'Edge references non-existent source node',
          edgeId: (edge as any).id,
          sourceId: edge.source,
          reason: `Edge references source node "${edge.source}" which does not exist in the graph.`,
        });
      }

      const targetNode = nodeById.get(edge.target);
      if (!targetNode) {
        throw new BadRequestException({
          message: 'Edge references non-existent target node',
          edgeId: (edge as any).id,
          targetId: edge.target,
          reason: `Edge references target node "${edge.target}" which does not exist in the graph.`,
        });
      }

      this.assertHandle(edge, sourceNode, targetNode);
    }
  }

  private assertHandle(edge: GraphEdge, sourceNode: any, targetNode: any): void {
    const sourceType = nodeType(sourceNode);
    const handle = String(edge.sourceHandle || '').toLowerCase();
    const ends = describeEnds(edge, sourceNode, targetNode);

    if (sourceType === 'condition') {
      if (handle !== 'true' && handle !== 'false') {
        throw new BadRequestException({
          message: 'Invalid condition branch handle on edge',
          ...ends,
          sourceHandle: edge.sourceHandle,
          reason: `Edge from Condition block "${ends.sourceLabel}" ($${ends.sourceName}) → "${ends.targetLabel}" ($${ends.targetName}) must use "true" or "false" handle, but got "${edge.sourceHandle || 'none'}".`,
        });
      }
      return;
    }

    if (sourceType === 'router') {
      if (!edge.sourceHandle) return;
      const allowed = routerHandles(sourceNode);
      if (!allowed.has(handle)) {
        throw new BadRequestException({
          message: 'Invalid router branch handle on edge',
          ...ends,
          sourceHandle: edge.sourceHandle,
          validHandles: [...allowed],
          reason: `Edge from Router block "${ends.sourceLabel}" ($${ends.sourceName}) → "${ends.targetLabel}" ($${ends.targetName}): handle "${edge.sourceHandle}" is not valid. Available: [${[...allowed].join(', ')}]. Please reconnect this edge.`,
        });
      }
      return;
    }

    if (!edge.sourceHandle) return;
    const allowed = this.outputHandles(sourceNode);
    if (!allowed.has(handle)) {
      throw new BadRequestException({
        message: 'Invalid source handle on edge',
        ...ends,
        sourceHandle: edge.sourceHandle,
        validHandles: [...allowed],
        reason: `Edge from "${ends.sourceLabel}" ($${ends.sourceName}) → "${ends.targetLabel}" ($${ends.targetName}): source handle "${edge.sourceHandle}" does not exist. Available handles: [${[...allowed].join(', ')}]. Please reconnect this edge.`,
      });
    }
  }

  private outputHandles(node: any): Set<string> {
    const data = node.data || {};
    const allowed = new Set<string>(['flow']);
    for (const output of asOutputs(data.outputs)) allowed.add(output.name.toLowerCase());

    const plugin = this.pluginRegistry?.get(nodeType(node), node);
    if (plugin?.getValidHandles) {
      for (const handle of plugin.getValidHandles(data.config, data.outputs, data, nodeNameFrom(data))) {
        allowed.add(String(handle).toLowerCase());
      }
    }
    return allowed;
  }

  private assertNoDirectedCycles(nodeIds: string[], edges: GraphEdge[], nodeById: Map<string, any>): void {
    const outgoing = new Map<string, string[]>();
    for (const id of nodeIds) outgoing.set(id, []);
    for (const edge of edges) {
      if (edge.source !== edge.target) outgoing.get(edge.source)?.push(edge.target);
    }

    const visited = new Set<string>();
    const onStack = new Set<string>();
    const path: string[] = [];

    const visit = (nodeId: string) => {
      visited.add(nodeId);
      onStack.add(nodeId);
      path.push(nodeId);

      for (const next of outgoing.get(nodeId) ?? []) {
        if (!visited.has(next)) {
          visit(next);
        } else if (onStack.has(next)) {
          const cycle = path.slice(path.indexOf(next)).concat(next);
          const formatted = cycle.map((id) => shownName(nodeById.get(id)?.data, id)).join(' -> ');
          throw new BadRequestException({
            message: 'Cycle detected in graph topology',
            cycle: formatted,
            reason: `A circular dependency was detected: ${formatted}. Cycles are not permitted in the execution graph.`,
          });
        }
      }

      onStack.delete(nodeId);
      path.pop();
    };

    for (const id of nodeIds) {
      if (!visited.has(id)) visit(id);
    }
  }

  private assertNoDuplicateEdges(edges: GraphEdge[], nodeById: Map<string, any>): void {
    const byPair = new Map<string, Map<string, GraphEdge[]>>();
    for (const edge of edges) {
      const byTarget = byPair.get(edge.source) ?? new Map<string, GraphEdge[]>();
      const list = byTarget.get(edge.target) ?? [];
      list.push(edge);
      byTarget.set(edge.target, list);
      byPair.set(edge.source, byTarget);
    }

    for (const [sourceId, byTarget] of byPair) {
      const sourceNode = nodeById.get(sourceId);
      const sourceName = shownName(sourceNode?.data, sourceId);
      const sourceType = nodeType(sourceNode);
      const branches = sourceType === 'condition' || sourceType === 'router';

      for (const [targetId, pair] of byTarget) {
        if (pair.length < 2) continue;
        const targetName = shownName(nodeById.get(targetId)?.data, targetId);

        if (branches) {
          const counts = new Map<string, number>();
          for (const edge of pair) {
            const handle = String(edge.sourceHandle || 'default').toLowerCase();
            counts.set(handle, (counts.get(handle) || 0) + 1);
          }
          for (const [handle, count] of counts) {
            if (count < 2) continue;
            throw new BadRequestException({
              message: 'Duplicate edge detected in graph topology',
              source: sourceId,
              sourceName,
              target: targetId,
              targetName,
              handle,
              reason: `Duplicate connection: Node "${sourceName}" has ${count} edges from the "${handle}" branch to Node "${targetName}". Remove duplicate wires to prevent multiple executions.`,
            });
          }
          continue;
        }

        const handles = pair.map((edge) => edge.sourceHandle || 'default');
        throw new BadRequestException({
          message: 'Duplicate edge detected in graph topology',
          source: sourceId,
          sourceName,
          target: targetId,
          targetName,
          handles,
          reason: `Duplicate connection: Node "${sourceName}" has ${pair.length} connections (${handles.join(', ')}) to Node "${targetName}". Remove duplicate wires to prevent multiple executions.`,
        });
      }
    }
  }

  /** For each node, the nodes whose outputs it is allowed to read. */
  private ancestorsByNode(nodes: any[], edges: GraphEdge[], nodeById: Map<string, any>): Map<string, Set<string>> {
    const incoming = incomingByTarget(edges);
    const jobsByOrchestrator = new Map<string, Set<string>>();
    const jobsFor = (orchestratorId: string) => {
      let jobs = jobsByOrchestrator.get(orchestratorId);
      if (!jobs) {
        jobs = this.getOrchestratedJobNodeIds(orchestratorId, nodes, edges);
        jobsByOrchestrator.set(orchestratorId, jobs);
      }
      return jobs;
    };

    const ancestors = new Map<string, Set<string>>();
    for (const node of nodes) {
      ancestors.set(node.id, ancestorsOf(node.id, incoming, nodeById, jobsFor));
    }
    return ancestors;
  }

  /** Nodes wired from a canvas foreach `item` socket. `item.*` is valid only there. */
  private foreachItemBranches(
    nodes: any[],
    edges: GraphEdge[],
    nodeById: Map<string, any>,
  ): Map<string, Set<string>> {
    const outgoing = outgoingBySource(edges);
    const branches = new Map<string, Set<string>>();

    for (const node of nodes) {
      const data = node.data || {};
      const mode = String(data.config?.mode || 'canvas').toLowerCase();
      if (nodeType(node) !== 'foreach' || mode === 'subgraph') continue;

      const branch = new Set<string>();
      const queue = (outgoing.get(node.id) ?? [])
        .filter((edge) => handleOf(edge) === 'item')
        .map((edge) => edge.target);

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (!currentId || branch.has(currentId)) continue;
        branch.add(currentId);
        if (nodeType(nodeById.get(currentId)) === 'output') continue;
        for (const edge of outgoing.get(currentId) ?? []) {
          if (!branch.has(edge.target)) queue.push(edge.target);
        }
      }

      branches.set(node.id, branch);
    }

    return branches;
  }

  private producedPathsByNode(nodes: any[]): Map<string, Set<string>> {
    const produced = new Map<string, Set<string>>();
    for (const node of nodes) {
      const data = node.data || {};
      const name = nodeNameFrom(data);
      const outputs = asOutputs(data.outputs);
      const paths = new Set<string>();

      for (const output of outputs) {
        const basePath = `${name}.${output.name}`;
        paths.add(basePath);
        if (!isRecord(output.schema)) continue;

        const nested = (prefix: string) =>
          this.enrichmentService.generateNestedVariables(node.id, name, output.name, prefix, output.schema);
        for (const variable of nested(basePath)) paths.add(variable.path);
        if (outputs.length === 1) {
          for (const variable of nested(name)) paths.add(variable.path);
        }
      }

      const plugin = this.pluginRegistry?.get(nodeType(node), node);
      if (plugin?.getProducedPaths) {
        for (const path of plugin.getProducedPaths(name, data.config, data)) paths.add(path);
      }
      produced.set(node.id, paths);
    }
    return produced;
  }

  private assertVariableReferences(
    nodes: any[],
    ctx: {
      nodeById: Map<string, any>;
      nodeByName: Map<string, any>;
      ancestors: Map<string, Set<string>>;
      itemBranches: Map<string, Set<string>>;
      producedPaths: Map<string, Set<string>>;
      definitions: Map<string, NodeDefinition>;
    },
  ): void {
    for (const node of nodes) {
      const data = node.data || {};
      const name = nodeNameFrom(data);
      const config = isRecord(data.config) ? data.config : {};
      const definitionType = String(data.definitionType || node.type || 'function');
      const definition = this.enrichmentService.resolveDefinition(data, definitionType, ctx.definitions);
      const inputs = asInputs(data.inputs || definition?.inputs);
      const ancestors = ctx.ancestors.get(node.id) ?? new Set<string>();

      for (const [field, value] of Object.entries(config)) {
        if (!value) continue;
        const input = inputs.find((item) => item.name === field);
        for (const reference of referencesIn(value, input, ctx.nodeByName, ctx.nodeById)) {
          this.assertReference(reference, { ...ctx, node, name, ancestors });
        }
      }
    }
  }

  private assertReference(
    reference: string,
    ctx: {
      node: any;
      name: string;
      ancestors: Set<string>;
      nodeById: Map<string, any>;
      nodeByName: Map<string, any>;
      itemBranches: Map<string, Set<string>>;
      producedPaths: Map<string, Set<string>>;
    },
  ): void {
    const dot = reference.indexOf('.');
    if (dot <= 0) {
      const wholeNode = ctx.nodeByName.get(reference) || ctx.nodeById.get(reference);
      if (wholeNode && ctx.ancestors.has(wholeNode.id)) return;
      throw invalidReference(
        reference,
        ctx.node.id,
        wholeNode ? 'Referenced node is not upstream' : `Referenced node '${reference}' does not exist in the graph`,
      );
    }

    const prefix = reference.slice(0, dot).trim();
    if (prefix === ctx.name || prefix === ctx.node.id) {
      throw invalidReference(reference, ctx.node.id, 'Referenced node is not upstream');
    }

    const referenced = ctx.nodeByName.get(prefix) || ctx.nodeById.get(prefix);
    if (!referenced) {
      throw invalidReference(reference, ctx.node.id, `Referenced node '${prefix}' does not exist in the graph`);
    }
    if (!ctx.ancestors.has(referenced.id)) {
      throw invalidReference(reference, ctx.node.id, 'Referenced node is not upstream');
    }

    const produced = ctx.producedPaths.get(referenced.id) ?? new Set<string>();
    const withoutIndexes = reference.replace(/\.\d+/g, '');
    if (produced.has(reference) || produced.has(withoutIndexes)) return;
    if (isForeachItemPath(reference, prefix, referenced, ctx.node.id, ctx.itemBranches)) return;

    throw invalidReference(reference, ctx.node.id, `Output path '${reference}' does not exist on referenced node`);
  }
}

function ancestorsOf(
  startId: string,
  incoming: Map<string, GraphEdge[]>,
  nodeById: Map<string, any>,
  jobsFor: (orchestratorId: string) => Set<string>,
): Set<string> {
  const upstream = new Set<string>();
  const seen = new Set<string>([startId]);
  const queue = [startId];

  const include = (nodeId: string) => {
    if (!nodeId || seen.has(nodeId)) return;
    seen.add(nodeId);
    upstream.add(nodeId);
    queue.push(nodeId);
  };

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const edge of incoming.get(currentId) ?? []) {
      include(edge.source);
      if (!leavesOrchestratorResult(edge, nodeById)) continue;
      for (const jobId of jobsFor(edge.source)) include(jobId);
    }
  }

  return upstream;
}

function leavesOrchestratorResult(edge: GraphEdge, nodeById: Map<string, any>): boolean {
  if (!isResultHandle(edge.sourceHandle)) return false;
  return ORCHESTRATOR_TYPES.has(nodeType(nodeById.get(edge.source)));
}

/**
 * Every `item` wire is a loop body. When an older graph has no `item` socket,
 * the first wire that is not done/result is treated as the body. A gate on
 * done or result sits after the loop and is allowed.
 */
function itemBranchStarts(foreachId: string, edges: GraphEdge[]): string[] {
  const itemTargets = edges.filter((edge) => edge.source === foreachId && handleOf(edge) === 'item').map((edge) => edge.target);
  if (itemTargets.length > 0) return itemTargets;

  const legacy = edges.find(
    (edge) => edge.source === foreachId && !RESULT_HANDLES.has(handleOf(edge)),
  );
  return legacy ? [legacy.target] : [];
}

function isForeachItemPath(
  reference: string,
  prefix: string,
  referenced: any,
  readerId: string,
  itemBranches: Map<string, Set<string>>,
): boolean {
  const mode = String(referenced.data?.config?.mode || 'canvas').toLowerCase();
  return (
    nodeType(referenced) === 'foreach' &&
    mode !== 'subgraph' &&
    reference.startsWith(`${prefix}.item.`) &&
    Boolean(itemBranches.get(referenced.id)?.has(readerId))
  );
}

function routerHandles(node: any): Set<string> {
  const data = node.data || {};
  const allowed = new Set<string>(['flow', 'result', 'default']);
  for (const output of asOutputs(data.outputs)) allowed.add(output.name.toLowerCase());

  let routes = data.config?.routes;
  if (typeof routes === 'string') {
    try {
      routes = JSON.parse(routes);
    } catch {
      routes = [];
    }
  }
  if (Array.isArray(routes)) {
    for (const route of routes) {
      const name = String(route?.name || route?.id || '').trim().toLowerCase();
      if (name) allowed.add(name);
    }
  }
  if (data.config?.defaultRoute) allowed.add(String(data.config.defaultRoute).trim().toLowerCase());
  return allowed;
}

function referencesIn(
  value: unknown,
  input: { name: string; type?: string } | undefined,
  nodeByName: Map<string, any>,
  nodeById: Map<string, any>,
): string[] {
  if (isRecord(value) && value.mode === 'variable' && typeof value.value === 'string') {
    const reference = value.value.trim();
    return reference ? [reference] : [];
  }
  if (typeof value !== 'string') return [];

  const text = value.trim();
  if (input?.type === 'variable') {
    const reference = text.replace(/^\{\{|\}\}$/g, '').trim();
    return reference ? [reference] : [];
  }
  if (text.includes('{{')) {
    return [...text.matchAll(/\{\{\s*([\w$.]+)\s*\}\}/g)]
      .map((match) => match[1]?.trim())
      .filter((match): match is string => Boolean(match) && match !== 'uuid');
  }
  if (input?.type === 'valueOrVariable' && looksLikeBareReference(text, nodeByName, nodeById)) {
    return [text];
  }
  return [];
}

/** A filename or version such as config.json is not a variable. A known node prefix is. */
function looksLikeBareReference(text: string, nodeByName: Map<string, any>, nodeById: Map<string, any>): boolean {
  if (
    text.includes(' ') ||
    text.includes('\n') ||
    !text.includes('.') ||
    text.startsWith('http://') ||
    text.startsWith('https://') ||
    text.startsWith('/') ||
    text.startsWith('{')
  ) {
    return false;
  }
  const prefix = text.slice(0, text.indexOf('.')).trim();
  return nodeByName.has(prefix) || nodeById.has(prefix);
}

function describeEnds(edge: GraphEdge, sourceNode: any, targetNode: any) {
  const sourceData = sourceNode.data || {};
  const targetData = targetNode.data || {};
  const sourceName = shownName(sourceData, sourceNode.id);
  const targetName = shownName(targetData, edge.target);
  return {
    edgeId: (edge as any).id,
    source: sourceNode.id,
    sourceName,
    sourceLabel: typeof sourceData.label === 'string' && sourceData.label ? sourceData.label : sourceName,
    target: edge.target,
    targetName,
    targetLabel: typeof targetData.label === 'string' && targetData.label ? targetData.label : targetName,
  };
}

function invalidReference(path: string, blockId: string, reason: string): BadRequestException {
  return new BadRequestException({ message: 'Invalid variable reference', path, blockId, reason });
}

function shownName(data: any, fallback: string): string {
  if (typeof data?.name === 'string' && data.name) return data.name;
  if (typeof data?.nodeName === 'string' && data.nodeName) return data.nodeName;
  return fallback;
}

function nodeType(node: any): string {
  return String(node?.kind || node?.data?.definitionType || node?.type || '').toLowerCase();
}

function nodeConfig(node: any): Record<string, any> {
  const config = node?.config ?? node?.data?.config;
  return isRecord(config) ? config : {};
}

function handleOf(edge: GraphEdge): string {
  return String(edge.sourceHandle || '').trim().toLowerCase();
}

function isResultHandle(handle: unknown): boolean {
  return RESULT_HANDLES.has(String(handle || '').trim().toLowerCase());
}

function asEdges(edges: any): GraphEdge[] {
  if (!Array.isArray(edges)) return [];
  return edges.filter((edge) => edge?.source && edge?.target);
}

function outgoingBySource(edges: GraphEdge[]): Map<string, GraphEdge[]> {
  const outgoing = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
  }
  return outgoing;
}

function incomingByTarget(edges: GraphEdge[]): Map<string, GraphEdge[]> {
  const incoming = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const list = incoming.get(edge.target) ?? [];
    list.push(edge);
    incoming.set(edge.target, list);
  }
  return incoming;
}

function asOutputs(value: unknown): Array<{ name: string; schema?: any }> {
  if (!Array.isArray(value)) return [];
  return value.filter((output) => output && typeof output.name === 'string');
}

function asInputs(value: unknown): Array<{ name: string; type?: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter((input) => input && typeof input.name === 'string');
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
