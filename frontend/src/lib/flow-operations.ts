import { FlowBlock, FlowOperation } from './flow-assistant';

export interface FlowOutputDefinition {
  id?: string;
  name?: string;
  type: string;
  inputs?: any[];
  outputs?: { name: string; label?: string; type: string }[];
  actionDefinitions?: any[];
}

export interface CanvasNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  selected?: boolean;
  data: Record<string, any>;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  data?: Record<string, any>;
  style?: Record<string, any>;
}

/**
 * Applies a validated edit list to the canvas.
 * Existing positions and node data are kept. New blocks sit next to `after`.
 * Outputs come from the block definition, not a hard-coded port list.
 */
export function applyFlowOperations<N extends CanvasNode, E extends CanvasEdge>(
  nodes: N[],
  edges: E[],
  ops: FlowOperation[],
  definitions: FlowOutputDefinition[],
): { nodes: N[]; edges: E[] } {
  let nextNodes = nodes.map((node) => ({ ...node, data: { ...node.data } })) as N[];
  let nextEdges = edges.map((edge) => ({ ...edge })) as E[];

  for (const operation of ops) {
    if (operation.op === 'removeConnection') {
      nextEdges = nextEdges.filter((edge) => !connectionMatches(edge, operation.from, operation.to, operation.output));
      continue;
    }

    if (operation.op === 'removeBlock') {
      nextNodes = nextNodes.filter((node) => node.id !== operation.blockId);
      nextEdges = nextEdges.filter(
        (edge) => edge.source !== operation.blockId && edge.target !== operation.blockId,
      );
      continue;
    }

    if (operation.op === 'addBlock') {
      if (!operation.block?.id || nextNodes.some((node) => node.id === operation.block.id)) continue;
      nextNodes = [...nextNodes, createNode(nextNodes, operation.block, operation.after, definitions)];
      continue;
    }

    if (operation.op === 'updateBlock') {
      nextNodes = nextNodes.map((node) => {
        if (node.id !== operation.blockId) return node;
        const name = operation.name || node.data.name;
        return {
          ...node,
          data: {
            ...node.data,
            ...(operation.name
              ? { name: operation.name, label: operation.name, nodeName: operation.name }
              : { name }),
            config: { ...(node.data.config || {}), ...(operation.configPatch || {}) },
          },
        };
      });
      continue;
    }

    if (operation.op === 'addConnection') {
      const output = operation.output || 'done';
      const already = nextEdges.some(
        (edge) =>
          edge.source === operation.from &&
          edge.target === operation.to &&
          (edge.sourceHandle || 'done') === output,
      );
      if (already) continue;
      nextEdges = [
        ...nextEdges,
        {
          id: `e-${operation.from}-${operation.to}-${output}`,
          source: operation.from,
          target: operation.to,
          sourceHandle: output,
          targetHandle: operation.input || 'in',
          type: 'default',
        } as unknown as E,
      ];
    }
  }

  return { nodes: nextNodes, edges: nextEdges };
}

/**
 * Shows a proposed edit without changing the real graph:
 * added blocks are ghosts, changed and removed blocks are marked.
 */
export function previewFlowOperations<N extends CanvasNode, E extends CanvasEdge>(
  nodes: N[],
  edges: E[],
  ops: FlowOperation[],
  definitions: FlowOutputDefinition[],
): { nodes: N[]; edges: E[] } {
  let nextNodes = nodes.map((node) => ({
    ...node,
    data: { ...node.data, assistantDiff: undefined, assistantGhost: undefined, assistantHighlight: undefined },
  })) as N[];
  let nextEdges = edges
    .filter((edge) => !edge.data?.assistantPreview)
    .map((edge) => ({ ...edge, data: { ...(edge.data || {}) } })) as E[];

  for (const operation of ops) {
    if (operation.op === 'removeBlock') {
      nextNodes = nextNodes.map((node) =>
        node.id === operation.blockId
          ? { ...node, data: { ...node.data, assistantDiff: 'removed' } }
          : node,
      );
      continue;
    }

    if (operation.op === 'updateBlock') {
      nextNodes = nextNodes.map((node) =>
        node.id === operation.blockId
          ? { ...node, data: { ...node.data, assistantDiff: 'changed' } }
          : node,
      );
      continue;
    }

    if (operation.op === 'addBlock' && operation.block?.id) {
      if (nextNodes.some((node) => node.id === operation.block.id)) continue;
      const ghost = createNode(nextNodes, operation.block, operation.after, definitions);
      ghost.data = { ...ghost.data, assistantDiff: 'added', assistantGhost: true };
      nextNodes = [...nextNodes, ghost];
      continue;
    }

    if (operation.op === 'addConnection') {
      const output = operation.output || 'done';
      nextEdges = [
        ...nextEdges,
        {
          id: `preview-${operation.from}-${operation.to}-${output}`,
          source: operation.from,
          target: operation.to,
          sourceHandle: output,
          targetHandle: operation.input || 'in',
          type: 'default',
          data: { assistantPreview: true },
          style: { strokeDasharray: '6 4', opacity: 0.7 },
        } as unknown as E,
      ];
      continue;
    }

    if (operation.op === 'removeConnection') {
      nextEdges = nextEdges.map((edge) =>
        connectionMatches(edge, operation.from, operation.to, operation.output)
          ? { ...edge, data: { ...(edge.data || {}), assistantDiff: 'removed' }, style: { opacity: 0.35 } }
          : edge,
      );
    }
  }

  return { nodes: nextNodes, edges: nextEdges };
}

function createNode<N extends CanvasNode>(
  nodes: N[],
  block: FlowBlock,
  after: string | undefined,
  definitions: FlowOutputDefinition[],
): N {
  const definition = definitions.find((item) => item.type === block.kind);
  const outputs = outputsFor(block.kind, definition);
  return {
    id: block.id,
    type: 'langgraphNode',
    position: placeBeside(nodes, after),
    data: {
      name: block.name || block.id,
      label: block.label || block.name || block.id,
      nodeName: block.name || block.id,
      definitionId: definition?.id || block.kind,
      definitionType: block.kind,
      definitionName: definition?.name || block.name || block.kind,
      config: block.config || {},
      inputs: definition?.inputs || [],
      definitionOutputs: outputs,
      outputs,
      actionDefinitions: definition?.actionDefinitions || [],
    },
  } as unknown as N;
}

function outputsFor(kind: string, definition?: FlowOutputDefinition) {
  if (definition?.outputs?.length) return definition.outputs;
  if (kind === 'condition') {
    return [
      { name: 'true', label: 'True', type: 'branch' },
      { name: 'false', label: 'False', type: 'branch' },
    ];
  }
  return [{ name: 'done', label: 'Done', type: 'default' }];
}

function placeBeside(nodes: CanvasNode[], after?: string): { x: number; y: number } {
  const anchor = after ? nodes.find((node) => node.id === after) : undefined;
  let x = anchor ? anchor.position.x : 320;
  let y = anchor
    ? anchor.position.y + 180
    : nodes.reduce((max, node) => Math.max(max, node.position?.y || 0), 40) + 160;
  while (nodes.some((node) => Math.abs(node.position.x - x) < 30 && Math.abs(node.position.y - y) < 30)) {
    x += 48;
  }
  return { x, y };
}

function connectionMatches(
  edge: CanvasEdge,
  from: string,
  to: string,
  output?: string,
): boolean {
  if (edge.source !== from || edge.target !== to) return false;
  if (!output) return true;
  return (edge.sourceHandle || 'done') === output;
}
