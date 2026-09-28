# Flow Builder Tool Definition Specification & Frontend Integration

This document defines the schema, conventions, and frontend architecture for adding, modifying, and rendering tool/node definitions in the Flow Builder.

---

## 1. File Structure & Backend Discovery

Each file in `backend/src/tools/*.json` is a valid JSON file representing a single node or tool definition in the Flow Builder.

### Top-Level Schema

```json
{
  "name": "Human-readable Name",
  "type": "trigger | agent | function | app | condition | transform | validator | subgraph | <custom_type>",
  "description": "Short description of what the node does.",
  "inputs": [ ... ],
  "outputs": [ ... ]
}
```

- **`name`** *(string, required)*: The display name shown in the left Node Palette and on the node header (e.g., `"Json Parser"`, `"Agent"`, `"Subgraph"`).
- **`type`** *(string, required)*: The functional type of the node. Automatically mapped to categories in [node-definitions.service.ts](backend/src/node-definitions/node-definitions.service.ts):
  - `trigger`, `subgraph` → **Flow**
  - `agent` → **Agent**
  - `function`, `transform`, `variable`, `set-variable`, `script` → **Function**
  - `app`, `browser`, `brower` → **App**
  - `condition`, `validator` → **Logic**
- **`description`** *(string, required)*: Short description shown as tooltip and card subtitle in the palette.
- **`inputs`** *(array, required)*: Array of input field descriptors rendered in the node configuration modal.
- **`outputs`** *(array, required)*: Array of output handle descriptors rendered on the canvas node.

---

## 2. Input Field Specifications (`inputs`)

Each item in the `inputs` array defines a configurable field in `NodeConfigModal`:

```json
{
  "name": "fieldName",
  "label": "Field Display Label",
  "type": "text | textarea | select | radio | json | code | functionCode | variable | valueOrVariable | object",
  "required": true,
  "defaultValue": "...",
  "placeholder": "...",
  "options": [
    { "label": "Option Label", "value": "optionValue" }
  ],
  "language": "typescript | javascript | python | json",
  "helpText": "Helpful guidance displayed beneath the field.",
  "accepts": ["string", "number", "boolean", "object", "array"],
  "dependsOn": {
    "field": "otherFieldName",
    "equals": "expectedValue"
  },
  "dataSource": {
    "type": "endpoint",
    "url": "/api/agents",
    "labelKey": "name",
    "valueKey": "id"
  }
}
```

### Supported Input Types

| Type | Description | Rendered Component |
| :--- | :--- | :--- |
| `text` | Single-line text string | Standard `<input type="text">` |
| `textarea` | Multi-line text string | Multiline `<textarea>` |
| `select` | Dropdown selection | `<select>` with `options` or loaded from `dataSource` |
| `radio` | Single-choice radio buttons | Styled radio button pills |
| `json` / `object` | JSON structure | Textarea with syntax validator and "Format JSON" button |
| `code` | Code snippet | Syntax-highlighted code editor box with monospace font and language tag |
| `functionCode` | Protected JS function | Highlighted JS editor with static `function run(input) {` signature and static `}` closing |
| `variable` | Upstream flow variable reference | `VariablePicker` with autocomplete (`parser.value`, etc.) |
| `valueOrVariable` | Toggle between literal value or variable | Toggleable mode switcher between text and `VariablePicker` |

### Prompt Revision (`canRevise`)

Textarea inputs supporting AI prompt refinement declare `"canRevise": true` (e.g. `systemPrompt` in `agent.json`). This renders a **Revise** action button beside the field label which invokes the **Flow Helper LLM** configured in Settings (with customizable instructions and one-click presets) to structure, optimize, and improve the prompt.

### Output Schema AI Synthesis (`supportsAiGenerator`)

