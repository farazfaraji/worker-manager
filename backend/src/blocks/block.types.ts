export type BlockStatus = 'completed' | 'waiting' | 'failed';

export interface BlockInput {
  input?: any;
  context?: Record<string, any>;
  config?: Record<string, any>;
  artifacts?: string[];
  policy?: Record<string, any>;
  runId?: string;
}

export interface BlockOutput {
  result?: any;
  artifacts?: any;
  events?: any[];
  status: BlockStatus;
  error?: any;
  trace?: any;
  [key: string]: any;
}

export interface ForEachConfig {
  items: any[] | { items: any[] };
  graphId: string;
  baseInput?: Record<string, any>;
  maxIterations?: number;
  concurrency?: number;
  stopOnError?: boolean;
  outputMode?: 'result' | 'state';
  outputType?: string;
}

export interface ForEachItemResult {
  index: number;
  item: any;
  status: 'completed' | 'failed';
  result?: any;
  childRunId?: string;
  error?: any;
}

export interface ForEachResult {
  status: 'completed' | 'partial' | 'failed';
  count: number;
  processed: number;
  truncated: boolean;
  items: ForEachItemResult[];
  errors: Array<{
    index: number;
    childRunId?: string;
    error: any;
  }>;
}

export interface AggregateResult {
  items: any[];
  errors: any[];
  count: number;
  successCount: number;
  failureCount: number;
  allSucceeded: boolean;
  truncated: boolean;
  status?: string;
  error?: any;
}

