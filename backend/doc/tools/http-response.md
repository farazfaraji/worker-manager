# HTTP Response Block Documentation & Usage Guide

The **HTTP Response** block sends a custom HTTP response back to the client that invoked a synchronous **Route** block.

---

## 1. Overview & Architecture

When a client sends a request to a synchronous Route endpoint, the client waits for the response. When the flow execution path reaches the **HTTP Response** block:
1. It resolves the pending client connection with the configured status code, headers, and body payload.
2. Variable references (`{{nodes.agent_1.result}}` or `{{transform.data}}`) are resolved and formatted.
3. Execution continues down any remaining nodes in the flow.

---

## 2. Node Inputs & Configuration

| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `statusCode` | `select` | Yes | `"200"` | HTTP response status code (`200`, `201`, `400`, `404`, `500`). |
| `responseBody` | `valueOrVariable` | No | `{ mode: "variable", value: "" }` | Data to send back to client (accepts board variables or literal JSON/text). |
| `headers` | `json` | No | `{"Content-Type": "application/json"}` | Custom response headers. |

---

## 3. Node Outputs

| Output Name | Type | Description |
| :--- | :--- | :--- |
| `sent` | `boolean` | `true` if the HTTP response was successfully dispatched. |
| `response` | `object` | The exact response payload returned to the client. |
