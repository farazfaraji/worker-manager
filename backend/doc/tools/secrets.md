# Secrets Tool Documentation & Usage Guide

The **Secrets** vault stores project credentials encrypted with AES-256-GCM. Other nodes should reference them as `{{secrets.NAME}}`. The plaintext is resolved when the node runs and is redacted from logs, run output, and checkpoints. It is not copied onto the run context.

Each project has its own encryption key, set in **Manage Projects → Secrets**. The key is stored with the project and is never returned by the API. Use at least 8 characters, or 64 hex characters for a raw 32-byte key. Changing the key re-encrypts that project's existing secrets. `SECRETS_MASTER_KEY` is an optional fallback when a project has no key of its own.

---

## Referencing a secret

```text
Authorization: Bearer {{secrets.GITHUB_TOKEN}}
```

`NAME` must be `UPPER_SNAKE_CASE`. The flow's project id selects the vault. A missing name fails template resolution unless you provide a fallback (`{{secrets.OPTIONAL_TOKEN || ""}}`).

Prefer this over the `get` operation. `get` returns the value on the node output under the key `secret`, which is redacted when the run is stored, but it is still present in memory for the rest of the run.

## Node operations

| Operation | Result |
| :--- | :--- |
| `get` | `{ name, exists, secret }`. `secret` is the decrypted value. |
| `set` | Creates or replaces a secret. Use this to store a token the flow just obtained. Returns metadata only. |
| `delete` | Removes the secret. |
| `list` | Names, descriptions, and timestamps. Never values. |
| `exists` | Routes along `true` or `false`. |

## HTTP API

Values are write-only. No endpoint returns a secret.

| Method | Path | Body |
| :--- | :--- | :--- |
| `GET` | `/api/projects/:projectId/secrets` | — |
| `PUT` | `/api/projects/:projectId/secrets/:name` | `{ "value": "...", "description": "..." }` |
| `DELETE` | `/api/projects/:projectId/secrets/:name` | — |

The project settings dialog has a Secrets tab for the same operations.
