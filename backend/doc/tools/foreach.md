# Foreach Tool Documentation & Usage Guide

The **Foreach** node executes a saved child graph once for each item in an input collection. It supports controlled concurrency (1 to 10), truncation ceilings, error-handling behaviors, and passes parent run tracking (`parentRunId`) to every child execution.

---

## Table of Contents
1. [Overview & Architecture](#1-overview--architecture)
2. [Node Inputs & Configuration](#2-node-inputs--configuration)
3. [Child Graph Input Contract](#3-child-graph-input-contract)
4. [Execution Rules & Concurrency](#4-execution-rules--concurrency)
5. [Outputs & Schema](#5-outputs--schema)
6. [Best Practices](#6-best-practices)

---

## 1. Overview & Architecture

Unlike the purely structural `Loop` block (which maps arrays into indexed items), `Foreach` orchestrates child graph execution per item.

```mermaid
graph TD
    ItemsInput[Input Items Array] --> ForeachNode[Foreach Node]
    ForeachNode --> WorkerPool[Bounded Concurrency Pool (1-10)]
    WorkerPool --> ChildRun1[Child Graph: Item 0]
    WorkerPool --> ChildRun2[Child Graph: Item 1]
    WorkerPool --> ChildRunN[Child Graph: Item N]
    ChildRun1 --> ResultCollector[Result Aggregator]
    ChildRun2 --> ResultCollector
    ChildRunN --> ResultCollector
    ResultCollector --> ForeachResult[foreach.result: status, items, errors]
```

Key features:
- **Child Graph Invocation**: Executes a saved graph identified by `graphId`.
- **Bounded Concurrency**: Controls concurrency between 1 (strictly sequential) and 10 workers without unbounded promises.
- **Parent Run Lineage**: Preserves `parentRunId` across all child executions.
- **Ordered Determinism**: Output items are strictly preserved in their original sequence.

---

## 2. Node Inputs & Configuration

| Input Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `items` | `valueOrVariable` | Yes | - | Array of items or an object containing an `items` array. |
| `graphId` | `select` | Yes | - | The saved child graph to execute for each item (`/api/graphs`). |
| `baseInput` | `valueOrVariable` | No | `{}` | Optional base payload merged into every child graph invocation. |
| `maxIterations` | `number` | No | `25` | Maximum number of items to process (range: 1–100). |
| `concurrency` | `number` | No | `1` | Number of concurrent child runs (range: 1–10). |
| `stopOnError` | `checkbox` | No | `false` | If `true`, stops launching new child runs after the first failure. |
| `outputMode` | `select` | No | `"result"` | Output mode: `"result"` (graph output) or `"state"` (node execution list). |
| `outputType` | `code` | No | - | TypeScript interface describing child result for autocomplete. |

---

## 3. Child Graph Input Contract

For each item, the child graph Trigger receives:

```json
{
  ...baseInput,
  "item": "<currentItem>",
  "index": 0,
  "total": 3
}
```

> [!NOTE]
> The fields `item`, `index`, and `total` are reserved and automatically injected by `Foreach`. They strictly override any colliding keys provided in `baseInput`.

---

## 4. Execution Rules & Concurrency

- **Sequential Execution**: Default `concurrency: 1` processes items one at a time.
- **Bounded Parallelism**: Concurrency values up to 10 are supported using a bounded worker pool.
- **Truncation**: If `items.length > maxIterations`, processing stops at `maxIterations` and `truncated: true` is reported.
- **Stop on Error**:
  - `stopOnError: false`: Processing continues for all items; overall status is `"partial"` if any item failed.
  - `stopOnError: true`: No new items are initiated after a failure; overall status is `"failed"`.
- **Child Waiting Unsupported**: If a child returns `waiting`, it is treated as a controlled failure with `errorCode: "FOREACH_CHILD_WAITING_UNSUPPORTED"`.

---

## 5. Outputs & Schema

The node outputs a single `result` object:

```json
{
  "status": "completed",
  "count": 2,
  "processed": 2,
  "truncated": false,
  "items": [
    {
      "index": 0,
      "item": { "id": "task-1" },
      "status": "completed",
      "result": { "processed": true },
      "childRunId": "run-abc-123"
    },
    {
      "index": 1,
      "item": { "id": "task-2" },
      "status": "completed",
      "result": { "processed": true },
      "childRunId": "run-abc-124"
    }
  ],
  "errors": []
}
```

Status meanings:
- `completed`: All processed items succeeded.
- `partial`: At least one item failed, but processing continued (`stopOnError: false`).
- `failed`: Execution stopped due to error with `stopOnError: true` or configuration validation error.

---

## 6. Best Practices

1. **Keep Child Graphs Focused**: Design child graphs with a clear input contract expecting `item`, `index`, and `total`.
2. **Combine with Aggregate**: Connect the output of `Foreach` to an **Aggregate** node to filter, count, and summarize item results.
3. **Use Base Input for Shared Context**: Pass shared variables such as `projectId` or authentication tokens via `baseInput`.
