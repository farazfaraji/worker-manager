---
name: flow-board-composer
description: Use when designing, selecting tools for, composing, or generating Flow Board graphs (workflows) in the LangGraph Flow Builder. Guides tool selection across 20+ specialized blocks, node wiring, variable referencing, and graph JSON generation.
---

# Flow Board Composer & Tool Selection Skill

This skill guides AI agents in selecting the right tools and generating complete, valid, and fully-wired **Flow Board graphs** for the LangGraph Flow Builder.

For the current board-construction contract, read [../board/llm.md](../board/llm.md) before creating or changing a graph. Its canonical `flow.blocks` / `flow.connections` model and layout rules take precedence over older React Flow examples in this document.

All tools in the builder have dedicated reference documentation located in [`backend/src/tools/doc/`](backend/src/tools/doc/).

---

## 1. Tool Selection Decision Matrix

Match user intents and task requirements to the appropriate node blocks:

| Intent / Requirement | Primary Tools | Secondary / Supporting | Reference Documentation |
| :--- | :--- | :--- | :--- |
| **Workflow Entrypoint** | `trigger` | `subgraph` | [trigger.md](backend/src/tools/doc/trigger.md) |
| **LLM Reasoning & Extraction** | `agent` | `json-parser`, `validator` | [agent.md](backend/src/tools/doc/agent.md) |
| **Web Scraping & Browser Automation** | `browser` | `script`, `transform` | [browser.md](backend/src/tools/doc/browser.md) |
| **Boolean Branching & Checks** | `condition`, `validator` | `router` | [condition.md](backend/src/tools/doc/condition.md), [validator.md](backend/src/tools/doc/validator.md) |
| **Multi-Path Intent Routing** | `router` | `condition` | [router.md](backend/src/tools/doc/router.md) |
| **Custom Code & Math / Logic** | `script`, `transform` | `variable` | [script.md](backend/src/tools/doc/script.md), [transform.md](backend/src/tools/doc/transform.md) |
| **Durable Document Storage & Diffs** | `artifact` | `trigger` (Event mode) | [artifact.md](backend/src/tools/doc/artifact.md) |
| **Human Review / Approval Gate** | `human-gate` | `artifact`, `notification` | [human-gate.md](backend/src/tools/doc/human-gate.md) |
| **Reusable Sub-Workflows** | `subgraph` | `trigger`, `foreach` | [subgraph.md](backend/src/tools/doc/subgraph.md) |
| **Vector Search & RAG Knowledge** | `retrieval`, `embedding` | `memory` | [retrieval.md](backend/src/tools/doc/retrieval.md), [embedding.md](backend/src/tools/doc/embedding.md) |
| **Conversation Memory (Key-Value)** | `memory` | `variable` | [memory.md](backend/src/tools/doc/memory.md) |
| **Multi-Agent Coordination** | `orchestrator` | `agent` | [orchestrator.md](backend/src/tools/doc/orchestrator.md) |
| **External REST APIs & Webhooks** | `action` | `notification` | [action.md](backend/src/tools/doc/action.md) |
| **Terminal / CLI Command Execution**| `execution` | `script` | [execution.md](backend/src/tools/doc/execution.md) |
| **Slack / Email / Webhook Alerts** | `notification` | `action` | [notification.md](backend/src/tools/doc/notification.md) |
| **Collection Loops & Batching** | `loop` | `variable` | [loop.md](backend/src/tools/doc/loop.md) |
| **Child Graph Iteration (Fan-Out)** | `foreach` | `subgraph`, `aggregate` | [foreach.md](backend/src/tools/doc/foreach.md) |
| **Canvas Architecture & Layout** | `board` | — | [board.md](backend/src/tools/doc/tools/board.md) |
| **Workspace & Project Scoping** | `project` / `board` | `trigger`, `artifact` | [board/new-board.md](backend/src/tools/doc/tools/board/new-board.md) |

---

## 2. Tool Reference & Configuration Cheatsheet

### 1. `trigger` ([trigger.md](backend/src/tools/doc/trigger.md))
- **Role**: Every flow MUST begin with a trigger node.
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

### 2. `agent` ([agent.md](backend/src/tools/doc/agent.md))
- **Role**: Core LLM engine.
- **Key Configs**: `model` (e.g. `gpt-4o-mini`, `gpt-4o`, `claude-3-5-sonnet-20241022`), `systemPrompt`, `userPrompt`, `outputFormat` (`"text"` or `"json"`), `outputType` (Zod schema for structured output).
- **Outputs**: `result` (object if JSON format), `text` (raw markdown/string), `reasoning`.

