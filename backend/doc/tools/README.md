# Flow Builder Tools & Node Blocks Documentation

Welcome to the comprehensive documentation index for all node and tool blocks in the **Agentic Flow Builder**. Each block serves as a discrete, composable unit in graph workflows—enabling automated browser navigation, LLM agent reasoning, data transformation, branching logic, state mutation, knowledge retrieval, and multi-agent coordination.

---

## Tool Categories & Documentation Index

| Category | Tool | Description | Documentation Guide |
| :--- | :--- | :--- | :--- |
| **Workspace** | `project` / `board` | Two-tier hierarchy (Project -> Flow), database schemas, endpoints, and flow creation. | [Project & Board Creation Guide](file:///Users/faraz/builder/backend/doc/board/new-board.md) |
| **Canvas** | `board` | Visual React Flow workspace, node wiring, real-time runtime status, and controls. | [Board Guide](file:///Users/faraz/builder/backend/doc/board/board.md) |
| **Flow** | `trigger` | Flow entrypoint supporting manual, domain event listener, webhook, or scheduled triggers. | [Trigger Guide](file:///Users/faraz/builder/backend/doc/tools/trigger.md) |
| **Flow** | `webserver` | Embedded HTTP server that mounts Route blocks on the same board. | [Webserver Guide](file:///Users/faraz/builder/backend/doc/tools/webserver.md) |
| **Flow** | `route` | HTTP endpoint on the board webserver, with sync or async response modes. | [Route Guide](file:///Users/faraz/builder/backend/doc/tools/route.md) |
| **Flow** | `http-response` | Status, headers, and body returned to a synchronous route caller. | [HTTP Response Guide](file:///Users/faraz/builder/backend/doc/tools/http-response.md) |
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
| **Data** | `file` | Sandboxed project file read, write, list, parse, and host-allowlisted download. | [File Guide](file:///Users/faraz/builder/backend/doc/tools/file.md) |
| **Knowledge** | `memory` | Scoped project and conversation memory store with lexical relevance ranking (remember, recall, forget). | [Memory Guide](file:///Users/faraz/builder/backend/doc/tools/memory.md) |
| **Knowledge** | `retrieval` | Semantic vector search and document indexing using cosine similarity and metadata filters. | [Retrieval Guide](file:///Users/faraz/builder/backend/doc/tools/retrieval.md) |
| **Knowledge** | `embedding` | Text-to-vector embeddings generation via OpenAI-compatible endpoints. | [Embedding Guide](file:///Users/faraz/builder/backend/doc/tools/embedding.md) |
| **Execution** | `execution` | Sandboxed child process command execution under strict security allowlists. | [Execution Guide](file:///Users/faraz/builder/backend/doc/tools/execution.md) |
| **Integration** | `action` | External REST API requests, webhooks, and delegated browser operations with host allowlisting. | [Action Guide](file:///Users/faraz/builder/backend/doc/tools/action.md) |
| **Integration** | `secrets` | Encrypted project credentials referenced as `{{secrets.NAME}}`. | [Secrets Guide](file:///Users/faraz/builder/backend/doc/tools/secrets.md) |
| **Integration** | `database` | Read-only by default MongoDB and PostgreSQL queries via a connection secret. | [Database Guide](file:///Users/faraz/builder/backend/doc/tools/database.md) |
| **Integration** | `telegram` | Telegram messages and questions. | [Telegram Guide](file:///Users/faraz/builder/backend/doc/tools/telegram.md) |
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
| **Control** | `log` | Redacted trace entries, context snapshots, assertions, metrics, and timers. | [Log Guide](file:///Users/faraz/builder/backend/doc/tools/log.md) |

---

## Universal Concepts Across All Tools

### 1. Variable Referencing (`{{ ... }}`)
All input fields accepting strings or variables support mustache templating syntax:
- **Upstream Node Outputs**: `{{nodes.browser_1.result.url}}`, `{{agent_1.result.summary}}`
- **Initial Run Input**: `{{input.query}}`, `{{trigger.input.targetUrl}}`
- **Context Variables**: `{{variables.retryCount}}`
- **Project Secrets**: `{{secrets.GITHUB_TOKEN}}` (resolved at run time, then redacted from logs and checkpoints)

### 2. Zod Schema Output Typing
Nodes that produce structured data (`agent`, `script`, `transform`, `json-parser`, `trigger`, `subgraph`) accept a **Zod Output Schema**. This schema is parsed by the frontend to provide typed property autocomplete in downstream node configuration modals.

### 3. Branching & Route Selection
Logic nodes (`condition`, `validator`) provide dedicated colored output handles:
- **`true`** (Green): Followed when the condition or validation passes.
- **`false`** (Red / Orange): Followed when the condition or validation fails.
Nodes connected to the inactive branch are skipped during execution.

### 4. Events and data outputs
- **Events** are branch outputs and control which downstream workflow path runs. Examples include `true`, `false`, `done`, `failed`, `approved`, and `rejected`.
- **Data outputs** are stored in flow state and referenced through variables such as `{{agent_1.text}}`; they are not execution branches.
- The node configuration UI lets users choose which supported events are exposed as empty workflow paths. Events with existing connections always remain visible.
- Decision nodes expose their outcomes by default. Lifecycle events such as `done` and `failed` stay compact until the user exposes them or connects them.
- A handled `failed` event continues the failure path and marks the run `partial`. Without a connected failure path, the run fails normally.

### 5. Security Allowlists & Guardrails
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
- **Non-Retryable Errors**: Validation errors (400), authentication errors (401/403), human-gate nodes, **Artifact mutations** (`create`, `update`, `patch`, `archive`, `addRelation`, `removeRelation`), and **Database writes** (`insert`, `update`, `delete`, `execute`, `transaction`).

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

Node definitions are JSON files in `backend/src/tools/`. Runtime behavior lives in `backend/src/runs/plugins/`. Guides for each tool are in `backend/doc/tools/`.

```
backend/src/tools/          # *.json node definitions loaded by NodeDefinitionsService
backend/src/runs/plugins/   # ToolPlugin classes executed by the graph runner
backend/doc/tools/          # Per-tool guides and this index
```
