import { RuntimeNode } from '../services/variable-resolver.service';

export interface ToolExecutionContext {
  node: RuntimeNode;
  nodeInput: any;
  context: Record<string, any>;
  initialInput: any;
  runId: string;
}

export interface DependsOnCondition {
  field: string;
  in?: Array<string | number | boolean>;
  equals?: string | number | boolean;
  notEquals?: string | number | boolean;
}

export interface NodeOutputDefinition {
  name: string;
  label?: string;
  type: string;
  schema?: any;
  dependsOn?: DependsOnCondition;
  schemaFrom?: string;
}

export interface NodeDefinition {
  id?: string;
  name?: string;
  type?: string;
  inputs?: Array<{ name: string; type?: string; defaultValue?: any }>;
  outputs?: NodeOutputDefinition[];
  actionDefinitions?: any[];
}

export interface OutputSynthesisContext {
  defType: string;
  data: Record<string, any>;
  config: Record<string, any>;
  def?: NodeDefinition;
}

export interface UpstreamVariable {
  nodeId: string;
  nodeName: string;
  outputName: string;
  path: string;
  type: string;
  schema?: unknown;
}

export interface ToolPlugin {
  /**
   * Unique identifier or array of identifiers matching the tool's definitionType.
   */
  readonly toolType: string | string[];

  /**
   * Optional custom matching function for nodes with fallback type matching
   * (e.g. 'function' with name 'jsonparser', or name containing 'increment').
   */
  matches?(type: string, node?: RuntimeNode): boolean;

  /**
   * Main execution entry point.
   */
  run(ctx: ToolExecutionContext): Promise<any>;

  /**
   * Graph validation: valid output handle names for this tool.
   */
  getValidHandles?(config: any, outputs: any[], nodeData?: any, nodeName?: string): Set<string>;

  /**
   * Graph validation: known variable paths this tool produces.
   */
  getProducedPaths?(nodeName: string, config: any, nodeData?: any): Set<string>;

  /**
   * Dynamic output sockets synthesis (e.g. dynamic router routes, orchestrator agents, foreach branches).
   */
  synthesizeOutputs?(ctx: OutputSynthesisContext): NodeOutputDefinition[];

  /**
   * Detects if this node is a waiting / human-gate block requiring user suspension.
   */
  isWaitingGate?(config: any): boolean;

  /**
   * Provides custom upstream variables exposed by this node (e.g. set-variable custom key or state.key).
   */
  getUpstreamVariables?(
    nodeId: string,
    nodeName: string,
    config: any,
    outputs: NodeOutputDefinition[],
    node?: any,
  ): UpstreamVariable[];
}
