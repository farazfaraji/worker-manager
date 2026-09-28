---
name: flow-board-composer
description: Use when designing, selecting tools for, composing, or generating Flow Board graphs (workflows) in the LangGraph Flow Builder. Guides tool selection across 20+ specialized blocks, node wiring, variable referencing, and graph JSON generation.
---

# Flow Board Composer & Tool Selection Skill

This skill guides AI agents in selecting the right tools and generating complete, valid, and fully-wired **Flow Board graphs** for the LangGraph Flow Builder.

All tools in the builder have dedicated reference documentation located in [`backend/doc/tools/`](backend/doc/tools/).

---

## 1. Tool Selection Decision Matrix

Match user intents and task requirements to the appropriate node blocks:

| Intent / Requirement | Primary Tools | Secondary / Supporting | Reference Documentation |
| :--- | :--- | :--- | :--- |
| **Workflow Entrypoint** | `trigger` | `subgraph` | [trigger.md](backend/doc/tools/trigger.md) |
| **LLM Reasoning & Extraction** | `agent` | `json-parser`, `validator` | [agent.md](backend/doc/tools/agent.md) |
| **Web Search & Discovery** | `web-search` | `browser`, `agent` | [web-search.md](backend/doc/tools/web-search.md) |
| **Web Scraping & Browser Automation** | `browser` | `web-search`, `script` | [browser.md](backend/doc/tools/browser.md) |
| **Boolean Branching & Checks** | `condition`, `validator`, `research-review` | `router` | [condition.md](backend/doc/tools/condition.md), [validator.md](backend/doc/tools/validator.md) |
| **Multi-Path Intent Routing** | `router` | `condition` | [router.md](backend/doc/tools/router.md) |
| **Custom Code & Math / Logic** | `script`, `transform` | `variable` | [script.md](backend/doc/tools/script.md), [transform.md](backend/doc/tools/transform.md) |
| **Durable Document Storage & Diffs** | `artifact` | `trigger` (Event mode) | [artifact.md](backend/doc/tools/artifact.md) |
| **Human Review / Approval Gate** | `human-gate` | `artifact`, `notification` | [human-gate.md](backend/doc/tools/human-gate.md) |
| **Reusable Sub-Workflows** | `subgraph` | `trigger`, `foreach` | [subgraph.md](backend/doc/tools/subgraph.md) |
| **Vector Search & RAG Knowledge** | `retrieval`, `embedding` | `memory` | [retrieval.md](backend/doc/tools/retrieval.md), [embedding.md](backend/doc/tools/embedding.md) |
| **Conversation Memory (Key-Value)** | `memory` | `variable` | [memory.md](backend/doc/tools/memory.md) |
| **Multi-Agent Coordination** | `orchestrator` | `agent` | [orchestrator.md](backend/doc/tools/orchestrator.md) |
| **External REST APIs & Webhooks** | `action` | `notification` | [action.md](backend/doc/tools/action.md) |
| **Terminal / CLI Command Execution**| `execution` | `script` | [execution.md](backend/doc/tools/execution.md) |
| **Read-only Existing Repository Inspection** | `repo-inspect` | `artifact`, `subgraph` | [repo-inspect.md](backend/doc/tools/repo-inspect.md) |
| **Slack / Email / Webhook Alerts** | `notification` | `action` | [notification.md](backend/doc/tools/notification.md) |
| **Collection Loops & Batching** | `loop` | `variable` | [loop.md](backend/doc/tools/loop.md) |
| **Child Graph Iteration (Fan-Out)** | `foreach` | `subgraph`, `aggregate` | [foreach.md](backend/doc/tools/foreach.md) |
| **HTTP Webserver & REST Endpoints** | `webserver`, `route` | `http-response` | [webserver.md](backend/doc/tools/webserver.md) |
| **Canvas Architecture & Layout** | `board` | — | [board.md](backend/doc/tools/board.md) |
| **Workspace & Project Scoping** | `project` / `board` | `trigger`, `artifact` | [board/new-board.md](backend/doc/board/new-board.md) |

---

## 2. Tool Reference & Configuration Cheatsheet

### 1. `trigger` ([trigger.md](backend/doc/tools/trigger.md))
- **Role**: Every standard batch flow begins with a trigger node (manual, event, webhook, schedule). For HTTP webserver services, use `webserver` and `route` instead.
- **Trigger Modes (`triggerType`)**:
  - `manual`: User clicks "Run Flow" in UI or submits JSON modal.
  - `event`: Reactive trigger listening to domain events via Event Engine (e.g. `eventTopic: "artifact.update"`, `artifact.*`).
  - `webhook`: Triggered via external POST request.
  - `schedule`: Recurring cron or timer.
