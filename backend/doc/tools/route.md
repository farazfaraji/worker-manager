# Route Block Documentation & Usage Guide

The **Route** block defines an HTTP endpoint handler on the board's webserver. It serves as an entry point for incoming requests, validates incoming payloads against a declared TypeScript or Zod schema (`type`), and exposes typed variables to all downstream nodes on the canvas.

---

## 1. Overview & Architecture

- **Flow Entry Point**: Like the `trigger` node, a `route` block does not require an upstream input connection. It activates whenever an HTTP client calls its matching endpoint and method.
- **Typed Board Variables**: Any properties defined inside the `type` schema (e.g. `{ name: string, count: number }`) are parsed and become selectable autocomplete variables (`{{route.name}}`, `{{nodes.route_1.body.name}}`).
- **Synchronous vs Asynchronous Modes**:
  - **`sync`**: Holds the client connection open while downstream nodes execute, returning the output from an **HTTP Response** block (or the final node's result).
  - **`async`**: Immediately replies to the client with `202 Accepted` and a `runId`, executing downstream nodes in the background (ideal for webhooks).

---

## 2. Node Inputs & Configuration

| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `endpoint` | `text` | Yes | `"/api/example"` | URL path to mount (e.g. `/api/users`, `/webhook`). |
| `method` | `select` | Yes | `"POST"` | HTTP method (`POST`, `GET`, `PUT`, `DELETE`, `PATCH`). |
| `responseMode` | `select` | Yes | `"sync"` | `"sync"` (synchronous response) or `"async"` (fire-and-forget webhook). |
| `type` | `code` (ts) | No | `z.object({...})` | Zod or TypeScript schema. Declared keys become typed board variables. |

---

## 3. Node Outputs

| Output Name | Type | Description |
| :--- | :--- | :--- |
| `body` | `object` | The parsed request body (typed according to `type`). |
| `params` | `object` | Extracted URL route parameters (e.g. `:id`). |
| `query` | `object` | Parsed URL query parameters (`?query=val`). |
| `headers` | `object` | Incoming HTTP request headers. |

---

## 4. Downstream Variable Referencing

```json
{{route.query}}
{{route.name}}
{{nodes.route_1.body.name}}
{{nodes.route_1.headers.authorization}}
```
