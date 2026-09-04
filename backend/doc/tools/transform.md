# Transform Tool Documentation & Usage Guide

The **Transform** node reshapes, filters, and maps in-memory data structures without external network overhead or complex scripting. It takes an input variable and applies a lightweight JavaScript expression mapping to produce a new object conforming to a defined **Zod Output Schema**.

---

## Table of Contents
1. [Overview & Architecture](#1-overview--architecture)
2. [Node Inputs & Configuration](#2-node-inputs--configuration)
3. [Mapping Expression Syntax](#3-mapping-expression-syntax)
4. [Output Schema (Zod)](#4-output-schema-zod)
5. [Outputs & Referencing in Downstream Nodes](#5-outputs--referencing-in-downstream-nodes)
6. [Comparison: Transform vs. Script vs. JSON Parser](#6-comparison-transform-vs-script-vs-json-parser)
7. [Real-World Examples & Recipes](#7-real-world-examples--recipes)
8. [Troubleshooting & Best Practices](#8-troubleshooting--best-practices)

---

## 1. Overview & Architecture

When a Transform node executes:
- **Zero-IO In-Memory Execution**: The node runs entirely in-memory with zero network or filesystem latency.
- **Expression Evaluation**: The expression configured in `mapping` is evaluated with `input` and `context` injected into scope.
- **Instant Data Reshaping**: Converts complex, nested objects from API responses, database queries, or web scrapers into clean, compact payloads tailored for downstream nodes.

---

## 2. Node Inputs & Configuration

| Input Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `input` | `variable` | Yes | `null` | Upstream variable to be reshaped (passed as `input`). |
| `mapping` | `code` (js) | Yes | `({ ... })` | JavaScript mapping expression returning the transformed object. |
| `outputType` | `code` (ts) | Yes | `z.object({...})` | Zod schema defining the output shape for downstream autocomplete. |

---

## 3. Mapping Expression Syntax

The `mapping` field is evaluated as a single expression returning a new value or object. 

### Object Literal Shorthand:
Wrap your object in parentheses `({ ... })` so JavaScript parses it as an expression:

```javascript
({
  fullName: `${input.firstName} ${input.lastName}`,
  email: input.contact.email.toLowerCase(),
  isSubscribed: Boolean(input.preferences?.newsletter),
  membershipLevel: input.loyaltyPoints > 500 ? 'Gold' : 'Standard'
})
```

### Available Scope:
- **`input`**: The variable selected in the `input` field.
- **`context`**: The full workflow state object.
- **Named upstream nodes**: All prior nodes in the graph (e.g. `trigger`, `browser_1`, `agent_qa`).

---

## 4. Output Schema (Zod)

Specify the Zod schema matching the transformed object:

```typescript
z.object({
  fullName: z.string(),
  email: z.string().email(),
  isSubscribed: z.boolean(),
  membershipLevel: z.enum(["Gold", "Standard"])
})
```

---

## 5. Outputs & Referencing in Downstream Nodes

| Output Name | Type | Description |
| :--- | :--- | :--- |
| `result` | `object` | The newly transformed object, typed by `outputType`. |

### Downstream Referencing Syntax:

```json
{{nodes.transform_1.result.fullName}}
{{nodes.transform_1.result.email}}
{{nodes.transform_1.result.membershipLevel}}
```

---

## 6. Comparison: Transform vs. Script vs. JSON Parser

| Capability | Transform | Script | JSON Parser |
| :--- | :--- | :--- | :--- |
| **Primary Goal** | Reshaping existing objects | Multi-line JS logic & computation | Parsing raw strings/files/URLs |
| **Code Style** | Single mapping expression `({ ... })` | Full function body with `return` | Declarative config (no code required) |
| **Async Operations** | Synchronous only | Supports `await` & `fetch` | Handles async remote URLs |
| **Complexity** | Low | High | Minimal |

---

## 7. Real-World Examples & Recipes

### Recipe 1: Flattening Complex API Responses
*Transform nested user details from a CRM into a simplified profile.*

```javascript
({
  userId: input.id,
  displayName: input.profile.name,
  primaryEmail: input.emails.find(e => e.primary)?.address || '',
  company: input.organization?.title || 'Individual',
  isActive: input.status === 'ACTIVE'
})
```

### Recipe 2: Web Scraping Metric Normalization
*Map scraped data from Browser node output into standardized metrics.*

```javascript
({
  sourceUrl: browser_1.result.url,
  scrapedTitle: browser_1.result.title,
  priceNumber: parseFloat(input.priceText.replace(/[^0-9.]/g, '')),
  currency: input.priceText.startsWith('$') ? 'USD' : 'EUR',
  extractedAt: new Date().toISOString()
})
```

### Recipe 3: Array Transformation & Projection
*Extract only IDs and names from an array of products.*

```javascript
({
  count: (input || []).length,
  items: (input || []).map(item => ({
    id: item.sku,
    title: item.product_name,
    inStock: item.inventory > 0
  }))
})
```

---

## 8. Troubleshooting & Best Practices

1. **Remember Parentheses Around Objects**: When returning an object literal directly in `mapping`, wrap it in parentheses: `({ key: input.value })`. Without parentheses, JavaScript interprets `{ ... }` as a code block.
2. **Defensive Access**: Always use optional chaining (`input?.data?.id`) to prevent errors if upstream fields are missing or undefined.
3. **Keep It Functional**: Avoid side effects or mutating the `input` argument; construct and return a new object instead.
