# MongoDB MCP server

Standalone MCP server for one MongoDB database. It uses the local stdio transport and exposes `list_collections`, `find`, `count_documents`, and `aggregate`. Writes are disabled by default. Set `MONGODB_MCP_ALLOW_WRITES=true` to also expose `insert_one`, `update_one`, and `delete_one`.

## Setup

Requires Node.js 20 or later.

```sh
cd mongodb-mcp
npm install
MONGODB_URI='mongodb://127.0.0.1:27017/flow_builder?directConnection=true' npm start
```

Set `MONGODB_DATABASE` to select a database explicitly. Without it, the database name comes from the URI. Queries accept MongoDB Extended JSON, such as `{ "_id": { "$oid": "..." } }`. Results use Extended JSON too.

Use a MongoDB account with the permissions you intend this MCP client to have. The read-only setting hides mutation tools, and database permissions provide the final access boundary.

Configure an MCP client to launch `node` with the absolute path to `mongodb-mcp/src/index.js`, and pass `MONGODB_URI` (plus optional `MONGODB_DATABASE` and `MONGODB_MCP_ALLOW_WRITES`) as environment variables. For example:

```json
{
  "mongodb": {
    "command": "node",
    "args": ["/absolute/path/to/mongodb-mcp/src/index.js"],
    "env": {
      "MONGODB_URI": "mongodb://127.0.0.1:27017/flow_builder?directConnection=true"
    }
  }
}
```

The server sends protocol messages only to stdout and diagnostics to stderr. Query results are limited to 100 documents and 1 MB, and database operations have a 10 second time limit.
