# Flow Board Canvas Documentation & Usage Guide

The **Flow Board** is the primary visual design and execution environment of the **Agentic Flow Builder**. Built on React Flow, it allows engineers and workflow designers to drag, wire, configure, validate, and execute complex agentic graphs in real time.

---

## Table of Contents
1. [Overview & Visual Layout](#1-overview--visual-layout)
2. [Node Palette & Adding Nodes](#2-node-palette--adding-nodes)
3. [Node Anatomy & Sockets](#3-node-anatomy--sockets)
4. [Wiring Connections & Branch Logic](#4-wiring-connections--branch-logic)
5. [Configuring Nodes (`NodeConfigModal`)](#5-configuring-nodes-nodeconfigmodal)
6. [Variable Referencing & Autocomplete](#6-variable-referencing--autocomplete)
7. [Flow Execution & Live Runtime State](#7-flow-execution--live-runtime-state)
8. [Persistence & URL State (`?flow=<id>`)](#8-persistence--url-state-flowid)
9. [Right Toolbar & Quick Navigation](#9-right-toolbar--quick-navigation)
10. [Canvas Keyboard Shortcuts & Controls](#10-canvas-keyboard-shortcuts--controls)
11. [Best Practices for Robust Flow Design](#11-best-practices-for-robust-flow-design)

---

## 1. Overview & Visual Layout

The Flow Board interface is divided into three functional zones:

```
┌─────────────────┬───────────────────────────────────────────┬──────────────┐
│  NODE PALETTE   │               FLOW BOARD CANVAS           │ RIGHT TOOLBAR│
│  (Left Sidebar) │            (Interactive React Flow)       │ (Quick Nav)  │
│                 │                                           │              │
│ ⚡ Flow         │   ┌──────────────┐     ┌──────────────┐   │  [📄 Docs]   │
│ 🤖 Agent        │   │   Trigger    │────>│   AI Agent   │   │  [🕒 Runs]   │
│ 🌐 App          │   └──────────────┘     └──────┬───────┘   │  [⛶ Fit]    │
│ 🔀 Logic        │                               │           │              │
│ ⚙️ Function     │                        ┌──────▼───────┐   │              │
│ 📦 Data         │                        │   Artifact   │   │              │
│ 🧠 Knowledge    │                        └──────────────┘   │              │
│                 │                                           │              │
│                 │   [MiniMap]                    [Controls] │              │
└─────────────────┴───────────────────────────────────────────┴──────────────┘
```

- **Top Header Bar**: Flow name input, Save / Save As actions, Validate Graph button, and the primary **Run Flow** action.
- **Node Palette (Left Sidebar)**: Categorized library of tools and nodes with search filtering.
- **Flow Board Canvas (Center)**: Infinite zoomable and pannable workspace with background grid.
- **Right Toolbar**: Direct links to Artifacts/Documents dashboard, Execution Run History, and Fit View controls.

---

## 2. Node Palette & Adding Nodes

Nodes are organized into clear functional categories:

| Category | Typical Nodes | Purpose |
| :--- | :--- | :--- |
| **Flow** | `trigger`, `subgraph` | Entrypoints, scheduling, webhooks, domain events, nested workflows |
| **Agent** | `agent` | Multi-modal LLM reasoning, system prompts, attachments, structured outputs |
| **App** | `browser` | Playwright web automation, navigation, forms, scrapers, screenshots |
| **Logic** | `condition`, `validator`, `router` | Dynamic branching, schema validation, multi-way intent routing |
| **Function** | `script`, `transform`, `json-parser`, `variable` | JavaScript execution, data reshaping, loop variables, state counters |
| **Data / Artifact** | `artifact` | Durable document persistence, versioning, diffing, and domain event emission |
| **Knowledge** | `memory`, `retrieval`, `embedding` | Semantic search, vector embeddings, conversation memory |
| **Control** | `orchestrator`, `human-gate`, `loop`, `notification` | Multi-agent panels, human sign-offs, bounded loops, alerts |

### How to Add Nodes to the Board
1. **Drag-and-Drop**: Click and hold any tool card from the left palette, drag it onto the canvas, and release. The node will be instantiated at the exact cursor drop position.
2. **Click to Add**: Clicking any palette item will place the node at the current canvas center.

---

## 3. Node Anatomy & Sockets

Each node rendered on the canvas (`LangGraphCustomNode`) features a consistent, high-information structure:

```
                  ┌── Target Socket (Input Data / Control Flow)
                  │
          ┌───────▼───────────────────────────┐
          │ ⚡ [Icon] Trigger                 │  <-- Header & Category Color
          │ name: "trigger_1"                 │  <-- Variable Identifier Name
          ├───────────────────────────────────┤
          │ Type: Event Listener              │
          │ Topic: artifact.update            │  <-- Parameter Summary Preview
          ├───────────────────────────────────┤
          │ ● Status: completed (124ms)       │  <-- Live Execution Badge
          └───────┬───────────────────────────┘
                  ├── Source Socket: "event"  (Data handle)
                  ├── Source Socket: "data"   (Data handle)
                  └── Source Socket: "entityId"
```

- **Target Handle (Top Socket)**: Receives control flow and incoming variable context from upstream nodes.
- **Variable Identifier Name**: The identifier displayed under the title (e.g. `agent_1`, `artifact_2`) is the variable namespace used in mustache expressions (e.g. `{{agent_1.result.content}}`).
- **Live Status Indicator**: During and after a flow run, shows `idle`, `running` (with pulsing glow), `completed` (green), `waiting` (orange for human gates), or `failed` (red).
- **Source Handles (Bottom Sockets)**: Emits data or branch paths to downstream nodes.

---

## 4. Wiring Connections & Branch Logic

### Standard Connections (Data / Sequence)
- Drag from a source socket at the bottom of an upstream node to the target socket at the top of a downstream node.
- Connecting nodes establishes execution ordering and makes upstream outputs available for variable referencing.

### Branching Connections (Logic Nodes)
Nodes like **Condition** and **Validator** output discrete branch handles:
- **`true` / `valid` (Green Socket)**: The execution engine continues down this edge if the test passes.
- **`false` / `invalid` (Red / Orange Socket)**: The engine routes execution down this edge if the test fails.
- Inactive branches are automatically bypassed during flow execution without throwing an error.

### Cycle Protection & Validation
- The canvas prevents invalid self-connections.
- Clicking **Validate** on the top bar runs topological validation, checking for unreachable nodes, invalid variable references, and infinite cycles before execution.

---

## 5. Configuring Nodes (`NodeConfigModal`)

Clicking any node on the board opens the **Node Configuration Modal**:

1. **Node Name**: Rename the node (e.g., `audit_agent` instead of `agent_1`). This updates the variable reference prefix across the graph.
2. **Dynamic Parameter Form**:
   - Form fields dynamically adapt based on selected options (e.g., selecting `operation: "diff"` in an Artifact node reveals `previous` and `next` fields while hiding `content`).
   - Fields support multiple input types: code editors, dropdowns, text areas, number steppers, and JSON inspectors.
3. **Literal vs. Variable Toggle (`valueOrVariable`)**:
   - Click the toggle switch on any supported field to alternate between typing a literal value or binding an upstream node's output variable.

---

## 6. Variable Referencing & Autocomplete

Downstream nodes can read any property emitted by an upstream node using the `{{node_name.property}}` syntax.

### The Variable Picker
When an input is in **Variable Reference** mode:
1. Click the variable input field to open the **Variable Picker**.
2. Upstream nodes connected to the current node appear grouped by node name.
3. Click any property (e.g. `artifact_1.artifactId` or `trigger.data.current.content`) to bind it directly.

### Template Interpolation in Text Fields
In text areas and prompt inputs, you can embed inline variables:
```
Please review the updated specification for project {{trigger.projectId}}:

{{trigger.data.current.content}}

Diff changes detected:
{{trigger.data.fileChanges.diff}}
```
At runtime, the execution engine parses and replaces every mustache expression with its live in-memory value.

---

## 7. Flow Execution & Live Runtime State

### Running a Flow
1. Click the **Run Flow** button on the top toolbar.
2. If the flow begins with a Manual Trigger, a dialog will appear allowing you to supply the initial JSON input payload.
3. If the flow begins with an **Event Listener Trigger**, it can be executed manually for testing or triggered automatically whenever a matching domain event (e.g. `artifact.update`) is published.

### Live Visual Feedback
As the backend graph runner processes each node:
- **Pulsing Blue Ring**: Node is actively executing.
- **Solid Green Badge**: Node completed successfully (displays execution duration in milliseconds).
- **Amber / Waiting Badge**: Flow is paused waiting for user action (e.g. Human Gate approval).
- **Red Badge**: Node failed (hover or click to view the exact error message and stack trace).

---

## 8. Persistence & URL State (`?flow=<id>`)

Flows are fully persistent in MongoDB:
- **Save / Save As**: Saves node positions, configurations, edge connections, and viewport pan/zoom into MongoDB.
- **Persistent URL**: Loading or saving a flow automatically sets the browser URL query parameter: `http://localhost:6301/?flow=<graphId>`.
- Refreshing the page or sharing the link reloads the exact board layout and node parameters.

---

## 9. Right Toolbar & Quick Navigation

Positioned on the top-right of the board canvas:

| Button | Label | Action |
| :---: | :--- | :--- |
| <kbd>📄</kbd> | **Documents** | Opens `/artifacts` to browse, inspect, and diff all deliverables produced by Artifact nodes. |
| <kbd>🕒</kbd> | **Runs** | Opens `/runs` to view execution run history, logs, step-by-step traces, and performance benchmarks. |
| <kbd>⛶</kbd> | **Fit View** | Automatically centers and scales all nodes within the current browser window. |

---

## 10. Canvas Keyboard Shortcuts & Controls

| Action | Shortcut / Gesture |
| :--- | :--- |
| **Pan Canvas** | Click and drag on empty background, or Hold <kbd>Space</kbd> + Drag |
| **Zoom In / Out** | Mouse Wheel / Trackpad Pinch, or Controls overlay (`+` / `-`) |
| **Delete Node / Edge** | Select node or edge + Press <kbd>Backspace</kbd> or <kbd>Delete</kbd> |
| **Open Node Settings** | Click any node card on the canvas |
| **Close Modal** | Press <kbd>Esc</kbd> or click modal backdrop |
| **Fit Canvas to View** | Click <kbd>⛶</kbd> button on the right toolbar |

---

## 11. Best Practices for Robust Flow Design

1. **Always Start with a Trigger Node**:
   Every executable flow must begin with a **Trigger** node. Choose `Manual` for human-triggered workflows, `Webhook` for API calls, or `Event Listener` for reactive event-driven flows.
2. **Give Nodes Descriptive Names**:
   Rename default IDs like `agent_1` to descriptive identifiers like `pr_reviewer` or `spec_extractor`. This makes downstream variable references (`{{pr_reviewer.result.summary}}`) clean and readable.
3. **Use Validators Before Dangerous Operations**:
   Before executing side effects (such as external HTTP actions, browser scraping, or command execution), wire a **Validator** node to verify payload integrity and required fields.
4. **Leverage Artifacts for Deliverables**:
   Do not pass massive Markdown documents purely in ephemeral runtime state. Persist them using an **Artifact** node so they are versioned, audited, and accessible from the Documents dashboard.
5. **Inspect Errors via Run History**:
   If a node fails during execution, click the **Runs** button on the right toolbar to inspect the complete JSON input, step timings, and backend error trace.
