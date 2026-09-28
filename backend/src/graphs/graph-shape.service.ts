import { Injectable } from '@nestjs/common';
import {
  GraphBlock,
  GraphConnection,
  GraphFlow,
  GraphLayout,
  GraphNodeLayout,
  GraphViewport,
} from './schemas/graph.schema';

type GraphNode = Record<string, any>;
type GraphEdge = Record<string, any>;

export interface GraphShapeInput {
  flow?: Partial<GraphFlow> | Record<string, any>;
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  layout?: Partial<GraphLayout> | Record<string, any>;
  viewport?: Partial<GraphViewport>;
}

export interface ShapedGraph {
  flow: GraphFlow;
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: GraphLayout;
}

const DEFAULT_VIEWPORT: GraphViewport = { x: 0, y: 0, zoom: 1 };
const VERTICAL_GAP = 180;
const HORIZONTAL_GAP = 320;

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function copyRecord(value: unknown): Record<string, any> | undefined {
  return isRecord(value) ? { ...value } : undefined;
}

/** The translation boundary between persisted flow data, runtime, and React Flow. */
@Injectable()
export class GraphShapeService {
  reshapeForSave(input: GraphShapeInput): ShapedGraph {
    const flow = this.normalizeFlow(input.flow, input.nodes, input.edges);
    const runtime = this.toRuntimeGraph(flow);
    const sourceNodes = Array.isArray(input.nodes) ? input.nodes : runtime.nodes;
    const sourceEdges = Array.isArray(input.edges) ? input.edges : runtime.edges;
    const layout = this.normalizeLayout(input.layout, input.viewport);
    const runtimeNodeIds = new Set(runtime.nodes.map((node) => node.id));
    const runtimeEdgeIds = new Set(runtime.edges.map((edge) => edge.id));
    const sourceNodeById = new Map(
      sourceNodes
        .filter((node) => isRecord(node) && typeof node.id === 'string')
        .map((node) => [node.id, node]),
    );
    const sourceEdgeById = new Map(
      sourceEdges
        .filter((edge) => isRecord(edge) && typeof edge.id === 'string')
        .map((edge) => [edge.id, edge]),
    );

    runtime.nodes.forEach((node, index) => {
      layout.nodes[node.id] = this.extractNodeLayout(
        sourceNodeById.get(node.id) || node,
        layout.nodes[node.id],
        index,
      );
    });
    layout.nodes = Object.fromEntries(
      Object.entries(layout.nodes).filter(([nodeId]) => runtimeNodeIds.has(nodeId)),
    );

    for (const edge of runtime.edges) {
      layout.edges[edge.id] = this.extractEdgeLayout(
        sourceEdgeById.get(edge.id) || edge,
        layout.edges[edge.id],
      );
    }
    layout.edges = Object.fromEntries(
      Object.entries(layout.edges).filter(([edgeId]) => runtimeEdgeIds.has(edgeId)),
    );

    this.assignMissingPositions(runtime.nodes, runtime.edges, layout);
    return { flow, nodes: runtime.nodes, edges: runtime.edges, layout };
  }

  reshapeForLoad(input: GraphShapeInput): ShapedGraph {
    const shaped = this.reshapeForSave(input);
    return {
      flow: shaped.flow,
      layout: shaped.layout,
      nodes: shaped.nodes.map((node, index) => {
        const nodeLayout: GraphNodeLayout = shaped.layout.nodes[node.id] || this.fallbackPosition(index);
        return {
          ...node,
          position: { x: nodeLayout.x, y: nodeLayout.y },
          ...(nodeLayout.hidden !== undefined ? { hidden: nodeLayout.hidden } : {}),
          ...(nodeLayout.width !== undefined ? { width: nodeLayout.width } : {}),
          ...(nodeLayout.height !== undefined ? { height: nodeLayout.height } : {}),
        };
      }),
      edges: shaped.edges.map((edge) => ({
        ...edge,
        ...(shaped.layout.edges[edge.id] || {}),
      })),
    };
  }