Code inputs defining schemas (e.g. `outputType` in `agent.json`) declare `"supportsAiGenerator": true`. This renders a two-tab interface in the configuration modal:
1. **Schema Code**: Direct syntax-highlighted code editor for Zod / TypeScript schema definitions.
2. **Explain & Generate (AI)**: Natural language generator tab where users explain their desired data structure in plain English, choose quick templates, and invoke the **Type Generator LLM** (configured in Settings) to synthesize production-ready Zod schemas automatically with `.strict()`, validations, and `.describe()` annotations.

### Conditional Visibility (`dependsOn`)

Fields dynamically appear or disappear based on the value of another input field:

```json
{
  "name": "filePath",
  "label": "File Path",
  "type": "text",
  "required": true,
  "dependsOn": {
    "field": "sourceType",
    "equals": "path"
  }
}
```

### Dynamic Data Sources (`dataSource`)

For dropdowns populated from backend APIs (e.g., `/api/agents`, `/api/graphs`):

```json
{
  "name": "graphId",
  "label": "Select Graph",
  "type": "select",
  "dataSource": {
    "type": "endpoint",
    "url": "/api/graphs",
    "labelKey": "name",
    "valueKey": "id"
  }
}
```

---

## 3. Output Handle & Connector Specifications (`outputs`)

- **Connector Rules**:
  - **Standard Blocks** (`agent`, `transform`, `function`, `app`, `subgraph`, `variable`): Exactly **1 input connector** (top target) and **1 output connector** (bottom source). Trigger has 0 inputs (flow entrypoint) and 1 output.
  - **Logic & Branching Blocks** (`condition`, `validator`): **1 input connector** (top target) and **2 output connectors** (`true` and `false` branch source handles).

Each item in `outputs` defines a connectable React Flow Source Handle on the node:

```json
{
  "name": "result",
  "label": "Result",
  "type": "object | string | number | boolean | array | branch | image",
  "schemaFrom": "outputType"
}
```

- **`name`** *(string, required)*: Handle identifier. Used when connecting edges and referencing output variables (e.g. `parser.value`, `agent.result`).
- **`label`** *(string)*: Display name shown on the node's output socket.
- **`type`** *(string)*:
  - `branch`: Creates dedicated branch connection sockets (`true`/`false`) with colored badges.
  - `object`, `string`, `number`, `array`, `image`: Standard single output data socket.
- **`schemaFrom`** *(string, optional)*: Names the input field containing the TypeScript type definition (e.g., `"outputType"` or `"inputSchema"`). The frontend parses this schema to autocomplete nested fields.

---

## 4. Frontend Architecture & Component Map

The frontend dynamic rendering system is structured into modular components in `frontend/src/`:

```
frontend/src/
├── components/
│   ├── palette/
│   │   └── NodePalette.tsx          # 1. Fetches & displays tools by category
│   ├── nodes/
│   │   ├── LangGraphCustomNode.tsx  # 2. Node canvas card, icons, variable tags
│   │   └── NodeOutputHandles.tsx   # 3. Dynamic output sockets & branch handles
│   ├── modal/
│   │   ├── NodeConfigModal.tsx     # 4. Main parameter configuration modal
│   │   ├── DynamicFieldRenderer.tsx # 5. Renders individual input controls
│   │   └── VariablePicker.tsx      # 6. Upstream variable autocomplete picker
│   └── FlowBoard.tsx               # 7. React Flow canvas wrapper & drag-and-drop
└── lib/
    ├── types.ts                    # TypeScript definitions (ToolInput, ToolOutput, FlowNodeData)
    ├── api.ts                      # Backend fetch clients (/api/node-definitions, /api/graphs)
    └── variable-utils.ts           # Upstream variable extraction & TypeScript schema parser
```

---

## 5. Node Data Structure on the Canvas

When a node is added to the React Flow board (via drag-and-drop or clicking the palette), its `node.data` is structured as:

```ts
{
  definitionType: "agent",       // matches JSON "type"
  definitionName: "Agent",       // matches JSON "name"
  label: "UI Reviewer",          // user-editable display title
  nodeName: "reviewer",          // unique variable identifier for referencing outputs
  config: {                      // key-value map of configured parameters
    model: "default",
    systemPrompt: "You are a reviewer...",
    input: "parser.value"
  },
  inputs: [ ... ],               // cloned input definitions from JSON
  outputs: [ ... ]               // cloned output definitions from JSON
}
```

