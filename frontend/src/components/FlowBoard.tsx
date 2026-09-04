'use client';

import React, { useCallback, useMemo } from 'react';
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
  ReactFlowProvider,
} from '@xyflow/react';
import { FlowNodeData, NodeDefinition } from '@/lib/types';
import { LangGraphCustomNode } from './nodes/LangGraphCustomNode';
import { BoardRightToolbar } from './BoardRightToolbar';

interface FlowBoardProps {
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

const FlowBoardInner: React.FC<FlowBoardProps> = ({
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

  // Handle node click to open configuration modal
  const handleNodeClick: NodeMouseHandler = useCallback(
    (_, clickedNode) => {
      onNodeSelect(clickedNode as Node<FlowNodeData>);
    },
    [onNodeSelect],
  );

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
        fitView
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

export const FlowBoard: React.FC<FlowBoardProps> = (props) => {
  return (
    <ReactFlowProvider>
      <FlowBoardInner {...props} />
    </ReactFlowProvider>
  );
};
