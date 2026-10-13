# Jira Tool Documentation

The **Jira** block runs [jira-cli](https://github.com/ankitpokhrel/jira-cli) commands from a flow. You pick an **Action** from a dropdown, and the config modal shows only the argument fields that action uses. Every field supports `{{variables}}` or the literal/variable toggle.

- Definition: `backend/src/tools/jira.json`
- Runtime: `backend/src/runs/services/jira-cli.service.ts` (`JiraCliService`)
- Dispatch: `node-executor.service.ts` (`type === 'jira'`)
- Branch routing: `run-topology.service.ts` (`done` / `onFailed`)
- Tests: `npm run test:jira`

---

## 1. Prerequisites

1. Install jira-cli (`brew install ankitpokhrel/jira-cli/jira-cli`) and run `jira init` once.
2. Export `JIRA_API_TOKEN` in the **backend process** environment. jira-cli reads it for authentication.
3. Optional: set `JIRA_CLI_PATH` if the binary is not on `PATH`.

The backend runs jira-cli with `execFile`. It does not use a shell, so argument values cannot inject shell commands. It also sets `NO_COLOR=1` and `TERM=dumb` so the output can be parsed.

---

## 2. Actions & Arguments

| Action | Command | Required | Optional |
| :--- | :--- | :--- | :--- |
| `issue-list` | `jira issue list … --raw` | — | `query`, `jql`, `status`, `issueType`, `assignee`, `priority`, `labels`, `parent`, `limit` |
| `issue-view` | `jira issue view KEY --raw` | `issueKey` | `commentsCount` |
| `issue-create` | `jira issue create --no-input --raw` | `issueType`, `summary` | `body`, `assignee`, `priority`, `parent`, `labels`, `components` |
| `issue-edit` | `jira issue edit KEY --no-input` | `issueKey` | `summary`, `body`, `assignee`, `priority`, `parent`, `labels`, `components` |
| `issue-move` | `jira issue move KEY STATE` | `issueKey`, `state` | `comment`, `assignee`, `resolution` |
| `issue-assign` | `jira issue assign KEY ASSIGNEE` | `issueKey`, `assignee` | — |
| `issue-comment` | `jira issue comment add KEY BODY --no-input` | `issueKey`, `body` | — |
| `issue-link` | `jira issue link IN OUT TYPE` | `inwardKey`, `outwardKey`, `linkType` | — |
| `sprint-list` | `jira sprint list` | — | `sprintScope` (`current`/`prev`/`next`/`id`/`sprints`), `sprintId`, `sprintState`, `jql`, `limit` |
| `epic-list` | `jira epic list [EPIC]` | — | `epicKey`, `jql`, `status`, `assignee`, `priority`, `labels`, `limit` |
| `me` | `jira me` | — | — |
| `custom` | `jira <args…>` | `args` (JSON array) | — |

Arguments that apply to every action:

- `project` → `--project` (not used for `me` or `custom`)
- `extraArgs` → a JSON array of flags added after the generated command (not used for `custom`)
- `configFile` → `--config`
- `timeoutMs` → kills the process after this time (default 60000)

List fields such as `status`, `labels` and `components` accept comma-separated text or an array. Each value becomes its own flag. `limit` is limited to 1–100 and is sent as `--paginate 0:<limit>`.

---

## 3. Outputs

Canvas handles follow the event-driven convention:

- **`done`**: jira-cli exited with code 0.
- **`onFailed`**: jira-cli failed (non-zero exit, timeout, or missing binary). The run continues, so you can handle the failure in the flow.

A missing required argument (for example, `issueKey` for `issue-view`) is a configuration error. It fails the node. It does not route to `onFailed`.

Data is stored in the context as `{{jira.<field>}}` (also available under `{{jira.result.<field>}}`):

| Field | Type | Description |
| :--- | :--- | :--- |
| `ok` | boolean | True when the command succeeded |
| `data` | object/array | Parsed JSON output (`--raw` actions), otherwise `null` |
| `issues` | array | Issues for list actions (empty otherwise) |
| `count` | number | Number of issues returned by list actions |
| `issueKey` | string | Key from the response (e.g. created issue) or the first key found in stdout |
| `text` / `stdout` / `stderr` | string | Output from jira-cli |
| `exitCode` | number | Process exit code |
| `args` | array | The arguments that were run (without `jira`) |
| `error` | string | Failure reason when `ok` is false |

---

## 4. Examples

Create a bug from an agent's output, then comment on it:

```json
{ "action": "issue-create", "project": "PAY", "issueType": "Bug", "summary": "{{triage.title}}", "body": "{{triage.details}}", "labels": "auto-triage" }
```

```json
{ "action": "issue-comment", "issueKey": "{{jira.issueKey}}", "body": "Triaged automatically." }
```

Raw command with the `custom` action:

```json
{ "action": "custom", "args": ["issue", "list", "--plain", "--columns", "key,status", "-s", "{{trigger.status}}"] }
```

---

## 5. Troubleshooting

- **`jira-cli binary "jira" not found`**: install jira-cli or set `JIRA_CLI_PATH`.
- **401 / authentication errors in `stderr`**: `JIRA_API_TOKEN` is not set in the backend environment. Restart the backend after you export it.
- **Command hangs until timeout**: an interactive prompt opened. Add `--no-input` with `extraArgs`, or give all required fields.
- **Data privacy**: issue content can contain customer or merchant data. Pass only the fields your flow needs to downstream agents.
