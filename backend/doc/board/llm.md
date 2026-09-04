# Board Builder Skill

Use this guide when asked to create or change a Flow Board. Build the workflow's **meaning**; the board engine builds its visual shape.

## Core contract

- Use the available board functions or graph API to create nodes and connect them. Do not manually assemble a large React Flow canvas payload unless explicitly asked.
- Create semantic `nodes` and `edges` only. Never generate `position`, `viewport`, `animated`, `style`, selection state, dimensions, or routing data.
- The backend graph-shape engine stores canvas data separately in `layout` and recreates React Flow nodes and edges when a graph is loaded.
- Use stable, descriptive IDs and unique `data.name` / `data.nodeName` values. These names are the variable namespaces used by downstream nodes.
- Read the selected tool's definition before configuring it. Do not invent configuration keys or output handles.

## Board-building workflow

1. Identify the trigger and the intended outcome.
2. List the minimum nodes needed, in execution order.
3. Create each node with its tool type, unique name, label, and configuration.
4. Connect the nodes with directed edges.
5. Add branches only when the workflow has genuinely different outcomes.
6. Validate the board before saving. Fix invalid variable references, missing nodes, duplicate branch edges, and disconnected steps.

Prefer a small, understandable graph. Use a subgraph when a section has its own reusable purpose.

## Semantic graph shape

Use this shape for a new graph. The server enriches node outputs and produces layout automatically.

```json
{
  "name": "Summarize support ticket",
  "projectId": "<project-id>",
  "nodes": [
    {
      "id": "manual_trigger",
      "type": "langgraphNode",
      "data": {
        "name": "trigger",
        "nodeName": "trigger",
        "definitionType": "trigger",
        "definitionName": "Trigger",
        "label": "Start",
        "config": {
          "triggerType": "manual"
        }
      }
    },
    {
      "id": "summarize_ticket",
      "type": "langgraphNode",
      "data": {
        "name": "summarize_ticket",
        "nodeName": "summarize_ticket",
        "definitionType": "agent",
        "definitionName": "Agent",
        "label": "Summarize ticket",
        "config": {
          "userPrompt": "Summarize this ticket: {{trigger.input.ticket}}",
          "outputFormat": "text"
        }
      }
    }
  ],
  "edges": [
    {
      "id": "trigger_to_summary",
      "source": "manual_trigger",
      "sourceHandle": "input",
      "target": "summarize_ticket"
    }
  ]
}
```

Do not include a `layout` object when building a new board. It is generated and maintained by the server. A human-edited layout may be returned on later reads; preserve it unless the user requests rearrangement.

## Connections and variables

- An edge always goes from the upstream node ID (`source`) to the downstream node ID (`target`).
- For ordinary nodes, use the output handle defined by the tool when one is known.
- A `condition` node must use `sourceHandle: "true"` or `sourceHandle: "false"`.
- A `router` node must use the configured route name or `default` as its `sourceHandle`.
- Reference upstream values with `{{node_name.output}}`, for example `{{summarize_ticket.text}}`.
- A node may only reference values that are available earlier on a connected execution path.

## Loops, retries, and large boards

- Do not make an edge point back to an earlier node. The current runner requires an acyclic executable graph and rejects cycles.
- For bounded collection work, use `loop` to prepare items or `foreach` with a child subgraph to run work per item. Always set a sensible iteration cap.
- Model retries with a node's execution policy (`maxAttempts`, `backoffMs`, and `timeoutMs`) when supported, rather than a visual back-edge.
- Split complex sections into subgraphs instead of producing a large, tangled parent board.

## Before saving

Check all of the following:

- Exactly one clear entry trigger, unless the requested design needs multiple entrypoints.
- Every node ID and node name is unique.
- Every edge points to an existing node.
- Branch handles match the originating tool.
- Variable references are upstream and valid.
- The graph is connected and has no cycles.
- No React Flow layout fields were generated.
