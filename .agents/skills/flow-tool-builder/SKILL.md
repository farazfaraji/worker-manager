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
│   ├── brower.json                  # Browser / App node definition
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
Create `backend/src/tools/<tool-name>.json` adhering to the schema in [instruction.md](backend/src/tools/instruction.md):

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
Check if all `type` values in `inputs` are supported by [DynamicFieldRenderer.tsx](frontend/src/components/modal/DynamicFieldRenderer.tsx):
- `text`
- `textarea`
- `select` (supports `options` or `dataSource: { type: "endpoint", url: "..." }`)
- `radio`
- `json` & `object` (with validation and format button)
- `code` (with language tag)
- `variable` (with `VariablePicker`)
- `valueOrVariable` (with literal / variable toggle)

If a new input type is introduced, add its case in `DynamicFieldRenderer.tsx`.

### Step 3: Verify Output Types & Handles
Check if all items in `outputs` render appropriately in [NodeOutputHandles.tsx](frontend/src/components/nodes/NodeOutputHandles.tsx):
- Branch types (`type: "branch"`, e.g. `true`/`false`, `valid`/`invalid`) receive colored badges.
- Data sockets receive clean output sockets with IDs matching `output.name`.

### Step 4: Verify Category & Icons
Check if the node's `type` maps to a suitable category and icon:
- `trigger` → **Flow**
- `agent` → **Agent**
- `function`, `transform` → **Function**
- `app`, `browser` → **App**
- `condition`, `validator` → **Logic**

If a custom type or icon is needed, check `getCategory` in [node-definitions.service.ts](backend/src/node-definitions/node-definitions.service.ts) and `getNodeIcon` in [LangGraphCustomNode.tsx](frontend/src/components/nodes/LangGraphCustomNode.tsx).

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
