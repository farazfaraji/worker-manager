# Loop Tool Documentation & Usage Guide

The **Loop** node handles bounded iteration, batch decomposition, and array mapping over collections with built-in safety guardrails. It transforms raw arrays of URLs, records, files, or tickets into indexed iteration items, preventing infinite loop states by enforcing hard iteration ceilings.

---

## Table of Contents
1. [Overview & Architecture](#1-overview--architecture)
2. [Node Inputs & Configuration](#2-node-inputs--configuration)
3. [Loop Modes & Behavior](#3-loop-modes--behavior)
   - [Map Mode](#map-mode)
   - [Batch Mode](#batch-mode)
4. [Safety Limits & Truncation Protection](#4-safety-limits--truncation-protection)
5. [Outputs & Schema](#5-outputs--schema)
6. [Real-World Recipes & Iteration Patterns](#6-real-world-recipes--iteration-patterns)
7. [Best Practices](#7-best-practices)

---

## 1. Overview & Architecture

Iterating over dynamic data in graph-based workflows presents safety challenges such as unbounded loops, runaway token consumption, and out-of-memory errors. The Loop node solves this by:
- **Index Tagging**: Wraps each item in the collection with its zero-based index (`{ index, item }`).
- **Bounded Guardrails**: Caps iteration counts strictly at `maxIterations` (default: 100).
- **Truncation Tracking**: Reports `truncated: true` if the input collection exceeded the iteration ceiling.

```mermaid
graph LR
    ArrayInput[Raw Items Array] --> LoopNode[Loop Node]
    LoopNode --> Guardrail{items.length > maxIterations?}
    Guardrail -- Yes --> Slice[Slice to maxIterations & set truncated=true]
    Guardrail -- No --> IndexMap[Map elements to { index, item }]
    Slice --> IndexMap
    IndexMap --> LoopResult[loop.result: items, count, truncated]
```

---

## 2. Node Inputs & Configuration

| Input Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `items` | `valueOrVariable` | Yes | `null` | Array of items to process, or an object containing an `items` array. Accepts `array`, `object`, `string`, `any`. |
| `maxIterations` | `number` | No | `100` | Hard cap on items processed in a single run. |
| `mode` | `select` | No | `"map"` | Iteration processing mode: `"map"` or `"batch"`. |

---

## 3. Loop Modes & Behavior

### Map Mode
Transforms the input array into an indexed list ready for item-by-item processing or fan-out across downstream nodes:
```json
{
  "items": "{{nodes.browser_1.result.extractedLinks}}",
  "maxIterations": 25,
  "mode": "map"
}
```

### Batch Mode
Groups items into manageable chunk batches, ideal for bulk database insertions or multi-record LLM prompt analysis.

---

## 4. Safety Limits & Truncation Protection

If an upstream scraping node extracts 5,000 URLs, running an agent over all of them could exhaust API credits and hang the workflow.

With `maxIterations: 50`:
- Only the first 50 items are processed.
- `result.truncated` is set to `true`.
- Downstream nodes can check `loop_1.result.truncated` in a **Condition** or **Notification** node to alert admins of remaining unprocessed records.

---

## 5. Outputs & Schema

The Loop node outputs a single `result` object:

### Output Schema
```json
{
  "status": "completed",
  "result": {
    "count": 3,
    "truncated": false,
    "items": [
      {
        "index": 0,
        "item": { "id": "task-1", "title": "Audit auth module" }
      },
      {
        "index": 1,
        "item": { "id": "task-2", "title": "Implement rate limiting" }
      },
      {
        "index": 2,
        "item": { "id": "task-3", "title": "Update Swagger docs" }
      }
    ]
  }
}
```

---

## 6. Real-World Recipes & Iteration Patterns

### Recipe 1: Web Scraper Link Iteration
Prepare a list of scraped product URLs for worker agents:

```json
{
  "items": "{{nodes.browser_scraper.result.productUrls}}",
  "maxIterations": 10,
  "mode": "map"
}
```

### Recipe 2: Iterating Over JSON Parser Results
Safely process items parsed from an external file:

```json
{
  "items": "{{nodes.jsonparser_1.value.records}}",
  "maxIterations": 50
}
```

---

## 7. Loop vs. Foreach: Decision Matrix

A common question is when to use **Loop** vs. **Foreach**:

| Feature | `Loop` Node | `Foreach` Node |
| :--- | :--- | :--- |
| **Primary Purpose** | **Data Transformer & Guardrail** | **Execution Orchestrator** |
| **Downstream Node Execution** | Downstream node runs **once** receiving the sliced or indexed array. | Downstream pipeline runs **once per item** (in parallel or sequentially). |
| **Execution Context** | Single linear run in same graph. | Isolated context per item (`item`, `index`, `total`). |
| **Workflow Termination** | Passes sliced collection directly to the next node. | Uses dedicated **`Output`** block at the end of the iteration branch. |
| **Best Used For** | Slicing top $N$ items for **one** LLM summary, chunking batches for DB inserts, or stateful cyclic loops. | Calling an **Agent** or API once for every record in a list. |

---

## 8. Best Practices

1. **Set Reasonable `maxIterations`**: Always establish a conservative `maxIterations` during testing (e.g. 5–10) before scaling up to production volumes.
2. **Combine with Increment Variable**: For stateful step-by-step looping where the graph cycles back on itself, pair with an **Increment Variable** and **Condition** node to manage the iteration counter and exit condition.
3. **Use Foreach for Multi-Node Iterations**: If you need to run an Agent, Script, or API call repeatedly for each item in an array, use the **`Foreach`** node rather than building cycles with `Loop`.

## Research Rounds mode

Set `mode` to `research` and choose a saved `graphId`. This mode invokes the child graph once per round; it does not add a cycle to the parent graph. Existing `map` and `batch` configurations retain their item-mapping behavior.

- `initialInput`: object containing the idea, constraints, questions, and other fixed context.
- `initialGaps`: starting array of unanswered questions.
- `maxRounds`: integer from 1 to 10, default 3. This is separate from legacy `maxIterations`.
- `completionPath`: property path in the child graph's output, such as `review.decision`. The default is `decision`.
- `completionValue`: value that marks completion, default `pass`.
- `gapPath`: property path for gaps passed to the next round, default `gaps`.

Child graph outputs are wrapped under the final node's name. For a final reviewer named `review`, configure `completionPath: "review.decision"` and `gapPath: "review.gaps"`. A missing completion field or a gaps field that is not an array fails the loop with a configuration error.

Each child run receives `{...initialInput, iteration, gaps, priorResult}`. `iteration` is one-based. `priorResult` contains the preceding round's structured output, capped at 16,000 characters; larger outputs pass a marked excerpt. The child should save long reports as Artifact documents and return IDs. A round output above 32,000 characters fails the loop. Each round has its own child run and a stable idempotency key, so a completed round is reused if the parent node is retried. Child run IDs remain in `result.iterations` for tracing.

The parent checks for cancellation before and after each child round and stops starting new rounds once cancelled. A currently running child round may finish before the cancellation is observed.

`result` contains `status`, `decision`, `iterations`, `count`, `stopReason`, `limitReached`, `gaps`, and `output`. A matching completion field yields `status: completed` and `stopReason: condition_met`. Exhaustion yields `status: incomplete`, `decision: incomplete_needs_human_review`, and `limitReached: true`; it does not assert research passed. A child human gate pauses the parent run and resumes the same child round when the user responds. A failed child still fails the parent node. Connect a Condition to `result.status` to route incomplete research to human review. `maxHandoffChars` bounds the previous round result sent into the next round; save large evidence as artifacts and pass their IDs.
