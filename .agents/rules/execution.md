# Flow Execution & Run System Architecture

When diagnosing, modifying, or extending flow execution, webserver test requests, node outputs, run state, or the Execution Studio dock, use this reference directly without unnecessary file exploratory searches.

---

## 🧭 File Navigation Map

### 1. Frontend Execution Studio & Dock
- **Modal Coordinator / Container**: [`frontend/src/components/modal/RunModal.tsx`](file:///Users/faraz/builder/frontend/src/components/modal/RunModal.tsx)
  - Bottom-docked resizable panel (VS Code / DevTools terminal design). Manages height presets (`280px`, `420px`, `620px`), drag-resize splitter, minimize, maximize, and tab routing.
- **Execution Subcomponents** ([`frontend/src/components/modal/execution/`](file:///Users/faraz/builder/frontend/src/components/modal/execution/)):
  - [`ExecutionEndpointsTab.tsx`](file:///Users/faraz/builder/frontend/src/components/modal/execution/ExecutionEndpointsTab.tsx): Webserver status/start/stop, live endpoint testing (`Send Test GET/POST Request`), query parameter builder, sample payload generator, cURL commands, and immediate run refresh upon response.
  - [`ExecutionTraceTab.tsx`](file:///Users/faraz/builder/frontend/src/components/modal/execution/ExecutionTraceTab.tsx): Execution timeline for all nodes in the run. Displays expandable node inputs, outputs (`nodeRecord.output`), durations, errors, and rerun from step.
  - [`ExecutionInputTab.tsx`](file:///Users/faraz/builder/frontend/src/components/modal/execution/ExecutionInputTab.tsx): Initial JSON flow input payload editor and quick presets.
  - [`ExecutionStudioHeader.tsx`](file:///Users/faraz/builder/frontend/src/components/modal/execution/ExecutionStudioHeader.tsx): Top header bar with status pill, tabs (`Endpoints`, `Input`, `Trace`), run button, height presets, and dock controls.
  - [`ExecutionGateReview.tsx`](file:///Users/faraz/builder/frontend/src/components/modal/execution/ExecutionGateReview.tsx): Human-in-the-loop gate review card and approval submission.
  - [`execution.utils.ts`](file:///Users/faraz/builder/frontend/src/components/modal/execution/execution.utils.ts): Helper functions for URL parsing, sample payload generation, and execution duration calculation.

### 2. Canvas & State Synchronization
- **Central Canvas State**: [`frontend/src/components/FlowStudio.tsx`](file:///Users/faraz/builder/frontend/src/components/FlowStudio.tsx)
  - `activeRunResult`: Current active run displayed in the Execution Studio and reflected on the canvas.
  - `applyRunResult(result: RunResult)`: The single source of truth helper that updates `activeRunResult`, annotates canvas nodes with `runStatus` and `runOutput`, and updates `selectedNode`.
  - **Live Webserver Polling**: Interval querying `fetchRuns(undefined, graphId)`. Updates both for new run IDs and when an in-progress run finishes or increments node execution records.
- **Canvas Node Badges**: [`frontend/src/components/nodes/LangGraphCustomNode.tsx`](file:///Users/faraz/builder/frontend/src/components/nodes/LangGraphCustomNode.tsx)
  - Reads `nodeData.runStatus` (`completed` &rarr; green border & checkmark, `failed` &rarr; red, `waiting` &rarr; yellow clock, `running` &rarr; blue spinner).
- **Node Drawer Output**: [`frontend/src/components/modal/NodeConfigModal.tsx`](file:///Users/faraz/builder/frontend/src/components/modal/NodeConfigModal.tsx)
  - Inspects node parameters and includes the **"Latest Execution Output"** card showing live output of the selected node.

### 3. Backend Execution Engine
- **Graph Runner**: [`backend/src/runs/graph-runner.service.ts`](file:///Users/faraz/builder/backend/src/runs/graph-runner.service.ts)
  - `runGraph(graphId, initialInput, options)`: Core execution loop. Manages queue, leases, checkpoints, and retries.
- **Subgraph & Foreach Runner**: [`backend/src/runs/services/subgraph-runner.service.ts`](file:///Users/faraz/builder/backend/src/runs/services/subgraph-runner.service.ts)
  - `executeSubgraphNode`: Runs child graph via `runGraph` delegate. Returns `{ result: childRun.output, childRunId, ...childRun.output }`.
  - `executeForeachNode`: Parallel batch iteration over item arrays.
- **Node Executor**: [`backend/src/runs/services/node-executor.service.ts`](file:///Users/faraz/builder/backend/src/runs/services/node-executor.service.ts)
  - Dispatches individual block executions: `route`, `condition`, `http-response`, `agent`, `artifact`, `embedding`, `vector-store`, variable mutations, and `browser`.
- **Variable & Output Resolver**: [`backend/src/runs/services/variable-resolver.service.ts`](file:///Users/faraz/builder/backend/src/runs/services/variable-resolver.service.ts)
  - Resolves `{{node.field}}` template strings and `{ mode: 'variable', value: '...' }` object references.
  - Supports fallback chains (`||`), e.g. `{{query.limit || 5}}` (handles strings, numeric literals, booleans, and null).
  - Normalizes node outputs according to block output schemas.
- **Graph Topology**: [`backend/src/runs/services/run-topology.service.ts`](file:///Users/faraz/builder/backend/src/runs/services/run-topology.service.ts)
  - Calculates graph adjacency, resolves start nodes (batch triggers vs. route nodes), and resolves branching edges (`condition` true/false, `router` handles).
- **Webserver Listener**: [`backend/src/webserver/webserver.service.ts`](file:///Users/faraz/builder/backend/src/webserver/webserver.service.ts) & [`webserver.controller.ts`](file:///Users/faraz/builder/backend/src/webserver/webserver.controller.ts)
  - Endpoints: `POST /api/webservers/:graphId/start`, `POST /api/webservers/:graphId/stop`, `GET /api/webservers/:graphId/status`.
  - Listens on configured port (e.g., 3210), routes incoming HTTP requests to corresponding Route blocks, and responds synchronously or asynchronously.
- **Runs API**: [`backend/src/runs/runs.controller.ts`](file:///Users/faraz/builder/backend/src/runs/runs.controller.ts) & [`backend/src/runs/services/run-storage.service.ts`](file:///Users/faraz/builder/backend/src/runs/services/run-storage.service.ts)
  - `GET /api/runs?graphId=...`: Lists runs sorted by `createdAt: -1`.
  - `GET /api/runs/:runId`: Full run document with all executed node records.

---

## ⚡ Key Rules & Conventions

1. **Immediate State Refresh on HTTP Route Tests**:
   - Whenever `handleSendTestRequest` in `ExecutionEndpointsTab` completes, it must immediately fetch `fetchRuns(undefined, graphId)` and pass `runs[0]` to `onRunResult(latest)`. Do not rely solely on interval polling.
2. **Synchronizing Canvas with Runs**:
   - Always call `applyRunResult` in `FlowStudio.tsx` to update `activeRunResult`, canvas node decorations (`runStatus`, `runOutput`), and `selectedNode`.
3. **Subgraph Output Referencing**:
   - Subgraphs expose outputs wrapped in `{ result: childOutput, childRunId, ...childOutput }`.
   - Downstream blocks can safely access child output either via `{{subgraphNode.result.property}}` or `{{subgraphNode.property}}`.
4. **Fallback Chains (`||`) in Variables**:
   - Fallback literals in variable resolver must handle numbers, booleans, and null without converting them to empty strings or invalid reference lookups.
5. **Webserver Routes vs. Batch Entry Roots**:
   - When a graph contains a `webserver`, `route` nodes are only triggered via incoming HTTP requests or explicit `startNodeId: routeNode.id`. They must not run as automatic batch roots.
6. **Event-Driven Output Architecture vs. State Variable System**:
   - **Canvas Sockets / Handles represent Flow Events & Branches ONLY**:
     - Connection sockets on the canvas represent control flow sequencing and branch transitions:
       - **Lifecycle events**: `onLoad`, `done`, `onFailed`.
       - **Decision / Logic branches**: `approved` / `rejected` (`human-gate`), `true` / `false` (`condition`, `validator`), review states (`pass`, `needs_more_research`, `revise_findings`, `incomplete_needs_human_review` in `research-review`), dynamic routes (`router`), item iterations (`foreach` `item` & `done`).
       - **Orchestrator fanout**: `agent_1`, `agent_2`, ..., and `done` (invoked strictly after all sub-jobs complete).
   - **Data Payloads represent State Variables ONLY**:
     - Never expose data fields (e.g. `content`, `artifactId`, `status`, `screenshot`, `text`, `html`, `feedback`, `count`) as canvas wire sockets. Redundant data sockets bloat node card heights and clutter edge routing.
     - Data produced by any block is stored in graph execution context (`context[nodeName]`) and referenced downstream via mustache variables (`{{nodeName.field}}`) or `{ mode: 'variable', value: 'nodeName.field' }`.
   - **Dual System Coordination**:
     - **Backend Validation** ([`graphs.service.ts`](file:///Users/faraz/builder/backend/src/graphs/graphs.service.ts)):
       - `validHandles`: Enforces valid event/branch handles (`onload`, `onfailed`, `done`, `flow`, `approved`, `rejected`, `pass`, etc.) while retaining backwards-compatibility aliases for legacy flows.
       - `nodeProducedPathsMap`: Registers well-known payload variables for action nodes (`artifact.content`, `browser.screenshot`, `human_gate.feedback`, `retrieval.results`, etc.) so template variable validation succeeds without physical sockets.
     - **Frontend Autocomplete** ([`variable-utils.ts`](file:///Users/faraz/builder/frontend/src/lib/variable-utils.ts)):
       - Filters out `type: 'branch'` handles from variable autocomplete to prevent control-flow tokens (`onLoad`, `done`) from appearing in data templates.
       - Automatically registers rich payload variables for action blocks in `VariablePicker` and autocomplete menus.
        - **Handle Spatial Placement**:
          - **Bottom Outputs**: The two primary / status handles (`onLoad` / `done` [success] and `onFailed` / `error` / `rejected` [failure]) are positioned at the bottom of the card (`Position.Bottom`) side-by-side.
          - **Side Outputs**: All other branch / dispatch outputs (e.g. `agent_1`, `agent_2`, `agent_3`, `agent_4` in `orchestrator`) are separated along the sides, alternating between Left (`Position.Left`) and Right (`Position.Right`).
