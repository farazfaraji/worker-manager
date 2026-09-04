import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { Graph, GraphDocument } from './schemas/graph.schema';
import { CreateGraphDto } from './dto/create-graph.dto';
import { UpdateGraphDto } from './dto/update-graph.dto';
import { NodeDefinitionsService } from '../node-definitions/node-definitions.service';
import { GraphShapeService } from './graph-shape.service';

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
  ) {}

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
      const def = definitions.find(
        (d) =>
          d.type.toLowerCase() === defType.toLowerCase() ||
          d.id.toLowerCase() === (data.definitionId || '').toLowerCase() ||
          d.name.toLowerCase() === (data.definitionName || '').toLowerCase() ||
          d.id.toLowerCase() === defType.toLowerCase(),
      );

      let outputsDef =
        data.definitionOutputs && data.definitionOutputs.length > 0
          ? data.definitionOutputs
          : def?.outputs || data.outputs || [];

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

      // Filter outputs by dependsOn against config
      if (config && outputsDef.some((o: any) => o.dependsOn)) {
        outputsDef = outputsDef.filter((out: any) => {
          if (!out.dependsOn) return true;
          const targetVal = config[out.dependsOn.field];
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
      .select('name projectId createdAt updatedAt nodes edges layout viewport metadata')
      .sort({ updatedAt: -1 })
      .exec();

    return graphs.map((g) => ({
      id: g._id.toString(),
      name: g.name,
      projectId: g.projectId,
      nodeCount: (g.nodes || []).length,
      edgeCount: (g.edges || []).length,
      createdAt: (g as any).createdAt,
      updatedAt: (g as any).updatedAt,
      metadata: g.metadata,
    }));
  }

  async findOne(id: string): Promise<GraphDocument> {
    if (!id || (typeof id === 'string' && !isValidObjectId(id))) {
      throw new NotFoundException('Graph not found');
    }
    try {
      const graph = await this.graphModel.findById(id).exec();
      if (!graph) {
        throw new NotFoundException('Graph not found');
      }
      // First extract inline React Flow layout from legacy documents. Enrichment
      // intentionally removes UI-only fields, so doing this first preserves the
      // current canvas arrangement during the schema transition.
      const storedShape = this.graphShapeService.reshapeForSave({
        nodes: graph.nodes || [],
        edges: graph.edges || [],
        layout: graph.layout,
        viewport: graph.viewport,
      });
      graph.nodes = (await this.enrichNodesWithOutputs(storedShape.nodes)) as any;
      graph.edges = storedShape.edges as any;
      graph.layout = storedShape.layout;
      graph.viewport = storedShape.layout.viewport;
      return this.reshapeDocumentForEditor(graph);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new NotFoundException('Graph not found');
    }
  }

  async create(createGraphDto: CreateGraphDto): Promise<GraphDocument> {
    const shaped = this.graphShapeService.reshapeForSave({
      nodes: createGraphDto.nodes,
      edges: createGraphDto.edges,
      layout: createGraphDto.layout,
      viewport: createGraphDto.viewport,
    });
    await this.validateGraphVariables(shaped.nodes, shaped.edges);

    const enrichedNodes = await this.enrichNodesWithOutputs(shaped.nodes);
    const createdGraph = new this.graphModel({
      ...createGraphDto,
      nodes: enrichedNodes,
      edges: shaped.edges,
      layout: shaped.layout,
      viewport: shaped.layout.viewport,
      metadata: createGraphDto.metadata || {},
    });
    return this.reshapeDocumentForEditor(await createdGraph.save());
  }

  async update(
    id: string,
    updateGraphDto: UpdateGraphDto,
  ): Promise<GraphDocument> {
    const existing = await this.findOne(id);
    const nodes = updateGraphDto.nodes !== undefined ? updateGraphDto.nodes : existing.nodes || [];
    const edges = updateGraphDto.edges !== undefined ? updateGraphDto.edges : existing.edges || [];
    const shaped = this.graphShapeService.reshapeForSave({
      nodes,
      edges,
      layout: updateGraphDto.layout !== undefined ? updateGraphDto.layout : existing.layout,
      viewport: updateGraphDto.viewport || existing.viewport,
    });

    await this.validateGraphVariables(shaped.nodes, shaped.edges);

    try {
      const updateData: any = { ...updateGraphDto };
      updateData.nodes = await this.enrichNodesWithOutputs(shaped.nodes);
      updateData.edges = shaped.edges;
      updateData.layout = shaped.layout;
      updateData.viewport = shaped.layout.viewport;

      const updatedGraph = await this.graphModel
        .findByIdAndUpdate(
          id,
          { $set: updateData },
          { new: true, runValidators: true },
        )
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

  private reshapeDocumentForEditor(graph: GraphDocument): GraphDocument {
    const shaped = this.graphShapeService.reshapeForLoad({
      nodes: graph.nodes || [],
      edges: graph.edges || [],
      layout: graph.layout,
      viewport: graph.viewport,
    });
    graph.nodes = shaped.nodes as any;
    graph.edges = shaped.edges as any;
    graph.layout = shaped.layout;
    graph.viewport = shaped.layout.viewport;
    return graph;
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
  async validateGraphVariables(
    nodes: any[],
    edges: any[],
  ): Promise<{ valid: boolean }> {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return { valid: true };
    }

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
      const sourceDefType = String(sourceData.definitionType || sourceNode.type || '').toLowerCase();
      const outputs = sourceData.outputs || [];

      if (sourceDefType === 'condition') {
        const handle = String(edge.sourceHandle || '').toLowerCase();
        if (handle !== 'true' && handle !== 'false') {
          throw new BadRequestException({
            message: 'Invalid condition branch handle on edge',
            edgeId: edge.id,
            source: sourceNode.id,
            sourceName: sourceNodeName,
            sourceHandle: edge.sourceHandle,
            reason: `Edge from Condition node "${sourceNodeName}" must connect from "true" or "false" handle, but received "${edge.sourceHandle || 'none'}".`,
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
            sourceHandle: edge.sourceHandle,
            validHandles: Array.from(validHandles),
            reason: `Edge connects from handle "${edge.sourceHandle}", but Router node "${sourceNodeName}" only provides [${Array.from(validHandles).join(', ')}]. Please reconnect this node.`,
          });
        }
      } else if (edge.sourceHandle) {
        const handle = String(edge.sourceHandle).toLowerCase();
        const validHandles = new Set<string>();
        validHandles.add('flow');
        for (const out of outputs) {
          if (out.name) validHandles.add(String(out.name).toLowerCase());
        }

        if (!validHandles.has(handle)) {
          throw new BadRequestException({
            message: 'Invalid source handle on edge',
            edgeId: edge.id,
            source: sourceNode.id,
            sourceName: sourceNodeName,
            sourceHandle: edge.sourceHandle,
            validHandles: Array.from(validHandles),
            reason: `Edge connects from handle "${edge.sourceHandle}", but node "${sourceNodeName}" only provides [${Array.from(validHandles).join(', ')}]. Please reconnect this node.`,
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
      }

      upstreamNodesMap.set(node.id, upstreamSet);
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

      // Add direct key references for variable / set-variable nodes (e.g. setvariable.key)
      const defType = String(data.definitionType || node.type || '').toLowerCase();
      if ((defType === 'variable' || defType === 'set-variable') && data.config?.key) {
        const keyName = String(data.config.key).trim();
        if (keyName) {
          producedPaths.add(`${nodeName}.${keyName}`);
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

      const def = definitions.find(
        (d) =>
          d.type.toLowerCase() === defType.toLowerCase() ||
          d.id.toLowerCase() === (data.definitionId || '').toLowerCase() ||
          d.name.toLowerCase() === (data.definitionName || '').toLowerCase() ||
          d.id.toLowerCase() === defType.toLowerCase(),
      );

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
            refPathsToCheck.push(strTrimmed);
          } else if (inputDef && inputDef.type === 'valueOrVariable') {
            if (
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
          if (!validPaths.has(refPath)) {
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
          if (out.dependsOn.equals !== undefined) {
            return String(targetVal ?? '').toLowerCase() === String(out.dependsOn.equals).toLowerCase();
          }
          if (out.dependsOn.notEquals !== undefined) {
            return String(targetVal ?? '').toLowerCase() !== String(out.dependsOn.notEquals).toLowerCase();
          }
          return true;
        });
      }

      // Expose direct key variable for variable / set-variable nodes (e.g. setvariable.key)
      const defType = String(data.definitionType || node.type || '').toLowerCase();
      const isVariableNode = defType === 'variable' || defType === 'set-variable';

      if (isVariableNode && data.config?.key) {
        const keyName = String(data.config.key).trim();
        if (keyName) {
          variables.push({
            nodeId: node.id,
            nodeName,
            outputName: keyName,
            path: `${nodeName}.${keyName}`,
            type: typeof data.config.value === 'number' ? 'number' : typeof data.config.value === 'boolean' ? 'boolean' : 'string',
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

        // 1. Add base variable
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
          // If single output (e.g. jsonparser, script), generate direct paths (e.g. jsonparser.entries, script.result)
          const targetPrefix = isSingleOutput ? nodeName : basePath;
          const nestedVars = this.generateNestedVariables(
            node.id,
            nodeName,
            output.name,
            targetPrefix,
            schema,
          );
          variables.push(...nestedVars);
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
