import { IsString, IsOptional, IsArray, IsObject, IsBoolean } from 'class-validator';

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
  name: string;
  label: string;
  config: Record<string, any>;
}

export interface FlowConnection {
  id: string;
  from: string;
  to: string;
  output: string;
  input: string;
  data?: Record<string, any>;
}

export interface FlowGraph {
  blocks: FlowBlock[];
  connections: FlowConnection[];
}

export type FlowOperation =
  | {
      op: 'addBlock';
      block: FlowBlock;
      after?: string;
    }
  | {
      op: 'updateBlock';
      blockId: string;
      name?: string;
      configPatch?: Record<string, any>;
    }
  | { op: 'removeBlock'; blockId: string }
  | {
      op: 'addConnection';
      from: string;
      to: string;
      output?: string;
      input?: string;
    }
  | {
      op: 'removeConnection';
      from: string;
      to: string;
      output?: string;
    };

export interface FlowHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  mode?: AssistantMode;
  payload?: any;
}

export class FlowAssistantChatDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsArray()
  history?: FlowHistoryMessage[];

  @IsOptional()
  @IsObject()
  currentGraph?: {
    blocks?: any[];
    connections?: any[];
  };

  /** questionId -> answer, sent from the question card */
  @IsOptional()
  @IsObject()
  answers?: Record<string, string>;

  /** "Skip, use defaults" on a question card */
  @IsOptional()
  @IsBoolean()
  skipClarification?: boolean;

  /** "Build it" on an outline card */
  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;

  @IsOptional()
  @IsObject()
  confirmedOutline?: FlowOutline;

  /** Blocks currently selected on the canvas */
  @IsOptional()
  @IsArray()
  focusBlockIds?: string[];
}

export interface FlowAssistantResponse {
  mode: AssistantMode;
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
