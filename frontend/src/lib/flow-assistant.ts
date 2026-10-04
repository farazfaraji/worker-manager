export type AssistantMode = 'clarify' | 'confirm' | 'build' | 'edit' | 'answer';

export interface BlockReference {
  blockId: string;
  role?: 'primary' | 'related';
}

export interface ClarifyingQuestionOption {
  id: string;
  label: string;
  blockId?: string;
}

export interface ClarifyingQuestion {
  id: string;
  question: string;
  why?: string;
  options?: ClarifyingQuestionOption[];
  allowFreeText: boolean;
  default?: string;
}

export interface FlowOutlineStep {
  id: string;
  kind: string;
  summary: string;
}

export interface FlowOutline {
  title: string;
  trigger: string;
  steps: FlowOutlineStep[];
  outputs: string[];
  assumptions: string[];
}

export interface FlowBlock {
  id: string;
  kind: string;
  name?: string;
  label?: string;
  config?: Record<string, any>;
}

export interface FlowConnection {
  id?: string;
  from: string;
  to: string;
  output?: string;
  input?: string;
}

export interface FlowGraph {
  blocks: FlowBlock[];
  connections: FlowConnection[];
}

export type FlowOperation =
  | { op: 'addBlock'; block: FlowBlock; after?: string }
  | { op: 'updateBlock'; blockId: string; name?: string; configPatch?: Record<string, any> }
  | { op: 'removeBlock'; blockId: string }
  | { op: 'addConnection'; from: string; to: string; output?: string; input?: string }
  | { op: 'removeConnection'; from: string; to: string; output?: string };

export interface FlowAssistantRequest {
  message: string;
  projectId?: string;
  modelId?: string;
  history?: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    mode?: AssistantMode;
    payload?: unknown;
  }[];
  currentGraph?: {
    blocks?: any[];
    connections?: any[];
  };
  answers?: Record<string, string>;
  skipClarification?: boolean;
  confirmed?: boolean;
  confirmedOutline?: FlowOutline;
  focusBlockIds?: string[];
}

export interface FlowAssistantResult {
  mode?: AssistantMode;
  reply: string;
  references?: BlockReference[];
  questions?: ClarifyingQuestion[];
  outline?: FlowOutline;
  graph?: FlowGraph;
  flowChanges?: string[];
  assumptions?: string[];
  operations?: FlowOperation[];
  modelUsed: string;
  provider: string;
}

export function describeOperation(operation: FlowOperation): string {
  switch (operation.op) {
    case 'addBlock':
      return operation.after
        ? `Add ${operation.block.name || operation.block.id} (${operation.block.kind}) after ${operation.after}`
        : `Add ${operation.block.name || operation.block.id} (${operation.block.kind})`;
    case 'updateBlock':
      return `Update ${operation.name || operation.blockId}`;
    case 'removeBlock':
      return `Remove ${operation.blockId}`;
    case 'addConnection':
      return `Connect ${operation.from} → ${operation.to}`;
    case 'removeConnection':
      return `Disconnect ${operation.from} → ${operation.to}`;
    default:
      return 'Change';
  }
}