- **Event Idempotency & Propagation Safety**:
  - Automatically dedupes events using composite key `event.id + graph.id`.
  - Propagates event context (`sourceEventId`, `sourceEventTopic`, `propagationDepth`, `visitedArtifactLogicalIds`, `rootRunId`).
  - Enforces depth ceiling of **5**, visited entities ceiling of **100**, and halts cycles with `EVENT_PROPAGATION_LIMIT_REACHED`.
- **Outputs**:
  - `input` (for manual/webhook/schedule)
  - `event`, `data`, `entityId`, `topic` (for `event` trigger mode)

### 2. `agent` ([agent.md](backend/doc/tools/agent.md))
- **Role**: Core LLM engine.
- **Key Configs**: `model` (e.g. `gpt-4o-mini`, `gpt-4o`, `claude-3-5-sonnet-20241022`), `systemPrompt`, `userPrompt`, `outputFormat` (`"text"` or `"json"`), `outputType` (Zod schema for structured output).
- **Outputs**: `result` (object if JSON format), `text` (raw markdown/string), `reasoning`.

### 3. `artifact` ([artifact.md](backend/doc/tools/artifact.md))
- **Role**: Durable document persistence in MongoDB, versioning, cross-document relations, diffing, and domain event emission.
- **Operations (`operation`)**: `create`, `get`, `list`, `update`, `addRelation`, `diff`, `approve`, `archive`.
- **Key Configs**: `title`, `content` (`valueOrVariable`), `linkedArtifactIds` (`valueOrVariable`, multiselect chips or variable array), `format` (`markdown`, `json`, `code`, `text`), `type` (`document`, `tech-spec`, `task`, `decision`).
- **Events Emitted**: Automatically emits `artifact.create`, `artifact.update`, `artifact.delete`, `artifact.approve`.
- **Canvas Outputs**: `onLoad` (triggers downstream flow upon successful operation), `onFailed` (error / failure branch).
- **Variable Access**: Access document data downstream via state variables: `{{nodeName.content}}`, `{{nodeName.artifactId}}`, `{{nodeName.status}}`, `{{nodeName.version}}`, `{{nodeName.artifact}}`.
- **Retry Rule**: Artifact mutation operations are never automatically retried to prevent phantom duplicated documents or split-brain state.

### 4. `web-search` ([web-search.md](backend/doc/tools/web-search.md))
- **Role**: Searches web via Tavily, scrapes website content, sanitizes HTML, resolves links, and reads articles.
- **Operations (`mode`)**: `search`, `fetch_and_clean`, `extract_links`, `read_article`.
- **Canvas Outputs**: `done` (triggers downstream flow on success), `onFailed` (failure / error branch).
- **Variable Access**: Access search and scraping results downstream via variables: `{{nodeName.results}}`, `{{nodeName.answer}}`, `{{nodeName.query}}`, `{{nodeName.text}}`, `{{nodeName.url}}`, `{{nodeName.title}}`, `{{nodeName.html}}`.

### 5. `browser` ([browser.md](backend/doc/tools/browser.md))
- **Role**: Playwright headless browser control.
- **Operations**: `navigate`, `click`, `fill`, `screenshot`, `scrape`, `evaluate`, `wait`.
- **Canvas Outputs**: `done` (proceed on success), `onFailed` (browser execution failure).
- **Variable Access**: `{{nodeName.screenshot}}`, `{{nodeName.text}}`, `{{nodeName.url}}`, `{{nodeName.title}}`, `{{nodeName.html}}`.

### 5. `condition` ([condition.md](backend/doc/tools/condition.md)) & `validator` ([validator.md](backend/doc/tools/validator.md))
- **Role**: Logic branching.
- **Condition**: Compares two values (`left`, `operator`, `right`) or executes custom JS expression.
- **Validator**: Tests data payload against a Zod schema.
- **Handles**: Has two discrete output sockets: `"true"` (green) and `"false"` (red).

### 6. `human-gate` ([human-gate.md](backend/doc/tools/human-gate.md))
- **Role**: Pauses execution until a human reviews, edits, and approves.
- **Key Configs**: `question`, `inputType`, `draft`, `allowDraftEdit`, and optional form fields.
- **Security & Resume Tokens**:
  - Generates opaque single-use token `rtk_<uuid>`.
  - Persists cryptographic SHA-256 hash `resumeTokenHash` in MongoDB (raw token is never logged or stored).
  - Single-use invalidation prevents replay attacks.
