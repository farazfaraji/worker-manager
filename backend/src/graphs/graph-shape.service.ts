import { Injectable } from '@nestjs/common';
import { GraphLayout, GraphNodeLayout, GraphViewport } from './schemas/graph.schema';

type GraphNode = Record<string, any>;
type GraphEdge = Record<string, any>;

export interface GraphShapeInput {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  layout?: Partial<GraphLayout> | Record<string, any>;
  /** Kept for documents and clients using the old top-level viewport field. */
  viewport?: Partial<GraphViewport>;
}

export interface ShapedGraph {
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

/**
 * Converts React Flow payloads into a compact executable graph plus a separate
 * presentation model, then rebuilds React Flow objects when a graph is read.
 *
 * The graph stored in `nodes` and `edges` deliberately contains no coordinates,
 * styles, selection state, or other canvas-only properties.
 */
@Injectable()
export class GraphShapeService {
  reshapeForSave(input: GraphShapeInput): ShapedGraph {
    const sourceNodes = Array.isArray(input.nodes) ? input.nodes : [];
    const sourceEdges = Array.isArray(input.edges) ? input.edges : [];
    const layout = this.normalizeLayout(input.layout, input.viewport);

    const nodes = sourceNodes
      .filter((node) => isRecord(node) && typeof node.id === 'string' && node.id.length > 0)
      .map((node, index) => {
        const previous = layout.nodes[node.id];
        layout.nodes[node.id] = this.extractNodeLayout(node, previous, index);
        return this.toSemanticNode(node);
      });

    const nodeIds = new Set(nodes.map((node) => node.id));
    layout.nodes = Object.fromEntries(
      Object.entries(layout.nodes).filter(([nodeId]) => nodeIds.has(nodeId)),
    );
    const edges = sourceEdges
      .filter(
        (edge) =>
          isRecord(edge) &&
          typeof edge.source === 'string' &&
          typeof edge.target === 'string' &&
          nodeIds.has(edge.source) &&
          nodeIds.has(edge.target),
      )
      .map((edge, index) => {
        const semantic = this.toSemanticEdge(edge, index);
        layout.edges[semantic.id] = this.extractEdgeLayout(edge, layout.edges[semantic.id]);
        return semantic;
      });

    const edgeIds = new Set(edges.map((edge) => edge.id));
    layout.edges = Object.fromEntries(
      Object.entries(layout.edges).filter(([edgeId]) => edgeIds.has(edgeId)),
    );

    this.assignMissingPositions(nodes, edges, layout);
    return { nodes, edges, layout };
  }

  reshapeForLoad(input: GraphShapeInput): ShapedGraph {
    // Feeding legacy graphs through the save shape first automatically extracts
    // their old inline `position` and edge styling into the new layout object.
    const shaped = this.reshapeForSave(input);

    return {
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

  private toSemanticNode(node: GraphNode): GraphNode {
    return {
      id: node.id,
      type: typeof node.type === 'string' ? node.type : 'langgraphNode',
      data: copyRecord(node.data) || {},
    };
  }

  private toSemanticEdge(edge: GraphEdge, index: number): GraphEdge {
    const id =
      typeof edge.id === 'string' && edge.id.length > 0
        ? edge.id
        : `${edge.source}:${edge.sourceHandle || 'default'}:${edge.target}:${index}`;

    return {
      id,
      source: edge.source,
      target: edge.target,
      ...(typeof edge.sourceHandle === 'string' ? { sourceHandle: edge.sourceHandle } : {}),
      ...(typeof edge.targetHandle === 'string' ? { targetHandle: edge.targetHandle } : {}),
      ...(copyRecord(edge.data) ? { data: copyRecord(edge.data) } : {}),
    };
  }

  private extractNodeLayout(
    node: GraphNode,
    existing: GraphLayout['nodes'][string] | undefined,
    index: number,
  ): GraphLayout['nodes'][string] {
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
    const visual: Record<string, any> = {
      ...(existing || {}),
    };

    for (const key of ['type', 'animated', 'style', 'label', 'labelStyle', 'labelBgStyle', 'markerEnd', 'markerStart', 'className', 'zIndex']) {
      if (edge[key] !== undefined) {
        visual[key] = edge[key];
      }
    }
    return visual;
  }

  /** A deterministic, simple fallback for legacy graphs or nodes without a position. */
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

  private fallbackPosition(index: number) {
    return { x: 0, y: index * VERTICAL_GAP };
  }
}
