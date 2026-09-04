import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { NodeDefinitionsService } from '../src/node-definitions/node-definitions.service';
import { BlockRuntimeService } from '../src/blocks/block-runtime.service';
import { GraphRunnerService } from '../src/runs/graph-runner.service';

// Helper mock factory for GraphRunnerService
function createTestGraphRunner(runGraphStub?: (graphId: string, input: any, options: any) => Promise<any>): GraphRunnerService {
  const runner = new (GraphRunnerService as any)(
    {} as any, // graphsService
    {} as any, // runModel
    {} as any, // checkpointModel
    {} as any, // variableResolver
    {} as any, // nodeExecutor
    {} as any, // browserRunner
  );
  if (runGraphStub) {
    runner.runGraph = runGraphStub;
  }
  return runner;
}

// Helper mock factory for BlockRuntimeService
function createTestBlockRuntime(): BlockRuntimeService {
  return new BlockRuntimeService(
    {} as any, // artifacts
    {} as any, // memory
    {} as any, // traces
    {} as any, // agentRunner
    {} as any, // browserRunner
    {} as any, // embeddings
    {} as any, // vectors
  );
}

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING CONTROL BLOCKS TEST SUITE');
  console.log('=============================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err?.message || err}`);
      if (err?.stack) console.error(err.stack);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // 1. Tool Definition Tests
  // -------------------------------------------------------------
  console.log('--- Tool Definition Tests ---');

  await test('foreach.json and aggregate.json are valid JSON files', () => {
    const foreachRaw = fs.readFileSync(path.resolve(__dirname, '../src/tools/foreach.json'), 'utf-8');
    const aggregateRaw = fs.readFileSync(path.resolve(__dirname, '../src/tools/aggregate.json'), 'utf-8');
    const foreachJson = JSON.parse(foreachRaw);
    const aggregateJson = JSON.parse(aggregateRaw);

    assert.strictEqual(foreachJson.type, 'foreach');
    assert.strictEqual(aggregateJson.type, 'aggregate');
  });

  await test('NodeDefinitionsService returns foreach and aggregate categorized under Control', async () => {
    const service = new NodeDefinitionsService();
    const defs = await service.getAllDefinitions();

    const foreachDef = defs.find((d) => d.type === 'foreach');
    const aggregateDef = defs.find((d) => d.type === 'aggregate');

    assert.ok(foreachDef, 'foreach definition must exist');
    assert.ok(aggregateDef, 'aggregate definition must exist');
    assert.strictEqual(foreachDef.category, 'Control');
    assert.strictEqual(aggregateDef.category, 'Control');
  });

  await test('All inputs of foreach and aggregate are supported frontend types', async () => {
    const service = new NodeDefinitionsService();
    const defs = await service.getAllDefinitions();

    const supportedInputTypes = new Set(['valueOrVariable', 'select', 'number', 'checkbox', 'code']);

    const foreachDef = defs.find((d) => d.type === 'foreach')!;
    for (const input of foreachDef.inputs) {
      assert.ok(
        supportedInputTypes.has(input.type),
        `foreach input "${input.name}" has unsupported type: ${input.type}`,
      );
    }

    const aggregateDef = defs.find((d) => d.type === 'aggregate')!;
    for (const input of aggregateDef.inputs) {
      assert.ok(
        supportedInputTypes.has(input.type),
        `aggregate input "${input.name}" has unsupported type: ${input.type}`,
      );
    }
  });

  await test('foreach output has result object with schemaFrom outputType', async () => {
    const service = new NodeDefinitionsService();
    const defs = await service.getAllDefinitions();
    const foreachDef = defs.find((d) => d.type === 'foreach')!;

    assert.strictEqual(foreachDef.outputs.length, 1);
    assert.strictEqual(foreachDef.outputs[0].name, 'result');
    assert.strictEqual(foreachDef.outputs[0].type, 'object');
    assert.strictEqual(foreachDef.outputs[0].schemaFrom, 'outputType');
  });

  // -------------------------------------------------------------
  // 2. Foreach Execution Tests
  // -------------------------------------------------------------
  console.log('\n--- Foreach Execution Tests ---');

  const validGraphId = '507f1f77bcf86cd799439011';

  await test('foreach handles empty input collection', async () => {
    let callCount = 0;
    const runner = createTestGraphRunner(async () => {
      callCount++;
      return { status: 'completed', runId: 'child-1', output: {} };
    });

    const res = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items: [], graphId: validGraphId },
      'parent-run-1',
    );

    assert.strictEqual(callCount, 0);
    assert.strictEqual(res.result.status, 'completed');
    assert.strictEqual(res.result.count, 0);
    assert.strictEqual(res.result.processed, 0);
    assert.strictEqual(res.result.truncated, false);
    assert.deepStrictEqual(res.result.items, []);
    assert.deepStrictEqual(res.result.errors, []);
  });

  await test('foreach processes single item and passes reserved child contract fields', async () => {
    let capturedInput: any = null;
    let capturedOptions: any = null;

    const runner = createTestGraphRunner(async (_id, input, options) => {
      capturedInput = input;
      capturedOptions = options;
      return { status: 'completed', runId: 'child-run-42', output: { processed: true, value: input.item } };
    });

    const res = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      {
        items: ['apple'],
        graphId: validGraphId,
        baseInput: { projectId: 'proj-123', item: 'will-be-overridden', index: 999, total: 999 },
      },
      'parent-run-100',
    );

    assert.strictEqual(capturedOptions.parentRunId, 'parent-run-100');
    assert.strictEqual(capturedInput.projectId, 'proj-123');
    assert.strictEqual(capturedInput.item, 'apple');
    assert.strictEqual(capturedInput.index, 0);
    assert.strictEqual(capturedInput.total, 1);

    assert.strictEqual(res.result.status, 'completed');
    assert.strictEqual(res.result.count, 1);
    assert.strictEqual(res.result.processed, 1);
    assert.strictEqual(res.result.truncated, false);
    assert.strictEqual(res.result.items.length, 1);
    assert.strictEqual(res.result.items[0].index, 0);
    assert.strictEqual(res.result.items[0].status, 'completed');
    assert.strictEqual(res.result.items[0].childRunId, 'child-run-42');
    assert.deepStrictEqual(res.result.items[0].result, { processed: true, value: 'apple' });
  });

  await test('foreach accepts input object containing items array', async () => {
    const runner = createTestGraphRunner(async (_id, input) => {
      return { status: 'completed', runId: `child-${input.index}`, output: { item: input.item } };
    });

    const res = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items: { items: ['x', 'y', 'z'] }, graphId: validGraphId },
      'parent-run-1',
    );

    assert.strictEqual(res.result.status, 'completed');
    assert.strictEqual(res.result.count, 3);
    assert.strictEqual(res.result.processed, 3);
    assert.strictEqual(res.result.items.length, 3);
  });

  await test('foreach preserves output order regardless of execution timing', async () => {
    // Artificial delay to finish out of order if parallel
    const runner = createTestGraphRunner(async (_id, input) => {
      const delay = input.index === 0 ? 50 : 10;
      await new Promise((r) => setTimeout(r, delay));
      return { status: 'completed', runId: `child-${input.index}`, output: { val: input.item } };
    });

    const res = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items: ['a', 'b', 'c', 'd'], graphId: validGraphId, concurrency: 4 },
      'parent-run-1',
    );

    assert.strictEqual(res.result.items.length, 4);
    assert.strictEqual(res.result.items[0].index, 0);
    assert.strictEqual(res.result.items[0].item, 'a');
    assert.strictEqual(res.result.items[1].index, 1);
    assert.strictEqual(res.result.items[1].item, 'b');
    assert.strictEqual(res.result.items[2].index, 2);
    assert.strictEqual(res.result.items[2].item, 'c');
    assert.strictEqual(res.result.items[3].index, 3);
    assert.strictEqual(res.result.items[3].item, 'd');
  });

  await test('foreach enforces maxIterations and marks truncated: true', async () => {
    let executedCount = 0;
    const runner = createTestGraphRunner(async () => {
      executedCount++;
      return { status: 'completed', runId: 'child-1', output: {} };
    });

    const items = Array.from({ length: 30 }, (_, i) => `item-${i}`);
    const res = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items, graphId: validGraphId, maxIterations: 5 },
      'parent-run-1',
    );

    assert.strictEqual(executedCount, 5);
    assert.strictEqual(res.result.count, 30);
    assert.strictEqual(res.result.processed, 5);
    assert.strictEqual(res.result.truncated, true);
    assert.strictEqual(res.result.items.length, 5);
  });

  await test('foreach rejects invalid maxIterations (< 1 or > 100 or non-number)', async () => {
    const runner = createTestGraphRunner(async () => ({ status: 'completed' }));

    const resNegative = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items: [1, 2], graphId: validGraphId, maxIterations: 0 },
      'parent-run-1',
    );
    assert.strictEqual(resNegative.result.status, 'failed');
    assert.ok(resNegative.result.errors.length > 0);

    const resTooLarge = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items: [1, 2], graphId: validGraphId, maxIterations: 101 },
      'parent-run-1',
    );
    assert.strictEqual(resTooLarge.result.status, 'failed');

    const resInvalidType = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items: [1, 2], graphId: validGraphId, maxIterations: 'abc' },
      'parent-run-1',
    );
    assert.strictEqual(resInvalidType.result.status, 'failed');
  });

  await test('foreach rejects invalid items input', async () => {
    const runner = createTestGraphRunner(async () => ({ status: 'completed' }));

    const res = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items: 12345, graphId: validGraphId },
      'parent-run-1',
    );
    assert.strictEqual(res.result.status, 'failed');
    assert.strictEqual(res.result.processed, 0);
  });

  await test('foreach rejects invalid baseInput (non-object or array)', async () => {
    const runner = createTestGraphRunner(async () => ({ status: 'completed' }));

    const resArray = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items: [1], graphId: validGraphId, baseInput: ['invalid', 'array'] },
      'parent-run-1',
    );
    assert.strictEqual(resArray.result.status, 'failed');

    const resString = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items: [1], graphId: validGraphId, baseInput: 'not-an-object' },
      'parent-run-1',
    );
    assert.strictEqual(resString.result.status, 'failed');
  });

  await test('foreach rejects missing or invalid graphId', async () => {
    const runner = createTestGraphRunner(async () => ({ status: 'completed' }));

    const resMissing = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items: [1, 2] },
      'parent-run-1',
    );
    assert.strictEqual(resMissing.result.status, 'failed');

    const resInvalid = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items: [1, 2], graphId: 'not-a-mongo-id' },
      'parent-run-1',
    );
    assert.strictEqual(resInvalid.result.status, 'failed');
  });

  await test('foreach bounds concurrency and caps at 10', async () => {
    let activeWorkers = 0;
    let maxActiveWorkers = 0;

    const runner = createTestGraphRunner(async () => {
      activeWorkers++;
      if (activeWorkers > maxActiveWorkers) maxActiveWorkers = activeWorkers;
      await new Promise((r) => setTimeout(r, 20));
      activeWorkers--;
      return { status: 'completed', runId: 'child-run', output: {} };
    });

    const items = Array.from({ length: 15 }, (_, i) => i);
    await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items, graphId: validGraphId, concurrency: 50 }, // exceeds 10 cap
      'parent-run-1',
    );

    assert.ok(maxActiveWorkers <= 10, `Active workers (${maxActiveWorkers}) exceeded maximum bound of 10`);
  });

  await test('foreach continues processing remaining items when stopOnError is false and reports partial status', async () => {
    const runner = createTestGraphRunner(async (_id, input) => {
      if (input.index === 1) {
        throw new Error('Simulated item 1 failure');
      }
      return { status: 'completed', runId: `child-${input.index}`, output: { val: input.item } };
    });

    const res = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items: ['a', 'b', 'c'], graphId: validGraphId, stopOnError: false },
      'parent-run-1',
    );

    assert.strictEqual(res.result.status, 'partial');
    assert.strictEqual(res.result.processed, 3);
    assert.strictEqual(res.result.items.length, 3);
    assert.strictEqual(res.result.items[0].status, 'completed');
    assert.strictEqual(res.result.items[1].status, 'failed');
    assert.strictEqual(res.result.items[2].status, 'completed');
    assert.strictEqual(res.result.errors.length, 1);
    assert.strictEqual(res.result.errors[0].index, 1);
  });

  await test('foreach halts new iterations when stopOnError is true and reports failed status', async () => {
    let startedCount = 0;
    const runner = createTestGraphRunner(async (_id, input) => {
      startedCount++;
      if (input.index === 0) {
        throw new Error('Fatal error on item 0');
      }
      return { status: 'completed', runId: `child-${input.index}`, output: {} };
    });

    const res = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items: ['a', 'b', 'c', 'd', 'e'], graphId: validGraphId, concurrency: 1, stopOnError: true },
      'parent-run-1',
    );

    assert.strictEqual(res.result.status, 'failed');
    assert.strictEqual(startedCount, 1, 'Only 1 item should have started under sequential stopOnError');
    assert.strictEqual(res.result.processed, 1);
    assert.strictEqual(res.result.errors.length, 1);
  });

  await test('foreach handles child graph returning waiting status as controlled failure', async () => {
    const runner = createTestGraphRunner(async () => {
      return { status: 'waiting', runId: 'child-waiting-run', output: { gate: 'approval' } };
    });

    const res = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items: ['task-1'], graphId: validGraphId },
      'parent-run-1',
    );

    assert.strictEqual(res.result.status, 'partial');
    assert.strictEqual(res.result.items.length, 1);
    assert.strictEqual(res.result.items[0].status, 'failed');
    assert.strictEqual(res.result.items[0].childRunId, 'child-waiting-run');
    assert.strictEqual(res.result.items[0].error.errorCode, 'FOREACH_CHILD_WAITING_UNSUPPORTED');
  });

  await test('foreach supports outputMode state and result', async () => {
    const runner = createTestGraphRunner(async () => {
      return { status: 'completed', runId: 'c1', output: { summary: 'ok' }, nodes: [{ id: 'n1', status: 'completed' }] };
    });

    const resResult = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items: ['a'], graphId: validGraphId, outputMode: 'result' },
      'parent-run-1',
    );
    assert.deepStrictEqual(resResult.result.items[0].result, { summary: 'ok' });

    const resState = await runner.executeForeachNode(
      { id: 'node_1', data: { name: 'foreach_1' } },
      { items: ['a'], graphId: validGraphId, outputMode: 'state' },
      'parent-run-1',
    );
    assert.deepStrictEqual(resState.result.items[0].result, [{ id: 'n1', status: 'completed' }]);
  });

  // -------------------------------------------------------------
  // 3. Aggregate Execution Tests
  // -------------------------------------------------------------
  console.log('\n--- Aggregate Execution Tests ---');

  await test('aggregate processes raw array of successful items', async () => {
    const blockRuntime = createTestBlockRuntime();
    const rawItems = [
      { id: 1, title: 'Item 1' },
      { id: 2, title: 'Item 2' },
    ];

    const out = await blockRuntime.execute('aggregate', { input: rawItems });
    assert.strictEqual(out.status, 'completed');
    assert.strictEqual(out.result.count, 2);
    assert.strictEqual(out.result.successCount, 2);
    assert.strictEqual(out.result.failureCount, 0);
    assert.strictEqual(out.result.allSucceeded, true);
    assert.strictEqual(out.result.truncated, false);
    assert.deepStrictEqual(out.result.items, rawItems);
    assert.deepStrictEqual(out.result.errors, []);
  });

  await test('aggregate processes foreach result shape with mixed successes and failures', async () => {
    const blockRuntime = createTestBlockRuntime();
    const foreachInput = {
      status: 'partial',
      count: 3,
      processed: 3,
      truncated: true,
      items: [
        { index: 0, item: 'a', status: 'completed', result: { val: 'A' }, childRunId: 'run-1' },
        { index: 1, item: 'b', status: 'failed', childRunId: 'run-2', error: 'Timed out' },
        { index: 2, item: 'c', status: 'completed', result: { val: 'C' }, childRunId: 'run-3' },
      ],
      errors: [{ index: 1, childRunId: 'run-2', error: 'Timed out' }],
    };

    const out = await blockRuntime.execute('aggregate', { input: foreachInput });
    assert.strictEqual(out.status, 'completed');
    assert.strictEqual(out.result.count, 3);
    assert.strictEqual(out.result.successCount, 2);
    assert.strictEqual(out.result.failureCount, 1);
    assert.strictEqual(out.result.allSucceeded, false);
    assert.strictEqual(out.result.truncated, true);
    assert.strictEqual(out.result.errors.length, 1);
    assert.strictEqual(out.result.errors[0].index, 1);
  });

  await test('aggregate filters by includeSuccessful: false and includeFailed: false', async () => {
    const blockRuntime = createTestBlockRuntime();
    const mixedItems = [
      { id: 1, status: 'completed' },
      { id: 2, status: 'failed', error: 'Fail' },
      { id: 3, status: 'completed' },
    ];

    // Only failed items
    const failedOnly = await blockRuntime.execute('aggregate', {
      input: mixedItems,
      config: { includeSuccessful: false, includeFailed: true },
    });
    assert.strictEqual(failedOnly.result.count, 1);
    assert.strictEqual(failedOnly.result.items[0].id, 2);
    assert.strictEqual(failedOnly.result.successCount, 2);
    assert.strictEqual(failedOnly.result.failureCount, 1);

    // Only successful items
    const successOnly = await blockRuntime.execute('aggregate', {
      input: mixedItems,
      config: { includeSuccessful: true, includeFailed: false },
    });
    assert.strictEqual(successOnly.result.count, 2);
    assert.strictEqual(successOnly.result.items[0].id, 1);
    assert.strictEqual(successOnly.result.items[1].id, 3);
  });

  await test('aggregate handles empty items collection', async () => {
    const blockRuntime = createTestBlockRuntime();
    const out = await blockRuntime.execute('aggregate', { input: [] });

    assert.strictEqual(out.status, 'completed');
    assert.strictEqual(out.result.count, 0);
    assert.strictEqual(out.result.successCount, 0);
    assert.strictEqual(out.result.failureCount, 0);
    assert.strictEqual(out.result.allSucceeded, true);
    assert.deepStrictEqual(out.result.items, []);
  });

  await test('aggregate returns controlled failure on invalid input', async () => {
    const blockRuntime = createTestBlockRuntime();
    const out = await blockRuntime.execute('aggregate', { input: 12345 });

    assert.strictEqual(out.status, 'failed');
    assert.strictEqual(out.result.count, 0);
    assert.strictEqual(out.result.allSucceeded, false);
    assert.ok(out.result.errors.length > 0);
  });

  // -------------------------------------------------------------
  // 4. Regression Tests
  // -------------------------------------------------------------
  console.log('\n--- Regression Tests ---');

  await test('existing loop block behavior is completely preserved', async () => {
    const blockRuntime = createTestBlockRuntime();
    const inputItems = ['first', 'second', 'third'];

    const out = await blockRuntime.execute('loop', {
      input: inputItems,
      config: { maxIterations: 2 },
    });

    assert.strictEqual(out.status, 'completed');
    assert.strictEqual(out.result.count, 2);
    assert.strictEqual(out.result.truncated, true);
    assert.deepStrictEqual(out.result.items, [
      { index: 0, item: 'first' },
      { index: 1, item: 'second' },
    ]);
  });

  console.log('\n=============================================');
  console.log(`📊 RESULTS: ${passed} passed, ${failed} failed`);
  console.log('=============================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