- **Canvas Outputs**: `approved` (branch when reviewer approves), `rejected` (branch when reviewer rejects).
- **Variable Access**: `{{nodeName.feedback}}`, `{{nodeName.draft}}`, `{{nodeName.value}}`, `{{nodeName.status}}`.

### 7. `subgraph` ([subgraph.md](backend/doc/tools/subgraph.md))
- **Role**: Executes a modular child flow with parameter mapping.
- **Key Configs**: `graphId`, `input` (JSON payload or variable reference), `outputMode` (`"result"` or `"state"`).
- **Parent/Child Recovery**:
  - Subgraphs that encounter a `human-gate` pause the parent flow cleanly with `waitingChildRunId`.
  - Resuming the parent delegates directly to the child run without restarting child execution from scratch.
  - Bounded nesting depth of **10** (`MAX_SUBGRAPH_DEPTH_EXCEEDED`).

### 8. `retrieval` ([retrieval.md](backend/doc/tools/retrieval.md)) & `embedding` ([embedding.md](backend/doc/tools/embedding.md))
- **Role**: Vector database indexing and semantic cosine similarity search.
- **Canvas Outputs**: `done`, `onFailed`.
- **Variable Access**: `{{nodeName.results}}`, `{{nodeName.context}}`, `{{nodeName.count}}`, `{{nodeName.embeddings}}`.

### 9. `action` ([action.md](backend/doc/tools/action.md)) & `notification` ([notification.md](backend/doc/tools/notification.md))
- **Role**: External integrations.
- **Action**: HTTP REST requests (`method`, `url`, `headers`, `body`, `allowedHosts`).
- **Notification**: Alerts to Slack, Discord, Email, or Webhook.

### 10. `foreach` ([foreach.md](backend/doc/tools/foreach.md))
- **Role**: Executes a saved child graph once for each item in an input collection with bounded concurrency.
- **Key Configs**:
  - `items` (`valueOrVariable`, required): Array of items or object with `items` array.
  - `graphId` (`select`, required in subgraph mode): ID of the saved child flow (`/api/graphs`).
  - `baseInput` (`valueOrVariable`, optional): Base object payload merged into each child run.
  - `concurrency` (`number`, 1–10, default: 1): Bounded parallel child execution; keep at 1 if child flow can pause for input.
  - `maxIterations` (`number`, 1–100, default: 25): Hard cap on items processed.
  - `stopOnError` (`checkbox`, default: false): Halts starting new child runs on failure.
  - `outputMode` (`select`): `"result"` or `"state"`.
- **Child Graph Contract**: Each child Trigger receives `{ ...baseInput, item: currentItem, index: 0, total: N }` (reserved `item`, `index`, `total` override `baseInput`). Preserves `parentRunId`.
- **Outputs**: `result` containing `{ status, count, processed, truncated, items: [...], errors: [...] }`.

### 11. `aggregate` ([aggregate.md](backend/doc/tools/aggregate.md))
- **Role**: In-memory normalization, filtering, and summary metrics for `foreach` outputs or raw arrays.
- **Key Configs**:
  - `items` (`valueOrVariable`, required): Array of items or `foreach` result object.
  - `includeSuccessful` (`checkbox`, default: true): Retain successful items.
  - `includeFailed` (`checkbox`, default: true): Retain failed items.
- **Outputs**: `result` containing `{ items: [...], errors: [...], count, successCount, failureCount, allSucceeded, truncated }`.

### 12. `webserver` ([webserver.md](backend/doc/tools/webserver.md))
- **Role**: Embedded HTTP server listening on a specified port and host, managing live routes.
- **Key Configs**: `port` (e.g. `"3210"`), `host` (`"0.0.0.0"`), `cors` (`"enabled"`).
- **Wiring**: Connects to connected `route` nodes using `output: "routes"`.
- **Outputs**: `routes` (array of active route objects).

### 13. `route` ([route.md](backend/doc/tools/route.md))
- **Role**: Represents an HTTP endpoint attached to a webserver. Initiates a synchronous request-handling execution chain.
- **Key Configs**: `endpoint` (e.g. `"/api/plans"`), `method` (`"POST"`, `"GET"`, `"PUT"`, `"DELETE"`, etc.), `responseMode` (`"sync"`), `type` (Zod body schema for POST/PUT), `querySchema` (Zod query schema for GET).
- **Outputs**: `body` (parsed request body object), `query` (query parameters), `params` (URL path parameters), `headers` (request headers).

### 14. `http-response` ([http-response.md](backend/doc/tools/http-response.md))
- **Role**: Concludes a route pipeline and sends the HTTP response back to the client.
- **Key Configs**: `statusCode` (e.g. `"200"`, `"201"`), `responseBody` (literal or `{ "mode": "variable", "value": "nodeName.result" }`), `headers` (JSON string).
- **Outputs**: None (terminal sink node).