  private normalizeFlow(
    candidate?: Partial<GraphFlow> | Record<string, any>,
    legacyNodes?: GraphNode[],
    legacyEdges?: GraphEdge[],
  ): GraphFlow {
    if (isRecord(candidate) && Array.isArray(candidate.blocks) && Array.isArray(candidate.connections)) {
      const blocks = candidate.blocks
        .filter((block: any) => isRecord(block) && typeof block.id === 'string' && block.id.length > 0)
        .map((block: any) => this.normalizeBlock(block));
      const blockIds = new Set(blocks.map((block) => block.id));
      const connections = candidate.connections
        .filter(
          (connection: any) =>
            isRecord(connection) &&
            typeof connection.from === 'string' &&
            typeof connection.to === 'string' &&
            blockIds.has(connection.from) &&
            blockIds.has(connection.to),
        )
        .map((connection: any, index: number) => this.normalizeConnection(connection, index));
      return { version: 1, blocks, connections };
    }

    const blocks = (Array.isArray(legacyNodes) ? legacyNodes : [])
      .filter((node) => isRecord(node) && typeof node.id === 'string' && node.id.length > 0)
      .map((node) => this.nodeToBlock(node));
    const blockIds = new Set(blocks.map((block) => block.id));
    const connections = (Array.isArray(legacyEdges) ? legacyEdges : [])
      .filter(
        (edge) =>
          isRecord(edge) &&
          typeof edge.source === 'string' &&
          typeof edge.target === 'string' &&
          blockIds.has(edge.source) &&
          blockIds.has(edge.target),
      )
      .map((edge, index) => this.edgeToConnection(edge, index));
    return { version: 1, blocks, connections };
  }

  private normalizeBlock(block: Record<string, any>): GraphBlock {
    const name = this.safeName(block.name, block.id);
    return {
      id: block.id,
      kind: typeof block.kind === 'string' && block.kind ? block.kind : 'function',
      name,
      label: typeof block.label === 'string' && block.label ? block.label : name,
      ...(typeof block.definitionId === 'string' ? { definitionId: block.definitionId } : {}),
      ...(typeof block.definitionName === 'string' ? { definitionName: block.definitionName } : {}),
      config: copyRecord(block.config) || {},
    };
  }

  private nodeToBlock(node: GraphNode): GraphBlock {
    const data = copyRecord(node.data) || {};
    const kind =
      typeof data.definitionType === 'string' && data.definitionType
        ? data.definitionType
        : typeof node.type === 'string' && node.type !== 'langgraphNode'
          ? node.type
          : 'function';
    const name = this.safeName(data.name || data.nodeName, node.id);
    return {
      id: node.id,
      kind,
      name,
      label: typeof data.label === 'string' && data.label ? data.label : name,
      ...(typeof data.definitionId === 'string' ? { definitionId: data.definitionId } : {}),
      ...(typeof data.definitionName === 'string' ? { definitionName: data.definitionName } : {}),
      config: copyRecord(data.config) || {},
    };
  }

  private normalizeConnection(connection: Record<string, any>, index: number): GraphConnection {
    const output = typeof connection.output === 'string' ? connection.output : undefined;
    const input = typeof connection.input === 'string' ? connection.input : undefined;
    return {
      id:
        typeof connection.id === 'string' && connection.id
          ? connection.id
          : `${connection.from}:${output || 'default'}:${connection.to}:${index}`,
      from: connection.from,
      to: connection.to,
      ...(output ? { output } : {}),
      ...(input ? { input } : {}),
      ...(copyRecord(connection.data) ? { data: copyRecord(connection.data) } : {}),
    };
  }

  private edgeToConnection(edge: GraphEdge, index: number): GraphConnection {
    return this.normalizeConnection(
      {
        id: edge.id,
        from: edge.source,
        to: edge.target,
        output: edge.sourceHandle,
        input: edge.targetHandle,
        data: edge.data,
      },
      index,
    );
  }