### Unique Variable Identifiers (`nodeName`)
- Automatically generated on node creation (e.g., `parser`, `agent`, `browser`, `agent_2`).
- Shown on the node card as `$parser` or `$reviewer`.
- Used to reference node outputs in downstream nodes (e.g., `reviewer.findings`, `parser.value.type`).

---

## 6. How the UI Renders Each Part

### A. Node Palette (`NodePalette.tsx`)
- Fetches all definitions from `GET /api/node-definitions`.
- Groups them dynamically into `Flow`, `Agent`, `Function`, `App`, `Logic` based on `definition.category`.
- Provides instant search filtering across name, description, and category.
- Dragging sets `application/reactflow/definition` payload; clicking adds the node directly.

### B. Canvas Node (`LangGraphCustomNode.tsx` & `NodeOutputHandles.tsx`)
- **Target Handle**: Rendered at the top for all nodes except `trigger`.
- **Header**: Shows category icon ([getNodeIcon](frontend/src/components/nodes/LangGraphCustomNode.tsx)), editable label, and delete button.
- **Body**: Shows variable tag (`$nodeName`) and number of configured parameters.
- **Source Handles**: Rendered dynamically at the bottom from `data.outputs`:
  - Single output: centered at bottom.
  - Multiple outputs: distributed horizontally with socket labels (`true`/`false`, `valid`/`invalid`, `error`, `value`, `screenshot`).

### C. Config Modal & Field Rendering (`NodeConfigModal.tsx` & `DynamicFieldRenderer.tsx`)
- Clicking any node on the board opens `NodeConfigModal`.
- **Display Label & Variable Identifier**: Can be edited directly at the top.
- **Inputs**: Loops over `inputs` and calls `DynamicFieldRenderer`:
  - Evaluates `dependsOn: { field: "...", equals: "..." }` in real-time against `formValues`.
  - For `select` with `dataSource`, fetches options asynchronously.
  - For `variable` or `valueOrVariable`, mounts `VariablePicker`.
  - For `json`/`object`, checks JSON validity and enables one-click formatting.
  - For `code`, provides monospace textarea with language badge.
- **Outputs Preview**: Displays list of produced output variables with their types.
- **Saving**: Updates `node.data.config`, `node.data.label`, and `node.data.nodeName` without losing canvas state.

### D. Variable Resolution (`VariablePicker.tsx` & `variable-utils.ts`)
- [extractAvailableVariables](frontend/src/lib/variable-utils.ts) walks all other nodes in the graph.
- Generates paths: `{nodeName}.{outputName}` (e.g. `parser.value`, `browser.screenshot`).
- If an output has `schemaFrom: "outputType"`, it parses the TypeScript schema (e.g. `{ summary: string, findings: Finding[] }`) to generate nested paths (e.g. `reviewer.result.summary`, `reviewer.result.findings`).

---

## 7. Adding New UI Controls or Node Types (Extensibility Guide)

When adding a tool that requires a new input control or visual behavior:

1. **Add new input control**:
   - Open [DynamicFieldRenderer.tsx](frontend/src/components/modal/DynamicFieldRenderer.tsx).
   - Add a new `case 'myNewType':` in `renderFieldControl()`.
2. **Add new icon or category**:
   - In [node-definitions.service.ts](backend/src/node-definitions/node-definitions.service.ts), add your type to `getCategory()`.
   - In [LangGraphCustomNode.tsx](frontend/src/components/nodes/LangGraphCustomNode.tsx), add an icon case in `getNodeIcon()`.
3. **Add custom handle colors**:
   - In [NodeOutputHandles.tsx](frontend/src/components/nodes/NodeOutputHandles.tsx), add custom styling conditions for new output types.

---

