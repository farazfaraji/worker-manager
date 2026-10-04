import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { NodeDefinitionsService } from '../../node-definitions/node-definitions.service';
import { ToolPluginRegistry } from '../../runs/plugins/tool-plugin.registry';
import {
  NodeOutputDefinition,
  NodeDefinition,
  OutputSynthesisContext,
  UpstreamVariable,
  DependsOnCondition,
} from '../../runs/plugins/tool-plugin.interface';
import { parseSchema } from '../utils/schema-parser.util';

// Re-export domain interfaces for complete backward compatibility
export {
  NodeOutputDefinition,
  NodeDefinition,
  OutputSynthesisContext,
  OutputSynthesisContext as SynthesisContext,
  UpstreamVariable,
  DependsOnCondition,
};

export interface UpstreamVariablesResponse {
  graphId: string;
  blockId: string;
  variables: UpstreamVariable[];
}

export interface EnrichedNodeData extends Record<string, any> {
  name: string;
  nodeName: string;
  label: string;
  definitionType: string;
  config: Record<string, any>;
  outputs: NodeOutputDefinition[];
  actionDefinitions: any[];
}

export interface EnrichedGraphNode {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data: EnrichedNodeData;
}

/** Sockets that carry an orchestrator's finished jobs, not a single job branch. */
const ORCHESTRATOR_RESULT_HANDLES = new Set(['done', 'result']);
const ORCHESTRATOR_TYPES = new Set(['orchestrator', 'delegator']);
const VARIABLE_NODE_TYPES = new Set(['variable', 'set-variable']);

/** Stop expanding a user-supplied schema before a cyclic or huge object blows up the response. */
const MAX_SCHEMA_DEPTH = 12;

interface IncomingEdge {
  source: string;
  sourceHandle?: string;
}

@Injectable()
export class GraphEnrichmentService {
  private readonly logger = new Logger(GraphEnrichmentService.name);
  /** Tool JSON files do not change while the process is running. */
  private cachedDefinitions: Promise<Map<string, NodeDefinition>> | null = null;

  constructor(
    private readonly nodeDefinitionsService: NodeDefinitionsService,
    @Optional() private readonly pluginRegistry?: ToolPluginRegistry,
  ) {}

