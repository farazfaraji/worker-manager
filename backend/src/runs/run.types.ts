export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type NodeRunStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface ExecutionPolicy {
  timeoutMs: number;
  maxAttempts: number;
  backoffMs: number;
}

export interface RunMetrics {
  totalDurationMs?: number;
  nodeCount?: number;
  completedNodeCount?: number;
  failedNodeCount?: number;
  retryCount?: number;
  childRunCount?: number;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  estimatedCost?: number;
}

export interface WaitingDescriptor {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  waitingChildRunId?: string;
  waitingTokenId?: string;
  uiPayload?: any;
  createdAt: string | Date;
  timeoutMs?: number;
}

export interface RunLease {
  leaseOwner?: string;
  leaseExpiresAt?: Date;
  heartbeatAt?: Date;
}

export interface EventPropagationContext {
  sourceEventId?: string;
  sourceEventTopic?: string;
  propagationDepth: number;
  visitedArtifactLogicalIds: string[];
  rootRunId?: string;
  propagationRunId?: string;
}

export interface ResumePayload {
  token?: string;
  resumeToken?: string;
  decision?: any;
  value?: any;
  approved?: boolean;
  formValues?: Record<string, any>;
  feedback?: string;
  draft?: any;
  [key: string]: any;
}

export interface RunCheckpointState {
  checkpointId: string;
  runId: string;
  sequence: number;
  status: RunStatus;
  currentNodeId?: string;
  waitingNodeId?: string;
  waitingChildRunId?: string;
  queue: string[];
  context: Record<string, any>;
  completedNodeIds: string[];
  nodeRecords: any[];
  lastNodeOutput?: any;
  waitingDescriptor?: WaitingDescriptor;
  metrics?: RunMetrics;
  createdAt: Date;
}

export interface RunState {
  runId: string;
  graphId: string;
  graphName: string;
  status: RunStatus;
  checkpointSequence: number;
  currentNodeId?: string;
  waitingNodeId?: string;
  waitingChildRunId?: string;
  waitingDescriptor?: WaitingDescriptor;
  metrics?: RunMetrics;
  completedNodeIds: string[];
  queue: string[];
  context?: Record<string, any>;
  lastNodeOutput?: any;
  error?: any;
  startedAt?: Date;
  finishedAt?: Date;
}
