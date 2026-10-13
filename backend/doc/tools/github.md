# GitHub CLI

`github` runs one [GitHub CLI](https://cli.github.com/) (`gh`) command per node. An **Action** dropdown selects the command. The configuration modal shows only the fields that the selected action uses. The node reads PRs, issues, repositories and workflow runs as structured JSON. It can also create PRs and issues, comment, review, merge, check out and clone.

Definition: [`backend/src/tools/github.json`](../../src/tools/github.json) · Runtime: [`github-cli.service.ts`](../../src/runs/services/github-cli.service.ts)

## Host setup

- `gh` must be installed on the backend host and authenticated for the user that runs the backend. Use `gh auth login`, or set `GH_TOKEN` / `GITHUB_TOKEN`. `GH_HOST` and `GH_ENTERPRISE_TOKEN` are forwarded for GitHub Enterprise.
- `GH_CLI_BIN` can point to a specific `gh` binary. When it is not set, the node uses `gh` from `PATH`.
- The node never stores a token in node configuration.

## Working directory

gh runs in the project's **Repository Path** (`metadata.repositoryPath`). The rules are the same as for the [Repository Inspector](./repo-inspect.md):

- **Working Directory Override** must be an absolute path inside the project's allowed repository roots.
- **Repo: Clone** targets must also stay inside the allowed roots. The default target is `<working dir>/<repo name>`.
- If no path is configured, remote-only actions run in a scratch directory. These are actions that name a repository with **Repository (OWNER/REPO)**. `repo-clone` and `pr-checkout` need a real path, so they fail if no path is configured.

## Actions

| Action | gh command | Key inputs |
| :--- | :--- | :--- |
| `pr-create` | `gh pr create` | `title` (required), `body`, `base`, `head`, `draft`, `labels`, `reviewers`, `assignees` |
| `pr-view` | `gh pr view --json …` | `number` (number / URL / branch; empty = the PR of the current branch) |
| `pr-list` | `gh pr list --json …` | `state` (open/closed/merged/all), `base`, `head`, `labels`, `assignees`, `search`, `limit` |
| `pr-diff` | `gh pr diff` | `number` |
| `pr-checks` | `gh pr checks --json …` | `number` |
| `pr-comment` | `gh pr comment` | `number`, `body` (required) |
| `pr-review` | `gh pr review` | `number`, `reviewType` (comment/approve/request-changes), `body` (required unless approving) |
| `pr-merge` | `gh pr merge` | `number`, `mergeMethod` (squash/merge/rebase), `autoMerge`, `deleteBranch` |
| `pr-checkout` | `gh pr checkout` | `number` (required) |
| `pr-close` | `gh pr close` | `number`, `body` (posted as a closing comment), `deleteBranch` |
| `repo-clone` | `gh repo clone` | `repo` (required), `cloneDirectory`, `cloneDepth` |
| `repo-view` | `gh repo view --json …` | `repo` (empty = the current repository) |
| `issue-create` | `gh issue create` | `title` (required), `body`, `labels`, `assignees` |
| `issue-view` | `gh issue view --json …` | `number` (required) |
| `issue-list` | `gh issue list --json …` | `state`, `labels`, `assignees`, `search`, `limit` |
| `issue-comment` | `gh issue comment` | `number`, `body` (both required) |
| `run-list` | `gh run list --json …` | `branch`, `workflow`, `limit` |
| `run-view` | `gh run view --json …` | `runId` (required) |
| `api` | `gh api` | `apiEndpoint` (a relative REST path; `{owner}`/`{repo}` placeholders are allowed), `apiMethod`, `apiBody` (JSON, sent on stdin) |
| `custom` | `gh <args>` | `args` (for example `release list --limit 5 --json tagName`) |

Common inputs:

- `repo`: passed as `--repo OWNER/REPO`. Must be `OWNER/REPO`, `HOST/OWNER/REPO`, or a GitHub URL.
- `extraArgs`: extra flags appended to the generated command. Not available for `custom`.
- `timeoutMs`: default 120 s, clamped to 1 s–15 min.
- `failOnError`: see [Branches](#branches).

Every text input supports `{{variables}}`. For example, you can set `body` to `{{review_agent.text}}` or `number` to `{{open_pr.number}}`.

## Safety

- gh runs through `spawn` with an argument array. No shell is used. `custom` args are split with quote rules similar to a POSIX shell, but nothing in them is evaluated.
- The process gets a minimal environment with prompts disabled (`GH_PROMPT_DISABLED=1`, `GIT_TERMINAL_PROMPT=0`).
- `custom` blocks `gh auth` (except `auth status` without `--show-token`), `gh extension` and `gh alias`.
- `api` accepts only relative endpoints, not absolute URLs.
- GitHub tokens (`ghp_…`, `github_pat_…`) and credentials embedded in URLs are redacted from `command`, `stdout`, `stderr` and `error`.
- Output is capped at 200 KB of stdout.

## Outputs

The canvas has two branch handles:

- `done`: the command succeeded.
- `onFailed`: the command failed and `failOnError` is off.

The node's data is stored as state variables. Reference them with `{{nodeName.field}}`:

| Field | Description |
| :--- | :--- |
| `success` | `true` when gh exited 0. |
| `data` | Parsed JSON from `--json` actions and from `api`. Otherwise `null`. |
| `result` | `data` when it exists, otherwise the stdout text. For example, the diff for `pr-diff`. |
| `stdout` / `stderr` | Redacted gh output. |
| `url` / `number` | PR or issue URL and number. Taken from JSON output, or read from the URL that `pr-create` / `issue-create` print. |
| `clonedPath` | Absolute path of the clone (`repo-clone` only). |
| `command`, `workingDirectory`, `exitCode`, `durationMs`, `error` | Execution details. |

## Branches

- `failOnError: true` (default): a failing command fails the node and the run, like other action nodes.
- `failOnError: false`: a failing command returns `success: false` with `error`, `exitCode` and `stderr`, and the run continues on the `onFailed` branch. Use this to handle cases such as "PR already exists" or "checks failing" inside the flow.

## Example: agent writes a PR description, then opens the PR

```json
{
  "id": "open_pr",
  "kind": "github",
  "name": "open_pr",
  "definitionName": "GitHub CLI",
  "label": "Open pull request",
  "config": {
    "action": "pr-create",
    "title": "{{describe_change.result.title}}",
    "body": "{{describe_change.result.body}}",
    "base": "main",
    "draft": true
  }
}
```

A downstream node can then read `{{open_pr.url}}` and `{{open_pr.number}}`. For example, a second `github` node with `action: "pr-checks"` and `number: "{{open_pr.number}}"`.

## Tests

`npx ts-node test/github.spec.ts`. The tests use a fake `gh` binary (set through `GH_CLI_BIN`) that echoes its arguments. They cover command building, the path, repository and custom-command guards, failure handling, and `done` / `onFailed` routing. They make no network calls.
