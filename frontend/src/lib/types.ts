export interface FlowViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface FlowNode<T = FlowNodeData> {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: T;
  selected?: boolean;
  width?: number;
  height?: number;
  hidden?: boolean;
  dragging?: boolean;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  animated?: boolean;
  selected?: boolean;
  data?: Record<string, any>;
  style?: Record<string, any>;
}

export interface ModelCapabilities {
  supportsVision: boolean;
  supportsAudio: boolean;
  supportsDocuments: boolean;
  supportsJson: boolean;
}

export interface LLMModel {
  _id?: string;
  id?: string;
  label: string;
  modelId: string;
  provider: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'lmstudio' | 'custom' | string;
  endpoint: string;
  apiKey?: string;
  capabilities: ModelCapabilities;
  defaultTemperature: number;
  isDefault: boolean;
  reasoningEffort?: 'default' | 'none' | 'low' | 'medium' | 'high' | string;
  reasoningFormat?: 'hidden' | 'parsed' | 'raw' | string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ToolInputOption {
  label: string;
  value: any;
}

export interface ToolInput {
  name: string;
  label: string;
  type:
    | 'text'
    | 'textarea'
    | 'select'
    | 'combobox'
    | 'slug'
    | 'radio'
    | 'checkbox'
    | 'boolean'
    | 'number'
    | 'json'
    | 'code'
    | 'functionCode'
    | 'variable'
    | 'valueOrVariable'
    | 'object'
    | string;
  required?: boolean;
  defaultValue?: any;
  placeholder?: string;
  prefix?: string;
  options?: ToolInputOption[];
  language?: string;
  helpText?: string;
  accepts?: string[];
  multiline?: boolean;
  multiselect?: boolean;
  rows?: number;
  supportsUuid?: boolean;
  canRevise?: boolean;
  supportsAiGenerator?: boolean;
  prefixField?: string;
  dependsOn?: {
    field: string;
    equals?: any;
    notEquals?: any;
    in?: any[];
  };
  dataSource?: {
    type: string;
    url: string;
    labelKey: string;
    valueKey: string;
  };
}

export interface ToolOutput {
  name: string;
  label?: string;
  type: string;
  schemaFrom?: string;
  schema?: unknown;
  dependsOn?: {
    field: string;
    equals?: any;
    notEquals?: any;
    in?: any[];
  };
}

export interface ToolActionDefinition {
  type: string;
  name: string;
  description?: string;
  inputs: ToolInput[];
  outputs: ToolOutput[];
}

export interface NodeDefinition {
  id: string;
  name: string;
  type: string;
  description: string;
  category: 'Flow' | 'Agent' | 'Function' | 'App' | 'Logic' | string;
  inputs: ToolInput[];
  outputs: ToolOutput[];
  actionDefinitions?: ToolActionDefinition[];
}

export interface FlowNodeData {
  name?: string;
  definitionType: string;
  definitionName?: string;
  label?: string;
  nodeName?: string;
  config: Record<string, any>;
  inputs?: ToolInput[];
  outputs: ToolOutput[];
  definitionOutputs?: ToolOutput[];
  actionDefinitions?: ToolActionDefinition[];
  runStatus?: 'idle' | 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'skipped' | 'cancelled' | 'listening';
  runOutput?: any;
  runError?: string;
  runErrorDetails?: {
    message?: string;
    stack?: string;
    nodeId?: string;
    nodeName?: string;
    input?: any;
  };
  [key: string]: any;
}

export interface Project {
  _id: string;
  name: string;
  description?: string;
  color?: string;
  metadata?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
  graphCount?: number;
  runCount?: number;
}

export interface GraphSummary {
  id: string;
  name: string;
  projectId: string;
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

export interface GraphLayoutData {
  version: number;
  viewport: FlowViewport;
  nodes: Record<string, {
    x: number;
    y: number;
    width?: number;
    height?: number;
    hidden?: boolean;
  }>;
  edges: Record<string, Record<string, any>>;
}

export interface GraphFlowData {
  version: number;
  blocks: Array<{
    id: string;
    kind: string;
    name: string;
    label: string;
    definitionId?: string;
    definitionName?: string;
    config: Record<string, any>;
    events?: ToolOutput[];
  }>;
  connections: Array<{
    id: string;
    from: string;
    to: string;
    output?: string;
    input?: string;
    data?: Record<string, any>;
  }>;
}

export interface GraphData {
  _id?: string;
  name: string;
  projectId: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  flow?: GraphFlowData;
  layout?: GraphLayoutData;
  viewport?: FlowViewport;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, any>;
}

export interface VariableItem {
  name: string;
  label: string;
  path: string;
  sourceNodeId: string;
  sourceNodeName: string;
  sourceNodeType: string;
  type: string;
}

export interface RunNodeRecord {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'skipped' | 'cancelled' | 'listening';
  input?: any;
  output?: any;
  error?: {
    message: string;
    stack?: string;
    nodeId?: string;
    nodeName?: string;
    input?: any;
    code?: string;
  };
  attempt?: number;
  durationMs?: number;
  errorCode?: string;
  retryable?: boolean;
  childRunId?: string;
  checkpointSequence?: number;
  waitingTokenId?: string;
  startedAt?: string;
  finishedAt?: string;
  cached?: boolean;
}

export interface RunResult {
  runId: string;
  projectId?: string;
  graphId: string;
  graphName: string;
  parentRunId?: string;
  rootRunId?: string;
  rerunFromNodeId?: string;
  status: 'queued' | 'running' | 'waiting' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'listening';
  currentNodeId?: string;
  waitingNodeId?: string;
  waitingChildRunId?: string;
  waitingDescriptor?: any;
  resumeToken?: string;
  checkpointSequence?: number;
  debugMode?: boolean;
  useCache?: boolean;
  input?: any;
  output?: any;
  nodes?: RunNodeRecord[];
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
  metrics?: {
    totalDurationMs?: number;
    nodeCount?: number;
    completedNodeCount?: number;
    failedNodeCount?: number;
    retryCount?: number;
    childRunCount?: number;
    estimatedCost?: number;
  };
  dataSizeBytes?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ArtifactItem {
  _id?: string;
  artifactId: string;
  logicalId?: string;
  rootArtifactId?: string;
  isLatest?: boolean;
  contentHash?: string;
  schemaVersion?: number;
  changed?: boolean;
  projectId?: string;
  type: string;
  category?: string;
  tags?: string[];
  format?: 'markdown' | 'text' | 'json' | 'code' | string;
  language?: string;
  title: string;
  content: any;
  status: 'draft' | 'in-review' | 'approved' | 'rejected' | 'archived' | string;
  version: number;
  parentArtifactId?: string;
  author?: string;
  changeSummary?: string;
  sourceEventIds?: string[];
  metadata?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
  label?: string;
  value?: string;
}

export interface ArtifactRelationItem {
  _id?: string;
  relationId: string;
  projectId?: string;
  sourceLogicalId: string;
  targetLogicalId: string;
  type: string;
  inverseType: string;
  status: string;
  metadata?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

export interface NodeCacheItem {
  _id?: string;
  graphId: string;
  graphName?: string;
  projectId?: string;
  nodeId: string;
  nodeName?: string;
  nodeType?: string;
  result: any;
  input?: any;
  updatedAt: string;
  createdAt?: string;
}
