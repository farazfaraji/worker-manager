# Artifact Tool

The Artifact node stores versioned documents for a project: PRDs, specs, decisions, and code. Each change can publish a domain event.

## How an artifact is organized

| Field | Meaning | Example |
| :--- | :--- | :--- |
| Project | Who owns it. Every read and write stays inside this project. | `checkout` |
| Logical ID | Stable name across all versions. The server generates the physical version ID. | `checkout-prd` |
| Type | What the artifact is. | `prd`, `tech-spec`, `task`, `code` |
| Category | The one subject it belongs to, like a folder. | `billing` |
| Tags | Extra search labels. An artifact can have many. | `jwt`, `rotation` |
| Status | Lifecycle of the current version. | `draft`, `in-review`, `approved`, `rejected`, `archived` |

A new version always starts as `draft`. Approve, reject, archive, and unarchive change status without copying the body. Update copies the body into a new draft version. If nothing material changed, the node returns `changed: false` and follows **On Unchanged**.

## Operations

| Operation | What it does |
| :--- | :--- |
| `create` | Stores version 1. `ifExists` can fail, return the current artifact, or update it. |
| `get` | Reads the latest version, or the version number you pass. |
| `list` | Filters by type, category, tags, and status. Content is omitted unless Include content is on. |
| `listVersions` | Returns the version history for one logical ID. |
| `update` | Writes a new version. Pass Expected version to reject a stale write. |
| `diff` | Compares two version numbers. Format can be summary, line diff, or JSON. |
| `approve` / `reject` | Marks the selected version approved or rejected. Reject stores a reason. |
| `archive` / `unarchive` | Hides a version, or brings it back to draft. |
| `restore` | Copies an older version into a new draft. |
| `delete` | Removes every version of that logical ID in the project. |
| `addRelation` / `getRelations` / `removeRelation` | Links two logical IDs. The inverse link is created and removed with it. |

## Branches

| Handle | When it runs |
| :--- | :--- |
| On Success | The operation completed. |
| On Unchanged | An update did not change the artifact. |
| On Not Found | The logical ID or version does not exist. |
| On Conflict | The logical ID already exists, or Expected version does not match. |
| On Failed | Anything else. |

Useful variables: `logicalId`, `artifactId`, `version`, `category`, `tags`, `content`, `changed`, `diff`.

## Relations

| Relation | Inverse |
| :--- | :--- |
| `refines` | `refined-by` |
| `has-techspec` | `techspec-for` |
| `decomposes-to` | `decomposed-from` |
| `depends-on` | `required-by` |
| `constrains` | `constrained-by` |
| `derived-from` | `source-of` |
| `conflicts-with` | `conflicts-with` |
| `relates-to` | `relates-to` |

## API

| Endpoint | Method | Purpose |
| :--- | :--- | :--- |
| `/api/artifacts` | `GET` | List. Query: `projectId`, `type`, `category`, `tags`, `status`, `query`, `latestOnly`, `limit`, `offset` |
| `/api/artifacts` | `POST` | Create |
| `/api/artifacts/:id` | `GET` | Get by logical ID or version ID. Optional `version` |
| `/api/artifacts/:id` | `PATCH` | New version |
| `/api/artifacts/:id/versions` | `GET` | History |
| `/api/artifacts/:id/approve` | `POST` | Approve |
| `/api/artifacts/:id/reject` | `POST` | Reject |
| `/api/artifacts/:id/archive` | `POST` | Archive |
| `/api/artifacts/:id/unarchive` | `POST` | Unarchive |
| `/api/artifacts/:id/restore` | `POST` | Restore a version (`version` in the body) |
| `/api/artifacts/:id` | `DELETE` | Delete the logical artifact |
| `/api/artifacts/:id/relations` | `GET` / `POST` | Read or add a typed relation |
| `/api/artifacts/:id/relations/:relId` | `DELETE` | Remove a relation and its inverse |
