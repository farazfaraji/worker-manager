# File Tool Documentation & Usage Guide

The **File** node reads and writes files inside a per-project sandbox at `files/projects/<projectId>/`. Paths are resolved, normalized, and rejected when they escape the sandbox, including symlink escapes. `..` and absolute paths cannot leave the project directory.

Reads and writes default to a 10 MB limit (`maxBytes`), matching the checkpoint size ceiling. `allowedExtensions` optionally restricts the suffix (for example `[".md", ".csv"]`).

---

## Operations

| Operation | What it does | Result |
| :--- | :--- | :--- |
| `read` | Reads a file. `encoding` is `utf8`, `base64`, or `json`. | `{ path, content, size, mimeType }` |
| `write` | Writes `content`. `mode` is `overwrite`, `append`, or `createOnly`. | `{ path, size, mimeType, mode }` |
| `list` | Lists a directory. Optional `glob` and `recursive`. Capped at 1000 entries. | `{ files: [{ path, size, modifiedAt, isDir }] }` |
| `delete` | Deletes a file. Set `recursive` to delete a directory. The sandbox root itself cannot be deleted. | `{ path, deleted }` |
| `move` / `copy` | Moves or copies `path` to `to`, both inside the sandbox. | `{ from, to }` |
| `exists` | Routes along `true` or `false`. | `{ path, exists }` |
| `stat` | Size, timestamps, and MIME type. | object |
| `parse` | Reads a file and parses `json`, `csv`, `markdown` (front matter plus body), or `text`. | `{ content, parsed }` |
| `download` | Fetches `url` into `path`. The host must be in `allowedHosts`, unless `allowAnyHost` is set. A blocked host returns `{ blocked: true, dryRun: true }` instead of throwing. | same as `write` |

Downstream nodes read `{{file_1.result.content}}` and `{{file_1.result.path}}`. Paths in the result are relative to the sandbox.
