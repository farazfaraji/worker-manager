# Browser Tool Documentation & Usage Guide

The **Browser** tool provides automated web browsing, scraping, UI interaction, and end-to-end testing capabilities within your flow workflows. Powered by **Playwright**, it can launch a headless or headed browser session, navigate pages, interact with DOM elements (click, type, fill, hover, key press), extract text or HTML, take screenshots, assert page states, and dynamically resize viewports.

---

## Table of Contents
1. [Overview & Architecture](#1-overview--architecture)
2. [Browser Node Inputs & Configuration](#2-browser-node-inputs--configuration)
3. [Viewport Configuration](#3-viewport-configuration)
4. [Action Definitions Reference](#4-action-definitions-reference)
   - [Navigation: `goto`, `reload`, `back`, `forward`](#navigation-goto-reload-back-forward)
   - [Interaction: `click`, `dblclick`, `fill`, `type`, `press`, `hover`](#interaction-click-dblclick-fill-type-press-hover)
   - [Synchronization: `waitForSelector`, `waitForTimeout`](#synchronization-waitforselector-waitfortimeout)
   - [Data Extraction: `getText`, `getHtml`, `getTitle`](#data-extraction-gettext-gethtml-gettitle)
   - [Viewport Control: `setViewport`](#viewport-control-setviewport)
   - [Visual Capture: `screenshot`](#visual-capture-screenshot)
   - [Assertions & Testing: `assertVisible`, `assertText`](#assertions--testing-assertvisible-asserttext)
5. [Variable Interpolation & Dynamic Expressions](#5-variable-interpolation--dynamic-expressions)
6. [Outputs & Referencing in Downstream Nodes](#6-outputs--referencing-in-downstream-nodes)
7. [Real-World Examples & Recipes](#7-real-world-examples--recipes)
8. [Troubleshooting & Best Practices](#8-troubleshooting--best-practices)

---

## 1. Overview & Architecture

When a Browser node runs within a flow execution:
- **Session Persistence**: An isolated browser session is created for the node (keyed by its `appId` / node name). Multiple browser nodes referencing the same app instance or flow context can share the session.
- **Headless Mode**: Runs headlessly by default in backend environments, but supports non-headless execution if configured.
- **Sequential Action Pipeline**: You can define an array of discrete browser actions that execute sequentially on the active page.

---

## 2. Browser Node Inputs & Configuration

The top-level configuration for the Browser node accepts the following parameters:

| Input Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `url` | `string` / `valueOrVariable` | Optional | `null` | Initial URL to navigate to upon launching the page. |
| `viewport` | `object` | Optional | `{ width: 1280, height: 720 }` | Initial browser viewport dimensions. |
| `headless` | `boolean` | Optional | `true` | Whether to run the browser in headless mode. |
| `actions` | `array` / `json` | Optional | `[]` | List of browser action objects to execute in sequence. |

---

## 3. Viewport Configuration

The **Viewport** specifies the screen resolution and dimensions of the browser window.

### Structure
```json
{
  "width": 1280,
  "height": 720
}
```

### Use Cases:
1. **Desktop Standard**: `{ "width": 1920, "height": 1080 }` or `{ "width": 1280, "height": 720 }`
2. **Mobile Device Emulation**: `{ "width": 375, "height": 812 }` (e.g., iPhone X/11/12) or `{ "width": 414, "height": 896 }`
3. **Tablet Emulation**: `{ "width": 768, "height": 1024 }` (iPad)
4. **Responsive Testing**: Testing whether UI elements (like hamburger menus or desktop sidebars) appear properly at specific screen widths.

---

## 4. Action Definitions Reference

The `actions` array defines the sequence of operations executed against the page.

### Navigation: `goto`, `reload`, `back`, `forward`

#### `goto`
Navigates the active page to a target URL.
```json
{
  "type": "goto",
  "url": "https://example.com/products",
  "waitUntil": "domcontentloaded"
}
```
- **`url`** *(string, required)*: Target URL. Supports variable interpolation (e.g., `https://example.com/{{product.id}}`).
- **`waitUntil`** *(select, optional)*:
  - `"domcontentloaded"` *(default)*: Wait until `DOMContentLoaded` event fires.
  - `"load"`: Wait until the `load` event fires (all resources loaded).
  - `"networkidle"`: Wait until there are no active network connections for at least 500ms.

#### `reload`, `back`, `forward`
```json
{ "type": "reload" }
{ "type": "back" }
{ "type": "forward" }
```

---

### Interaction: `click`, `dblclick`, `fill`, `type`, `press`, `hover`

#### `click` & `doubleClick` (`dblclick`)
Clicks an element matched by a CSS or text selector.
```json
{
  "type": "click",
  "selector": "button#submit-form"
}
```
- **`selector`** *(string, required)*: CSS selector (`#btn`, `.menu-item`), XPath, or Playwright text selector (`text=Sign In`).

#### `fill`
Clears the existing value and sets the new value of an `<input>`, `<textarea>`, or contenteditable element.
```json
{
  "type": "fill",
  "selector": "input#email",
  "value": "{{user.email}}"
}
```

#### `type`
Types text into an element character by character (useful for triggering JS `keypress` or autocomplete handlers).
```json
{
  "type": "type",
  "selector": "input#search-query",
  "text": "Laptop Pro 16"
}
```

#### `press`
Presses a keyboard key on the specified element.
```json
{
  "type": "press",
  "selector": "input#search-query",
  "key": "Enter"
}
```
- Supported keys: `"Enter"`, `"Escape"`, `"Tab"`, `"ArrowDown"`, `"ArrowUp"`, `"Backspace"`, `"Space"`, etc.

#### `hover`
Hovers the mouse cursor over an element (e.g., to open hover dropdowns or tooltips).
```json
{
  "type": "hover",
  "selector": ".nav-dropdown"
}
```

---

### Synchronization: `waitForSelector`, `waitForTimeout`

#### `waitForSelector`
Waits for an element to satisfy a specific DOM state before proceeding.
```json
{
  "type": "waitForSelector",
  "selector": ".dashboard-loaded",
  "state": "visible",
  "timeout": 10000
}
```
- **`state`** *(select)*:
  - `"visible"` *(default)*: Element is present in DOM and visible (not hidden/zero-size).
  - `"attached"`: Present in DOM, whether visible or not.
  - `"hidden"`: Absent from DOM or not visible.
  - `"detached"`: Absent from DOM.
- **`timeout`** *(number, ms)*: Max wait duration before throwing an error (default: `10000`).

#### `waitForTimeout`
Pauses execution for a specified duration in milliseconds.
```json
{
  "type": "waitForTimeout",
  "milliseconds": 2000
}
```

---

### Data Extraction: `getText`, `getHtml`, `getTitle`

#### `getText`
Extracts inner text content from an element.
```json
{
  "type": "getText",
  "selector": "h1.page-title"
}
```
- **Result**: `{ "action": "getText", "selector": "h1.page-title", "text": "Welcome Back", "success": true }`

#### `getHtml`
Extracts inner HTML of an element, or the full page HTML if no selector is provided.
```json
{
  "type": "getHtml",
  "selector": "div#content"
}
```
- **Result**: `{ "action": "getHtml", "selector": "div#content", "html": "<p>Content...</p>", "success": true }`

#### `getTitle`
Extracts the current page document title.
```json
{
  "type": "getTitle"
}
```
- **Result**: `{ "action": "getTitle", "title": "Dashboard - Example App", "success": true }`

#### `extractElement` (Element Extractor)
Extracts raw element HTML, matched CSS stylesheet rules, and standalone HTML with full computed inlined CSS from any target element selector or ID. Optionally saves the extracted standalone HTML to disk.
```json
{
  "type": "extractElement",
  "selector": ".my-card",
  "filename": "my_card_extracted.html"
}
```
- **`selector`** *(string, required)*: Target element selector or ID (e.g. `#main-card`, `.my-card`, `h1`).
- **`filename`** *(string, optional)*: Optional filename to save the standalone inlined HTML bundle to `/files/extracted/<runId>/<filename>`.
- **Result**:
```json
{
  "action": "extractElement",
  "selector": ".my-card",
  "html": "<div class=\"my-card\">...</div>",
  "css": ".my-card { background: #fff; padding: 16px; }\n.my-card h3 { color: #333; }",
  "standaloneHtml": "<div class=\"my-card\" style=\"background-color:rgb(255,255,255);padding:16px;...\">...</div>",
  "path": "files/extracted/run-123/my_card_extracted.html",
  "success": true
}
```

---

### Viewport Control: `setViewport`

Dynamically resizes the browser viewport during the execution.
```json
{
  "type": "setViewport",
  "width": 375,
  "height": 812
}
```
- **Result**: `{ "action": "setViewport", "width": 375, "height": 812, "success": true }`

---

### Visual Capture: `screenshot`

Captures an image screenshot of the browser view or the entire scrollable page.
```json
{
  "type": "screenshot",
  "filename": "dashboard-view.png",
  "fullPage": false
}
```
- **`filename`** *(string, optional)*: Desired filename (saved to `/files/screenshots/<runId>/<filename>`).
- **`fullPage`** *(boolean)*: `true` to capture the entire scrollable document height, `false` to capture only the current viewport.
- **Result**: `{ "action": "screenshot", "path": "/path/to/files/screenshots/.../dashboard-view.png", "success": true }`

---

### Assertions & Testing: `assertVisible`, `assertText`

Assertions validate conditions and halt/fail the flow if the condition is not met.

#### `assertVisible`
```json
{
  "type": "assertVisible",
  "selector": ".success-notification"
}
```
- Fails if the element is not visible within default timeout.

#### `assertText`
```json
{
  "type": "assertText",
  "selector": ".user-greeting",
  "expected": "Hello, Alice"
}
```
- Fails if the element text does not contain the expected string.

---

## 5. Variable Interpolation & Dynamic Expressions

All string fields (URLs, selectors, text/values to fill, expected assertion values) support Flow Builder variable templating using the `{{ ... }}` syntax:

- Upstream node outputs: `{{nodes.trigger_1.payload.url}}`
- Flow runtime variables: `{{variables.authToken}}`
- Loop item variables: `{{item.email}}`

### Example
```json
{
  "type": "fill",
  "selector": "#search-field",
  "value": "{{nodes.trigger_1.payload.searchQuery}}"
}
```

---

## 6. Outputs & Referencing in Downstream Nodes

When a Browser node finishes execution, it outputs a structured `result` payload:

```json
{
  "result": {
    "appId": "Browser_1",
    "status": "ready",
    "url": "https://example.com/dashboard",
    "title": "User Dashboard",
    "actions": [
      { "action": "goto", "url": "https://example.com/login", "success": true },
      { "action": "fill", "selector": "#username", "success": true },
      { "action": "fill", "selector": "#password", "success": true },
      { "action": "click", "selector": "#login-btn", "success": true },
      { "action": "getText", "selector": ".stats-count", "text": "1,420", "success": true },
      { "action": "screenshot", "path": "files/screenshots/run-123/dashboard.png", "success": true }
    ]
  }
}
```

### Downstream Node Referencing

You can reference these outputs in subsequent nodes (such as Condition nodes, Agents, Functions, or JSON Parsers):

| What you want to access | Variable Reference Syntax |
| :--- | :--- |
| **Final Page URL** | `{{nodes.browser_1.result.url}}` |
| **Page Title** | `{{nodes.browser_1.result.title}}` |
| **Specific Scraped Text** | `{{nodes.browser_1.result.actions[4].text}}` |
| **Screenshot File Path** | `{{nodes.browser_1.result.actions[5].path}}` |
| **Whole Action Results Array** | `{{nodes.browser_1.result.actions}}` |

---

## 7. Real-World Examples & Recipes

### Recipe 1: Login and Scrape Dashboard Statistics
```json
{
  "viewport": { "width": 1920, "height": 1080 },
  "actions": [
    { "type": "goto", "url": "https://example.com/login" },
    { "type": "fill", "selector": "#email", "value": "{{variables.adminEmail}}" },
    { "type": "fill", "selector": "#password", "value": "{{variables.adminPassword}}" },
    { "type": "click", "selector": "button[type='submit']" },
    { "type": "waitForSelector", "selector": ".dashboard-stats", "state": "visible" },
    { "type": "getText", "selector": ".total-revenue-value" },
    { "type": "screenshot", "filename": "dashboard-overview.png", "fullPage": false }
  ]
}
```

### Recipe 2: Mobile UI Screenshot Comparison
```json
{
  "actions": [
    { "type": "setViewport", "width": 375, "height": 812 },
    { "type": "goto", "url": "https://example.com" },
    { "type": "waitForSelector", "selector": ".mobile-menu-button", "state": "visible" },
    { "type": "click", "selector": ".mobile-menu-button" },
    { "type": "screenshot", "filename": "mobile-nav-expanded.png", "fullPage": false }
  ]
}
```

### Recipe 3: Automated Search & Form Submission
```json
{
  "actions": [
    { "type": "goto", "url": "https://docs.example.com" },
    { "type": "fill", "selector": "input[name='q']", "value": "{{nodes.trigger_1.payload.query}}" },
    { "type": "press", "selector": "input[name='q']", "key": "Enter" },
    { "type": "waitForSelector", "selector": ".search-results-list", "state": "visible" },
    { "type": "getText", "selector": ".search-results-list .first-result" }
  ]
}
```

---

## 8. Troubleshooting & Best Practices

1. **Use `waitForSelector` before interacting with dynamic elements**: Single Page Applications (React, Vue, Angular) load elements asynchronously. Always wait for selectors to be `'visible'` before clicking or reading text.
2. **Prefer unique selectors**: Use IDs (`#login-submit`) or data attributes (`[data-testid='login-btn']`) instead of generic tag names or deeply nested class hierarchies.
3. **Use `fill` instead of `type` for long values**: `fill` sets input values instantly, whereas `type` simulates keystroke delays. Use `type` only when real keystroke events are needed.
4. **Handling Dynamic Viewports**: If you are testing mobile views, set the `viewport` object initially in the node config or invoke `setViewport` as the first action before visiting the URL.
