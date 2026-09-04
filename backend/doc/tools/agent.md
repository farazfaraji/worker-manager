# Agent Tool Documentation & Usage Guide

The **Agent** node introduces Large Language Model (LLM) intelligence directly into your flow pipelines. It supports prompt engineering, variable interpolation, multi-modal file/media attachments (vision, audio, PDFs), temperature fine-tuning, and structured JSON output constrained by Zod schemas.

---

## Table of Contents
1. [Overview & Architecture](#1-overview--architecture)
2. [Node Inputs & Configuration](#2-node-inputs--configuration)
3. [Supported Models & Providers](#3-supported-models--providers)
4. [Prompt Templating & Variable Interpolation](#4-prompt-templating--variable-interpolation)
5. [Multi-Modal Attachments (Vision, Audio, Docs)](#5-multi-modal-attachments-vision-audio-docs)
6. [Structured JSON Output & Zod Schemas](#6-structured-json-output--zod-schemas)
7. [Outputs & Referencing in Downstream Nodes](#7-outputs--referencing-in-downstream-nodes)
8. [Real-World Examples & Recipes](#8-real-world-examples--recipes)
9. [Troubleshooting & Best Practices](#9-troubleshooting--best-practices)

---

## 1. Overview & Architecture

When an Agent node executes during a flow run:
- **Model Resolution**: The node loads configured provider credentials, endpoint URLs, and default settings from the internal Models database (`/api/models`), supporting OpenAI, Anthropic, Ollama, and custom OpenAI-compatible endpoints.
- **Prompt Synthesis**: The `systemPrompt` and `userPrompt` templates are evaluated with runtime variables from upstream nodes (e.g. `{{browser_1.result.url}}`, `{{trigger.input.query}}`).
- **Multi-Modal Processing**: If media attachments are enabled, image screenshots, audio recordings, or PDF documents are encoded into base64 data URLs and attached directly into the multi-modal payload.
- **Output Validation & Extraction**: Depending on `outputFormat`, responses are returned as plain text or parsed into a strongly-typed JSON object conforming to your `outputType` Zod schema.

---

## 2. Node Inputs & Configuration

| Input Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `model` | `select` | Yes | `"gpt-4o"` | The LLM model to execute. Populated dynamically via `/api/models`. |
| `customTemperature` | `checkbox` | No | `false` | Enable to override the model's default sampling temperature. |
| `temperature` | `number` | Conditional | `0.7` | Sampling temperature (0.0 = deterministic, 1.0 = creative). Visible only when `customTemperature` is `true`. |
| `reasoningEffort` | `select` | No | `"model_default"` | Reasoning effort: `"model_default"`, `"none"` (disable thinking for ultra-fast generation), `"low"`, `"medium"`, `"high"`. Supported by Groq (Qwen/DeepSeek) and OpenAI (o1/o3). |
| `reasoningFormat` | `select` | No | `"hidden"` | Formatting of reasoning tokens: `"hidden"` (clean final answer), `"parsed"` (separate field), `"raw"` (keeps `<think>` tags). |
| `systemPrompt` | `textarea` | Yes | `"You are a helpful AI assistant..."` | High-level instructions defining role, persona, constraints, and instructions. |
| `userPrompt` | `textarea` | Yes | `""` | The prompt sent as the user turn. Supports mustache templates `{{nodeName.field}}`. |
| `enableAttachment` | `checkbox` | No | `false` | Enables attaching external media (images, audio, PDFs) to the prompt. |
| `attachment` | `valueOrVariable` | Conditional | `null` | Local file path, remote URL, or upstream node variable (e.g. `{{browser.screenshot}}`). |
| `attachmentType` | `select` | Conditional | `"auto"` | Media category: `"auto"`, `"image"`, `"audio"`, or `"document"`. |
| `outputFormat` | `radio` | Yes | `"text"` | Response formatting: `"text"` or `"json"`. |
| `outputType` | `code` (ts) | Conditional | `null` | Zod schema definition for JSON mode. Downstream nodes can autocomplete its properties. |

---

## 3. Supported Models & Providers

The agent runtime natively handles multiple LLM providers:

### OpenAI & OpenAI-Compatible Endpoints
- **GPT-4o / GPT-4o Mini**: Full text & vision support via `image_url`.
- **o1 / o3 Reasoning Models**: Reasoning tokens supported (custom temperature is automatically bypassed for reasoning models).
- **Local Ollama / vLLM / LM Studio**: Works seamlessly with any local or self-hosted endpoint matching OpenAI's `/chat/completions` specification.

### Anthropic Claude
- **Claude 3.5 Sonnet / Claude 3 Opus / Haiku**: Formatted via Anthropic's Messages API (`/v1/messages`) with base64 image blocks and system prompt separation.

---

## 4. Prompt Templating & Variable Interpolation

Both `systemPrompt` and `userPrompt` support dynamic variable substitution using `{{ ... }}` syntax:

```markdown
Analyze this scraped web content:
URL: {{nodes.browser_1.result.url}}
Document Title: {{nodes.browser_1.result.title}}
Extracted Text:
{{nodes.browser_1.result.actions[3].text}}
```

### Context Scopes:
- Upstream Node Outputs: `{{nodes.nodeName.outputProperty}}` or `{{nodeName.outputProperty}}`
- Flow Run Input: `{{input.propertyName}}` or `{{trigger.input.propertyName}}`
- In-memory Variables: `{{variables.myVar}}`

---

## 5. Multi-Modal Attachments (Vision, Audio, Docs)

When analyzing browser screenshots, diagrams, photos, or documents, enable **Attach File / Media**:

```json
{
  "enableAttachment": true,
  "attachment": "{{nodes.browser_1.result.actions[4].path}}",
  "attachmentType": "image"
}
```

### Supported Attachment Sources:
1. **Local File Paths**: Absolute paths on the runner disk (e.g., `/Users/.../files/screenshots/shot.png`). The runner automatically detects mime types (`image/png`, `image/jpeg`, `image/webp`, `audio/mp3`, `application/pdf`) and encodes the file into a base64 Data URL.
2. **Data URLs**: Direct `data:image/png;base64,...` strings.
3. **HTTP/HTTPS URLs**: Publicly accessible web image URLs.
4. **Structured Objects**: Objects containing a `.path` property returned by tools like the Browser screenshot action.

---

## 6. Structured JSON Output & Zod Schemas

To reliably pass structured data to downstream nodes (Condition, Transform, Script, or API calls), set `outputFormat` to `"json"` and define an `outputType` using Zod syntax:

```typescript
z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]),
  summary: z.string(),
  keyPoints: z.array(z.string()),
  urgencyScore: z.number().min(1).max(10),
  actionRequired: z.boolean()
})
```

When JSON mode is active:
1. The backend automatically augments the system prompt with strict schema enforcement instructions.
2. The agent response is parsed and validated.
3. All defined properties (`sentiment`, `summary`, `keyPoints`, etc.) become selectable in downstream `VariablePicker` components across the flow.

---

## 7. Outputs & Referencing in Downstream Nodes

The Agent node emits two primary outputs:

| Output Name | Type | Description |
| :--- | :--- | :--- |
| `result` | `object` | Parsed JSON object conforming to `outputType` (available in JSON mode). |
| `text` | `string` | The complete raw string response generated by the model. |

### Downstream Referencing Syntax:

```json
{{nodes.agent_1.text}}
{{nodes.agent_1.result.sentiment}}
{{nodes.agent_1.result.keyPoints[0]}}
{{nodes.agent_1.result.urgencyScore}}
```

---

## 8. Real-World Examples & Recipes

### Recipe 1: Web Page Screenshot Visual QA Auditor
```json
{
  "model": "gpt-4o",
  "systemPrompt": "You are a senior UI/UX engineer and QA tester. Review the attached webpage screenshot and audit visual hierarchy, typography, broken layouts, and contrast.",
  "userPrompt": "Please review this screenshot from {{nodes.browser_1.result.url}}.",
  "enableAttachment": true,
  "attachment": "{{nodes.browser_1.result.actions[2].path}}",
  "attachmentType": "image",
  "outputFormat": "json",
  "outputType": "z.object({\n  hasBugs: z.boolean(),\n  issues: z.array(z.string()),\n  score: z.number()\n})"
}
```

### Recipe 2: Customer Inquiry Classification & Routing
```json
{
  "model": "gpt-4o-mini",
  "systemPrompt": "You are an automated support ticket triage assistant.",
  "userPrompt": "Customer message: {{trigger.input.customerMessage}}",
  "outputFormat": "json",
  "outputType": "z.object({\n  category: z.enum(['billing', 'technical', 'sales', 'general']),\n  priority: z.enum(['low', 'medium', 'high']),\n  suggestedResponse: z.string()\n})"
}
```

---

## 9. Troubleshooting & Best Practices

1. **JSON Validation Failures**: If the model occasionally wraps responses in markdown code blocks (\`\`\`json ... \`\`\`), the backend automatically cleans and unescapes it, but using clear field names in your Zod schema ensures the model returns exact matches.
2. **Reasoning Models (Qwen / DeepSeek / o1)**: When using reasoning models with structured JSON mode, ensure `reasoningFormat` is set to `"hidden"` or `reasoningEffort` to `"none"`. Emitting raw `<think>` tokens into JSON mode can cause provider JSON schema enforcers (like Groq) to throw HTTP 400 validation errors.
3. **Large Media Files**: Keep screenshots and images within standard sizes (e.g., 1280x720 or 1920x1080) to optimize token usage and response latency.
