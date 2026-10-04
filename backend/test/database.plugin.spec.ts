import { DatabasePlugin } from '../src/runs/plugins/database.plugin';

function plugin() {
  const calls: string[] = [];
  const secrets = {
    async resolve() {
      return 'mongodb://user:super-secret-token@localhost/app';
    },
  };
  const connector = {
    async getMongo() {
      calls.push('mongo');
      return {
        db() {
          return {
            async command() {
              return { ok: 1 };
            },
            collection() {
              return {
                find() {
                  return {
                    sort() { return this; },
                    skip() { return this; },
                    limit() { return this; },
                    async toArray() {
                      return [{ _id: 1, title: 'a' }];
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    async getPostgres() {
      calls.push('postgres');
      return { connect: async () => { throw new Error('should not connect'); } };
    },
  };
  return { plugin: new DatabasePlugin(connector as any, secrets as any), calls };
}

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING DATABASE PLUGIN TESTS');
  console.log('=============================================\n');

  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  const ctx = { projectId: 'p1', runId: 'run-1' };
  const run = (tool: DatabasePlugin, config: any) => tool.run({
    node: { data: { config } },
    nodeInput: config,
    context: ctx,
    initialInput: {},
    runId: 'run-1',
  });

  const first = plugin();
  const ping = await run(first.plugin, { driver: 'mongodb', connectionSecret: 'MONGO_URI', operation: 'ping' });
  assert(ping.conditionMet === true && ping.result.ok === true, 'ping sets conditionMet when the server responds');

  const found = await run(first.plugin, {
    driver: 'mongodb',
    connectionSecret: 'MONGO_URI',
    operation: 'find',
    collection: 'articles',
    filter: { status: 'open' },
  });
  assert(found.result.documents.length === 1 && found.result.rowCount === 1, 'find returns documents');
  assert(!JSON.stringify(found).includes('super-secret-token'), 'connection URI is not part of the result');

  let readOnly = false;
  try {
    await run(first.plugin, {
      driver: 'mongodb',
      connectionSecret: 'MONGO_URI',
      operation: 'insertOne',
      collection: 'articles',
      document: { title: 'x' },
      readOnly: true,
    });
  } catch (err: any) {
    readOnly = /read-only/i.test(err.message);
  }
  assert(readOnly, 'readOnly blocks insertOne');

  let unsafe = false;
  try {
    await run(first.plugin, {
      driver: 'mongodb',
      connectionSecret: 'MONGO_URI',
      operation: 'find',
      collection: 'articles',
      filter: { $where: 'this.a == 1' },
      readOnly: true,
    });
  } catch (err: any) {
    unsafe = /\$where/.test(err.message);
  }
  assert(unsafe, '$where is rejected');

  const sqlTool = plugin();
  let rawSql = false;
  try {
    await run(sqlTool.plugin, {
      driver: 'postgres',
      connectionSecret: 'DATABASE_URL',
      operation: 'query',
      sql: 'SELECT * FROM articles WHERE id = {{input.id}}',
      readOnly: true,
    });
  } catch (err: any) {
    rawSql = /Parameterized/.test(err.message);
  }
  assert(rawSql, 'template SQL is rejected unless allowRawSql is set');
  assert(sqlTool.calls.includes('postgres'), 'postgres driver is selected from the connection secret');

  console.log(`\n=============================================`);
  console.log(`📊 RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`=============================================\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