### 3. `artifact` ([artifact.md](backend/src/tools/doc/artifact.md))
- **Role**: Durable document persistence in MongoDB, versioning, cross-document relations, diffing, and domain event emission.
- **Operations (`operation`)**: `create`, `get`, `list`, `update`, `addRelation`, `diff`, `approve`, `archive`.
- **Key Configs**: `title`, `content` (`valueOrVariable`), `linkedArtifactIds` (`valueOrVariable`, multiselect chips or variable array), `format` (`markdown`, `json`, `code`, `text`), `type` (`document`, `tech-spec`, `task`, `decision`).
- **Events Emitted**: Automatically emits `artifact.create`, `artifact.update`, `artifact.delete`, `artifact.approve`.
- **Outputs**: `artifact`, `artifactId`, `linkedArtifactIds`, `title`, `content`, `version`.
- **Retry Rule**: Artifact mutation operations are never automatically retried to prevent phantom duplicated documents or split-brain state.

### 4. `browser` ([browser.md](backend/src/tools/doc/browser.md))
- **Role**: Playwright headless browser control.
- **Operations**: `navigate`, `click`, `fill`, `screenshot`, `scrape`, `evaluate`, `wait`.
- **Outputs**: `result`, `url`, `title`, `content`, `screenshot`, `path`.

### 5. `condition` ([condition.md](backend/src/tools/doc/condition.md)) & `validator` ([validator.md](backend/src/tools/doc/validator.md))
- **Role**: Logic branching.
- **Condition**: Compares two values (`left`, `operator`, `right`) or executes custom JS expression.
- **Validator**: Tests data payload against a Zod schema.
- **Handles**: Has two discrete output sockets: `"true"` (green) and `"false"` (red).

### 6. `human-gate` ([human-gate.md](backend/src/tools/doc/human-gate.md))
- **Role**: Pauses execution until a human reviews, edits, and approves.
- **Key Configs**: `title`, `description`, `fields` (form controls), `draftContent` (prefilled editable draft).
- **Security & Resume Tokens**:
  - Generates opaque single-use token `rtk_<uuid>`.
  - Persists cryptographic SHA-256 hash `resumeTokenHash` in MongoDB (raw token is never logged or stored).
  - Single-use invalidation prevents replay attacks.
- **Outputs**: `decision` (`"approved"` / `"rejected"`), `value`, `feedback`.

### 7. `subgraph` ([subgraph.md](backend/src/tools/doc/subgraph.md))
- **Role**: Executes a modular child flow with parameter mapping.
- **Key Configs**: `graphId`, `input` (JSON payload or variable reference), `outputMode` (`"result"` or `"state"`).
- **Parent/Child Recovery**:
  - Subgraphs that encounter a `human-gate` pause the parent flow cleanly with `waitingChildRunId`.
  - Resuming the parent delegates directly to the child run without restarting child execution from scratch.
  - Bounded nesting depth of **10** (`MAX_SUBGRAPH_DEPTH_EXCEEDED`).

### 8. `retrieval` ([retrieval.md](backend/src/tools/doc/retrieval.md)) & `embedding` ([embedding.md](backend/src/tools/doc/embedding.md))
- **Role**: Vector database indexing and semantic cosine similarity search.
- **Outputs**: `results`, `query`, `count`.

### 9. `action` ([action.md](backend/src/tools/doc/action.md)) & `notification` ([notification.md](backend/src/tools/doc/notification.md))
- **Role**: External integrations.
- **Action**: HTTP REST requests (`method`, `url`, `headers`, `body`, `allowedHosts`).
- **Notification**: Alerts to Slack, Discord, Email, or Webhook.

### 10. `foreach` ([foreach.md](backend/src/tools/doc/foreach.md))
- **Role**: Executes a saved child graph once for each item in an input collection with bounded concurrency.
- **Key Configs**:
  - `items` (`valueOrVariable`, required): Array of items or object with `items` array.
  - `graphId` (`select`, required): ID of the saved child flow (`/api/graphs`).
  - `baseInput` (`valueOrVariable`, optional): Base object payload merged into each child run.
  - `concurrency` (`number`, 1–10, default: 1): Bounded parallel child execution.
  - `maxIterations` (`number`, 1–100, default: 25): Hard cap on items processed.
  - `stopOnError` (`checkbox`, default: false): Halts starting new child runs on failure.
  - `outputMode` (`select`): `"result"` or `"state"`.
