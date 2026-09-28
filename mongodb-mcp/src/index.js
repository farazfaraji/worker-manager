import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { BSON, MongoClient } from 'mongodb';
import * as z from 'zod/v4';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is required');
  process.exit(1);
}

const readOnly = process.env.MONGODB_MCP_ALLOW_WRITES !== 'true';
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
const database = client.db(process.env.MONGODB_DATABASE || undefined);
const documentSchema = z.record(z.string(), z.unknown());
const collectionSchema = z.string().min(1).max(255);
const maxDocuments = 100;
class InputError extends Error {}

function result(value) {
  const output = BSON.EJSON.stringify(value, null, 2);
  if (output.length > 1_000_000) {
    return { isError: true, content: [{ type: 'text', text: 'Result exceeds 1 MB. Narrow the query or projection.' }] };
  }
  return { content: [{ type: 'text', text: output }] };
}

function failure(error) {
  if (error instanceof InputError) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
  // MongoDB errors can contain connection details; keep them off the MCP channel.
  console.error(error);
  return { isError: true, content: [{ type: 'text', text: `MongoDB operation failed: ${error.codeName || error.name || 'Error'}` }] };
}

function tool(server, name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema }, async (input) => {
    try {
      return result(await handler(input));
    } catch (error) {
      return failure(error);
    }
  });
}

function decode(value) {
  return BSON.EJSON.deserialize(value);
}

function validatePipeline(pipeline) {
  const forbidden = new Set(['$out', '$merge', '$function', '$accumulator']);
  function containsForbidden(value) {
    if (Array.isArray(value)) return value.some(containsForbidden);
    if (value && typeof value === 'object') {
      return Object.entries(value).some(([key, nested]) => forbidden.has(key) || containsForbidden(nested));
    }
    return false;
  }
  if (pipeline.some((stage) => Object.keys(stage).length !== 1) || containsForbidden(pipeline)) {
    throw new InputError('Aggregation pipeline contains an unsupported stage or expression');
  }
}

function createServer() {
  const server = new McpServer({ name: 'mongodb', version: '1.0.0' }, {
    instructions: `Connected to one configured MongoDB database. Results use MongoDB Extended JSON. Writes are ${readOnly ? 'disabled' : 'enabled'}.`,
  });

  tool(server, 'list_collections', 'List collections in the configured database.', z.object({}),
    async () => database.listCollections({}, { nameOnly: true }).toArray());

  tool(server, 'find', 'Find documents in a collection. The result is capped at 100 documents.', z.object({
    collection: collectionSchema,
    filter: documentSchema.default({}),
    projection: documentSchema.optional(),
    sort: documentSchema.optional(),
    limit: z.number().int().min(1).max(maxDocuments).default(20),
  }), async ({ collection, filter, projection, sort, limit }) => {
    const cursor = database.collection(collection).find(decode(filter), {
      projection: projection ? decode(projection) : undefined,
      sort: sort ? decode(sort) : undefined,
      limit,
      maxTimeMS: 10000,
    });
    return cursor.toArray();
  });

  tool(server, 'count_documents', 'Count documents matching a filter.', z.object({
    collection: collectionSchema,
    filter: documentSchema.default({}),
  }), async ({ collection, filter }) => ({ count: await database.collection(collection).countDocuments(decode(filter), { maxTimeMS: 10000 }) }));

  tool(server, 'aggregate', 'Run a read-only aggregation pipeline, capped at 100 results.', z.object({
    collection: collectionSchema,
    pipeline: z.array(documentSchema).max(30),
    limit: z.number().int().min(1).max(maxDocuments).default(20),
  }), async ({ collection, pipeline, limit }) => {
    validatePipeline(pipeline);
    return database.collection(collection).aggregate([...decode(pipeline), { $limit: limit }], { maxTimeMS: 10000 }).toArray();
  });

  if (!readOnly) {
    tool(server, 'insert_one', 'Insert one document into a collection.', z.object({
      collection: collectionSchema,
      document: documentSchema,
    }), async ({ collection, document }) => {
      const response = await database.collection(collection).insertOne(decode(document));
      return { insertedId: response.insertedId };
    });

    tool(server, 'update_one', 'Update one matching document using update operators.', z.object({
      collection: collectionSchema,
      filter: documentSchema,
      update: documentSchema,
      upsert: z.boolean().default(false),
    }), async ({ collection, filter, update, upsert }) => {
      if (!Object.keys(update).length || Object.keys(update).some((key) => !key.startsWith('$'))) {
        throw new InputError('Update must use update operators');
      }
      const response = await database.collection(collection).updateOne(decode(filter), decode(update), { upsert });
      return { matchedCount: response.matchedCount, modifiedCount: response.modifiedCount, upsertedId: response.upsertedId };
    });

    tool(server, 'delete_one', 'Delete one matching document.', z.object({
      collection: collectionSchema,
      filter: documentSchema,
    }), async ({ collection, filter }) => {
      if (!Object.keys(filter).length) throw new InputError('A nonempty filter is required');
      const response = await database.collection(collection).deleteOne(decode(filter));
      return { deletedCount: response.deletedCount };
    });
  }

  return server;
}

const handle = serveStdio(createServer);
process.on('SIGINT', () => { void client.close().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { void client.close().finally(() => process.exit(0)); });
await handle;
