---
name: flow-board-composer
description: Use when designing, selecting tools for, composing, editing, or generating Flow Board workflows in the LangGraph Flow Builder. Covers the step-list board, canonical flow.blocks and flow.connections, event wiring, and variable references. Read before creating or changing a graph.
---

# Flow Board Composer

Build the workflow's meaning. The board is a **step list**, not a React Flow canvas. Persist canonical `flow.blocks` and `flow.connections` only. The server owns layout. Do not generate `nodes`, `edges`, `position`, `viewport`, `layout`, `style`, or dimensions.

Tool behavior lives in [`backend/doc/tools/`](backend/doc/tools/). Read the tool's `backend/src/tools/<kind>.json` before setting `config` keys or connection outputs. Do not invent keys.

## Board shape

```json
{
  "name": "Flow name",
  "projectId": "<project_id>",
  "flow": {
    "version": 1,
    "blocks": [],
    "connections": []
  }
}
```

Each block:

| Field | Rule |
| :--- | :--- |
| `id` | Stable unique id. Used by connections. |
| `kind` | Tool type, matching a file in `backend/src/tools/` (`agent`, `trigger`, `file`, …). |
| `name` | Unique variable namespace. Downstream templates use `{{name.field}}`. |
| `label` | Human title shown in the step list. |
| `definitionName` | Optional display name of the tool (for example `"Agent"`). |
| `config` | Only keys defined on that tool. |

Each connection:

```json
{ "id": "trigger_to_agent", "from": "<block id>", "output": "done", "to": "<block id>", "input": "in" }
```

`from` / `to` are block **ids**. `output` is a **control-flow event**, never a data field.

## How to build

1. Name the entry and the outcome.
2. Pick the smallest set of tools, in execution order. Read each tool doc before configuring it.
3. Give every block a unique `id` and `name`.
4. Connect every step. A `{{name.field}}` reference does not create an execution edge.
5. Add a branch only when the outcomes differ.
6. Keep the graph a DAG. Retries use `timeoutMs`, `maxAttempts`, and `backoffMs` on the block. Iteration uses `loop` or `foreach`.
7. Validate, then save. Do not send `layout`.

New flow: return the full graph. Change to an existing flow: return operations, not a rewritten graph.

```json
{ "op": "addBlock", "block": { "id": "", "kind": "", "name": "", "label": "", "config": {} }, "after": "<existing id>" }
{ "op": "updateBlock", "blockId": "", "name": "", "configPatch": {} }
{ "op": "removeBlock", "blockId": "" }
{ "op": "addConnection", "from": "", "to": "", "output": "done", "input": "in" }
{ "op": "removeConnection", "from": "", "to": "", "output": "done" }
```

## Events and data

Two separate systems:

- **Events** decide which step runs next. They are the only legal `connection.output` values.
- **Data** is stored on the block name and read with `{{name.field}}` or `{ "mode": "variable", "value": "name.field" }`.

Do not wire `text`, `result`, `content`, `body`, `artifactId`, `screenshot`, or `html` as connection outputs.

| Source | Main path `output` | Other events |
| :--- | :--- | :--- |
| Most action blocks (`agent`, `browser`, `web-search`, `script`, `transform`, `action`, `notification`, `telegram`, `embedding`, `retrieval`, `memory`, `subgraph`, `execution`, `repo-inspect`, `json-parser`, `aggregate`, `file` except `exists`, `database` except `ping`, `secrets` except `exists`) | `done` | `failed` |
| `trigger`, `route` | `done` (every outgoing edge runs; these blocks have no branch events) | — |
| `webserver` | `routes` toward each `route` | — |
| `condition`, `validator` | `true` or `false` | — |
| `file` `exists`, `database` `ping`, `secrets` `exists`, `log` `assert` with `onFail: "route"` | `true` or `false` | — |
| `router` | configured route name | `default` |
| `human-gate` | `approved` or `rejected` | — |
| `artifact` | `onSuccess` | `onUnchanged`, `onNotFound`, `onConflict`, `onFailed` |
| `research-review` | `pass` | `needs_more_research`, `revise_findings`, `incomplete_needs_human_review` |
| `loop` | `completed` | `incomplete`, `limitReached`, `failed` |
| `foreach` | `done` after the loop | `partial`, `failed`; in-canvas item body uses `item` |
| `orchestrator` | `agent_1` … per job | `done` runs after every job finishes |
| `http-response` | none (terminal) | — |

