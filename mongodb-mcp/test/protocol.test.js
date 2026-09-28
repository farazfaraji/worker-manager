import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { createInterface } from 'node:readline';

async function listTools(allowWrites, exerciseDatabase = false) {
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, MONGODB_URI: process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017/test', MONGODB_MCP_ALLOW_WRITES: String(allowWrites) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let nextId = 0;
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    const message = JSON.parse(line);
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  });
  function request(method, params = {}) {
    const id = ++nextId;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      setTimeout(() => reject(new Error(`${method} timed out`)), 5000).unref();
    });
  }
  try {
    const hello = await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    });
    assert.equal(hello.result.serverInfo.name, 'mongodb');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const tools = await request('tools/list');
    assert.ok(!tools.error, JSON.stringify(tools.error));
    if (exerciseDatabase) {
      const response = await request('tools/call', { name: 'list_collections', arguments: {} });
      assert.ok(!response.error, JSON.stringify(response.error));
      assert.equal(response.result.isError, undefined, JSON.stringify(response.result));
      assert.ok(Array.isArray(JSON.parse(response.result.content[0].text)));
    }
    return tools.result.tools.map((tool) => tool.name);
  } finally {
    child.kill();
  }
}

test('read-only mode exposes database reads', async () => {
  assert.deepEqual(await listTools(false), ['list_collections', 'find', 'count_documents', 'aggregate']);
});

test('write mode exposes single-document mutations', async () => {
  assert.deepEqual(await listTools(true), [
    'list_collections', 'find', 'count_documents', 'aggregate', 'insert_one', 'update_one', 'delete_one',
  ]);
});

test('live database read through MCP', { skip: !process.env.MONGODB_TEST_URI }, async () => {
  await listTools(false, true);
});