## 8. Node Output Schema Persistence in Graphs

When creating or updating a graph (`POST /api/graphs`, `PUT /api/graphs/:id`), the backend and frontend automatically extract and persist the static output schema and metadata for each node inside `node.data.outputs`:

```ts
{
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    name: string;
    definitionType: string;
    config: Record<string, unknown>;
    outputs: Array<{
      name: string;
      label?: string;
      type: string;
      schema?: Record<string, any>;
    }>;
  };
}
```

- **Runtime state values are NOT stored**; only static output definitions and parsed schema metadata are persisted.
- If an output has `schemaFrom` (e.g. `outputType`, `inputSchema`), the TypeScript/JSON schema is parsed into a structured object (`{ [key: string]: string | object }`) and stored under `schema`.

---

## 9. Upstream Variables API Endpoint

Retrieves all upstream ancestor variables available to a specific block within a graph DAG:

- **Route**: `GET /api/graphs/:graphId/blocks/:blockId/variables`
- **Response**:
```json
{
  "graphId": "graph-id",
  "blockId": "node-id",
  "variables": [
    {
      "nodeId": "node_parser",
      "nodeName": "parser",
      "outputName": "value",
      "path": "parser.value",
      "type": "object",
      "schema": {
        "type": "string",
        "name": "string"
      }
    },
    {
      "nodeId": "node_parser",
      "nodeName": "parser",
      "outputName": "value",
      "path": "parser.value.type",
      "type": "string"
    }
  ]
}
```
- **Error Codes**:
  - `404 Graph not found`
  - `404 Block not found`
  - `400 Block does not belong to this graph`

---

## 10. Variable Reference Validation

Before saving (`POST /api/graphs`, `PUT /api/graphs/:id`) or executing a graph DAG, all variable references in node configs are validated:

- **Validation Rules**:
  1. **Self-reference**: A node referencing its own outputs is rejected.
  2. **Non-existent node**: A node referencing a block that does not exist in the graph is rejected.
  3. **Downstream / Non-upstream reference**: A node referencing a downstream block or an independent unmerged parallel branch is rejected.
  4. **Invalid output path**: A node referencing an output or nested property not declared in the upstream node's definition or schema is rejected.

- **Validation Error Format (`400 Bad Request`)**:
```json
{
  "message": "Invalid variable reference",
  "path": "parser.value.type",
  "blockId": "node-id",
  "reason": "Referenced node is not upstream"
}
```

- **Validation Endpoints**:
  - `POST /api/graphs/validate`
  - `POST /api/graphs/:id/validate`

---

## 11. Set Variable Tool Definition (`set-variable.json`)

The **Set Variable** block sets a variable into the board state for downstream flow blocks.

### Inputs
1. **`key`** (`text`, required): Textbox for the variable key name (e.g. `status`, `user_query`, `payload`).
2. **`value`** (`text`, required): Textbox for the assigned value (e.g. `active`, `100`, `hello world`).

> [!NOTE]
> No manual `Output Schema` is required. The system automatically stores and resolves `{ [key]: value }` as the output schema for this block in the database and across downstream variable autocompletions.

### Connectors & Outputs
- **Input Connector**: 1 target handle at top.
- **Output Connector**: 1 source handle at bottom (`value`, type: `object`). Downstream nodes can reference this variable via `$nodeName.value` or `$nodeName.value.{key}`.

---

## 12. Script Tool Definition (`script.json`)

The **Script** block executes custom JavaScript code with variable inputs and defined output schema.

### Inputs
1. **`input`** (`variable`, optional): Upstream flow variable selector passed directly as the `input` argument into `run(input)`.
2. **`code`** (`functionCode`, `javascript`, required): Custom JavaScript function body. Rendered inside a protected wrapper with static `function run(input) {` at the top and static `}` at the bottom, equipped with PrismJS colorful syntax highlighting.
3. **`outputType`** (`code`, `typescript`, required): TypeScript / JSON schema defining the returned object structure for downstream variable resolution.

