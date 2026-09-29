import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';

/**
 * Shared state schema for LangGraph Flow Execution.
 */
export const FlowGraphState = Annotation.Root({
  /**
   * All flow execution context, including node outputs keyed by node ID and node name,
   * as well as mutable state variables.
   */
  context: Annotation<Record<string, any>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),

  /**
   * The output of the most recently executed node.
   */
  lastOutput: Annotation<any>({
    reducer: (_current, update) => update,
    default: () => null,
  }),

  /**
   * Current execution run ID.
   */
  runId: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => '',
  }),

  /**
   * The initial input payload supplied to start the graph run.
   */
  initialInput: Annotation<any>({
    reducer: (_current, update) => update,
    default: () => null,
  }),

  /**
   * Message history for ReAct agent nodes.
   */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  /**
   * History of node execution records.
   */
  nodeRecords: Annotation<any[]>({
    reducer: (current, update) => {
      if (!Array.isArray(update) || update.length === 0) return current;
      const map = new Map<string, any>(current.map((r) => [r.nodeId, r]));
      for (const rec of update) {
        map.set(rec.nodeId, rec);
      }
      return Array.from(map.values());
    },
    default: () => [],
  }),
});

export type FlowGraphStateType = typeof FlowGraphState.State;
export type FlowGraphStateUpdate = typeof FlowGraphState.Update;
