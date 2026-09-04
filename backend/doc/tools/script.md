# Script Tool Documentation & Usage Guide

The **Script** node executes custom JavaScript functions within your flow workflows. It gives you the full power of JavaScript for custom business logic, computations, data parsing, array operations, regex manipulation, and asynchronous workflows, paired with a typed **Zod Output Schema** for downstream autocomplete.

---

## Table of Contents
1. [Overview & Architecture](#1-overview--architecture)
2. [Node Inputs & Configuration](#2-node-inputs--configuration)
3. [Script Execution Environment & Global Scope](#3-script-execution-environment--global-scope)
4. [Defining Zod Output Schemas](#4-defining-zod-output-schemas)
5. [Outputs & Referencing in Downstream Nodes](#5-outputs--referencing-in-downstream-nodes)
6. [Real-World Examples & Recipes](#6-real-world-examples--recipes)
   - [Data Aggregation & Filtering](#recipe-1-data-aggregation--filtering)
   - [HTML / Text Cleaning & Regex Extraction](#recipe-2-html--text-cleaning--regex-extraction)
   - [Date & Timestamp Formatting](#recipe-3-date--timestamp-formatting)
   - [Async HTTP Fetch / External API](#recipe-4-async-http-fetch--external-api)
7. [Troubleshooting & Best Practices](#7-troubleshooting--best-practices)

---

## 1. Overview & Architecture

When a Script node executes:
- **Scope Injection**: The runtime injects the designated `input` variable, the flow's `context` object, and exposes every upstream node as a named global variable in the script function.
- **Asynchronous Execution**: Scripts are executed within an `async` wrapper, supporting `await`, Promises, and async operations.
- **Typed Output Normalization**: The object returned by the script is validated against the node's `outputType` schema and stored in flow state as `nodeName.result`.

---

## 2. Node Inputs & Configuration

| Input Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `input` | `variable` | No | `null` | Upstream variable passed into the function as the `input` argument. |
| `code` | `functionCode` | Yes | Sample JS snippet | JavaScript code executed by the node. |
| `outputType` | `code` (ts) | Yes | `z.object({...})` | Zod schema defining the output shape for downstream variable autocomplete. |

---

## 3. Script Execution Environment & Global Scope

Inside your script code, the following arguments are in direct scope:

### 1. `input`
The value of the variable selected in the **Input Variable** picker. If no input variable was selected, `input` defaults to the immediate predecessor's output.

### 2. `context`
The global workflow state dictionary containing inputs, variables, and previous node execution results.

### 3. Upstream Nodes as Direct Named Variables
Every preceding node is injected into local scope using its sanitized node name (e.g. `agent_1`, `browser_1`, `trigger`):

```javascript
// Accessing upstream nodes directly by name
const pageTitle = browser_1?.result?.title;
const agentSummary = agent_1?.result?.summary;
```

---

## 4. Defining Zod Output Schemas

Defining a Zod schema in `outputType` automatically exposes strongly-typed fields to subsequent nodes in the visual flow builder:

```typescript
z.object({
  totalCount: z.number(),
  items: z.array(z.string()),
  processedAt: z.string(),
  success: z.boolean()
})
```

Your script must return an object matching this structure:

```javascript
return {
  totalCount: items.length,
  items: items.map(i => i.title),
  processedAt: new Date().toISOString(),
  success: true
};
```

---

## 5. Outputs & Referencing in Downstream Nodes

| Output Name | Type | Description |
| :--- | :--- | :--- |
| `result` | `object` | The object returned by the script execution, typed by `outputType`. |

### Variable Reference Syntax:
- `{{nodes.script_1.result.totalCount}}`
- `{{nodes.script_1.result.items[0]}}`
- `{{nodes.script_1.result.processedAt}}`

---

## 6. Real-World Examples & Recipes

### Recipe 1: Data Aggregation & Filtering
*Process a list of products extracted from a web page and calculate total stock and high-value items.*

```javascript
// Input: array of product objects from upstream parser or agent
const products = Array.isArray(input) ? input : [];

const inStock = products.filter(p => Number(p.stock) > 0);
const highValue = inStock.filter(p => Number(p.price) >= 100);
const totalValue = inStock.reduce((acc, p) => acc + (Number(p.price) * Number(p.stock)), 0);

return {
  totalItems: products.length,
  inStockCount: inStock.length,
  highValueCount: highValue.length,
  totalStockValue: Math.round(totalValue * 100) / 100
};
```
**Zod Schema:**
```typescript
z.object({
  totalItems: z.number(),
  inStockCount: z.number(),
  highValueCount: z.number(),
  totalStockValue: z.number()
})
```

---

### Recipe 2: HTML / Text Cleaning & Regex Extraction
*Extract email addresses, phone numbers, and clean up messy scraped text.*

```javascript
const rawText = String(input || '');

const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const phoneRegex = /\+?[0-9]{1,3}?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g;

const emails = Array.from(new Set(rawText.match(emailRegex) || []));
const phones = Array.from(new Set(rawText.match(phoneRegex) || []));
const cleanedText = rawText.replace(/\s+/g, ' ').trim();

return {
  emails,
  phones,
  wordCount: cleanedText.split(' ').length,
  cleanedText: cleanedText.substring(0, 500)
};
```
**Zod Schema:**
```typescript
z.object({
  emails: z.array(z.string()),
  phones: z.array(z.string()),
  wordCount: z.number(),
  cleanedText: z.string()
})
```

---

### Recipe 3: Date & Timestamp Formatting
*Generate standard timestamps and calculate deadlines.*

```javascript
const now = new Date();
const deadline = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000)); // +7 days

return {
  timestampIso: now.toISOString(),
  dateFormatted: now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
  deadlineIso: deadline.toISOString(),
  deadlineFormatted: deadline.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
};
```
**Zod Schema:**
```typescript
z.object({
  timestampIso: z.string(),
  dateFormatted: z.string(),
  deadlineIso: z.string(),
  deadlineFormatted: z.string()
})
```

---

### Recipe 4: Async HTTP Fetch / External API
*Perform an asynchronous HTTP request using global `fetch`.*

```javascript
const targetUrl = 'https://httpbin.org/json';
const response = await fetch(targetUrl);
const data = await response.json();

return {
  slideshowTitle: data?.slideshow?.title || 'Unknown',
  author: data?.slideshow?.author || 'Anonymous',
  slidesCount: (data?.slideshow?.slides || []).length
};
```
**Zod Schema:**
```typescript
z.object({
  slideshowTitle: z.string(),
  author: z.string(),
  slidesCount: z.number()
})
```

---

## 7. Troubleshooting & Best Practices

1. **Always Return an Object**: If your script returns a primitive value (like a bare string or number), wrap it in an object property (e.g. `{ value: result }`) to match your Zod schema.
2. **Safe Navigation (`?.`)**: Upstream nodes might be skipped or return null on failure; always use optional chaining when accessing nested properties (e.g., `input?.data?.items`).
3. **Async Support**: Use standard `await` syntax directly in your code without defining an outer `async function` wrapper, as the execution engine handles the async boundary.
