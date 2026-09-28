# Board Builder Skill

Use this guide when asked to create or change a Flow Board. Build the workflow's **meaning**; the board engine builds its visual shape.

## Core contract

- Use the available board functions or graph API to create nodes and connect them. Do not manually assemble a large React Flow canvas payload unless explicitly asked.
- Create canonical `flow.blocks` and `flow.connections` only. Never generate React Flow `nodes`, `edges`, `position`, `viewport`, `animated`, `style`, selection state, dimensions, or routing data.
- The backend graph-shape engine stores canvas data separately in `layout` and recreates React Flow nodes and edges when a graph is loaded.
- Use stable, descriptive IDs and unique block `name` values. These names are the variable namespaces used by downstream blocks.
- Read the selected tool's definition before configuring it. Do not invent configuration keys or output handles.

## Board-building workflow

1. Identify the trigger and the intended outcome.
2. List the minimum nodes needed, in execution order.
3. Create each block with its tool type, unique name, label, and configuration.
4. Connect the blocks with directed connections.
5. Add branches only when the workflow has genuinely different outcomes.
6. Validate the board before saving. Fix invalid variable references, missing nodes, duplicate branch edges, and disconnected steps.

Prefer a small, understandable graph. Use a subgraph when a section has its own reusable purpose.

## Semantic graph shape

Use this shape for a new graph. The server compiles it to the runtime and React Flow representations, enriches node outputs, and produces layout automatically.

```json
{
  "name": "Summarize support ticket",
  "projectId": "<project-id>",
  "flow": {
    "version": 1,
    "blocks": [
      {
        "id": "manual_trigger",
        "kind": "trigger",
        "name": "trigger",
        "definitionName": "Trigger",
        "label": "Start",
        "config": {
          "triggerType": "manual"
        }
      },
      {
        "id": "summarize_ticket",
        "kind": "agent",
        "name": "summarize_ticket",
        "definitionName": "Agent",
        "label": "Summarize ticket",
        "config": {
          "userPrompt": "Summarize this ticket: {{trigger.input.ticket}}",
          "outputFormat": "text"
        }
      }
    ],
    "connections": [
      {
        "id": "trigger_to_summary",
        "from": "manual_trigger",
        "output": "input",
        "to": "summarize_ticket"
      }
    ]
  }
}
```

Do not include a `layout` object when building a new board. It is generated and maintained by the server. A human-edited layout may be returned on later reads; preserve it unless the user requests rearrangement.

## Connections and variables

- A connection always goes from the upstream block ID (`from`) to the downstream block ID (`to`).
- Use the tool's output name in `connection.output` when one is known:
  - `condition` / `validator`: MUST use `output: "true"` or `output: "false"`.
  - `router`: MUST use the configured route name or `default`.
  - `webserver`: Connects to `route` blocks using `output: "routes"`.
  - Single/Multi-output blocks: Use the specific output name (e.g. `body`, `query`, `result`, `artifactId`) or `flow`.
- Every block in an execution pipeline must be connected in `connections` without gaps (e.g., `route` -> `script` -> `artifact` -> `embedding` -> `http-response`). Even when downstream blocks reference earlier variables with `{{...}}`, the execution engine strictly relies on connections to determine execution order.
- Never add duplicate connections between the same pair of nodes (unless condition or router branches).
- Reference upstream values with `{{node_name.output}}`, for example `{{summarize_ticket.text}}` or `{{post_plans.body.title}}`.
- A node may only reference values that are available earlier on a connected execution path.

## State hygiene (Embeddings & Vector search)

- Never store raw float embedding vectors in graph state on add (`embedding`) or get (`retrieval`).
- Embeddings are stored out-of-band in the vector database collection, while graph node outputs only retain clean metadata (`dimensions`, `indexedChunks`, `artifactId`, `count`, `score`, `text`, `metadata`).
- Downstream HTTP response nodes and frontend clients consume text, context, or structured results without vector array bloat.

## Loops, retries, and large boards

- Do not make an edge point back to an earlier node. The current runner requires an acyclic executable graph and rejects cycles.
- For bounded collection work, use `loop` to prepare items or `foreach` with a child subgraph to run work per item. Always set a sensible iteration cap.
- Model retries with a node's execution policy (`maxAttempts`, `backoffMs`, and `timeoutMs`) when supported, rather than a visual back-edge.
- Split complex sections into subgraphs instead of producing a large, tangled parent board.

## Before saving

Check all of the following:

- Exactly one clear entry trigger (or a `webserver` block connected to `route` blocks for HTTP services).
- Every block ID and block name is unique.
- Every connection points to an existing block.
- Branch outputs match the originating tool.
- Every step in the execution chain is connected without missing intermediate links.
- No duplicate connections exist between the same pair of blocks.
- Variable references are upstream and valid.
- The graph is connected and has no cycles.
- No React Flow layout fields were generated.
