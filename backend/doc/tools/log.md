# Log Tool Documentation & Usage Guide

The **Log** node records a redacted trace entry on the run, snapshots context paths, asserts a condition, records a custom metric, or times a span. It has no external side effects.

---

## Node Inputs

| Field | Type | Used by | Description |
| :--- | :--- | :--- | :--- |
| `operation` | select | always | `log`, `inspect`, `assert`, `metric`, or `timer`. |
| `level` | select | `log` | `debug`, `info`, `warn`, or `error`. |
| `message` | value or variable | `log`, `assert` | Text written to the run log. Templates are resolved first. |
| `data` | value or variable | `log` | Extra payload stored on the node output. |
| `paths` | json | `inspect` | Context paths such as `["agent_1.result", "state.count"]`. |
| `mode` | radio | `assert` | `comparison` or `expression`. |
| `onFail` | select | `assert` | `fail` throws `ASSERTION_FAILED` (not retried). `route` follows the `false` handle. |
| `name` / `value` / `tags` | text, value, json | `metric` | Appended to `run.metrics.customMetrics`. |
| `phase` / `label` | select, text | `timer` | `start` stores a timestamp. `stop` returns `elapsedMs`. |

## Outputs

| Handle | When |
| :--- | :--- |
| `result` | Always. `{ level, message, data, timestamp }` plus operation-specific fields. |
| `true` / `false` | `assert` with `onFail: "route"`. The active handle matches `conditionMet`. |

Messages, inspected values, and metric tags pass through secret redaction before they are logged or stored.

## Example

```json
{
  "operation": "assert",
  "mode": "expression",
  "expression": "return context.agent_1.result.score >= 0.8;",
  "onFail": "route",
  "message": "Score was too low"
}
```
