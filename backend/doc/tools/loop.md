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
| `items` | `valueOrVariable` | Yes | `null` | Array of items to process, or an object containing an `items` array. |
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

## 7. Best Practices

1. **Set Reasonable `maxIterations`**: Always establish a conservative `maxIterations` during testing (e.g. 5–10) before scaling up to production volumes.
2. **Combine with Increment Variable**: For stateful step-by-step looping where the graph cycles back on itself, pair with an **Increment Variable** and **Condition** node to manage the iteration counter and exit condition.