---

## 3. Variable Referencing Rules

Any input accepting string or mustache templating can read from upstream nodes using:

```handlebars
{{<node_name>.<output_property>}}
```

### Reference Conventions
- **From Trigger**:
  - Manual payload: `{{trigger.input.query}}` or `{{input.query}}`
  - Event payload: `{{trigger.entityId}}`, `{{trigger.data.current.content}}`, `{{trigger.data.fileChanges.diff}}`
- **From Route**:
  - Body field: `{{post_plans.body.title}}`, `{{post_plans.body.content}}`
  - Query param: `{{get_plans.query.q}}`, `{{get_plans.query.limit}}`
- **From Agent**:
  - Text output: `{{agent_1.text}}`
  - Structured JSON: `{{agent_1.result.summary}}`, `{{agent_1.result.findings}}`
- **From Artifact**:
  - `{{artifact_1.artifactId}}`
  - `{{artifact_1.content}}`
  - `{{artifact_1.version}}`
- **From Embedding**:
  - `{{embed_1.artifactId}}`, `{{embed_1.result}}`
- **From Retrieval**:
  - `{{retrieval_1.context}}`, `{{retrieval_1.results}}`, `{{retrieval_1.result}}`
- **From Script / Transform**:
  - `{{script_1.result.field}}`
- **From Browser**:
  - `{{browser_1.url}}`
  - `{{browser_1.screenshot}}`
  - `{{browser_1.content}}`
- **From Human Gate**:
  - `{{human_gate_1.value}}`
  - `{{human_gate_1.result.feedback}}`
- **From Subgraph**:
  - `{{subgraph_1.result.summary}}`
- **From Foreach**:
  - `{{foreach_1.result.items}}`
  - `{{foreach_1.result.status}}`
  - `{{foreach_1.result.count}}`
  - `{{foreach_1.result.errors}}`
- **From Aggregate**:
  - `{{aggregate_1.result.items}}`
  - `{{aggregate_1.result.allSucceeded}}`
  - `{{aggregate_1.result.successCount}}`
  - `{{aggregate_1.result.failureCount}}`

---

## 4. Execution Policies & Reliability Controls

Nodes can configure custom execution policies to control retry loops, backoff delays, and timeouts:

```json
{
  "config": {
    "timeoutMs": 60000,
    "maxAttempts": 3,
    "backoffMs": 1000
  }
}
```

- **Timeouts**: Clamped between 10ms and 900,000ms (15 minutes). Exceeding timeout halts with `EXECUTION_TIMEOUT`.
- **Bounded Retries**: Maximum of 3 attempts with exponential backoff (`backoffMs * 2^(attempt - 1)`).
- **Auto-Exclusion**: Human-gate nodes and Artifact mutation operations (`create`, `update`, `patch`, `archive`, `addRelation`) are never retried.
- **Durable Checkpoints**: State is persisted to `run_checkpoints` collection after each node transition (up to 10 MB limit).
- **Concurrency Protection**: Active runs hold a 60s lease with 15s heartbeats, preventing dual-worker execution conflicts.

---

## 5. Graph Composition & Connection Rules

When generating graph JSON for a Flow Board:

### 1. Canonical Schema (`flow.blocks` & `flow.connections`)
- Always generate the canonical semantic workflow structure:
  ```json
  {
    "name": "Flow Name",
    "projectId": "<project_id>",
    "flow": {
      "version": 1,
      "blocks": [ ... ],
      "connections": [ ... ]
    }
  }
  ```
- **Do not manually generate React Flow presentation fields** (`nodes`, `edges`, `position`, `viewport`, `style`, `dimensions`). The server's graph-shape engine generates and maintains canvas layouts automatically.

### 2. Connection Output & Routing Rules
- Connections connect upstream block ID (`from`) to downstream block ID (`to`):
  - **From `condition` / `validator`**: MUST specify `output: "true"` or `output: "false"`.
  - **From `router`**: MUST specify configured route name or `default`.
  - **From `webserver`**: Connects to `route` blocks using `output: "routes"`.
  - **From Single / Multi-Output blocks**: Use the specific output name (e.g. `output: "body"`, `output: "query"`, `output: "result"`, `output: "artifactId"`) or `output: "flow"`.
