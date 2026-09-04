import * as assert from 'assert';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { Run, RunSchema } from '../src/runs/schemas/run.schema';
import {
  RunCheckpoint,
  RunCheckpointSchema,
} from '../src/runs/schemas/run-checkpoint.schema';
import { Graph, GraphSchema } from '../src/graphs/schemas/graph.schema';
import { EventRecord, EventRecordSchema } from '../src/events/schemas/event.schema';
import { GraphRunnerService } from '../src/runs/graph-runner.service';
import { VariableResolverService } from '../src/runs/services/variable-resolver.service';
import { NodeExecutorService } from '../src/runs/services/node-executor.service';
import { BrowserRunnerService } from '../src/runs/services/browser-runner.service';
import { EventEngineService } from '../src/events/event-engine.service';
import { GraphEventDispatcherService } from '../src/graphs/graph-event-dispatcher.service';
import {
  hashToken,
  redactSecrets,
  sanitizeRunForPublic,
} from '../src/runs/services/redaction.util';

const TEST_DB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/flow_builder_reliability_test';

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING EXECUTION & RELIABILITY TEST SUITE');
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

  // Connect to test MongoDB database
  const connection = await mongoose.createConnection(TEST_DB_URI).asPromise();

  // Register schemas on test connection
  const runModel = connection.model(Run.name, RunSchema);
  const checkpointModel = connection.model(RunCheckpoint.name, RunCheckpointSchema);
  const graphModel = connection.model(Graph.name, GraphSchema);
  const eventModel = connection.model(EventRecord.name, EventRecordSchema);

  // Clean test collections before running
  await runModel.deleteMany({});
  await checkpointModel.deleteMany({});
  await graphModel.deleteMany({});
  await eventModel.deleteMany({});

  // Ensure indexes
  await runModel.syncIndexes();
  await checkpointModel.syncIndexes();

  // Create mock / real services
  const graphsServiceMock: any = {
    findOne: async (id: string) => {
      const g = await graphModel.findById(id).lean().exec();
      return g;
    },
    validateGraphVariables: async () => true,
  };

  const variableResolver = new VariableResolverService();
  const browserRunnerMock: any = {
    executeBrowserNode: async () => ({ status: 'completed', result: { ok: true } }),
    closeRuntimeApps: async () => {},
  };

  const nodeExecutorMock: any = {
    executeNode: async (node: any, input: any, context: any) => {
      const type = String(node.data?.definitionType || node.type || '').toLowerCase();
      if (type === 'trigger') {
        return input;
      }
      if (type === 'human-gate' || type === 'humangate') {
        if (context.__resumeDecision) {
          return {
            status: 'completed',
            result: { approved: true, decision: context.__resumeDecision },
          };
        }
        return {
          status: 'waiting',
          result: { question: 'Please review', timeoutMs: 3600000 },
        };
      }
      if (type === 'fail-transient') {
        const attemptsMade = (node as any).__attempts || 0;
        (node as any).__attempts = attemptsMade + 1;
        if (attemptsMade < 1) {
          const err: any = new Error('Gateway Timeout');
          err.status = 504;
          throw err;
        }
        return { success: true, attempts: attemptsMade + 1 };
      }
      if (type === 'fail-validation') {
        const err: any = new Error('Invalid schema configuration');
        err.status = 400;
        throw err;
      }
      if (type === 'fail-timeout') {
        await new Promise((r) => setTimeout(r, 400));
        return { ok: true };
      }
      if (type === 'artifact-mutate') {
        const err: any = new Error('Artifact conflict');
        err.status = 500;
        throw err;
      }
      return { ok: true, node: node.id, ...input };
    },
  };

  const runner = new GraphRunnerService(
    graphsServiceMock,
    runModel as any,
    checkpointModel as any,
    variableResolver,
    nodeExecutorMock,
    browserRunnerMock,
  );

  // Helper to create test graphs
  async function createGraph(name: string, nodes: any[], edges: any[] = []) {
    return graphModel.create({
      projectId: 'default',
      name,
      nodes,
      edges,
    });
  }

  // -------------------------------------------------------------------------
  // 1. Checkpoint Tests
  // -------------------------------------------------------------------------
  console.log('--- 1. Checkpoint Tests ---');

  await test('Initial checkpoint creation on run start and node completion', async () => {
    const graph = await createGraph('Checkpoint Test 1', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start' } },
      { id: 'task1', type: 'task', data: { definitionType: 'task', name: 'task1' } },
    ], [
      { source: 'start', target: 'task1' },
    ]);

    const result = await runner.runGraph(String(graph._id), { msg: 'hello' });
    assert.strictEqual(result.status, 'completed');

    const checkpoints = await checkpointModel.find({ runId: result.runId }).sort({ sequence: 1 }).exec();
    // Seq 1 (start), Seq 2 (start node completed), Seq 3 (task1 node completed), Seq 4 (run completed)
    assert.ok(checkpoints.length >= 3, `Expected at least 3 checkpoints, got ${checkpoints.length}`);
    assert.strictEqual(checkpoints[0].sequence, 1);
    assert.strictEqual(checkpoints[0].status, 'running');
    const finalCp = checkpoints[checkpoints.length - 1];
    assert.strictEqual(finalCp.status, 'completed');
  });

  await test('Checkpoint created on node failure', async () => {
    const graph = await createGraph('Checkpoint Test Fail', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start' } },
      { id: 'failNode', type: 'fail-validation', data: { definitionType: 'fail-validation', name: 'failNode' } },
    ], [
      { source: 'start', target: 'failNode' },
    ]);

    const result = await runner.runGraph(String(graph._id), {});
    assert.strictEqual(result.status, 'failed');

    const checkpoints = await checkpointModel.find({ runId: result.runId }).exec();
    const failedCp = checkpoints.find((cp) => cp.status === 'failed');
    assert.ok(failedCp, 'Expected a checkpoint with failed status');
  });

  await test('Checkpoint created on waiting state', async () => {
    const graph = await createGraph('Checkpoint Test Wait', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start' } },
      { id: 'gate', type: 'human-gate', data: { definitionType: 'human-gate', name: 'gate' } },
    ], [
      { source: 'start', target: 'gate' },
    ]);

    const result = await runner.runGraph(String(graph._id), {});
    assert.strictEqual(result.status, 'waiting');

    const checkpoints = await checkpointModel.find({ runId: result.runId }).exec();
    const waitingCp = checkpoints.find((cp) => cp.status === 'waiting');
    assert.ok(waitingCp, 'Expected a checkpoint with waiting status');
    assert.strictEqual(waitingCp.waitingNodeId, 'gate');
  });

  await test('Checkpoint created on cancellation', async () => {
    const graph = await createGraph('Checkpoint Test Cancel', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start' } },
      { id: 'gate', type: 'human-gate', data: { definitionType: 'human-gate', name: 'gate' } },
    ], [
      { source: 'start', target: 'gate' },
    ]);

    const runResult = await runner.runGraph(String(graph._id), {});
    assert.strictEqual(runResult.status, 'waiting');

    const cancelled = await runner.cancelRun(runResult.runId);
    assert.strictEqual(cancelled.status, 'cancelled');

    const checkpoints = await checkpointModel.find({ runId: runResult.runId }).exec();
    const cancelCp = checkpoints.find((cp) => cp.status === 'cancelled');
    assert.ok(cancelCp, 'Expected a cancellation checkpoint');
  });

  // -------------------------------------------------------------------------
  // 2. Human-Gate & Resume Tests
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Human-Gate & Resume Tests ---');

  await test('Human gate enters waiting and generates single-use hashed token', async () => {
    const graph = await createGraph('Human Gate Test', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start' } },
      { id: 'gate', type: 'human-gate', data: { definitionType: 'human-gate', name: 'gate' } },
      { id: 'end', type: 'task', data: { definitionType: 'task', name: 'end' } },
    ], [
      { source: 'start', target: 'gate' },
      { source: 'gate', target: 'end' },
    ]);

    const runResult = await runner.runGraph(String(graph._id), {});
    assert.strictEqual(runResult.status, 'waiting');
    assert.ok(runResult.resumeToken, 'Public run response on initial waiting includes resumeToken');

    // Verify DB does NOT store raw token, but stores SHA-256 hash
    const dbRun = await runModel.findOne({ runId: runResult.runId }).lean().exec();
    assert.ok(dbRun?.resumeTokenHash, 'resumeTokenHash must be persisted');
    assert.strictEqual(dbRun.resumeTokenHash, hashToken(runResult.resumeToken));
    assert.strictEqual((dbRun as any).resumeToken, undefined, 'Raw resumeToken must NOT be saved in DB');
    assert.ok(dbRun.nodes.some((n) => n.nodeId === 'gate' && n.status === 'waiting'), 'Waiting node must be in run.nodes');
  });

  await test('Resume fails with invalid or missing token', async () => {
    const graph = await createGraph('Invalid Token Test', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start' } },
      { id: 'gate', type: 'human-gate', data: { definitionType: 'human-gate', name: 'gate' } },
    ], [
      { source: 'start', target: 'gate' },
    ]);

    const runResult = await runner.runGraph(String(graph._id), {});
    assert.strictEqual(runResult.status, 'waiting');

    await assert.rejects(
      async () => {
        await runner.resumeRun(runResult.runId, { token: 'invalid_token' });
      },
      /Invalid or expired resume token/,
    );
  });

  await test('Resume succeeds with valid token and token cannot be reused', async () => {
    const graph = await createGraph('Valid Resume Test', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start' } },
      { id: 'gate', type: 'human-gate', data: { definitionType: 'human-gate', name: 'gate' } },
      { id: 'end', type: 'task', data: { definitionType: 'task', name: 'end' } },
    ], [
      { source: 'start', target: 'gate' },
      { source: 'gate', target: 'end' },
    ]);

    const initial = await runner.runGraph(String(graph._id), {});
    assert.strictEqual(initial.status, 'waiting');
    const validToken = initial.resumeToken;

    // First resume: succeeds
    const resumed = await runner.resumeRun(initial.runId, {
      token: validToken,
      decision: 'Approve',
    });
    assert.strictEqual(resumed.status, 'completed');

    // Second resume with same token: rejected
    await assert.rejects(
      async () => {
        await runner.resumeRun(initial.runId, { token: validToken });
      },
      /Run is not in waiting state/,
    );
  });

  await test('Parent run waits for child run and resumes without restarting child', async () => {
    const childGraph = await createGraph('Child Flow', [
      { id: 'c_start', type: 'trigger', data: { definitionType: 'trigger', name: 'c_start' } },
      { id: 'c_gate', type: 'human-gate', data: { definitionType: 'human-gate', name: 'c_gate' } },
    ], [
      { source: 'c_start', target: 'c_gate' },
    ]);

    const parentGraph = await createGraph('Parent Flow', [
      { id: 'p_start', type: 'trigger', data: { definitionType: 'trigger', name: 'p_start' } },
      { id: 'sub', type: 'subgraph', data: { definitionType: 'subgraph', name: 'sub', config: { graphId: String(childGraph._id) } } },
      { id: 'p_end', type: 'task', data: { definitionType: 'task', name: 'p_end' } },
    ], [
      { source: 'p_start', target: 'sub' },
      { source: 'sub', target: 'p_end' },
    ]);

    const parentRun = await runner.runGraph(String(parentGraph._id), {});
    assert.strictEqual(parentRun.status, 'waiting');
    assert.ok(parentRun.waitingChildRunId, 'Parent run must track waitingChildRunId');

    // Get the child run to find its resume token
    const childRunDoc = await runModel.findOne({ runId: parentRun.waitingChildRunId }).exec();
    assert.ok(childRunDoc, 'Child run must exist');
    assert.strictEqual(childRunDoc.status, 'waiting');

    // Provide resume token to resume parent (delegating to child)
    // Create a mock token matching child's hash or clear it for testing
    childRunDoc.resumeTokenHash = hashToken('test_child_token');
    await childRunDoc.save();

    const resumedParent = await runner.resumeRun(parentRun.runId, {
      token: 'test_child_token',
      decision: 'Approved by Manager',
    });
    assert.strictEqual(resumedParent.status, 'completed');
  });

  // -------------------------------------------------------------------------
  // 3. Retry and Timeout Tests
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Retry & Timeout Tests ---');

  await test('Retryable failure succeeds on subsequent attempt with backoff', async () => {
    const graph = await createGraph('Retry Test Transient', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start' } },
      {
        id: 'transient',
        type: 'fail-transient',
        data: {
          definitionType: 'fail-transient',
          name: 'transient',
          config: { maxAttempts: 3, backoffMs: 50 },
        },
      },
    ], [
      { source: 'start', target: 'transient' },
    ]);

    const result = await runner.runGraph(String(graph._id), {});
    assert.strictEqual(result.status, 'completed');

    const transientRecord = result.nodes.find((n: any) => n.nodeId === 'transient');
    assert.ok(transientRecord);
    assert.strictEqual(transientRecord.attempt, 2);
    assert.strictEqual(transientRecord.status, 'completed');
    assert.ok(result.metrics?.retryCount >= 1, 'Metrics must record retryCount');
  });

  await test('Non-retryable failure fails immediately on attempt 1', async () => {
    const graph = await createGraph('Non-Retryable Validation Error', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start' } },
      {
        id: 'valNode',
        type: 'fail-validation',
        data: {
          definitionType: 'fail-validation',
          name: 'valNode',
          config: { maxAttempts: 3, backoffMs: 50 },
        },
      },
    ], [
      { source: 'start', target: 'valNode' },
    ]);

    const result = await runner.runGraph(String(graph._id), {});
    assert.strictEqual(result.status, 'failed');

    const nodeRecord = result.nodes.find((n: any) => n.nodeId === 'valNode');
    assert.ok(nodeRecord);
    assert.strictEqual(nodeRecord.attempt, 1, 'Non-retryable error must not be retried');
    assert.strictEqual(nodeRecord.status, 'failed');
  });

  await test('Artifact mutation operation is never automatically retried', async () => {
    const graph = await createGraph('Artifact Mutation No Retry', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start' } },
      {
        id: 'artCreate',
        type: 'artifact',
        data: {
          definitionType: 'artifact',
          name: 'artCreate',
          config: { operation: 'create', maxAttempts: 3 },
        },
      },
    ], [
      { source: 'start', target: 'artCreate' },
    ]);

    // Force failure in node executor specifically for artCreate
    const origExec = nodeExecutorMock.executeNode;
    nodeExecutorMock.executeNode = async (node: any, input: any, context: any) => {
      if (node.id === 'artCreate') {
        const err: any = new Error('Database temporary connection drop');
        err.status = 503;
        throw err;
      }
      return origExec(node, input, context);
    };

    try {
      const result = await runner.runGraph(String(graph._id), {});
      assert.strictEqual(result.status, 'failed');
      const nodeRecord = result.nodes.find((n: any) => n.nodeId === 'artCreate');
      assert.ok(nodeRecord, 'artCreate record must be present');
      assert.strictEqual(nodeRecord.attempt, 1, 'Artifact mutation must fail after 1 attempt');
    } finally {
      nodeExecutorMock.executeNode = origExec;
    }
  });

  await test('Timeout policy stops long-running node with EXECUTION_TIMEOUT', async () => {
    const graph = await createGraph('Timeout Test', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start' } },
      {
        id: 'slowNode',
        type: 'fail-timeout',
        data: {
          definitionType: 'fail-timeout',
          name: 'slowNode',
          config: { timeoutMs: 50, maxAttempts: 1 },
        },
      },
    ], [
      { source: 'start', target: 'slowNode' },
    ]);

    const result = await runner.runGraph(String(graph._id), {});
    assert.strictEqual(result.status, 'failed');
    const nodeRecord = result.nodes.find((n: any) => n.nodeId === 'slowNode');
    assert.strictEqual(nodeRecord.errorCode, 'EXECUTION_TIMEOUT');
  });

  // -------------------------------------------------------------------------
  // 4. Concurrency & Lease Tests
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Concurrency & Lease Tests ---');

  await test('Lease prevents concurrent execution of active run by another worker', async () => {
    const runId = `run_lease_test_${randomUUID()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60000);

    // Seed active run with valid lease
    await runModel.create({
      runId,
      projectId: 'default',
      graphId: new mongoose.Types.ObjectId(),
      graphName: 'Lease Test',
      status: 'running',
      leaseOwner: 'worker_primary',
      leaseExpiresAt: expiresAt,
      heartbeatAt: now,
      startedAt: now,
    });

    // Attempt to acquire lease from a second worker
    const acquired = await (runner as any).acquireLease(runId, 'worker_secondary');
    assert.strictEqual(acquired, false, 'Second worker must fail to acquire active lease');
  });

  await test('Expired lease can be reclaimed by another worker', async () => {
    const runId = `run_lease_expired_${randomUUID()}`;
    const expiredTime = new Date(Date.now() - 10000); // Expired 10s ago

    await runModel.create({
      runId,
      projectId: 'default',
      graphId: new mongoose.Types.ObjectId(),
      graphName: 'Expired Lease Test',
      status: 'running',
      leaseOwner: 'worker_crashed',
      leaseExpiresAt: expiredTime,
      heartbeatAt: expiredTime,
      startedAt: expiredTime,
    });

    const acquired = await (runner as any).acquireLease(runId, 'worker_recovery');
    assert.strictEqual(acquired, true, 'Recovery worker must successfully acquire expired lease');

    const updated = await runModel.findOne({ runId }).exec();
    assert.strictEqual(updated?.leaseOwner, 'worker_recovery');
  });

  await test('Lease is released on terminal and waiting states', async () => {
    const graph = await createGraph('Lease Release Test', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start' } },
      { id: 'task', type: 'task', data: { definitionType: 'task', name: 'task' } },
    ], [
      { source: 'start', target: 'task' },
    ]);

    const result = await runner.runGraph(String(graph._id), {});
    assert.strictEqual(result.status, 'completed');

    const dbRun = await runModel.findOne({ runId: result.runId }).exec();
    assert.strictEqual(dbRun?.leaseOwner, undefined, 'leaseOwner must be cleared on completion');
    assert.strictEqual(dbRun?.leaseExpiresAt, undefined, 'leaseExpiresAt must be cleared on completion');
  });

  // -------------------------------------------------------------------------
  // 5. Event Idempotency & Propagation Safety Tests
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Event Idempotency & Propagation Tests ---');

  await test('Same event delivered twice to same graph returns existing run', async () => {
    const graph = await createGraph('Event Idempotency Test', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start', config: { triggerType: 'event', eventTopic: 'test.topic' } } },
      { id: 't1', type: 'task', data: { definitionType: 'task', name: 't1' } },
    ], [
      { source: 'start', target: 't1' },
    ]);

    const eventEngine = new EventEngineService(eventModel as any);
    const dispatcher = new GraphEventDispatcherService(eventEngine, graphModel as any, runner);

    const eventPayload: any = {
      id: `evt_test_${randomUUID()}`,
      topic: 'test.topic',
      entityName: 'artifact',
      entityId: 'art-123',
      eventType: 'create',
      timestamp: new Date().toISOString(),
      source: { origin: 'api' },
      data: { logicalId: 'art-123' },
    };

    // First dispatch
    const runIds1 = await dispatcher.handleEvent(eventPayload);
    assert.strictEqual(runIds1.length, 1);
    const firstRunId = runIds1[0];

    // Second dispatch with same event
    const runIds2 = await dispatcher.handleEvent(eventPayload);
    assert.strictEqual(runIds2.length, 1);
    const secondRunId = runIds2[0];

    // Must return the identical run without creating a duplicate
    assert.strictEqual(firstRunId, secondRunId, 'Same event must return existing run');

    const totalRuns = await runModel.countDocuments({ idempotencyKey: `${eventPayload.id}${graph._id}` }).exec();
    assert.strictEqual(totalRuns, 1, 'Only one run document must exist for idempotency key');
  });

  await test('Propagation depth limit stops at depth > 5 with EVENT_PROPAGATION_LIMIT_REACHED', async () => {
    const graph = await createGraph('Propagation Depth Test', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start' } },
    ]);

    const result = await runner.runGraph(String(graph._id), {}, {
      propagationDepth: 6, // Exceeds max of 5
    });

    assert.strictEqual(result.status, 'partial');
    assert.strictEqual(result.error?.code, 'EVENT_PROPAGATION_LIMIT_REACHED');
  });

  await test('Visited logical ID limit stops infinite loop cycles', async () => {
    const graph = await createGraph('Visited Logical ID Test', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start' } },
    ]);

    const result = await runner.runGraph(String(graph._id), { logicalId: 'art-cycle-check' }, {
      visitedArtifactLogicalIds: ['art-cycle-check'], // Already visited
    });

    assert.strictEqual(result.status, 'partial');
    assert.strictEqual(result.error?.code, 'EVENT_PROPAGATION_LIMIT_REACHED');
  });

  // -------------------------------------------------------------------------
  // 6. Cancellation Tests
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Cancellation Tests ---');

  await test('Cancel waiting run marks cancelled and is idempotent', async () => {
    const graph = await createGraph('Cancel Test', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start' } },
      { id: 'gate', type: 'human-gate', data: { definitionType: 'human-gate', name: 'gate' } },
    ], [
      { source: 'start', target: 'gate' },
    ]);

    const waitingRun = await runner.runGraph(String(graph._id), {});
    assert.strictEqual(waitingRun.status, 'waiting');

    // First cancel
    const cancel1 = await runner.cancelRun(waitingRun.runId);
    assert.strictEqual(cancel1.status, 'cancelled');

    // Second cancel: idempotent
    const cancel2 = await runner.cancelRun(waitingRun.runId);
    assert.strictEqual(cancel2.status, 'cancelled');
  });

  // -------------------------------------------------------------------------
  // 7. Security and Redaction Tests
  // -------------------------------------------------------------------------
  console.log('\n--- 7. Security & Redaction Tests ---');

  await test('redactSecrets sanitizes sensitive keys and bearer tokens', () => {
    const sensitivePayload = {
      apiKey: 'sk-123456789012345678901234567890',
      password: 'super-secret-password',
      authorization: 'Bearer eyJhbGciOi...',
      cookie: 'sessionId=abc',
      safeField: 'hello world',
      nested: {
        token: 'xyz',
        publicVal: 42,
      },
    };

    const redacted = redactSecrets(sensitivePayload);
    assert.strictEqual(redacted.apiKey, '[REDACTED]');
    assert.strictEqual(redacted.password, '[REDACTED]');
    assert.strictEqual(redacted.authorization, '[REDACTED]');
    assert.strictEqual(redacted.cookie, '[REDACTED]');
    assert.strictEqual(redacted.safeField, 'hello world');
    assert.strictEqual(redacted.nested.token, '[REDACTED]');
    assert.strictEqual(redacted.nested.publicVal, 42);
  });

  await test('sanitizeRunForPublic strips resumeTokenHash and leaseOwner', () => {
    const mockRun = {
      runId: 'run-123',
      graphName: 'Test Graph',
      status: 'waiting',
      resumeTokenHash: 'abc123hash',
      leaseOwner: 'worker_42',
      input: { key: 'val', password: 'secret' },
      waitingDescriptor: {
        token: 'plain_token',
        nodeId: 'gate',
      },
    };

    const sanitized = sanitizeRunForPublic(mockRun);
    assert.strictEqual(sanitized.resumeTokenHash, undefined);
    assert.strictEqual(sanitized.leaseOwner, undefined);
    assert.strictEqual(sanitized.waitingDescriptor.token, undefined);
    assert.strictEqual(sanitized.input.password, '[REDACTED]');
  });

  await test('getRunState returns durable checkpoint state without secrets', async () => {
    const graph = await createGraph('State Endpoint Test', [
      { id: 'start', type: 'trigger', data: { definitionType: 'trigger', name: 'start' } },
      { id: 'gate', type: 'human-gate', data: { definitionType: 'human-gate', name: 'gate' } },
    ], [
      { source: 'start', target: 'gate' },
    ]);

    const runResult = await runner.runGraph(String(graph._id), { apiKey: 'secret-key-val' });
    const state = await runner.getRunState(runResult.runId);

    assert.strictEqual(state.runId, runResult.runId);
    assert.strictEqual(state.status, 'waiting');
    assert.ok(state.checkpointSequence >= 1);
    assert.strictEqual(state.waitingNodeId, 'gate');
    assert.strictEqual((state as any).resumeTokenHash, undefined);
    assert.strictEqual((state as any).leaseOwner, undefined);
    assert.strictEqual(state.context?.input?.apiKey, '[REDACTED]');
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n=============================================');
  console.log(`📊 RELIABILITY RESULTS: ${passed} passed, ${failed} failed`);
  console.log('=============================================\n');

  await connection.close();
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner failure:', err);
  process.exit(1);
});