### Connectors & Outputs
- **Input Connector**: 1 target handle at top.
- **Output Connector**: 1 source handle at bottom (`result`, type: `object`, `schemaFrom: "outputType"`). Downstream nodes reference properties directly via `$nodeName.{property}` (e.g. `$component_selector.id`) or the intact whole object via `$nodeName`.

---

## 13. Increment Variable Tool Definition (`increment-variable.json`)

The **Increment Variable** block takes an upstream numeric variable, adds a specified numeric amount (default: 1), and emits the updated numeric value.

### Inputs
1. **`variable`** (`variable`, required): Variable selector to choose an upstream numeric variable (e.g., `set_var.value.counter`, `init_num.value`).
2. **`amount`** (`number`, required, default: `"1"`): The numeric amount to add.

> [!IMPORTANT]
> **Runtime Numeric Validation**: During execution, the target variable must resolve to a valid number (or numeric string like `"10"`). If the variable is non-numeric, null, or undefined, execution safely halts with a descriptive error in the run record.

### Connectors & Outputs
- **Input Connector**: 1 target handle at top.
- **Output Connector**: 1 source handle at bottom (`value`, type: `number`). Downstream nodes can reference this variable via `$nodeName.value`.

---

## 14. Decrement Variable Tool Definition (`decrement-variable.json`)

The **Decrement Variable** block takes an upstream numeric variable, subtracts a specified numeric amount (default: 1), and emits the updated numeric value.

### Inputs
1. **`variable`** (`variable`, required): Variable selector to choose an upstream numeric variable (e.g., `set_var.value.counter`, `counter_node.value`).
2. **`amount`** (`number`, required, default: `"1"`): The numeric amount to subtract.

> [!IMPORTANT]
> **Runtime Numeric Validation**: During execution, the target variable must resolve to a valid number (or numeric string like `"10"`). If the variable is non-numeric, null, or undefined, execution safely halts with a descriptive error in the run record.

### Connectors & Outputs
- **Input Connector**: 1 target handle at top.
- **Output Connector**: 1 source handle at bottom (`value`, type: `number`). Downstream nodes can reference this variable via `$nodeName.value`.

---

## 15. Browser App Tool Definition (`brower.json`)

The **Browser** block creates a Playwright Chromium browser session and executes a sequence of browser actions (`goto`, `click`, `fill`, `type`, `waitForSelector`, `screenshot`, `getText`, assertions).

### Screenshot Storage
When a `screenshot` action runs, images are saved directly in the project directory segmented by execution run ID:
```
files/screenshots/<runId>/<sanitized_filename>.png
```
- Each execution run creates its own folder (`<runId>`).
- Emits `{ action: "screenshot", path: "<absolute_file_path>", success: true }` in the run output actions list.

---

## 16. Condition Tool Definition (`condition.json`)

The **Condition** block routes execution based on a comparison or custom JavaScript expression.

### Inputs
1. **`mode`** (`radio`, default: `"comparison"`): Toggle between `"comparison"` (**Comparison**) and `"expression"` (**Custom Expression**).
2. **Comparison Fields** (visible when `mode === "comparison"` via `dependsOn`):
   - **`leftValue`** (`variable`, required): Upstream flow variable to evaluate.
   - **`operator`** (`select`, required, default: `"equals"`): Comparison operator (`equals`, `notEquals`, `contains`, `greaterThan`, `lessThan`, `isEmpty`).
   - **`rightValue`** (`valueOrVariable`, optional): Static value or variable to compare against.
3. **Custom Expression Field** (visible when `mode === "expression"` via `dependsOn`):
   - **`expression`** (`code`, `javascript`, required): Custom JS returning boolean (`true`/`false`). Receives `(input, context)`.

### Connectors & Outputs
- **Input Connector**: 1 target handle at top.
- **Output Connectors**: 2 source handles at bottom:
  - `true` (`branch`): Executed when the condition evaluates to true.
  - `false` (`branch`): Executed when the condition evaluates to false.