A connected `failed` path marks the run `partial`. With no failure path, the run fails.

Rules:

- One connection per pair of blocks, unless two branches of the same node target one join.
- A join waits until every incoming branch has completed or become unreachable.
- No cycles.
- Variable references must come from an upstream block on a connected path.
- Read the tool JSON when the table and the definition disagree. The JSON wins.

## Tool selection

Match the job, then open that tool's guide for config.

| Intent | Tool | Guide |
| :--- | :--- | :--- |
| Manual, event, webhook, or schedule start | `trigger` | [trigger.md](backend/doc/tools/trigger.md) |
| HTTP service | `webserver`, `route`, `http-response` | [webserver.md](backend/doc/tools/webserver.md) |
| LLM step | `agent` | [agent.md](backend/doc/tools/agent.md) |
| Web search | `web-search` | [web-search.md](backend/doc/tools/web-search.md) |
| Browser | `browser` | [browser.md](backend/doc/tools/browser.md) |
| Boolean check | `condition`, `validator` | [condition.md](backend/doc/tools/condition.md) |
| Multi-way route | `router` | [router.md](backend/doc/tools/router.md) |
| Code or reshape | `script`, `transform`, `json-parser` | [script.md](backend/doc/tools/script.md) |
| Counters and scratch state | `variable` | [variable.md](backend/doc/tools/variable.md) |
| Durable document | `artifact` | [artifact.md](backend/doc/tools/artifact.md) |
| Project files | `file` | [file.md](backend/doc/tools/file.md) |
| Human approval | `human-gate` | [human-gate.md](backend/doc/tools/human-gate.md) |
| Saved child flow | `subgraph` | [subgraph.md](backend/doc/tools/subgraph.md) |
| RAG | `embedding`, `retrieval` | [retrieval.md](backend/doc/tools/retrieval.md) |
| Key-value memory | `memory` | [memory.md](backend/doc/tools/memory.md) |
| Several agents | `orchestrator` | [orchestrator.md](backend/doc/tools/orchestrator.md) |
| Research check | `research-review` | [research-review.md](backend/doc/tools/research-review.md) |
| REST call | `action` | [action.md](backend/doc/tools/action.md) |
| Shell | `execution` | [execution.md](backend/doc/tools/execution.md) |
| Read a repo | `repo-inspect` | [repo-inspect.md](backend/doc/tools/repo-inspect.md) |
| Slack, email, webhook | `notification` | [notification.md](backend/doc/tools/notification.md) |
| Telegram | `telegram` | [telegram.md](backend/doc/tools/telegram.md) |
| Database | `database` | [database.md](backend/doc/tools/database.md) |
| Credentials | `secrets` | [secrets.md](backend/doc/tools/secrets.md) |
| Per-item child graph or in-canvas body | `foreach` | [foreach.md](backend/doc/tools/foreach.md) |
| Research rounds or bounded loop | `loop` | [loop.md](backend/doc/tools/loop.md) |
| End of an in-canvas iteration | `output` | [output.md](backend/doc/tools/output.md) |
| Summarize a collection | `aggregate` | [aggregate.md](backend/doc/tools/aggregate.md) |
| Trace or assert | `log` | [log.md](backend/doc/tools/log.md) |

Defaults that are easy to get wrong:

- `agent`: `model`, `systemPrompt`, `userPrompt`, `outputFormat` (`text` or `json`). Read `{{name.text}}` or `{{name.result.field}}`.
- `artifact`: `operation` is `create`, `get`, `list`, `update`, `addRelation`, `diff`, `approve`, or `archive`. Continue on `onSuccess`. Mutations are never retried. Read `{{name.content}}`, `{{name.artifactId}}`, `{{name.version}}`.
- `foreach`: `items`, and either an in-canvas `item` branch or `graphId` for a child graph. `concurrency` 1–10. Keep it at 1 if a child can pause. Child trigger receives `{ ...baseInput, item, index, total }`.
- `secrets`: reference `{{secrets.NAME}}`. The runner redacts them from logs and checkpoints.
- Embeddings stay in the vector store. Node output keeps metadata (`dimensions`, `count`, `text`, `score`), not raw float arrays.

## Variables

