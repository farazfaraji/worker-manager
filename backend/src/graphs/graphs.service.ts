import { Injectable, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { Graph, GraphDocument } from './schemas/graph.schema';
import { CreateGraphDto } from './dto/create-graph.dto';
import { UpdateGraphDto } from './dto/update-graph.dto';
import { NodeDefinitionsService } from '../node-definitions/node-definitions.service';
import { GraphShapeService } from './graph-shape.service';
import { ToolPluginRegistry } from '../runs/plugins/tool-plugin.registry';

/**
 * Splits a type string by delimiters (, ; \n) only at the top level (outside braces, brackets, and generics).
 */
function splitTopLevel(str: string): string[] {
  const chunks: string[] = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '{' || ch === '[' || ch === '(' || ch === '<') {
      depth++;
      current += ch;
    } else if (ch === '}' || ch === ']' || ch === ')' || ch === '>') {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if ((ch === ',' || ch === ';' || ch === '\n') && depth === 0) {
      if (current.trim()) {
        chunks.push(current.trim());
      }
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * Cleans and normalizes Zod / TypeScript types into canonical schema types.
 */
function normalizeTypeDefinition(typeVal: string): any {
  let cleaned = typeVal.trim();

  // Strip trailing comments
  if (cleaned.includes('//')) {
    cleaned = cleaned.split('//')[0].trim();
  }
  cleaned = cleaned.replace(/[,;]$/, '').trim();

  // Handle nested z.object({ ... }) or object literal
  if (cleaned.includes('z.object') || (cleaned.startsWith('{') && cleaned.endsWith('}'))) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const inner = cleaned.slice(firstBrace, lastBrace + 1);
      return parseSchema(inner);
    }
  }

  // Handle Zod primitives & chaining (.optional(), .nullable(), .describe(), etc.)
  if (/^z\.array\b/.test(cleaned)) return 'array';
  if (/^z\.string\b/.test(cleaned)) return 'string';
  if (/^z\.number\b/.test(cleaned)) return 'number';
  if (/^z\.boolean\b/.test(cleaned)) return 'boolean';
  if (/^z\.record\b/.test(cleaned)) return 'object';
  if (/^z\.enum\b/.test(cleaned)) return 'string';
  if (/^z\.any\b/.test(cleaned)) return 'any';

  return cleaned;
}

/**
 * Parses simple typescript or Zod object schemas like "z.object({ summary: z.string() })"
 * or "{ type: string, name: string }" or JSON into structured key-type schema objects.
 */
export function parseSchema(raw: any): any {
  if (!raw) return undefined;
  if (typeof raw === 'object' && raw !== null) return raw;
  if (typeof raw !== 'string') return undefined;

  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // 1. Try parsing JSON directly
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
  } catch {
    // Continue with TypeScript / Zod parsing
  }

  // 2. Parse TypeScript interface / Zod z.object / object literal notation
  try {
    let content = trimmed;
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      content = content.slice(firstBrace + 1, lastBrace);
    }

    const result: Record<string, any> = {};
    const lines = splitTopLevel(content);

    for (const line of lines) {
      const lineTrimmed = line.trim();
      if (!lineTrimmed || lineTrimmed.startsWith('//') || lineTrimmed.startsWith('/*')) {
        continue;
      }

      const colonIdx = lineTrimmed.indexOf(':');
      if (colonIdx > 0) {
        let key = lineTrimmed.slice(0, colonIdx).trim();
        let typeVal = lineTrimmed.slice(colonIdx + 1).trim();

        // Clean key (remove optional ? and quotes)
        key = key.replace(/[\?'"]/g, '').trim();

        if (key && typeVal) {
          result[key] = normalizeTypeDefinition(typeVal);
        }
      }
    }

    if (Object.keys(result).length > 0) {
      return result;
    }
  } catch {
    // If parsing fails, ignore
  }

  return undefined;
}

@Injectable()
export class GraphsService {
  constructor(
    @InjectModel(Graph.name) private graphModel: Model<GraphDocument>,
    private readonly nodeDefinitionsService: NodeDefinitionsService,
    private readonly graphShapeService: GraphShapeService,
    @Optional() private readonly pluginRegistry?: ToolPluginRegistry,
  ) {}

  /** Converts either canonical flow input or legacy React Flow input for validation. */
  reshapeGraphInput(input: any) {
    return this.graphShapeService.reshapeForSave(input || {});
  }

  /**
   * Enriches nodes with metadata and extracted output schemas from tool definitions & node configs.
   */
  async enrichNodesWithOutputs(nodes: any[]): Promise<any[]> {
    if (!Array.isArray(nodes)) return [];
    const definitions = await this.nodeDefinitionsService.getAllDefinitions();

    return nodes.map((node) => {
      const data = node.data || {};
      const defType = data.definitionType || node.type || 'function';
      const nodeName =
        data.name ||
        data.nodeName ||
        (data.label ? data.label.toLowerCase().replace(/\s+/g, '_') : 'node');
      const config = data.config || {};

      // Match definition
      const def =
        definitions.find((d) => data.definitionId && d.id.toLowerCase() === String(data.definitionId).toLowerCase()) ||
        definitions.find((d) => data.definitionName && d.name.toLowerCase() === String(data.definitionName).toLowerCase()) ||
        definitions.find((d) => data.name && d.name.toLowerCase() === String(data.name).toLowerCase()) ||
        definitions.find((d) => data.name && d.id.toLowerCase() === String(data.name).toLowerCase().replace(/[_\s]+/g, '-')) ||
        definitions.find((d) => d.id.toLowerCase() === defType.toLowerCase()) ||
        definitions.find((d) => d.name.toLowerCase() === defType.toLowerCase()) ||
        definitions.find((d) => d.type.toLowerCase() === defType.toLowerCase());

      let outputsDef =
        data.definitionOutputs && data.definitionOutputs.length > 0
          ? data.definitionOutputs
          : def?.outputs || data.outputs || [];

      // Guarantee Set Variable nodes provide the 'value' output
      const isSetVar =
        defType.toLowerCase() === 'variable' ||
        defType.toLowerCase() === 'set-variable' ||
        (data.definitionId && String(data.definitionId).toLowerCase() === 'set-variable') ||
        (data.definitionName && String(data.definitionName).toLowerCase().includes('set variable'));
      if (isSetVar && (!outputsDef || outputsDef.length === 0)) {
        outputsDef = def?.outputs?.length ? def.outputs : [{ name: 'value', label: 'Assigned Value', type: 'object' }];
      }

      // If browser/app node has legacy result output or stale outputs, upgrade to definition outputs
      if (
        (defType.toLowerCase() === 'app' ||
          defType.toLowerCase() === 'browser' ||
          defType.toLowerCase() === 'brower') &&
        (outputsDef.some((o: any) => o.name === 'result') || outputsDef.length === 0) &&
        def?.outputs?.length
      ) {
        outputsDef = def.outputs;
      }

      // If artifact node has legacy result output or outputs have dependsOn, use definition outputs
      if (
        (defType.toLowerCase() === 'artifact' && (outputsDef.some((o: any) => o.name === 'result') || outputsDef.length === 0)) ||
        (def?.outputs?.some((o: any) => o.dependsOn))
      ) {
        if (def?.outputs?.length) {
          outputsDef = def.outputs;
        }
      }

      // If router node, dynamically generate branch output handles from routes config
      if (defType.toLowerCase() === 'router') {
        let routes = config.routes;
        if (routes === undefined || routes === null || routes === '') {
          const routesInput = def?.inputs?.find((inp: any) => inp.name === 'routes');
          if (routesInput?.defaultValue) {
            routes = routesInput.defaultValue;
          }
        }
        if (typeof routes === 'string') {
          try {
            routes = JSON.parse(routes);
          } catch {
            routes = [];
          }
        }
        if (Array.isArray(routes) && routes.length > 0) {
          const dynamicRoutes: any[] = [];
          const seen = new Set<string>();

          for (const r of routes) {
            const routeName = String(r?.name || r?.id || '').trim();
            if (routeName && !seen.has(routeName.toLowerCase())) {
              seen.add(routeName.toLowerCase());
              dynamicRoutes.push({
                name: routeName,
                label: routeName,
                type: 'branch',
              });
            }
          }

          const defaultRouteName = String(config.defaultRoute || '').trim();
          if (defaultRouteName && !seen.has(defaultRouteName.toLowerCase())) {
            seen.add(defaultRouteName.toLowerCase());
            dynamicRoutes.push({
              name: defaultRouteName,
              label: defaultRouteName,
              type: 'branch',
            });
          } else if (!seen.has('default')) {
            dynamicRoutes.push({
              name: 'default',
              label: 'default',
              type: 'branch',
            });
          }

          outputsDef = dynamicRoutes;
        } else {
          outputsDef = [
            { name: 'default', label: 'default', type: 'branch' },
            { name: 'result', label: 'Route Result', type: 'object' },
          ];
        }
      }

      // If foreach node, dynamically provide item, done, and result outputs based on mode
      if (defType.toLowerCase() === 'foreach') {
        const mode = String(config.mode || 'canvas').toLowerCase();
        if (mode !== 'subgraph') {
          outputsDef = [
            { name: 'item', label: 'Item (Loop)', type: 'branch' },
            { name: 'done', label: 'Done', type: 'branch' },
            { name: 'result', label: 'Foreach Result', type: 'object' },
          ];
        } else {
          outputsDef = [
            { name: 'result', label: 'Foreach Result', type: 'object' },
          ];
        }
      }

      // If orchestrator node, dynamically generate agent output sockets + last result socket
      if (defType.toLowerCase() === 'orchestrator' || defType.toLowerCase() === 'delegator') {
        let agentOutputs = config.agentOutputs ?? config.outputs ?? config.agents;
        if (agentOutputs === undefined || agentOutputs === null || agentOutputs === '') {
          const agentOutputsInput = def?.inputs?.find((inp: any) => inp.name === 'agentOutputs' || inp.name === 'agents');
          if (agentOutputsInput?.defaultValue) {
            agentOutputs = agentOutputsInput.defaultValue;
          }
        }
        if (typeof agentOutputs === 'string') {
          try {
            agentOutputs = JSON.parse(agentOutputs);
          } catch {
            agentOutputs = [];
          }
        }
        if (Array.isArray(agentOutputs) && agentOutputs.length > 0) {
          const dynamicOutputs: any[] = [];
          const seen = new Set<string>();
          for (let i = 0; i < agentOutputs.length; i++) {
            const item = agentOutputs[i];
            const handleName = typeof item === 'string' ? item : (item?.name || item?.id || `agent_${i + 1}`);
            const handleLabel = typeof item === 'object' ? item.label || item.name || handleName : handleName;
            if (handleName && !seen.has(handleName.toLowerCase())) {
              seen.add(handleName.toLowerCase());
              dynamicOutputs.push({
                name: handleName,
                label: handleLabel,
                type: 'branch',
              });
            }
          }
          dynamicOutputs.push({
            name: 'result',
            label: 'Last Result',
            type: 'object',
          });
          outputsDef = dynamicOutputs;
        } else {
          outputsDef = [
            { name: 'agent_1', label: 'agent_1', type: 'branch' },
            { name: 'agent_2', label: 'agent_2', type: 'branch' },
            { name: 'agent_3', label: 'agent_3', type: 'branch' },
            { name: 'agent_4', label: 'agent_4', type: 'branch' },
            { name: 'result', label: 'Last Result', type: 'object' },
          ];
        }
      }

      // Filter outputs by dependsOn against config
      if (config && outputsDef.some((o: any) => o.dependsOn)) {
        outputsDef = outputsDef.filter((out: any) => {
          if (!out.dependsOn) return true;
          const targetVal = config[out.dependsOn.field];
          if (Array.isArray(out.dependsOn.in)) {
            return out.dependsOn.in.some((item: any) => String(item).toLowerCase() === String(targetVal ?? '').toLowerCase());
          }
          if (out.dependsOn.equals !== undefined) {
            return String(targetVal ?? '').toLowerCase() === String(out.dependsOn.equals).toLowerCase();
          }
          if (out.dependsOn.notEquals !== undefined) {
            return String(targetVal ?? '').toLowerCase() !== String(out.dependsOn.notEquals).toLowerCase();
          }
          return true;
        });
      }

      const extractedOutputs = outputsDef.map((out: any) => {
        const outItem: {
          name: string;
          label?: string;
          type: string;
          schema?: any;
          dependsOn?: any;
        } = {
          name: out.name,
          label: out.label || out.name,
          type: out.type || 'object',
          ...(out.dependsOn ? { dependsOn: out.dependsOn } : {}),
        };

        let rawSchema: any = undefined;
        const extractVal = (v: any) =>
          typeof v === 'object' && v !== null && v.value !== undefined ? v.value : v;

        if (out.schemaFrom && config[out.schemaFrom]) {
          rawSchema = extractVal(config[out.schemaFrom]);
        } else if (config.querySchema && out.name === 'query') {
          rawSchema = extractVal(config.querySchema);
        } else if (config.paramsSchema && out.name === 'params') {
          rawSchema = extractVal(config.paramsSchema);
        } else if (config.outputType && (out.name === 'result' || out.name === 'value')) {
          rawSchema = extractVal(config.outputType);
        } else if (config.inputSchema && out.name === 'input') {
          rawSchema = extractVal(config.inputSchema);
        } else if (
          config.type &&
          (out.name === 'body' ||
            out.name === 'data' ||
            out.name === 'input' ||
            (out.name === 'query' && String(config.method).toUpperCase() === 'GET'))
        ) {
          rawSchema = extractVal(config.type);
        } else if (config.schema && (out.name === 'value' || out.name === 'result')) {
          rawSchema = extractVal(config.schema);
        } else if (config.key && (out.name === 'value' || out.name === 'result' || out.name === 'output')) {
          const keyName = String(config.key).trim();
          if (keyName) {
            rawSchema = { [keyName]: config.value !== undefined ? String(config.value) : 'string' };
          }
        } else if (out.schema) {
          rawSchema = extractVal(out.schema);
        }

        if (rawSchema) {
          const parsed = parseSchema(rawSchema);
          if (parsed !== undefined) {
            outItem.schema = parsed;
          }
        }

        return outItem;
      });

      return {
        id: node.id,
        type: node.type || 'langgraphNode',
        ...(node.position ? { position: node.position } : {}),
        data: {
          ...data,
          name: nodeName,
          nodeName: data.nodeName || nodeName,
          label: data.label || nodeName,
          definitionType: defType,
          config: config,
          outputs: extractedOutputs,
          actionDefinitions: def?.actionDefinitions?.length ? def.actionDefinitions : (data.actionDefinitions || []),
        },
      };
    });
  }

  async findAll(projectId?: string) {
    const filter = projectId ? { projectId } : {};
    const graphs = await this.graphModel
      .find(filter)
      .select('name projectId createdAt updatedAt flow layout metadata')
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    return graphs.map((g) => ({
      id: g._id.toString(),
      name: g.name,
      projectId: g.projectId,
      nodeCount: (g.flow?.blocks || []).length,
      edgeCount: (g.flow?.connections || []).length,
      createdAt: (g as any).createdAt,
      updatedAt: (g as any).updatedAt,
      metadata: g.metadata,
    }));
  }

  async findOne(id: string): Promise<any> {
    if (!id || (typeof id === 'string' && !isValidObjectId(id))) {
      throw new NotFoundException('Graph not found');
    }
    try {
      const graph: any = await this.graphModel.findById(id).lean().exec();
      if (!graph) {
        throw new NotFoundException('Graph not found');
      }
      return this.reshapeDocumentForEditor(graph);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new NotFoundException('Graph not found');
    }
  }

  async create(createGraphDto: CreateGraphDto): Promise<any> {
    const shaped = this.graphShapeService.reshapeForSave({
      flow: createGraphDto.flow,
      nodes: createGraphDto.nodes,
      edges: createGraphDto.edges,
      layout: createGraphDto.layout,
      viewport: createGraphDto.viewport,
    });
    await this.validateGraphVariables(shaped.nodes, shaped.edges);

    const createdGraph = new this.graphModel({
      ...createGraphDto,
      flow: shaped.flow,
      layout: shaped.layout,
      metadata: createGraphDto.metadata || {},
    });
    const saved = await createdGraph.save();
    return this.reshapeDocumentForEditor(saved.toObject());
  }

  async update(
    id: string,
    updateGraphDto: UpdateGraphDto,
  ): Promise<any> {
    const existing = await this.findOne(id);
    const isLegacyPresentationUpdate =
      updateGraphDto.flow === undefined &&
      (updateGraphDto.nodes !== undefined || updateGraphDto.edges !== undefined);
    const shaped = this.graphShapeService.reshapeForSave({
      flow: updateGraphDto.flow !== undefined ? updateGraphDto.flow : isLegacyPresentationUpdate ? undefined : existing.flow,
      nodes: updateGraphDto.nodes !== undefined ? updateGraphDto.nodes : existing.nodes,
      edges: updateGraphDto.edges !== undefined ? updateGraphDto.edges : existing.edges,
      layout: updateGraphDto.layout !== undefined ? updateGraphDto.layout : existing.layout,
      viewport: updateGraphDto.viewport || existing.layout?.viewport,
    });

    await this.validateGraphVariables(shaped.nodes, shaped.edges);

    try {
      const updateData: any = { ...updateGraphDto };
      updateData.flow = shaped.flow;
      updateData.layout = shaped.layout;
      delete updateData.nodes;
      delete updateData.edges;
      delete updateData.viewport;

      const updatedGraph = await this.graphModel
        .findByIdAndUpdate(
          id,
          { $set: updateData, $unset: { nodes: '', edges: '', viewport: '' } },
          { new: true, runValidators: true },
        )
        .lean()
        .exec();

      if (!updatedGraph) {
        throw new NotFoundException('Graph not found');
      }
      return this.reshapeDocumentForEditor(updatedGraph);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      throw new NotFoundException('Graph not found');
    }
  }

  private async reshapeDocumentForEditor(graph: any): Promise<any> {
    const shaped = this.graphShapeService.reshapeForLoad({
      flow: graph.flow,
      // Legacy fields are read only for documents that have not been migrated.
      nodes: graph.nodes,
      edges: graph.edges,
      layout: graph.layout,
      viewport: graph.viewport,
    });
    const enrichedNodes = await this.enrichNodesWithOutputs(shaped.nodes);
    return {
      ...graph,
      flow: shaped.flow,
      layout: shaped.layout,
      viewport: shaped.layout.viewport,
      nodes: enrichedNodes,
      edges: shaped.edges,
    };
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const result = await this.graphModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException('Graph not found');
    }
    return { success: true, message: `Graph "${id}" deleted successfully` };
  }

  /**
   * Validates all variable references within nodes of a graph before saving or executing.
   * Rejects:
   * - Variables referencing nodes that don't exist in this graph.
   * - Self-referencing variables.
   * - Variables referencing downstream or un-merged parallel branch nodes (not upstream).
   * - Invalid output property paths that don't exist on the upstream node's outputs/schema.
   */
  /** Detect waiting gates where the caller cannot safely pause and resume. */
  async assertNoWaitingGatesInChildGraph(graphId: string, visited = new Set<string>()): Promise<void> {
    if (!isValidObjectId(graphId) || visited.has(graphId)) return;
    visited.add(graphId);
    const graph = await this.findOne(graphId);
    const nodes = graph.nodes || [];
    if (nodes.some((node: any) => ['human-gate', 'humangate'].includes(String(node.data?.definitionType || node.type || '').toLowerCase()) || (String(node.data?.definitionType || node.type || '').toLowerCase() === 'telegram' && node.data?.config?.mode === 'question'))) {
      throw new BadRequestException({ code: 'NESTED_WAITING_GATE_UNSUPPORTED', message: 'Human gates inside foreach or research-round child graphs are not supported. Place the gate in the parent graph.' });
    }
    for (const node of nodes) {
      const type = String(node.data?.definitionType || node.type || '').toLowerCase();
      const nestedId = node.data?.config?.graphId;
      if (nestedId && ['subgraph', 'foreach', 'loop'].includes(type)) await this.assertNoWaitingGatesInChildGraph(String(nestedId), visited);
    }
  }

  private async validateNestedWaitingGates(nodes: any[], edges: any[]): Promise<void> {
    const byId = new Map(nodes.map((node: any) => [node.id, node]));
    for (const node of nodes) {
      const type = String(node.data?.definitionType || node.type || '').toLowerCase();
      const config = node.data?.config || {};
      const foreachMode = String(config.mode || (config.graphId ? 'subgraph' : 'canvas'));
      if (type === 'foreach' && foreachMode !== 'subgraph') {
        const first = (edges.find((edge: any) => edge.source === node.id && edge.sourceHandle === 'item') || edges.find((edge: any) => edge.source === node.id && edge.sourceHandle !== 'done'))?.target;
        const queue = first ? [first] : [];
        const seen = new Set<string>();
        while (queue.length) {
          const id = queue.shift()!;
          if (seen.has(id)) continue;
          seen.add(id);
          const child: any = byId.get(id);
          const childType = String(child?.data?.definitionType || child?.type || '').toLowerCase();
          if (['human-gate', 'humangate'].includes(childType) || (childType === 'telegram' && child?.data?.config?.mode === 'question')) throw new BadRequestException({ code: 'NESTED_WAITING_GATE_UNSUPPORTED', message: 'Human gates inside a foreach item branch are not supported. Place the gate after the foreach node.' });
          if (childType !== 'output') queue.push(...edges.filter((edge: any) => edge.source === id && edge.target !== node.id).map((edge: any) => edge.target));
        }
      }
      if (type === 'foreach' && foreachMode === 'subgraph' && (String(config.executionType || 'sync') !== 'sync' || Number(config.concurrency ?? 1) !== 1)) {
        if (typeof config.graphId === 'string' && isValidObjectId(config.graphId)) await this.assertNoWaitingGatesInChildGraph(config.graphId);
      }
    }
  }

  /** Identify all downstream node IDs that belong to the parallel jobs spawned by an orchestrator node. */
  private getOrchestratedJobNodeIds(
    orchNodeId: string,
    nodes: any[],
    edges: any[],
  ): Set<string> {
    const jobNodes = new Set<string>();
    const doneTargetIds = new Set<string>();

    for (const edge of edges) {
      if (edge.source === orchNodeId) {
        const handle = String(edge.sourceHandle || '').toLowerCase().trim();
        if (handle === 'done' || handle === 'result') {
          doneTargetIds.add(edge.target);
        }
      }
    }

    const queue: string[] = [];
    for (const edge of edges) {
      if (edge.source === orchNodeId) {
        const handle = String(edge.sourceHandle || '').toLowerCase().trim();
        if (handle !== 'done' && handle !== 'result' && !doneTargetIds.has(edge.target)) {
          queue.push(edge.target);
          jobNodes.add(edge.target);
        }
      }
    }

    const visited = new Set<string>(jobNodes);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of edges) {
        if (edge.source === current) {
          if (!doneTargetIds.has(edge.target) && !visited.has(edge.target) && edge.target !== orchNodeId) {
            visited.add(edge.target);
            jobNodes.add(edge.target);
            queue.push(edge.target);
          }
        }
      }
    }

    return jobNodes;
  }

  async validateGraphVariables(
    nodes: any[],
    edges: any[],
  ): Promise<{ valid: boolean }> {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return { valid: true };
    }

    await this.validateNestedWaitingGates(nodes, edges);

    const definitions = await this.nodeDefinitionsService.getAllDefinitions();
    const enrichedNodes = await this.enrichNodesWithOutputs(nodes);

    const nodeById = new Map<string, any>();
    const nodeByName = new Map<string, any>();

    for (const node of enrichedNodes) {
      const data = node.data || {};
      const nodeName =
        data.name ||
        data.nodeName ||
        (data.label ? data.label.toLowerCase().replace(/\s+/g, '_') : 'node');
      nodeById.set(node.id, node);
      nodeByName.set(nodeName, node);
    }

    // 1. Edge Topology & Source Handle Validation
    for (const edge of edges || []) {
      if (!edge.source || !edge.target) continue;

      if (edge.source === edge.target) {
        const node = nodeById.get(edge.source);
        const nodeName = node?.data?.name || node?.data?.nodeName || edge.source;
        throw new BadRequestException({
          message: 'Self-referencing cycle detected',
          edgeId: edge.id,
          source: edge.source,
          sourceName: nodeName,
          reason: `Node "${nodeName}" has a direct edge connecting to itself.`,
        });
      }

      const sourceNode = nodeById.get(edge.source);
      if (!sourceNode) {
        throw new BadRequestException({
          message: 'Edge references non-existent source node',
          edgeId: edge.id,
          sourceId: edge.source,
          reason: `Edge references source node "${edge.source}" which does not exist in the graph.`,
        });
      }

      const targetNode = nodeById.get(edge.target);
      if (!targetNode) {
        throw new BadRequestException({
          message: 'Edge references non-existent target node',
          edgeId: edge.id,
          targetId: edge.target,
          reason: `Edge references target node "${edge.target}" which does not exist in the graph.`,
        });
      }

      const sourceData = sourceNode.data || {};
      const sourceNodeName = sourceData.name || sourceData.nodeName || sourceNode.id;
      const sourceNodeLabel = sourceData.label || sourceNodeName;
      const sourceDefType = String(sourceData.definitionType || sourceNode.type || '').toLowerCase();
      const outputs = sourceData.outputs || [];

      const targetData = targetNode?.data || {};
      const targetNodeName = targetData.name || targetData.nodeName || edge.target;
      const targetNodeLabel = targetData.label || targetNodeName;

      if (sourceDefType === 'condition') {
        const handle = String(edge.sourceHandle || '').toLowerCase();
        if (handle !== 'true' && handle !== 'false') {
          throw new BadRequestException({
            message: 'Invalid condition branch handle on edge',
            edgeId: edge.id,
            source: sourceNode.id,
            sourceName: sourceNodeName,
            sourceLabel: sourceNodeLabel,
            target: edge.target,
            targetName: targetNodeName,
            targetLabel: targetNodeLabel,
            sourceHandle: edge.sourceHandle,
            reason: `Edge from Condition block "${sourceNodeLabel}" ($${sourceNodeName}) → "${targetNodeLabel}" ($${targetNodeName}) must use "true" or "false" handle, but got "${edge.sourceHandle || 'none'}".`,
          });
        }
      } else if (sourceDefType === 'router') {
        const handle = String(edge.sourceHandle || '').toLowerCase();
        const validHandles = new Set<string>();
        validHandles.add('flow');
        validHandles.add('result');
        validHandles.add('default');
        for (const out of outputs) {
          if (out.name) validHandles.add(String(out.name).toLowerCase());
        }

        let cfgRoutes = sourceData.config?.routes;
        if (typeof cfgRoutes === 'string') {
          try {
            cfgRoutes = JSON.parse(cfgRoutes);
          } catch {
            cfgRoutes = [];
          }
        }
        if (Array.isArray(cfgRoutes)) {
          for (const r of cfgRoutes) {
            const rName = String(r.name || r.id || '').trim().toLowerCase();
            if (rName) validHandles.add(rName);
          }
        }
        if (sourceData.config?.defaultRoute) {
          validHandles.add(String(sourceData.config.defaultRoute).trim().toLowerCase());
        }

        if (edge.sourceHandle && !validHandles.has(handle)) {
          throw new BadRequestException({
            message: 'Invalid router branch handle on edge',
            edgeId: edge.id,
            source: sourceNode.id,
            sourceName: sourceNodeName,
            sourceLabel: sourceNodeLabel,
            target: edge.target,
            targetName: targetNodeName,
            targetLabel: targetNodeLabel,
            sourceHandle: edge.sourceHandle,
            validHandles: Array.from(validHandles),
            reason: `Edge from Router block "${sourceNodeLabel}" ($${sourceNodeName}) → "${targetNodeLabel}" ($${targetNodeName}): handle "${edge.sourceHandle}" is not valid. Available: [${Array.from(validHandles).join(', ')}]. Please reconnect this edge.`,
          });
        }
      } else if (edge.sourceHandle) {
        const handle = String(edge.sourceHandle).toLowerCase();
        const validHandles = new Set<string>();
        validHandles.add('flow');
        for (const out of outputs) {
          if (out.name) validHandles.add(String(out.name).toLowerCase());
        }

        const plugin = this.pluginRegistry?.get(sourceDefType, sourceNode);
        if (plugin?.getValidHandles) {
          const handles = plugin.getValidHandles(sourceData.config, outputs, sourceData, sourceNodeName);
          for (const h of handles) validHandles.add(h);
        }

        if (!validHandles.has(handle)) {
          throw new BadRequestException({
            message: 'Invalid source handle on edge',
            edgeId: edge.id,
            source: sourceNode.id,
            sourceName: sourceNodeName,
            sourceLabel: sourceNodeLabel,
            target: edge.target,
            targetName: targetNodeName,
            targetLabel: targetNodeLabel,
            sourceHandle: edge.sourceHandle,
            validHandles: Array.from(validHandles),
            reason: `Edge from "${sourceNodeLabel}" ($${sourceNodeName}) → "${targetNodeLabel}" ($${targetNodeName}): source handle "${edge.sourceHandle}" does not exist. Available handles: [${Array.from(validHandles).join(', ')}]. Please reconnect this edge.`,
          });
        }
      }
    }

    // 2. Duplicate Edge Detection (same source and target)
    const edgesByPair = new Map<string, any[]>();
    for (const edge of edges || []) {
      if (!edge.source || !edge.target) continue;
      const pairKey = `${edge.source}->${edge.target}`;
      if (!edgesByPair.has(pairKey)) {
        edgesByPair.set(pairKey, []);
      }
      edgesByPair.get(pairKey)!.push(edge);
    }

    for (const [pairKey, pairEdges] of edgesByPair.entries()) {
      const [sourceId, targetId] = pairKey.split('->');
      const sourceNode = nodeById.get(sourceId);
      const targetNode = nodeById.get(targetId);
      const sourceNodeName = sourceNode?.data?.name || sourceNode?.data?.nodeName || sourceId;
      const targetNodeName = targetNode?.data?.name || targetNode?.data?.nodeName || targetId;
      const sourceDefType = String(sourceNode?.data?.definitionType || sourceNode?.type || '').toLowerCase();

      if (sourceDefType === 'condition' || sourceDefType === 'router') {
        const handleCounts = new Map<string, number>();
        for (const e of pairEdges) {
          const h = String(e.sourceHandle || 'default').toLowerCase();
          handleCounts.set(h, (handleCounts.get(h) || 0) + 1);
        }
        for (const [handle, count] of handleCounts.entries()) {
          if (count > 1) {
            throw new BadRequestException({
              message: 'Duplicate edge detected in graph topology',
              source: sourceId,
              sourceName: sourceNodeName,
              target: targetId,
              targetName: targetNodeName,
              handle,
              reason: `Duplicate connection: Node "${sourceNodeName}" has ${count} edges from the "${handle}" branch to Node "${targetNodeName}". Remove duplicate wires to prevent multiple executions.`,
            });
          }
        }
      } else {
        if (pairEdges.length > 1) {
          const handles = pairEdges.map((e) => e.sourceHandle || 'default');
          throw new BadRequestException({
            message: 'Duplicate edge detected in graph topology',
            source: sourceId,
            sourceName: sourceNodeName,
            target: targetId,
            targetName: targetNodeName,
            handles,
            reason: `Duplicate connection: Node "${sourceNodeName}" has ${pairEdges.length} connections (${handles.join(', ')}) to Node "${targetNodeName}". Remove duplicate wires to prevent multiple executions.`,
          });
        }
      }
    }

    // Build incoming edges map: targetNodeId -> Set of sourceNodeIds
    const incomingMap = new Map<string, Set<string>>();
    for (const edge of edges || []) {
      if (edge.source && edge.target) {
        if (!incomingMap.has(edge.target)) {
          incomingMap.set(edge.target, new Set<string>());
        }
        incomingMap.get(edge.target)!.add(edge.source);
      }
    }

    // Map each node to its set of upstream ancestor node IDs (BFS)
    const upstreamNodesMap = new Map<string, Set<string>>();

    for (const node of enrichedNodes) {
      const upstreamSet = new Set<string>();
      const queue: string[] = [node.id];
      const visited = new Set<string>([node.id]);

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const sources = incomingMap.get(currentId) || new Set();

        for (const sourceId of sources) {
          if (!visited.has(sourceId)) {
            visited.add(sourceId);
            upstreamSet.add(sourceId);
            queue.push(sourceId);
          }
        }

        // If currentId receives a 'done' or 'result' edge from an orchestrator,
        // all downstream job nodes belonging to that orchestrator are also upstream.
        for (const edge of edges || []) {
          if (edge.target === currentId) {
            const handle = String(edge.sourceHandle || '').toLowerCase().trim();
            if (handle === 'done' || handle === 'result') {
              const srcNode = nodeById.get(edge.source);
              const srcType = String(srcNode?.data?.definitionType || srcNode?.type || '').toLowerCase();
              if (srcType === 'orchestrator' || srcType === 'delegator') {
                const jobNodeIds = this.getOrchestratedJobNodeIds(edge.source, enrichedNodes, edges || []);
                for (const jId of jobNodeIds) {
                  if (!visited.has(jId)) {
                    visited.add(jId);
                    upstreamSet.add(jId);
                    queue.push(jId);
                  }
                }
              }
            }
          }
        }
      }

      upstreamNodesMap.set(node.id, upstreamSet);
    }

    // Canvas Foreach exposes the current input as an arbitrary item object only
    // inside its item branch. Track that scope so references such as
    // `foreach.item.url` can be validated without making the item available to
    // unrelated downstream nodes after the `done` handle.
    const foreachItemBranchNodes = new Map<string, Set<string>>();
    for (const foreachNode of enrichedNodes) {
      const foreachData = foreachNode.data || {};
      const foreachType = String(foreachData.definitionType || foreachNode.type || '').toLowerCase();
      const foreachMode = String(foreachData.config?.mode || 'canvas').toLowerCase();
      if (foreachType !== 'foreach' || foreachMode === 'subgraph') continue;

      const branchNodes = new Set<string>();
      const queue = (edges || [])
        .filter((edge: any) => edge.source === foreachNode.id && String(edge.sourceHandle || '').toLowerCase() === 'item')
        .map((edge: any) => edge.target);
      while (queue.length) {
        const currentId = queue.shift();
        if (!currentId || branchNodes.has(currentId)) continue;
        branchNodes.add(currentId);
        const currentNode = nodeById.get(currentId);
        const currentType = String(currentNode?.data?.definitionType || currentNode?.type || '').toLowerCase();
        if (currentType === 'output') continue;
        for (const edge of edges || []) {
          if (edge.source === currentId && !branchNodes.has(edge.target)) queue.push(edge.target);
        }
      }
      foreachItemBranchNodes.set(foreachNode.id, branchNodes);
    }

    // Compute all valid variable paths produced by each node
    const nodeProducedPathsMap = new Map<string, Set<string>>();

    for (const node of enrichedNodes) {
      const data = node.data || {};
      const nodeName =
        data.name ||
        data.nodeName ||
        (data.label ? data.label.toLowerCase().replace(/\s+/g, '_') : 'node');
      const outputs = data.outputs || [];
      const producedPaths = new Set<string>();

      for (const output of outputs) {
        const basePath = `${nodeName}.${output.name}`;
        producedPaths.add(basePath);

        if (
          output.schema &&
          typeof output.schema === 'object' &&
          !Array.isArray(output.schema)
        ) {
          const addNestedPaths = (
            currentPrefix: string,
            schemaObj: Record<string, any>,
          ) => {
            for (const [k, v] of Object.entries(schemaObj)) {
              const p = `${currentPrefix}.${k}`;
              producedPaths.add(p);
              if (v && typeof v === 'object' && !Array.isArray(v)) {
                addNestedPaths(p, v);
              }
            }
          };
          addNestedPaths(basePath, output.schema);
          if (outputs.length === 1) {
            addNestedPaths(nodeName, output.schema);
          }
        }
      }

      // Add direct key references and plugin produced paths
      const defType = String(data.definitionType || node.type || '').toLowerCase();
      const plugin = this.pluginRegistry?.get(defType, node);
      if (plugin?.getProducedPaths) {
        const paths = plugin.getProducedPaths(nodeName, data.config, data);
        for (const p of paths) {
          producedPaths.add(p);
        }
      }

      nodeProducedPathsMap.set(node.id, producedPaths);
    }

    // Validate variable references in each node's config
    for (const node of enrichedNodes) {
      const data = node.data || {};
      const nodeName =
        data.name ||
        data.nodeName ||
        (data.label ? data.label.toLowerCase().replace(/\s+/g, '_') : 'node');
      const config = data.config || {};
      const defType = data.definitionType || node.type || 'function';

      const def =
        definitions.find((d) => data.definitionId && d.id.toLowerCase() === String(data.definitionId).toLowerCase()) ||
        definitions.find((d) => data.definitionName && d.name.toLowerCase() === String(data.definitionName).toLowerCase()) ||
        definitions.find((d) => data.name && d.name.toLowerCase() === String(data.name).toLowerCase()) ||
        definitions.find((d) => data.name && d.id.toLowerCase() === String(data.name).toLowerCase().replace(/[_\s]+/g, '-')) ||
        definitions.find((d) => d.id.toLowerCase() === defType.toLowerCase()) ||
        definitions.find((d) => d.name.toLowerCase() === defType.toLowerCase()) ||
        definitions.find((d) => d.type.toLowerCase() === defType.toLowerCase());

      const inputsDef = data.inputs || def?.inputs || [];
      const upstreamSet = upstreamNodesMap.get(node.id) || new Set<string>();

      for (const [fieldKey, fieldVal] of Object.entries(config)) {
        if (!fieldVal) continue;

        const inputDef = inputsDef.find((i: any) => i.name === fieldKey);
        const refPathsToCheck: string[] = [];

        if (typeof fieldVal === 'object' && fieldVal !== null) {
          if (
            (fieldVal as any).mode === 'variable' &&
            (fieldVal as any).value &&
            typeof (fieldVal as any).value === 'string'
          ) {
            refPathsToCheck.push((fieldVal as any).value.trim());
          }
        } else if (typeof fieldVal === 'string') {
          const strTrimmed = fieldVal.trim();
          if (inputDef && inputDef.type === 'variable') {
            const cleanRef = strTrimmed.replace(/^\{\{|\}\}$/g, '').trim();
            refPathsToCheck.push(cleanRef);
          } else if (inputDef && inputDef.type === 'valueOrVariable') {
            if (strTrimmed.includes('{{')) {
              const matches = Array.from(strTrimmed.matchAll(/\{\{([\w$.]+)\}\}/g));
              for (const m of matches) {
                if (m[1] && m[1] !== 'uuid') {
                  refPathsToCheck.push(m[1].trim());
                }
              }
            } else if (
              !strTrimmed.includes(' ') &&
              !strTrimmed.includes('\n') &&
              strTrimmed.includes('.') &&
              !strTrimmed.startsWith('http://') &&
              !strTrimmed.startsWith('https://') &&
              !strTrimmed.startsWith('/') &&
              !strTrimmed.startsWith('{')
            ) {
              refPathsToCheck.push(strTrimmed);
            }
          }
        }

        for (const refPath of refPathsToCheck) {
          if (!refPath) continue;

          const dotIdx = refPath.indexOf('.');
          if (dotIdx <= 0) {
            // A bare upstream node name refers to that node's complete output.
            // This is useful for passing an object from one Script node to another.
            const wholeNode = nodeByName.get(refPath) || nodeById.get(refPath);
            if (wholeNode && upstreamSet.has(wholeNode.id)) {
              continue;
            }
            throw new BadRequestException({
              message: 'Invalid variable reference',
              path: refPath,
              blockId: node.id,
              reason: 'Referenced node is not upstream',
            });
          }

          const nodePrefix = refPath.slice(0, dotIdx).trim();

          // 1. Self-reference check
          if (nodePrefix === nodeName || nodePrefix === node.id) {
            throw new BadRequestException({
              message: 'Invalid variable reference',
              path: refPath,
              blockId: node.id,
              reason: 'Referenced node is not upstream',
            });
          }

          // 2. Node exists in graph check
          const referencedNode =
            nodeByName.get(nodePrefix) || nodeById.get(nodePrefix);
          if (!referencedNode) {
            throw new BadRequestException({
              message: 'Invalid variable reference',
              path: refPath,
              blockId: node.id,
              reason: `Referenced node '${nodePrefix}' does not exist in the graph`,
            });
          }

          // 3. Upstream ancestor check (branching / downstream isolation)
          if (!upstreamSet.has(referencedNode.id)) {
            throw new BadRequestException({
              message: 'Invalid variable reference',
              path: refPath,
              blockId: node.id,
              reason: 'Referenced node is not upstream',
            });
          }

          // 4. Output path existence check
          const validPaths =
            nodeProducedPathsMap.get(referencedNode.id) || new Set<string>();
          const normalizedPath = refPath.replace(/\.\d+/g, '');
          const referencedData = referencedNode.data || {};
          const referencedType = String(referencedData.definitionType || referencedNode.type || '').toLowerCase();
          const referencedMode = String(referencedData.config?.mode || 'canvas').toLowerCase();
          const isScopedForeachItemPath =
            referencedType === 'foreach' &&
            referencedMode !== 'subgraph' &&
            refPath.startsWith(`${nodePrefix}.item.`) &&
            Boolean(foreachItemBranchNodes.get(referencedNode.id)?.has(node.id));
          if (!validPaths.has(refPath) && !validPaths.has(normalizedPath) && !isScopedForeachItemPath) {
            throw new BadRequestException({
              message: 'Invalid variable reference',
              path: refPath,
              blockId: node.id,
              reason: `Output path '${refPath}' does not exist on referenced node`,
            });
          }
        }
      }
    }

    return { valid: true };
  }

  /**
   * Extracts all upstream available variables accessible to a specific block (node) in a graph.
   * Rules:
   * - Only upstream ancestor nodes preceding the block are returned.
   * - The current node is excluded.
   * - Downstream and unconnected nodes are excluded.
   * - Stored outputs are converted to variables.
   * - Nested paths are constructed for object types with schemas.
   */
  async getUpstreamVariables(
    graphId: string,
    blockId: string,
  ): Promise<UpstreamVariablesResponse> {
    if (!graphId || (typeof graphId === 'string' && !isValidObjectId(graphId))) {
      throw new NotFoundException('Graph not found');
    }

    if (!blockId || typeof blockId !== 'string' || !blockId.trim()) {
      throw new BadRequestException('Block does not belong to this graph');
    }

    const graph = await this.findOne(graphId);
    if (!graph) {
      throw new NotFoundException('Graph not found');
    }

    const nodes: any[] = graph.nodes || [];
    const edges: any[] = graph.edges || [];

    // Find the target node
    const targetNode = nodes.find(
      (n) =>
        n.id === blockId ||
        n.data?.name === blockId ||
        n.data?.nodeName === blockId,
    );

    if (!targetNode) {
      throw new NotFoundException('Block not found');
    }

    // Build incoming edges map: targetNodeId -> Set of sourceNodeIds
    const incomingMap = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (edge.source && edge.target) {
        if (!incomingMap.has(edge.target)) {
          incomingMap.set(edge.target, new Set<string>());
        }
        incomingMap.get(edge.target)!.add(edge.source);
      }
    }

    // Traverse backwards from targetNode to find all upstream ancestor node IDs (BFS)
    const upstreamNodeIds = new Set<string>();
    const queue: string[] = [targetNode.id];
    const visited = new Set<string>([targetNode.id]);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const sources = incomingMap.get(currentId) || new Set();

      for (const sourceId of sources) {
        if (!visited.has(sourceId)) {
          visited.add(sourceId);
          upstreamNodeIds.add(sourceId);
          queue.push(sourceId);
        }
      }

      // If currentId receives a 'done' or 'result' edge from an orchestrator,
      // all downstream job nodes belonging to that orchestrator are also upstream.
      for (const edge of edges) {
        if (edge.target === currentId) {
          const handle = String(edge.sourceHandle || '').toLowerCase().trim();
          if (handle === 'done' || handle === 'result') {
            const srcNode = nodes.find((n) => n.id === edge.source);
            const srcType = String(srcNode?.data?.definitionType || srcNode?.type || '').toLowerCase();
            if (srcType === 'orchestrator' || srcType === 'delegator') {
              const jobNodeIds = this.getOrchestratedJobNodeIds(edge.source, nodes, edges);
              for (const jId of jobNodeIds) {
                if (!visited.has(jId)) {
                  visited.add(jId);
                  upstreamNodeIds.add(jId);
                  queue.push(jId);
                }
              }
            }
          }
        }
      }
    }

    // If no upstream nodes found, return empty array with graphId & blockId
    if (upstreamNodeIds.size === 0) {
      return {
        graphId: graph._id ? graph._id.toString() : graphId,
        blockId: targetNode.id,
        variables: [],
      };
    }

    // Filter nodes maintaining graph order
    const upstreamNodes = nodes.filter((n) => upstreamNodeIds.has(n.id));

    // Ensure outputs and schemas are enriched for these upstream nodes
    const enrichedUpstreamNodes = await this.enrichNodesWithOutputs(upstreamNodes);

    const variables: UpstreamVariable[] = [];

    for (const node of enrichedUpstreamNodes) {
      const data = node.data || {};
      const nodeName =
        data.name ||
        data.nodeName ||
        (data.label ? data.label.toLowerCase().replace(/\s+/g, '_') : 'node');
      let outputs = data.outputs || [];
      if (data.config && outputs.some((o: any) => o.dependsOn)) {
        outputs = outputs.filter((out: any) => {
          if (!out.dependsOn) return true;
          const targetVal = data.config[out.dependsOn.field];
          if (Array.isArray(out.dependsOn.in)) {
            return out.dependsOn.in.some((item: any) => String(item).toLowerCase() === String(targetVal ?? '').toLowerCase());
          }
          if (out.dependsOn.equals !== undefined) {
            return String(targetVal ?? '').toLowerCase() === String(out.dependsOn.equals).toLowerCase();
          }
          if (out.dependsOn.notEquals !== undefined) {
            return String(targetVal ?? '').toLowerCase() !== String(out.dependsOn.notEquals).toLowerCase();
          }
          return true;
        });
      }

      // Expose direct key variable for variable / set-variable nodes (e.g. setvariable.key, state.key)
      const defType = String(data.definitionType || node.type || '').toLowerCase();
      const isVariableNode = defType === 'variable' || defType === 'set-variable';

      if (isVariableNode && data.config?.key) {
        const keyName = String(data.config.key).trim();
        if (keyName) {
          const valType = String(data.config.valueType || '').toLowerCase();
          let resolvedType = 'string';
          if (valType === 'number' || typeof data.config.value === 'number' || typeof data.config.numberValue === 'number') {
            resolvedType = 'number';
          } else if (valType === 'boolean' || typeof data.config.value === 'boolean' || typeof data.config.booleanValue === 'boolean') {
            resolvedType = 'boolean';
          } else if (valType === 'json' || typeof data.config.value === 'object' || typeof data.config.jsonValue === 'object') {
            resolvedType = 'object';
          }

          variables.push({
            nodeId: node.id,
            nodeName,
            outputName: keyName,
            path: `${nodeName}.${keyName}`,
            type: resolvedType,
            schema: undefined,
          });
          variables.push({
            nodeId: node.id,
            nodeName: 'state',
            outputName: keyName,
            path: `state.${keyName}`,
            type: resolvedType,
            schema: undefined,
          });
          continue;
        }
      }

      // Expose whole node output for single output nodes
      if (outputs.length === 1) {
        variables.push({
          nodeId: node.id,
          nodeName,
          outputName: outputs[0].name,
          path: nodeName,
          type: outputs[0].type || 'object',
          schema: outputs[0].schema !== undefined ? outputs[0].schema : undefined,
        });
      }

      for (const output of outputs) {
        const basePath = `${nodeName}.${output.name}`;
        const outputType = output.type || 'object';
        const schema = output.schema;
        const isSingleOutput = outputs.length === 1;

        // 1. Add base variable (e.g. trigger.input, script.result)
        variables.push({
          nodeId: node.id,
          nodeName,
          outputName: output.name,
          path: basePath,
          type: outputType,
          schema: schema !== undefined ? schema : undefined,
        });

        // 2. If schema exists and is an object, generate nested field paths
        if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
          // Qualified paths (e.g. trigger.input.type, trigger.input.content)
          const nestedVars = this.generateNestedVariables(
            node.id,
            nodeName,
            output.name,
            basePath,
            schema,
          );
          variables.push(...nestedVars);

          // If single output, also expose direct path without intermediate handle (e.g. trigger.type, trigger.content)
          if (isSingleOutput) {
            const directVars = this.generateNestedVariables(
              node.id,
              nodeName,
              output.name,
              nodeName,
              schema,
            );
            variables.push(...directVars);
          }
        }
      }
    }

    return {
      graphId: graph._id ? graph._id.toString() : graphId,
      blockId: targetNode.id,
      variables,
    };
  }

  private generateNestedVariables(
    nodeId: string,
    nodeName: string,
    rootOutputName: string,
    currentPath: string,
    schema: Record<string, any>,
  ): UpstreamVariable[] {
    const result: UpstreamVariable[] = [];

    for (const [key, val] of Object.entries(schema)) {
      const fieldPath = `${currentPath}.${key}`;

      if (val && typeof val === 'object' && !Array.isArray(val)) {
        result.push({
          nodeId,
          nodeName,
          outputName: rootOutputName,
          path: fieldPath,
          type: 'object',
          schema: val,
        });

        // Recursively traverse nested object
        result.push(
          ...this.generateNestedVariables(
            nodeId,
            nodeName,
            rootOutputName,
            fieldPath,
            val,
          ),
        );
      } else {
        const typeStr = typeof val === 'string' ? val : 'property';
        result.push({
          nodeId,
          nodeName,
          outputName: rootOutputName,
          path: fieldPath,
          type: typeStr,
        });
      }
    }

    return result;
  }
}

export interface UpstreamVariable {
  nodeId: string;
  nodeName: string;
  outputName: string;
  path: string;
  type: string;
  schema?: unknown;
}

export interface UpstreamVariablesResponse {
  graphId: string;
  blockId: string;
  variables: UpstreamVariable[];
}