- **Child Graph Contract**: Each child Trigger receives `{ ...baseInput, item: currentItem, index: 0, total: N }` (reserved `item`, `index`, `total` override `baseInput`). Preserves `parentRunId`.
- **Outputs**: `result` containing `{ status, count, processed, truncated, items: [...], errors: [...] }`.

### 11. `aggregate` ([aggregate.md](backend/src/tools/doc/aggregate.md))
- **Role**: In-memory normalization, filtering, and summary metrics for `foreach` outputs or raw arrays.
- **Key Configs**:
  - `items` (`valueOrVariable`, required): Array of items or `foreach` result object.
  - `includeSuccessful` (`checkbox`, default: true): Retain successful items.
  - `includeFailed` (`checkbox`, default: true): Retain failed items.
- **Outputs**: `result` containing `{ items: [...], errors: [...], count, successCount, failureCount, allSucceeded, truncated }`.

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
- **From Agent**:
  - Text output: `{{agent_1.text}}`
  - Structured JSON: `{{agent_1.result.summary}}`, `{{agent_1.result.findings}}`
- **From Artifact**:
  - `{{artifact_1.artifactId}}`
  - `{{artifact_1.content}}`
  - `{{artifact_1.version}}`
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

## 5. Graph Composition & Layout Rules

When generating graph JSON for a Flow Board:

### 1. Canonical Flow Only
- Generate `flow.blocks`, `flow.connections`, names, tool configuration, and valid outputs.
- Do not generate positions, viewport, edge styling, animations, dimensions, or routing points.
- `GraphShapeService` persists those canvas concerns separately as `layout` and reconstructs the React Flow representation when the graph is loaded.

### 2. Edge Definitions
- Edges connect `source` (upstream node ID) to `target` (downstream node ID).
- Always specify `sourceHandle`:
  - From Trigger: `sourceHandle: "input"` (or `"data"`, `"event"` for event triggers)
  - From Agent: `sourceHandle: "result"` or `"text"`
  - From Condition / Validator: `sourceHandle: "true"` or `"false"`
  - From Artifact: `sourceHandle: "artifact"` or `"artifactId"`

---

## 6. Complete Graph Template (Ready-to-Post JSON)

Here is a full example of a valid graph structure that can be saved via `POST /api/graphs`:

```json
{
  "name": "PRD Review and Approval Flow",
  "projectId": "6a99bcfc636072bb867a0bad",
  "nodes": [
    {
      "id": "trigger_node",
      "type": "langgraphNode",
      "data": {
        "name": "trigger",
        "nodeName": "trigger",
        "definitionType": "trigger",
        "definitionName": "Trigger",
        "label": "Trigger",
        "config": {
          "triggerType": "manual",
          "inputSchema": "z.object({\n  featureName: z.string(),\n  requirements: z.string()\n})"
        }
      }
    },
    {
      "id": "agent_node",
      "type": "langgraphNode",
      "data": {
        "name": "spec_agent",
        "nodeName": "spec_agent",
        "definitionType": "agent",
        "definitionName": "Agent",
        "label": "Spec Generator",
        "config": {
          "model": "gpt-4o-mini",
          "systemPrompt": "You are a senior product manager drafting comprehensive Markdown PRDs.",
          "userPrompt": "Draft a detailed PRD for feature: {{trigger.input.featureName}}.\nRequirements: {{trigger.input.requirements}}",
          "outputFormat": "text",
          "timeoutMs": 60000,
          "maxAttempts": 2
        }
      }
    },
    {
      "id": "artifact_node",
      "type": "langgraphNode",
      "data": {
        "name": "prd_artifact",
        "nodeName": "prd_artifact",
        "definitionType": "artifact",
        "definitionName": "Artifact",
        "label": "Durable PRD Store",
        "config": {
          "operation": "create",
          "artifactId": "prd-{{uuid}}",
          "title": "PRD: {{trigger.input.featureName}}",
          "type": "document",
          "format": "markdown",
          "content": {
            "mode": "variable",
            "value": "{{spec_agent.text}}"
          }
        }
      }
    }
  ],
  "edges": [
    {
      "id": "edge_trigger_agent",
      "source": "trigger_node",
      "sourceHandle": "input",
      "target": "agent_node"
    },
    {
      "id": "edge_agent_artifact",
      "source": "agent_node",
      "sourceHandle": "text",
      "target": "artifact_node"
    }
  ]
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
