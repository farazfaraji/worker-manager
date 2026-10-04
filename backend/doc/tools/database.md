# Database Tool Documentation & Usage Guide

The **Database** node queries MongoDB or PostgreSQL. The connection string lives in a project secret named by `connectionSecret`. It is never stored on the node, and it is redacted anywhere it would otherwise be logged.

The node is **read-only by default**. Insert, update, delete, `execute`, and `transaction` throw until `readOnly` is false. Those writes are also non-retryable, so a retry cannot apply them twice.

Pools are cached per project, secret, and driver, closed after 10 minutes idle, and closed on shutdown. If the secret value changes, the next run opens a new pool.

---

## Shared fields

| Field | Default | Description |
| :--- | :--- | :--- |
| `driver` | `mongodb` | `mongodb` or `postgres`. |
| `connectionSecret` | — | Secret name holding the URI, for example `MONGO_URI`. |
| `readOnly` | `true` | Blocks every write operation. |
| `maxRows` | `1000` | Upper bound on returned documents or rows (max 5000). |
| `timeoutMs` | `15000` | Driver statement timeout. |
| `outputSchema` | — | Optional Zod schema for downstream autocomplete. |

`ping` routes along `true` when the server responds and `false` when the connection fails.

## MongoDB

| Operation | Notes |
| :--- | :--- |
| `find` | `filter`, `projection`, `sort`, `limit`, `skip`. |
| `findOne`, `count`, `distinct` | `distinct` needs `field`. |
| `aggregate` | `pipeline` array. |
| `insertOne`, `insertMany` | Writes. `document` or `documents`. |
| `updateOne`, `updateMany` | Writes. `filter` and `update`. |
| `deleteOne`, `deleteMany` | Writes. |
| `listCollections`, `describe` | Names, or a sample document's keys plus indexes. |

`$where`, `$function`, and `$accumulator` are rejected. The node can only touch the `collection` named in the config.

## PostgreSQL

| Operation | Notes |
| :--- | :--- |
| `query` | A single `SELECT` or `WITH`. Returns `{ rows, rowCount, fields }`. |
| `execute` | A single `INSERT`, `UPDATE`, or `DELETE`. Write. |
| `transaction` | Array of `{ sql, params }`, committed or rolled back together. Write. |
| `listTables`, `describe` | `describe` needs `table`. |

Pass values in `params` as `$1`, `$2`, …. SQL that contains `{{ }}` is rejected unless `allowRawSql` is enabled. Multiple statements in one string are rejected.

```json
{
  "driver": "postgres",
  "connectionSecret": "DATABASE_URL",
  "operation": "query",
  "sql": "SELECT id, title FROM articles WHERE status = $1",
  "params": ["open"]
}
```