- **Full Pipeline Connectivity**: Every block in the execution path MUST be wired into `connections` without gaps (e.g., `route` ➔ `script` ➔ `artifact` ➔ `embedding` ➔ `http-response`). Even if downstream blocks reference upstream variables via `{{...}}`, the execution engine strictly relies on connections to establish execution order and topological dependencies.
- **No Duplicate Connections**: Exactly ONE connection between any pair of blocks (unless condition or router branches to the same target).
- **Acyclic Only**: Graphs must be strictly directed acyclic graphs (DAGs). Never create back-edges; use iteration blocks (`loop` / `foreach`) or node execution policies (`maxAttempts`, `backoffMs`) instead. A downstream join waits for all incoming branches to complete or become unreachable.

---

## 6. Complete Graph Template (Canonical API Payload)

Here is a full example of a valid, fully-wired canonical graph structure saved via `POST /api/graphs`:

```json
{
  "name": "PRD Review and Approval Flow",
  "projectId": "6a99bcfc636072bb867a0bad",
  "flow": {
    "version": 1,
    "blocks": [
      {
        "id": "trigger_node",
        "kind": "trigger",
        "name": "trigger",
        "label": "Start Trigger",
        "config": {
          "triggerType": "manual",
          "inputSchema": "z.object({\n  featureName: z.string(),\n  requirements: z.string()\n})"
        }
      },
      {
        "id": "agent_node",
        "kind": "agent",
        "name": "spec_agent",
        "label": "Spec Generator",
        "config": {
          "model": "gpt-4o-mini",
          "systemPrompt": "You are a senior product manager drafting comprehensive Markdown PRDs.",
          "userPrompt": "Draft a detailed PRD for feature: {{trigger.input.featureName}}.\nRequirements: {{trigger.input.requirements}}",
          "outputFormat": "text",
          "timeoutMs": 60000,
          "maxAttempts": 2
        }
      },
      {
        "id": "artifact_node",
        "kind": "artifact",
        "name": "prd_artifact",
        "label": "Durable PRD Store",
        "config": {
          "operation": "create",
          "artifactId": "prd-{{uuid}}",
          "title": "PRD: {{trigger.input.featureName}}",
          "type": "prd",
          "format": "markdown",
          "content": "{{spec_agent.text}}"
        }
      }
    ],
    "connections": [
      {
        "id": "trigger_to_agent",
        "from": "trigger_node",
        "output": "input",
        "to": "agent_node"
      },
      {
        "id": "agent_to_artifact",
        "from": "agent_node",
        "output": "text",
        "to": "artifact_node"
      }
    ]
  }
}
```

---

## 7. How to Persist, Run, Resume, and Inspect Flows via API

1. **Save New Graph**:
   ```bash
   curl -X POST http://localhost:6300/api/graphs \
     -H "Content-Type: application/json" \
     -d '<graph_json>'
   ```

2. **Validate Variables & Connections**:
   ```bash
   curl -X POST http://localhost:6300/api/graphs/<graph_id>/validate
   ```

3. **Execute Graph**:
   ```bash
   curl -X POST http://localhost:6300/api/graphs/<graph_id>/run \
     -H "Content-Type: application/json" \
     -d '{"input": {"featureName": "Real-Time Notifications", "requirements": "WebSocket alerts with audio chime"}}'
   ```

4. **Inspect Execution State & Durable Checkpoint**:
   ```bash
   curl -X GET http://localhost:6300/api/runs/<run_id>/state
   ```

5. **Resume Waiting Flow (e.g. Human-Gate)**:
   ```bash
   curl -X POST http://localhost:6300/api/runs/<run_id>/resume \
     -H "Content-Type: application/json" \
     -d '{"token": "<resume_token>", "decision": "Approve", "feedback": "Looks good"}'
   ```

6. **Cancel Active or Waiting Flow**:
   ```bash
   curl -X POST http://localhost:6300/api/runs/<run_id>/cancel
   ```

7. **Open in UI**:
   Navigate to `http://localhost:6301/runs/<run_id>` or `http://localhost:6301/?flow=<graph_id>` to view and edit the board.

## Research workflow contracts

- Use `orchestrator` with `requireResearchOutput: true` for delegated researchers, and set `maxToolStepsPerAgent` to bound web calls. Each finding must include a claim, source-specific evidence, source URL, access date, confidence, limitations, research area, and question IDs.
- Use `research-review` with `verifySources: true` to fetch source pages and flag evidence that cannot be matched. This is a retrieval check, not a semantic proof of the claim.
- In research mode, `loop` runs a saved child graph. The child output must expose the configured `completionPath` (default `decision`) and an array at `gapPath` (default `gaps`). When the limit is reached, the loop returns `decision: incomplete_needs_human_review`.
- Waiting gates can be used in research-round child graphs and synchronous `foreach` child graphs with concurrency 1. Keep gates outside asynchronous or in-canvas `foreach` item branches.
