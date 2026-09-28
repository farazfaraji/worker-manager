# Repository Inspector

`repo-inspect` asks Codex CLI or Cursor CLI to inspect an existing Git repository for a proposed prompt or feature investigation. It automatically reads the repository path from the flow's assigned project settings (`metadata.repositoryPath`) and returns a compact, structured summary. The node does not edit source files or run tests.

## Project setup

Set **Repository Path** and, when needed, **Allowed Repository Roots** in the project's Create/Edit dialog. Paths must be absolute and exist on the same host as the Builder backend. Repository Path is always allowed; each listed root adds that folder and its subfolders. When the list is blank, Repository Path is the only allowed root. A graph node cannot widen these roots.

The Codex or Cursor CLI must already be installed and authenticated on the backend host. `CODEX_CLI_BIN` and `CURSOR_CLI_BIN` can select operator-controlled binary paths; otherwise the node uses `codex` and `agent` from `PATH`.

## Inputs

- `provider`: `codex` (default) or `cursor`.
- `prompt`: Prompt sent to the CLI (supports template variables like `{{test}}` or `{{trigger.input}}`).
- `repositoryPath`: Optional override within the project's allowed roots (defaults to project repository path).
- `timeoutMs`: CLI limit, clamped to 1–900 seconds.

Codex runs with a read-only sandbox and a JSON output schema. Cursor runs in Ask mode with its sandbox enabled. The node invokes fixed binaries with argument arrays and gives the CLI a minimal environment rather than forwarding Builder's API keys. Both providers are instructed to read only, avoid tests, and omit secrets from the response.

## Output

`result` includes `provider`, `repositoryPath`, `revision`, `dirty`, `summary`, `relevantFiles`, `existingPatterns`, `integrationPoints`, `constraints`, and `unknowns`. Each relevant file is checked against the repository before it is returned. The recorded commit and dirty flag describe the inspected checkout; they do not pin future runs to that state.

If the CLI is unavailable, fails, exceeds its timeout, or returns invalid JSON, the node fails instead of producing a misleading repository summary.