```handlebars
{{<block name>.<field>}}
```

| From | Examples |
| :--- | :--- |
| Trigger | `{{trigger.input.query}}`, `{{trigger.entityId}}`, `{{trigger.data.current.content}}` |
| Route | `{{post_plans.body.title}}`, `{{get_plans.query.q}}` |
| Agent | `{{spec_agent.text}}`, `{{spec_agent.result.summary}}` |
| Artifact | `{{prd_artifact.artifactId}}`, `{{prd_artifact.content}}` |
| Foreach | `{{each_ticket.result.items}}`, `{{each_ticket.result.errors}}` |
| Aggregate | `{{summary.result.allSucceeded}}` |
| Subgraph | `{{child.result.summary}}` or `{{child.summary}}` |
| Secrets | `{{secrets.GITHUB_TOKEN}}` |

Fallback chains are allowed: `{{query.limit || 5}}`.

## Execution policy

```json
{ "timeoutMs": 60000, "maxAttempts": 3, "backoffMs": 1000 }
```

Timeouts clamp to 10–900000 ms. Attempts cap at 3. Human gates, artifact mutations, and database writes are not retried. Checkpoints land in `run_checkpoints` after each step (10 MB cap).

## Example

```json
{
  "name": "PRD Review and Approval Flow",
  "projectId": "<project_id>",
  "flow": {
    "version": 1,
    "blocks": [
      {
        "id": "trigger_node",
        "kind": "trigger",
        "name": "trigger",
        "label": "Start",
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
          "systemPrompt": "You are a senior product manager drafting Markdown PRDs.",
          "userPrompt": "Draft a PRD for {{trigger.input.featureName}}.\nRequirements: {{trigger.input.requirements}}",
          "outputFormat": "text",
          "timeoutMs": 60000,
          "maxAttempts": 2
        }
      },
      {
        "id": "artifact_node",
        "kind": "artifact",
        "name": "prd_artifact",
        "label": "Save PRD",
        "config": {
          "operation": "create",
          "title": "PRD: {{trigger.input.featureName}}",
          "type": "prd",
          "format": "markdown",
          "content": "{{spec_agent.text}}"
        }
      }
    ],
    "connections": [
      { "id": "trigger_to_agent", "from": "trigger_node", "output": "done", "to": "agent_node", "input": "in" },
      { "id": "agent_to_artifact", "from": "agent_node", "output": "done", "to": "artifact_node", "input": "in" }
    ]
  }
}
```

## Save, validate, run

Backend is `http://localhost:6300`. The step list is `http://localhost:6301/flow/<graph_id>`.

```bash
curl -X POST http://localhost:6300/api/graphs -H "Content-Type: application/json" -d '<graph_json>'
curl -X POST http://localhost:6300/api/graphs/<graph_id>/validate
curl -X POST http://localhost:6300/api/graphs/<graph_id>/run -H "Content-Type: application/json" -d '{"input":{}}'
curl -X GET http://localhost:6300/api/runs/<run_id>/state
curl -X POST http://localhost:6300/api/runs/<run_id>/resume -H "Content-Type: application/json" -d '{"token":"<resume_token>","decision":"Approve","feedback":""}'
curl -X POST http://localhost:6300/api/runs/<run_id>/cancel
```

HTTP services start with `POST /api/webservers/<graph_id>/start`. A `route` runs only from an HTTP request or an explicit `startNodeId`. It is not a batch root.

## Before saving

- One entry: a `trigger`, or a `webserver` wired to `route` blocks.
- Unique block ids and names.
- Every connection references real blocks and a real event for that tool.
- Every execution step is connected.
- Variables point at upstream block names.
- No cycles, no duplicate edges, no layout fields.

## Research flows

- `orchestrator` with `requireResearchOutput: true`, and `maxToolStepsPerAgent` set. Each finding needs a claim, evidence, source URL, access date, confidence, limitations, research area, and question ids.
- `research-review` with `verifySources: true` checks that evidence text appears on the source page.
- In research mode, `loop` runs a child graph. The child must expose `completionPath` (default `decision`) and `gapPath` (default `gaps`). At the limit the loop returns `decision: incomplete_needs_human_review`.
- A waiting gate may sit in a research-round child or a synchronous `foreach` child with concurrency 1. Keep gates off asynchronous and in-canvas `foreach` item branches.