  private toRuntimeGraph(flow: GraphFlow): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return {
      nodes: flow.blocks.map((block) => ({
        id: block.id,
        type: 'langgraphNode',
        data: {
          name: block.name,
          nodeName: block.name,
          definitionType: block.kind,
          definitionName: block.definitionName || block.label,
          ...(block.definitionId ? { definitionId: block.definitionId } : {}),
          label: block.label,
          config: copyRecord(block.config) || {},
        },
      })),
      edges: flow.connections.map((connection) => ({
        id: connection.id,
        source: connection.from,
        target: connection.to,
        ...(connection.output ? { sourceHandle: connection.output } : {}),
        ...(connection.input ? { targetHandle: connection.input } : {}),
        ...(copyRecord(connection.data) ? { data: copyRecord(connection.data) } : {}),
      })),
    };
  }

  private normalizeLayout(
    candidate?: Partial<GraphLayout> | Record<string, any>,
    legacyViewport?: Partial<GraphViewport>,
  ): GraphLayout {
    const rawLayout = isRecord(candidate) ? candidate : {};
    const rawViewport = isRecord(rawLayout.viewport)
      ? rawLayout.viewport
      : isRecord(legacyViewport)
        ? legacyViewport
        : DEFAULT_VIEWPORT;
    const nodes: GraphLayout['nodes'] = {};
    if (isRecord(rawLayout.nodes)) {
      for (const [nodeId, rawNodeLayout] of Object.entries(rawLayout.nodes)) {
        if (!isRecord(rawNodeLayout)) continue;
        nodes[nodeId] = {
          x: numberOr(rawNodeLayout.x, 0),
          y: numberOr(rawNodeLayout.y, 0),
          ...(typeof rawNodeLayout.width === 'number' ? { width: rawNodeLayout.width } : {}),
          ...(typeof rawNodeLayout.height === 'number' ? { height: rawNodeLayout.height } : {}),
          ...(typeof rawNodeLayout.hidden === 'boolean' ? { hidden: rawNodeLayout.hidden } : {}),
        };
      }
    }
    return {
      version: 1,
      viewport: {
        x: numberOr(rawViewport.x, DEFAULT_VIEWPORT.x),
        y: numberOr(rawViewport.y, DEFAULT_VIEWPORT.y),
        zoom: numberOr(rawViewport.zoom, DEFAULT_VIEWPORT.zoom),
      },
      nodes,
      edges: isRecord(rawLayout.edges) ? { ...rawLayout.edges } : {},
    };
  }

  private extractNodeLayout(
    node: GraphNode,
    existing: GraphNodeLayout | undefined,
    index: number,
  ): GraphNodeLayout {
    const position = isRecord(node.position) ? node.position : existing || this.fallbackPosition(index);
    return {
      x: numberOr(position.x, existing?.x ?? this.fallbackPosition(index).x),
      y: numberOr(position.y, existing?.y ?? this.fallbackPosition(index).y),
      ...(typeof node.width === 'number' ? { width: node.width } : existing?.width !== undefined ? { width: existing.width } : {}),
      ...(typeof node.height === 'number' ? { height: node.height } : existing?.height !== undefined ? { height: existing.height } : {}),
      ...(typeof node.hidden === 'boolean' ? { hidden: node.hidden } : existing?.hidden !== undefined ? { hidden: existing.hidden } : {}),
    };
  }

  private extractEdgeLayout(edge: GraphEdge, existing?: Record<string, any>): Record<string, any> {
    const visual: Record<string, any> = { ...(existing || {}) };
    for (const key of ['type', 'animated', 'style', 'label', 'labelStyle', 'labelBgStyle', 'markerEnd', 'markerStart', 'className', 'zIndex']) {
      if (edge[key] !== undefined) visual[key] = edge[key];
    }
    return visual;
  }

  private assignMissingPositions(nodes: GraphNode[], edges: GraphEdge[], layout: GraphLayout) {
    const assigned = new Map<string, number>();
    const nodeIds = new Set(nodes.map((node) => node.id));
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const node of nodes) {
      incoming.set(node.id, 0);
      outgoing.set(node.id, []);
    }
    for (const edge of edges) {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
      outgoing.get(edge.source)!.push(edge.target);
      incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    }
    const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
    if (queue.length === 0 && nodes[0]) queue.push(nodes[0].id);
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (assigned.has(nodeId)) continue;
      const level = assigned.get(nodeId) ?? 0;
      assigned.set(nodeId, level);
      for (const targetId of outgoing.get(nodeId) || []) {
        if (!assigned.has(targetId)) {
          assigned.set(targetId, level + 1);
          queue.push(targetId);
        }
      }
    }
    for (const node of nodes) {
      if (!assigned.has(node.id)) assigned.set(node.id, assigned.size);
    }
    const nodesByLevel = new Map<number, string[]>();
    for (const node of nodes) {
      const level = assigned.get(node.id) || 0;
      const ids = nodesByLevel.get(level) || [];
      ids.push(node.id);
      nodesByLevel.set(level, ids);
    }
    for (const [level, ids] of nodesByLevel) {
      ids.forEach((nodeId, column) => {
        const current = layout.nodes[nodeId];
        if (current && Number.isFinite(current.x) && Number.isFinite(current.y)) return;
        layout.nodes[nodeId] = {
          x: (column - (ids.length - 1) / 2) * HORIZONTAL_GAP,
          y: level * VERTICAL_GAP,
        };
      });
    }
  }

  private fallbackPosition(index: number): GraphNodeLayout {
    return { x: 0, y: index * VERTICAL_GAP };
  }

  private safeName(value: unknown, fallback: string): string {
    const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
    return raw.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}
