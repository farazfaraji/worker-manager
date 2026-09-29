import { RuntimeNode } from '../services/variable-resolver.service';

export interface ToolExecutionContext {
  node: RuntimeNode;
  nodeInput: any;
  context: Record<string, any>;
  initialInput: any;
  runId: string;
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
}
