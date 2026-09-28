# Flow Builder Tools & Node Blocks Documentation

Welcome to the comprehensive documentation index for all node and tool blocks in the **Agentic Flow Builder**. Each block serves as a discrete, composable unit in graph workflows—enabling automated browser navigation, LLM agent reasoning, data transformation, branching logic, state mutation, knowledge retrieval, and multi-agent coordination.

---

## Tool Categories & Documentation Index

| Category | Tool | Description | Documentation Guide |
| :--- | :--- | :--- | :--- |
| **Workspace** | `project` / `board` | Two-tier hierarchy (Project -> Flow), database schemas, endpoints, and flow creation. | [Project & Board Creation Guide](file:///Users/faraz/builder/backend/doc/board/new-board.md) |
| **Canvas** | `board` | Visual React Flow workspace, node wiring, real-time runtime status, and controls. | [Board Guide](file:///Users/faraz/builder/backend/doc/board/board.md) |
| **Flow** | `trigger` | Flow entrypoint supporting manual, domain event listener, webhook, or scheduled triggers. | [Trigger Guide](file:///Users/faraz/builder/backend/doc/tools/trigger.md) |
| **Flow** | `subgraph` | Embeds a saved graph as a reusable sub-flow with input parameter mapping. | [Subgraph Guide](file:///Users/faraz/builder/backend/doc/tools/subgraph.md) |
| **Agent** | `agent` | LLM reasoning engine with prompt templating, media attachments (vision/audio/doc), and Zod JSON output. | [Agent Guide](file:///Users/faraz/builder/backend/doc/tools/agent.md) |
| **App** | `browser` | Playwright browser automation, element interaction, scraping, standalone HTML extraction, and screenshots. | [Browser Guide](file:///Users/faraz/builder/backend/doc/tools/browser.md) |
| **Execution** | `repo-inspect` | Read-only Codex or Cursor CLI inspection of a project's configured Git repository. | [Repository Inspector Guide](file:///Users/faraz/builder/backend/doc/tools/repo-inspect.md) |
| **Logic** | `condition` | Branching decision node routing along `true` or `false` handles via comparison or JavaScript expression. | [Condition Guide](file:///Users/faraz/builder/backend/doc/tools/condition.md) |
| **Logic** | `validator` | Validates payloads against Zod schemas and routes along `true`/`false` handles or halts on error. | [Validator Guide](file:///Users/faraz/builder/backend/doc/tools/validator.md) |
| **Function** | `script` | Executes custom JavaScript functions with full `async/await` and global context injection. | [Script Guide](file:///Users/faraz/builder/backend/doc/tools/script.md) |
| **Function** | `transform` | Reshapes in-memory data objects via lightweight JavaScript mapping expressions. | [Transform Guide](file:///Users/faraz/builder/backend/doc/tools/transform.md) |
| **Function** | `json-parser` | Parses and validates JSON from local files, remote URLs, or upstream Agent responses. | [JSON Parser Guide](file:///Users/faraz/builder/backend/doc/tools/json-parser.md) |
| **Function** | `set-variable` / `increment` / `decrement` | State persistence, loop counters, and in-place variable mutation across the graph. | [Variable Guide](file:///Users/faraz/builder/backend/doc/tools/variable.md) |
| **Data / Artifact** | `artifact` | Durable document persistence, versioning, diffing, and type-safe domain event emission. | [Artifact Guide](file:///Users/faraz/builder/backend/doc/tools/artifact.md) |
| **Knowledge** | `memory` | Scoped project and conversation memory store with lexical relevance ranking (remember, recall, forget). | [Memory Guide](file:///Users/faraz/builder/backend/doc/tools/memory.md) |
| **Knowledge** | `retrieval` | Semantic vector search and document indexing using cosine similarity and metadata filters. | [Retrieval Guide](file:///Users/faraz/builder/backend/doc/tools/retrieval.md) |
| **Knowledge** | `embedding` | Text-to-vector embeddings generation via OpenAI-compatible endpoints. | [Embedding Guide](file:///Users/faraz/builder/backend/doc/tools/embedding.md) |
| **Execution** | `execution` | Sandboxed child process command execution under strict security allowlists. | [Execution Guide](file:///Users/faraz/builder/backend/doc/tools/execution.md) |
| **Integration** | `action` | External REST API requests, webhooks, and delegated browser operations with host allowlisting. | [Action Guide](file:///Users/faraz/builder/backend/doc/tools/action.md) |
| **Integration** | `web-search` | Query-based web search via Tavily, web content scraping, HTML sanitization, and article reading. | [Web Search Guide](file:///Users/faraz/builder/backend/doc/tools/web-search.md) |
| **Control** | `orchestrator` | Multi-agent delegation coordinating sub-agent panels under parallel or sequential strategies. | [Orchestrator Guide](file:///Users/faraz/builder/backend/doc/tools/orchestrator.md) |
| **Logic** | `research-review` | Validate research findings, question coverage, and evidence on source pages. | [Research Review Guide](file:///Users/faraz/builder/backend/doc/tools/research-review.md) |
| **Control** | `human-gate` | Human-in-the-loop approval, review, and feedback pause/resumption gates. | [Human Gate Guide](file:///Users/faraz/builder/backend/doc/tools/human-gate.md) |
| **Control** | `router` | Declarative value-based routing and multi-way intent switching. | [Router Guide](file:///Users/faraz/builder/backend/doc/tools/router.md) |
| **Control** | `loop` | Bounded collection iteration and multi-round research with child graph recovery. | [Loop Guide](file:///Users/faraz/builder/backend/doc/tools/loop.md) |
| **Control** | `foreach` | Executes an in-canvas branch or child graph per item with sync/async modes and bounded concurrency (1–10). | [Foreach Guide](file:///Users/faraz/builder/backend/doc/tools/foreach.md) |
| **Control** | `output` | Defines the return boundary and payload for an in-canvas loop iteration branch. | [Output Guide](file:///Users/faraz/builder/backend/doc/tools/output.md) |
| **Control** | `aggregate` | Normalizes, filters, and summarizes collection or foreach execution outputs. | [Aggregate Guide](file:///Users/faraz/builder/backend/doc/tools/aggregate.md) |
| **Control** | `notification` | Alerts and webhooks dispatch to Slack, Discord, email, or internal channels. | [Notification Guide](file:///Users/faraz/builder/backend/doc/tools/notification.md) |

---

## Universal Concepts Across All Tools

### 1. Variable Referencing (`{{ ... }}`)
All input fields accepting strings or variables support mustache templating syntax:
- **Upstream Node Outputs**: `{{nodes.browser_1.result.url}}`, `{{agent_1.result.summary}}`
- **Initial Run Input**: `{{input.query}}`, `{{trigger.input.targetUrl}}`
- **Context Variables**: `{{variables.retryCount}}`

### 2. Zod Schema Output Typing
Nodes that produce structured data (`agent`, `script`, `transform`, `json-parser`, `trigger`, `subgraph`) accept a **Zod Output Schema**. This schema is parsed by the frontend to provide typed property autocomplete in downstream node configuration modals.

### 3. Branching & Route Selection
Logic nodes (`condition`, `validator`) provide dedicated colored output handles:
- **`true`** (Green): Followed when the condition or validation passes.
- **`false`** (Red / Orange): Followed when the condition or validation fails.
Nodes connected to the inactive branch are skipped during execution.

### 4. Security Allowlists & Guardrails
Nodes executing side effects outside the in-memory JavaScript sandbox enforce strict security boundaries:
- **Host Allowlisting** (`action`, `notification`): Enforces `allowedHosts` to block SSRF attempts.
- **Command Allowlisting** (`execution`): Enforces `allowedCommands` to block unapproved binaries.
- **Loop Ceilings** (`loop`): Enforces `maxIterations` to prevent infinite loops.

---

## Runtime, State, Events, and Reliability

The execution platform provides robust primitives for mission-critical, long-running, and event-driven workflows:

### 1. Durable Checkpoints (`run_checkpoints`)
- Persisted automatically to the `run_checkpoints` MongoDB collection.
- Checkpoints are created:
  - At flow initialization (`sequence: 1`, `status: "running"`).
  - After every completed node.
  - After every waiting node.
  - After every failed node.
  - Upon run cancellation.
- Checkpoint payload size is strictly bounded to **10 MB** (fails with `CHECKPOINT_TOO_LARGE`).
- Resumption restores queue, context, node records, and waiting descriptors directly from the latest checkpoint.

### 2. Run Leases & Concurrency Protection
- Every executing run acquires an atomic lease on the `Run` document:
  - `leaseOwner`: Process/worker identifier.
  - `leaseExpiresAt`: 60-second lease window.
  - `heartbeatAt`: 15-second background heartbeat extending the lease.
- Expired leases may be safely reclaimed by recovery workers.
- Leases are released immediately upon terminal states (`completed`, `failed`, `cancelled`) or pause (`waiting`).

### 3. Human-Gate & Single-Use Hashed Tokens
- When a flow hits a wait condition (e.g. `human-gate`), an opaque token (`rtk_<uuid>`) is generated.
- Only the **SHA-256 hash** (`resumeTokenHash`) is stored in MongoDB; the raw token is returned to the client and never logged.
- `POST /runs/:runId/resume` verifies the token hash and atomically unsets `resumeTokenHash` via MongoDB `$unset`, guaranteeing single-use execution.
- If a child subgraph pauses on a human gate, the parent records `waitingChildRunId` and pauses. Resuming the parent delegates directly to the child without restarting the child flow from scratch.

### 4. Bounded Retries & Timeout Policy (`ExecutionPolicy`)
- Configurable per-node or runtime default:
  - `timeoutMs`: Default `120000` (2 minutes), max `900000` (15 minutes). Exceeding limits triggers `EXECUTION_TIMEOUT`.
  - `maxAttempts`: Default `1`, max `3`.
  - `backoffMs`: Default `1000`, max `30000` (exponential backoff: `backoffMs * 2^(attempt - 1)`).
- **Retryable Errors**: HTTP 5xx, HTTP 429, socket dropouts, timeouts, and transient provider connection drops.
- **Non-Retryable Errors**: Validation errors (400), authentication errors (401/403), human-gate nodes, and **Artifact mutations** (`create`, `update`, `patch`, `archive`, `addRelation`, `removeRelation`).

### 5. Run Cancellation (`POST /runs/:runId/cancel`)
- Active runs in `queued`, `running`, or `waiting` status can be cancelled via API or UI.
- Halts execution loops, cascades to waiting child runs, closes browser resources, sets `status: "cancelled"`, and preserves all completed node execution records.

### 6. Event Idempotency & Bounded Propagation
- **Event Idempotency**: Runs triggered by events compute an idempotency key `event.id + graph.id`. Repeated deliveries return the existing run rather than spawning duplicate executions.
- **Propagation Guards**:
  - `propagationDepth`: Max `5`.
  - `visitedArtifactLogicalIds`: Max `100`.
  - Cycle detection: Halts safely with `status: "partial"` and error code `EVENT_PROPAGATION_LIMIT_REACHED` if a logical ID is revisited.

### 7. Observability, State Endpoint & Secret Redaction
- **Durable State Inspection**: `GET /runs/:runId/state` returns the latest checkpoint snapshot, active queue, completed node IDs, metrics, and waiting descriptor.
- **Secret Redaction**: API keys, passwords, bearer tokens, cookies, auth headers, and internal lease owners are redacted from logs and public API responses.

---

## Directory Reference

```
backend/src/tools/
├── doc/
│   ├── README.md               # Master documentation index
│   ├── action.md               # External HTTP/REST & browser actions guide
│   ├── agent.md                # LLM agent reasoning & prompting guide
│   ├── aggregate.md            # Results aggregation & filtering guide
│   ├── artifact.md             # Durable documents, diffing & versioning guide
│   ├── browser.md              # Browser & Playwright automation guide
│   ├── condition.md            # Decision branching & comparison guide
│   ├── embedding.md            # Vector embeddings generation guide
│   ├── execution.md            # Sandboxed CLI command runner guide
│   ├── foreach.md              # Child graph iteration per item guide
│   ├── human-gate.md           # Human-in-the-loop review & approval guide
│   ├── json-parser.md          # JSON parsing from path/agent/URL guide
│   ├── loop.md                 # Bounded collection iteration guide
│   ├── memory.md               # Project & conversation memory guide
│   ├── notification.md         # Alerts & webhook dispatch guide
│   ├── orchestrator.md         # Multi-agent delegation & synthesis guide
│   ├── retrieval.md            # Vector search & RAG indexing guide
│   ├── router.md               # Declarative multi-way routing guide
│   ├── script.md               # Custom JavaScript function script guide
│   ├── subgraph.md             # Subgraph & modular sub-flow guide
│   ├── transform.md            # Data mapping & transformation guide
│   ├── trigger.md              # Trigger entrypoint & webhook guide
│   ├── validator.md            # Schema validation & guardrails guide
│   └── variable.md             # State, counters & mutation guide
├── instruction.md              # Tool schema & frontend integration reference
├── action.json                 # Action node definition
├── agent.json                  # Agent node definition
├── aggregate.json              # Aggregate node definition
├── artifact.json               # Artifact node definition
├── brower.json                 # Browser node definition
├── condition.json              # Condition node definition
├── decrement-variable.json     # Decrement variable node definition
├── embedding.json              # Embedding node definition
├── execution.json              # Execution node definition
├── foreach.json                # Foreach node definition
├── human-gate.json             # Human gate node definition
├── increment-variable.json     # Increment variable node definition
├── json-parser.json            # JSON parser node definition
├── loop.json                   # Loop node definition
├── memory.json                 # Memory node definition
├── notification.json           # Notification node definition
├── orchestrator.json           # Orchestrator node definition
├── retrieval.json              # Retrieval node definition
├── router.json                 # Router node definition
├── script.json                 # Script node definition
├── set-variable.json           # Set variable node definition
├── subgraph.json               # Subgraph node definition
├── transform.json              # Transform node definition
├── trigger.json                # Trigger node definition
└── validator.json              # Validator node definition
```
