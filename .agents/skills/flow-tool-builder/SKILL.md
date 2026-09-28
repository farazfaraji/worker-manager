---
name: flow-tool-builder
description: Use when adding, updating, or debugging Flow Builder tool/node definitions (in backend/src/tools/*.json), or when extending UI form controls, dynamic field renderers, output handles, or variable referencing logic.
---

# Flow Tool Builder Skill

This skill guides the creation, modification, and UI integration of node and tool definitions in the LangGraph Flow Builder project.

---

## 1. Overview & Architecture

Tool definitions are stored as standalone JSON files in `backend/src/tools/*.json`.

```
builder/
├── backend/src/tools/
│   ├── instruction.md               # Detailed schema & conventions specification
│   ├── trigger.json                 # Flow entrypoint definition
│   ├── agent.json                   # LLM Agent node definition
│   ├── json-parser.json             # Function parser definition
│   ├── browser.json                  # Browser / App node definition
│   ├── condition.json               # Branching logic definition
│   ├── transform.json               # Data transformation definition
│   └── validator.json               # Schema validation definition
└── frontend/src/components/
    ├── palette/NodePalette.tsx      # Fetches & groups nodes by category
    ├── modal/NodeConfigModal.tsx    # Node parameter configuration dialog
    ├── modal/DynamicFieldRenderer.tsx # Renders inputs (text, textarea, select, radio, code, json, variable, valueOrVariable)
    ├── modal/VariablePicker.tsx     # Upstream variable autocomplete & selector
    ├── nodes/LangGraphCustomNode.tsx # Board node rendering & variable identifier
    └── nodes/NodeOutputHandles.tsx  # Dynamic source handles from outputs
```

---

## 2. Adding a New Tool Definition

When the user provides a JSON definition or asks to create a new tool:

### Step 1: Create the JSON File
Create `backend/src/tools/<tool-name>.json` adhering to the schema in [instruction.md](file:///Users/faraz/builder/backend/src/tools/instruction.md):

```json
{
  "name": "Tool Name",
  "type": "trigger | agent | function | app | condition | transform | validator | <custom>",
  "description": "Short description of the tool.",
  "inputs": [
    {
      "name": "outputType",
      "label": "Zod Output Schema",
      "type": "code",
      "language": "typescript",
      "required": true,
      "defaultValue": "z.object({\n  id: z.string(),\n  status: z.string()\n})",
      "placeholder": "z.object({\n  id: z.string(),\n  status: z.string()\n})",
      "helpText": "Zod schema converted to typed variables for downstream autocomplete."
    }
  ],
  "outputs": [
    {
      "name": "outputName",
      "label": "Output Label",
      "type": "object | string | number | boolean | array | branch | image",
      "schemaFrom": "outputType"
    }
  ]
}

```

### Step 2: Verify Input Types
Check if all `type` values in `inputs` are supported by [DynamicFieldRenderer.tsx](file:///Users/faraz/builder/frontend/src/components/modal/DynamicFieldRenderer.tsx):
- `text`
- `textarea`
- `select` (supports `options` or `dataSource: { type: "endpoint", url: "..." }`)
- `radio`
- `json` & `object` (with validation and format button)
- `code` (with language tag)
- `variable` (with `VariablePicker`)
- `valueOrVariable` (with literal / variable toggle)

If a new input type is introduced, add its case in `DynamicFieldRenderer.tsx`.

### Step 3: Enforce Event-Driven Outputs vs. State Variables
Follow the **Event-Driven Output Architecture** strictly:
- **Canvas Sockets / Handles = Flow Events & Branches ONLY**:
  - **Action / Execution Nodes** (e.g. `artifact`, `browser`, `retrieval`, `embedding`):
    - Must ONLY define lifecycle event outputs (`onLoad` or `done`, `onFailed` with `type: "branch"`).
    - **NEVER** expose data fields (e.g. `content`, `text`, `screenshot`, `status`, `count`) as canvas sockets. Doing so bloats node cards and clutters connection routing.
  - **Decision / Gate Nodes** (e.g. `condition`, `validator`, `human-gate`, `research-review`):
    - Must ONLY define decision branches (`true`/`false`, `approved`/`rejected`, `pass`/`needs_more_research`, etc. with `type: "branch"`).
  - **Orchestrator Nodes**:
    - Dispatches to child worker handles (`agent_1`, `agent_2`, ...) and a dedicated `done` handle invoked once after all jobs conclude.
- **Data Payloads = State Variables**:
  - Node outputs are automatically saved to execution context (`context[nodeName]`) and referenced downstream via `{{nodeName.fieldName}}`.
  - When creating or modifying tools with rich payloads, register their properties in:
    1. [`graphs.service.ts`](file:///Users/faraz/builder/backend/src/graphs/graphs.service.ts) (`nodeProducedPathsMap` and `validHandles`).
    2. [`variable-utils.ts`](file:///Users/faraz/builder/frontend/src/lib/variable-utils.ts) (`extractAvailableVariables`).
- **Handle Visuals & Spatial Placement**:
  - The two primary status/lifecycle handles (`onLoad`/`done`, `onFailed`/`error`, `approved`/`rejected`, `true`/`false`) are positioned at the bottom of the card (`Position.Bottom`) in a clean 2-button grid with centered connection dots.
  - All remaining dispatch/branch handles (e.g. `agent_1`, `agent_2`, `agent_3`, `agent_4`) are positioned along the sides, alternating between Left (`Position.Left`) and Right (`Position.Right`).
  - Edges route with smooth 90° orthogonal step connections (`StraightWaypointEdge`) directly into target nodes' top handle (`Position.Top`).

### Step 4: Verify Category & Icons
Check if the node's `type` maps to a suitable category and icon:
- `trigger` → **Flow**
- `agent` → **Agent**
- `function`, `transform` → **Function**
- `app`, `browser` → **App**
- `condition`, `validator` → **Logic**

If a custom type or icon is needed, check `getCategory` in [node-definitions.service.ts](file:///Users/faraz/builder/backend/src/node-definitions/node-definitions.service.ts) and `getNodeIcon` in [LangGraphCustomNode.tsx](file:///Users/faraz/builder/frontend/src/components/nodes/LangGraphCustomNode.tsx).

---

## 3. Testing & Verification Checklist

1. Verify backend serves the new definition:
   ```bash
   curl -s http://localhost:6300/api/node-definitions
   ```
2. Open frontend at `http://localhost:6301`:
   - Verify the tool appears in the left `NodePalette` with correct icon, category, and description.
   - Drag or click to add it onto the React Flow canvas.
   - Click the node on the board to open `NodeConfigModal`.
   - Test `dependsOn` conditional visibility (if applicable).
   - Test variable autocomplete with upstream nodes.
   - Save configuration and verify parameters persist in `node.data.config`.
   - Connect output handles to another node's input.
   - Save graph to MongoDB (Save / Save As) and reload to confirm full persistence.

## Research node changes

When updating a research node, update its JSON definition, runtime dispatch, output normalization, branch handles, and the relevant guide in `backend/doc/tools/`. JSON metadata alone does not implement execution. For `research-review`, expose source-check results; for `orchestrator`, preserve research output and tool-step limits; for child flows with human gates, keep resume state and idempotent child run keys.