  /**
   * Attaches each node's definition, output sockets, and parsed schemas.
   * One broken node is returned as-is so the rest of the graph still loads.
   */
  async enrichNodesWithOutputs(nodes: any[]): Promise<EnrichedGraphNode[]> {
    if (!Array.isArray(nodes) || nodes.length === 0) return [];
    const definitions = await this.definitionsByKey();

    return nodes.map((node) => {
      try {
        return this.enrichNode(node, definitions);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Skipping enrichment for node ${node?.id ?? '(missing id)'}: ${message}`);
        return unenrichedNode(node);
      }
    });
  }

  /**
   * Variables a block can read: outputs of every node upstream of it.
   * `getOrchestratedJobNodeIds` is supplied by the caller so this service
   * does not depend on the validation service.
   */
  async computeUpstreamVariables(
    graph: any,
    blockId: string,
    getOrchestratedJobNodeIds: (orchId: string, nodes: any[], edges: any[]) => Set<string>,
  ): Promise<UpstreamVariablesResponse> {
    if (typeof blockId !== 'string' || !blockId.trim()) {
      throw new BadRequestException('Block id is required');
    }

    const nodes: any[] = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const edges: any[] = Array.isArray(graph?.edges) ? graph.edges : [];
    const target = findBlock(nodes, blockId);
    if (!target) {
      throw new NotFoundException('Block not found');
    }

    const upstreamIds = this.upstreamNodeIds(target.id, nodes, edges, (orchestratorId) =>
      getOrchestratedJobNodeIds(orchestratorId, nodes, edges),
    );

    const graphId = graph?._id ? String(graph._id) : graph?.id || 'graph';
    if (upstreamIds.size === 0) {
      return { graphId, blockId: target.id, variables: [] };
    }

    const upstreamNodes = nodes.filter((node) => upstreamIds.has(node.id));
    const enriched = await this.enrichNodesWithOutputs(upstreamNodes);

    return {
      graphId,
      blockId: target.id,
      variables: enriched.flatMap((node) => this.variablesForNode(node)),
    };
  }

  /**
   * Resolves a node definition using the indexed definitions map in O(1).
   */
  resolveDefinition(
    data: Record<string, any>,
    defType: string,
    index: Map<string, NodeDefinition>,
  ): NodeDefinition | undefined {
    if (data.definitionId) {
      const match = index.get(String(data.definitionId).toLowerCase());
      if (match) return match;
    }
    if (data.definitionName) {
      const match = index.get(String(data.definitionName).toLowerCase());
      if (match) return match;
    }
    if (data.name) {
      const nameKey = String(data.name).toLowerCase();
      const match = index.get(nameKey) || index.get(nameKey.replace(/[_\s]+/g, '-'));
      if (match) return match;
    }
    return index.get(String(defType).toLowerCase());
  }

  /**
   * Flattens an object schema into variable paths (`order.user.id`).
   */
  generateNestedVariables(
    nodeId: string,
    nodeName: string,
    rootOutputName: string,
    currentPath: string,
    schema: Record<string, any>,
    depth = 0,
  ): UpstreamVariable[] {
    if (depth >= MAX_SCHEMA_DEPTH) return [];

    const result: UpstreamVariable[] = [];
    for (const [key, val] of Object.entries(objectFields(schema))) {
      const fieldPath = `${currentPath}.${key}`;

      if (isRecord(val)) {
        result.push({
          nodeId,
          nodeName,
          outputName: rootOutputName,
          path: fieldPath,
          type: 'object',
          schema: val,
        });
        result.push(
          ...this.generateNestedVariables(nodeId, nodeName, rootOutputName, fieldPath, val, depth + 1),
        );
      } else {
        result.push({
          nodeId,
          nodeName,
          outputName: rootOutputName,
          path: fieldPath,
          type: typeof val === 'string' ? val : 'property',
        });
      }
    }
    return result;
  }

  /** Tool definitions indexed by id, name, and unique type. Shared with validation. */
  getDefinitionIndex(): Promise<Map<string, NodeDefinition>> {
    return this.definitionsByKey();
  }

  private async definitionsByKey(): Promise<Map<string, NodeDefinition>> {
    if (!this.cachedDefinitions) {
      this.cachedDefinitions = this.nodeDefinitionsService
        .getAllDefinitions()
        .then((definitions) => indexDefinitions(definitions))
        .catch((error) => {
          this.cachedDefinitions = null;
          throw error;
        });
    }
    return this.cachedDefinitions;
  }

  private enrichNode(node: any, definitions: Map<string, NodeDefinition>): EnrichedGraphNode {
    const data = isRecord(node?.data) ? node.data : {};
    const definitionType = String(data.definitionType || node?.type || 'function');
    const name = nodeNameFrom(data);
    const config = isRecord(data.config) ? data.config : {};
    const definition = this.resolveDefinition(data, definitionType, definitions);

    const outputs = enabledOutputs(
      withLifecycleEvents(
        definitionType.toLowerCase(),
        config,
        this.rawOutputs(node, data, definitionType, config, definition),
      ),
      config,
    ).map((output) => this.withSchema(output, config, definitionType));

    return {
      id: node.id,
      type: node.type || 'langgraphNode',
      ...(node.position ? { position: node.position } : {}),
      data: {
        ...data,
        name,
        nodeName: typeof data.nodeName === 'string' && data.nodeName ? data.nodeName : name,
        label: typeof data.label === 'string' && data.label ? data.label : name,
        definitionType,
        config,
        outputs,
        actionDefinitions: actionDefinitionsFor(definition, data),
      },
    };
  }

  private rawOutputs(
    node: any,
    data: Record<string, any>,
    definitionType: string,
    config: Record<string, any>,
    definition: NodeDefinition | undefined,
  ): NodeOutputDefinition[] {
    const plugin = this.pluginRegistry?.get(definitionType, node);
    if (plugin?.synthesizeOutputs) {
      const synthesized = plugin.synthesizeOutputs({ defType: definitionType, data, config, def: definition });
      if (Array.isArray(synthesized)) return asOutputs(synthesized);
    }

    const declaredOnNode = asOutputs(data.definitionOutputs);
    if (declaredOnNode.length > 0) return declaredOnNode;
    const declaredOnDefinition = asOutputs(definition?.outputs);
    if (declaredOnDefinition.length > 0) return declaredOnDefinition;
    return asOutputs(data.outputs);
  }

  private withSchema(
    output: NodeOutputDefinition,
    config: Record<string, any>,
    definitionType: string,
  ): NodeOutputDefinition {
    const described: NodeOutputDefinition = {
      name: output.name,
      label: output.label || output.name,
      type: output.type || 'object',
      ...(output.dependsOn ? { dependsOn: output.dependsOn } : {}),
    };

    const rawSchema = rawSchemaForOutput(output, config, definitionType);
    if (rawSchema === undefined) return described;

    const parsed = parseSchema(rawSchema);
    if (parsed !== undefined) described.schema = parsed;
    return described;
  }

  /**
   * Ancestors of `targetId`, plus the job nodes of an orchestrator when the
   * walk crosses that orchestrator's "done" or "result" socket. A block after
   * the orchestrator can read what the jobs produced; a block on a job branch
   * cannot.
   */
  private upstreamNodeIds(
    targetId: string,
    nodes: any[],
    edges: any[],
    jobIdsFor: (orchestratorId: string) => Iterable<string>,
  ): Set<string> {
    const nodeById = new Map<string, any>(nodes.map((node) => [node.id, node]));
    const incoming = incomingEdgesByTarget(edges);
    const upstream = new Set<string>();
    const seen = new Set<string>([targetId]);
    const queue = [targetId];

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
        if (leavesOrchestratorResult(edge, nodeById)) {
          for (const jobId of jobIdsFor(edge.source)) include(jobId);
        }
      }
    }

    return upstream;
  }

  private variablesForNode(node: EnrichedGraphNode): UpstreamVariable[] {
    const data = node.data || ({} as EnrichedNodeData);
    const nodeName = nodeNameFrom(data);
    const outputs = asOutputs(data.outputs);
    const definitionType = String(data.definitionType || node.type || '').toLowerCase();
    const config = isRecord(data.config) ? data.config : {};

    const plugin = this.pluginRegistry?.get(definitionType, node);
    const custom = plugin?.getUpstreamVariables?.(node.id, nodeName, config, outputs, node);
    if (custom && custom.length > 0) return custom;

    // Used when the plugin registry is not wired (unit tests, partial boot).
    if (VARIABLE_NODE_TYPES.has(definitionType)) {
      const bindings = stateBindings(node.id, nodeName, config);
      if (bindings.length > 0) return bindings;
    }

    return this.variablesFromOutputs(node.id, nodeName, outputs);
  }

  /**
   * One output is addressable as `nodeName` and as `nodeName.output`.
   * Several outputs are only addressable as `nodeName.output`.
   */
  private variablesFromOutputs(
    nodeId: string,
    nodeName: string,
    outputs: NodeOutputDefinition[],
  ): UpstreamVariable[] {
    const variables: UpstreamVariable[] = [];
    const dataOutputs = outputs.filter((output) => output.type !== 'branch');
    const onlyOutput = dataOutputs.length === 1 ? dataOutputs[0] : undefined;

    if (onlyOutput) {
      variables.push(variableAt(nodeId, nodeName, onlyOutput, nodeName));
    }

    for (const output of dataOutputs) {
      const basePath = `${nodeName}.${output.name}`;
      variables.push(variableAt(nodeId, nodeName, output, basePath));
      if (!isRecord(output.schema)) continue;

      variables.push(
        ...this.generateNestedVariables(nodeId, nodeName, output.name, basePath, output.schema),
      );
      if (onlyOutput) {
        variables.push(
          ...this.generateNestedVariables(nodeId, nodeName, output.name, nodeName, output.schema),
        );
      }
    }

    return variables;
  }
}

function indexDefinitions(definitions: NodeDefinition[]): Map<string, NodeDefinition> {
  const index = new Map<string, NodeDefinition>();
  const ownersByType = new Map<string, NodeDefinition[]>();

  for (const definition of definitions) {
    if (!definition) continue;
    if (definition.id) index.set(String(definition.id).toLowerCase(), definition);
    if (definition.name) {
      const name = String(definition.name).toLowerCase();
      index.set(name, definition);
      index.set(name.replace(/[_\s]+/g, '-'), definition);
    }
    if (definition.type) {
      const typeKey = String(definition.type).toLowerCase();
      const owners = ownersByType.get(typeKey) ?? [];
      owners.push(definition);
      ownersByType.set(typeKey, owners);
    }
  }

  // Set Variable, Increment, and Decrement all use type "variable".
  // A shared type must not resolve to whichever file was read first.
  for (const [typeKey, owners] of ownersByType) {
    if (owners.length === 1 && !index.has(typeKey)) index.set(typeKey, owners[0]);
  }
  return index;
}

function findBlock(nodes: any[], blockId: string): any | undefined {
  return nodes.find(
    (node) => node.id === blockId || node.data?.name === blockId || node.data?.nodeName === blockId,
  );
}

function incomingEdgesByTarget(edges: any[]): Map<string, IncomingEdge[]> {
  const incoming = new Map<string, IncomingEdge[]>();
  for (const edge of edges) {
    if (!edge?.source || !edge?.target) continue;
    const list = incoming.get(edge.target) ?? [];
    list.push({ source: edge.source, sourceHandle: edge.sourceHandle });
    incoming.set(edge.target, list);
  }
  return incoming;
}

function leavesOrchestratorResult(edge: IncomingEdge, nodeById: Map<string, any>): boolean {
  const handle = String(edge.sourceHandle || '').trim().toLowerCase();
  if (!ORCHESTRATOR_RESULT_HANDLES.has(handle)) return false;

  const source = nodeById.get(edge.source);
  const type = String(source?.data?.definitionType || source?.type || '').toLowerCase();
  return ORCHESTRATOR_TYPES.has(type);
}

export function nodeNameFrom(data: Record<string, any>): string {
  if (typeof data.name === 'string' && data.name.trim()) return data.name;
  if (typeof data.nodeName === 'string' && data.nodeName.trim()) return data.nodeName;
  if (typeof data.label === 'string' && data.label.trim()) {
    return data.label.toLowerCase().replace(/\s+/g, '_');
  }
  return 'node';
}

function asOutputs(value: unknown): NodeOutputDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.filter((output) => output && typeof output.name === 'string');
}

function enabledOutputs(outputs: NodeOutputDefinition[], config: Record<string, any>): NodeOutputDefinition[] {
  if (!outputs.some((output) => output.dependsOn)) return outputs;
  return outputs.filter((output) => conditionHolds(output.dependsOn, config));
}

const LIFECYCLE_EVENT_TYPES = new Set([
  'action', 'agent', 'aggregate', 'app', 'browser', 'brower', 'embedding', 'execution',
  'function', 'json-parser', 'memory', 'notification', 'repo-inspect', 'retrieval', 'script',
  'subgraph', 'telegram', 'transform', 'web-search', 'websearch', 'web_search',
]);

function withLifecycleEvents(
  definitionType: string,
  config: Record<string, any>,
  outputs: NodeOutputDefinition[],
): NodeOutputDefinition[] {
  const operation = String(config.operation || '').toLowerCase();
  const onFail = String(config.onFail || 'fail').toLowerCase();
  const applicableOutputs = definitionType === 'log' && operation === 'assert' && onFail !== 'route'
    ? outputs.filter((output) => !['true', 'false'].includes(output.name.toLowerCase()))
    : outputs;
  const supportsLifecycle =
    LIFECYCLE_EVENT_TYPES.has(definitionType) ||
    (definitionType === 'database' && operation !== 'ping') ||
    (definitionType === 'file' && operation !== 'exists') ||
    (definitionType === 'log' && !(operation === 'assert' && onFail === 'route')) ||
    (definitionType === 'secrets' && operation !== 'exists');
  if (!supportsLifecycle) return applicableOutputs;

  const result = [...applicableOutputs];
  const names = new Set(result.map((output) => output.name.toLowerCase()));
  if (![...names].some((name) => ['done', 'success', 'onsuccess', 'onload', 'completed'].includes(name))) {
    result.unshift({ name: 'done', label: 'Done', type: 'branch' });
  }
  if (![...names].some((name) => ['failed', 'onfailed', 'error'].includes(name))) {
    result.push({ name: 'failed', label: 'Failed', type: 'branch' });
  }
  return result;
}

function conditionHolds(condition: DependsOnCondition | undefined, config: Record<string, any>): boolean {
  if (!condition) return true;
  const actual = String(config[condition.field] ?? '').toLowerCase();

  if (Array.isArray(condition.in)) {
    return condition.in.some((item) => String(item).toLowerCase() === actual);
  }
  if (condition.equals !== undefined) return actual === String(condition.equals).toLowerCase();
  if (condition.notEquals !== undefined) return actual !== String(condition.notEquals).toLowerCase();
  return true;
}

function actionDefinitionsFor(definition: NodeDefinition | undefined, data: Record<string, any>): any[] {
  if (definition?.actionDefinitions?.length) return definition.actionDefinitions;
  return Array.isArray(data.actionDefinitions) ? data.actionDefinitions : [];
}

function unenrichedNode(node: any): EnrichedGraphNode {
  const data = isRecord(node?.data) ? node.data : {};
  const name = nodeNameFrom(data);
  return {
    id: node?.id,
    type: node?.type || 'langgraphNode',
    ...(node?.position ? { position: node.position } : {}),
    data: {
      ...data,
      name,
      nodeName: typeof data.nodeName === 'string' && data.nodeName ? data.nodeName : name,
      label: typeof data.label === 'string' && data.label ? data.label : name,
      definitionType: String(data.definitionType || node?.type || 'function'),
      config: isRecord(data.config) ? data.config : {},
      outputs: asOutputs(data.outputs),
      actionDefinitions: Array.isArray(data.actionDefinitions) ? data.actionDefinitions : [],
    },
  };
}

/**
 * Where an output's schema lives in node config.
 * `schemaFrom` on the output wins. The remaining matches cover definitions
 * that predate `schemaFrom` and nodes saved without a definition.
 *
 * A `key` field is only a variable name on Set Variable nodes. Memory and
 * browser nodes also have a `key`, and their stored value is not a type.
 */
function rawSchemaForOutput(
  output: NodeOutputDefinition,
  config: Record<string, any>,
  definitionType: string,
): unknown {
  if (output.schemaFrom && config[output.schemaFrom] !== undefined) {
    return storedValue(config[output.schemaFrom]);
  }
  if (output.name === 'query' && config.querySchema !== undefined) return storedValue(config.querySchema);
  if (output.name === 'params' && config.paramsSchema !== undefined) return storedValue(config.paramsSchema);
  if ((output.name === 'result' || output.name === 'value') && config.outputType !== undefined) {
    return storedValue(config.outputType);
  }
  if (output.name === 'input' && config.inputSchema !== undefined) return storedValue(config.inputSchema);
  if (config.type !== undefined && schemaUsesTypeField(output.name, config)) return storedValue(config.type);
  if ((output.name === 'value' || output.name === 'result') && config.schema !== undefined) {
    return storedValue(config.schema);
  }

  if (VARIABLE_NODE_TYPES.has(definitionType.toLowerCase()) && isValueOutput(output.name)) {
    const key = config.key != null ? String(config.key).trim() : '';
    if (key) return { [key]: declaredValueType(config) };
  }

  if (output.schema !== undefined) return storedValue(output.schema);
  return undefined;
}

function schemaUsesTypeField(outputName: string, config: Record<string, any>): boolean {
  if (outputName === 'body' || outputName === 'data' || outputName === 'input') return true;
  return outputName === 'query' && String(config.method || '').toUpperCase() === 'GET';
}

function isValueOutput(name: string): boolean {
  return name === 'value' || name === 'result' || name === 'output';
}

/** Some config editors persist a field as `{ value }` rather than the value. */
function storedValue(value: unknown): unknown {
  if (isRecord(value) && 'value' in value) return value.value;
  return value;
}

function declaredValueType(config: Record<string, any>): string {
  const declared = String(config.valueType || '').toLowerCase();
  if (declared === 'number' || typeof config.value === 'number' || typeof config.numberValue === 'number') {
    return 'number';
  }
  if (declared === 'boolean' || typeof config.value === 'boolean' || typeof config.booleanValue === 'boolean') {
    return 'boolean';
  }
  if (declared === 'json' || isStructured(config.value) || isStructured(config.jsonValue)) {
    return 'object';
  }
  return 'string';
}

/** `nodeName.key` and `state.key` for a Set Variable node that has no plugin wired up. */
function stateBindings(nodeId: string, nodeName: string, config: Record<string, any>): UpstreamVariable[] {
  const key = config.key != null ? String(config.key).trim() : '';
  if (!key) return [];

  const type = declaredValueType(config);
  return [
    { nodeId, nodeName, outputName: key, path: `${nodeName}.${key}`, type, schema: undefined },
    { nodeId, nodeName: 'state', outputName: key, path: `state.${key}`, type, schema: undefined },
  ];
}

function variableAt(
  nodeId: string,
  nodeName: string,
  output: NodeOutputDefinition,
  path: string,
): UpstreamVariable {
  return {
    nodeId,
    nodeName,
    outputName: output.name,
    path,
    type: output.type || 'object',
    schema: output.schema,
  };
}

/** JSON Schema objects declare their fields under `properties`. */
function objectFields(schema: Record<string, any>): Record<string, any> {
  if (schema.type === 'object' && isRecord(schema.properties)) return schema.properties;
  return schema;
}

function isStructured(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return isStructured(value) && !Array.isArray(value);
}
