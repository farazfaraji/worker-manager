'use client';

import React from 'react';
import { NodeDefinition } from '@/lib/types';
import { NodePalette } from './palette/NodePalette';

interface LeftPanelProps {
  onAddNode: (definition: NodeDefinition) => void;
}

export const LeftPanel: React.FC<LeftPanelProps> = ({ onAddNode }) => {
  return <NodePalette onAddNode={onAddNode} />;
};
