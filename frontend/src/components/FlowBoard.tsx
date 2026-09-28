'use client';

import React, { useCallback, useRef } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  Connection,
  Edge,
  Node,
  NodeChange,
  EdgeChange,
  NodeMouseHandler,
  useReactFlow,
  SelectionMode,
  ConnectionLineType,
} from '@xyflow/react';
import { StraightWaypointEdge } from './edges/StraightWaypointEdge';
import { FlowNodeData, NodeDefinition } from '@/lib/types';
import { LangGraphCustomNode } from './nodes/LangGraphCustomNode';
import { BoardRightToolbar } from './BoardRightToolbar';

export interface FlowBoardProps {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange<Node<FlowNodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onNodeSelect: (node: Node<FlowNodeData>) => void;
  onAddNode: (definition: NodeDefinition, position?: { x: number; y: number }) => void;
  onOpenSettingsModal?: () => void;
  graphId?: string | null;
}

const nodeTypes = {
  langgraphNode: LangGraphCustomNode,
  default: LangGraphCustomNode,
};

const edgeTypes = {
  default: StraightWaypointEdge,
  straight: StraightWaypointEdge,
};

/**
 * FlowBoard must be rendered inside a <ReactFlowProvider> — this is handled by
 * FlowStudio so that FlowStudio itself can also access the React Flow context
 * (e.g. to compute the current viewport center when adding nodes from the palette).
 */
export const FlowBoard: React.FC<FlowBoardProps> = ({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeSelect,
  onAddNode,
  onOpenSettingsModal,
  graphId,
}) => {
  const reactFlowInstance = useReactFlow();
  // Track whether a multi-selection drag just completed to suppress modal open
  const didDragSelect = useRef(false);

  // Handle node click — only open config modal on a plain single click
  const handleNodeClick: NodeMouseHandler = useCallback(
    (event, clickedNode) => {
      // Suppress modal when Shift/Ctrl/Meta is held (multi-select modifier)
      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
      // Suppress modal when a rubber-band drag selection just finished
      if (didDragSelect.current) {
        didDragSelect.current = false;
        return;
      }
      onNodeSelect(clickedNode as Node<FlowNodeData>);
    },
    [onNodeSelect],
  );

  // Called when user starts drawing a rubber-band selection rectangle
  const handleSelectionStart = useCallback((_event: React.MouseEvent) => {
    didDragSelect.current = true;
  }, []);

  // Called when the rubber-band selection ends — keep the flag for a brief
  // moment so the follow-up click event on the node is ignored
  const handleSelectionEnd = useCallback((_event: React.MouseEvent) => {
    setTimeout(() => {
      didDragSelect.current = false;
    }, 100);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const rawDef = event.dataTransfer.getData('application/reactflow/definition');
      if (!rawDef) return;

      try {
        const definition: NodeDefinition = JSON.parse(rawDef);
        const position = reactFlowInstance.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        onAddNode(definition, position);
      } catch (err) {
        console.error('Failed to drop node definition:', err);
      }
    },
    [reactFlowInstance, onAddNode],
  );

  return (
    <div className="flow-board-wrapper" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionLineType={ConnectionLineType.Straight}
        defaultEdgeOptions={{ type: 'straight' }}
        fitView
        // ── Multi-select support ──────────────────────────────────────────────
        // Hold Shift and drag on an empty area of the canvas to draw a
        // rubber-band selection rectangle that selects all overlapping nodes
        selectionOnDrag
        // The key that switches click into "add to selection" mode
        multiSelectionKeyCode="Shift"
        // Use partial intersection so nodes are captured when the selection
        // rectangle merely overlaps them (not fully contains)
        selectionMode={SelectionMode.Partial}
        deleteKeyCode={['Delete', 'Backspace']}
        onSelectionStart={handleSelectionStart}
        onSelectionEnd={handleSelectionEnd}
      >
        <Controls />
        <MiniMap
          nodeColor={() => '#6366f1'}
          style={{ width: 130, height: 90 }}
          zoomable
          pannable
        />
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.2} color="#cbd5e1" />
      </ReactFlow>

      {/* Right Side Board Toolbar Menu */}
      <BoardRightToolbar
        nodes={nodes}
        graphId={graphId}
        onFitView={() => reactFlowInstance.fitView({ padding: 0.2, duration: 400 })}
      />
    </div>
  );
};
