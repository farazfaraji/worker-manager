import * as assert from 'assert';
import mongoose from 'mongoose';
import { Run, RunSchema } from '../src/runs/schemas/run.schema';
import {
  RunCheckpoint,
  RunCheckpointSchema,
} from '../src/runs/schemas/run-checkpoint.schema';
import { Graph, GraphSchema } from '../src/graphs/schemas/graph.schema';
import {
  TelegramMessage,
  TelegramMessageSchema,
} from '../src/telegram/schemas/telegram-message.schema';
import { Setting, SettingSchema } from '../src/settings/schemas/setting.schema';
import { SettingsService } from '../src/settings/settings.service';
import { GraphRunnerService } from '../src/runs/graph-runner.service';
import { VariableResolverService } from '../src/runs/services/variable-resolver.service';
import { NodeExecutorService } from '../src/runs/services/node-executor.service';
import { BrowserRunnerService } from '../src/runs/services/browser-runner.service';
import { TelegramService } from '../src/telegram/telegram.service';
import { BlockRuntimeService } from '../src/blocks/block-runtime.service';
import { ConfigService } from '@nestjs/config';
import { GraphShapeService } from '../src/graphs/graph-shape.service';

const TEST_DB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/flow_builder_telegram_test';

async function runTests() {
  console.log('\n=============================================');
  console.log('✈️ RUNNING TELEGRAM TRIGGER & QUESTION TEST SUITE');
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
  const telegramMessageModel = connection.model(
    TelegramMessage.name,
    TelegramMessageSchema,
  );
  const settingModel = connection.model(Setting.name, SettingSchema);

  // Clean collections
  await runModel.deleteMany({});
  await checkpointModel.deleteMany({});
  await graphModel.deleteMany({});
  await telegramMessageModel.deleteMany({});
  await settingModel.deleteMany({});

  const variableResolver = new VariableResolverService();
  const browserRunnerMock: any = {
    executeBrowserNode: async () => ({ status: 'completed', result: { ok: true } }),
    closeRuntimeApps: async () => {},
  };

  const blockRuntime = new (BlockRuntimeService as any)(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    browserRunnerMock,
    {} as any,
    {} as any,
  );

  const nodeExecutor = new NodeExecutorService(
    variableResolver,
    browserRunnerMock,
    {} as any,
    blockRuntime,
  );

  const graphShapeService = new GraphShapeService();

  const graphsServiceMock: any = {
    findOne: async (id: string) => {
      const g = await graphModel.findById(id).lean().exec();
      if (!g) return g;
      const shaped = graphShapeService.reshapeForLoad({
        flow: g.flow,
        nodes: (g as any).nodes,
        edges: (g as any).edges,
        layout: g.layout,
        viewport: (g as any).viewport,
      });
      return { ...g, ...shaped };
    },
    validateGraphVariables: async () => true,
  };

  const configService = new ConfigService();

  // Helper to create test graphs
  async function createGraph(name: string, nodes: any[], edges: any[] = []) {
    const shaped = graphShapeService.reshapeForSave({ nodes, edges });
    return graphModel.create({
      projectId: 'default',
      name,
      flow: shaped.flow,
      layout: shaped.layout,
    });
  }

  // We will wire runner and telegramService
  let runner: GraphRunnerService;
  let telegramService: TelegramService;

  // TelegramService needs runner reference, and Runner needs TelegramService reference
  telegramService = new TelegramService(
    telegramMessageModel as any,
    graphModel as any,
    null as any,
    configService,
  );

  runner = new GraphRunnerService(
    graphsServiceMock,
    runModel as any,
    checkpointModel as any,
    variableResolver,
    nodeExecutor,
    browserRunnerMock,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    telegramService,
  );

  // Bind runner into telegramService
  (telegramService as any).graphRunnerService = runner;

  // -------------------------------------------------------------------------
  // 1. Telegram Trigger Test: Unreplied incoming message triggers the flow
  // -------------------------------------------------------------------------
  console.log('--- 1. Telegram Trigger Mode ---');

  await test('Incoming unreplied message triggers graph with Telegram trigger node', async () => {
    const graph = await createGraph(
      'Telegram Trigger Flow',
      [
        {
          id: 'tg_start',
          type: 'telegram',
          data: {
            definitionType: 'telegram',
            name: 'tg_start',
            config: { mode: 'trigger' },
          },
        },
        {
          id: 'task1',
          type: 'script',
          data: {
            definitionType: 'script',
            name: 'task1',
            config: { code: 'return input;' },
          },
        },
      ],
      [{ source: 'tg_start', target: 'task1' }],
    );

    const update = {
      update_id: 10001,
      message: {
        message_id: 55,
        chat: { id: 987654321 },
        from: { id: 987654321, username: 'testuser', first_name: 'Test' },
        text: 'Deploy staging v1.2',
        date: Math.floor(Date.now() / 1000),
      },
    };

    const processResult = await telegramService.processUpdate(update);
    assert.strictEqual(processResult.handled, true);
    assert.strictEqual(processResult.scenario, 'unreplied_trigger');
    assert.strictEqual(processResult.triggeredCount, 1);

    const triggeredRunId = processResult.runIds[0];
    assert.ok(triggeredRunId, 'A runId must be returned');

    const dbRun = await runModel.findOne({ runId: triggeredRunId }).lean().exec();
    assert.ok(dbRun, 'Run must exist in database');
    assert.strictEqual(dbRun?.status, 'completed');
    assert.strictEqual(dbRun?.input?.text, 'Deploy staging v1.2');
    assert.strictEqual(dbRun?.input?.chatId, '987654321');
  });

  // -------------------------------------------------------------------------
  // 2. Human Gate with Telegram Response Channel (Question & Reply)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Human Gate with Telegram Channel ---');

  await test('Human Gate with responseType: telegram enters waiting state and persists message to DB', async () => {
    const graph = await createGraph(
      'Human Gate Telegram Test',
      [
        {
          id: 'start',
          type: 'trigger',
          data: { definitionType: 'trigger', name: 'start' },
        },
        {
          id: 'gate',
          type: 'human-gate',
          data: {
            definitionType: 'human-gate',
            name: 'gate',
            config: {
              responseType: 'telegram',
              chatId: '987654321',
              question: 'Do you authorize production deployment?',
            },
          },
        },
        {
          id: 'final_step',
          type: 'script',
          data: {
            definitionType: 'script',
            name: 'final_step',
            config: { code: 'return input;' },
          },
        },
      ],
      [
        { source: 'start', target: 'gate' },
        { source: 'gate', target: 'final_step' },
      ],
    );

    const runResult = await runner.runGraph(String(graph._id), {});
    assert.strictEqual(runResult.status, 'waiting', 'Flow should pause at Human Gate');
    assert.ok(runResult.resumeToken, 'Public run response includes resumeToken');

    // Check that interaction is persisted in telegram_messages collection
    const stored = await telegramMessageModel
      .findOne({ runId: runResult.runId, status: 'waiting' })
      .lean()
      .exec();

    assert.ok(stored, 'Message interaction must be stored in telegram_messages');
    assert.strictEqual(stored.chatId, '987654321');
    assert.strictEqual(stored.status, 'waiting');
    assert.strictEqual(stored.question, 'Do you authorize production deployment?');
    assert.ok(stored.messageId, 'Stored message must have a numeric messageId');

    // Now simulate user replying to this exact message in Telegram
    const replyUpdate = {
      update_id: 10002,
      message: {
        message_id: 77,
        chat: { id: 987654321 },
        from: { id: 987654321, username: 'testuser' },
        text: 'Yes, approved by lead engineer',
        date: Math.floor(Date.now() / 1000),
        reply_to_message: {
          message_id: stored.messageId,
          text: stored.question,
        },
      },
    };

    const replyResult = await telegramService.processUpdate(replyUpdate);
    assert.strictEqual(replyResult.handled, true);
    assert.strictEqual(replyResult.scenario, 'question_answered');
    assert.strictEqual(replyResult.runId, runResult.runId);

    // Verify record in DB is now answered
    const updatedRecord = await telegramMessageModel.findById(stored._id).lean().exec();
    assert.strictEqual(updatedRecord?.status, 'answered');
    assert.strictEqual(updatedRecord?.replyText, 'Yes, approved by lead engineer');

    // Verify run resumed and completed
    const finishedRun = await runModel.findOne({ runId: runResult.runId }).lean().exec();
    assert.strictEqual(finishedRun?.status, 'completed');
  });

  // -------------------------------------------------------------------------
  // 3. Standalone Telegram Node: Question & Reply Mode
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Telegram Node Question Mode ---');

  await test('Telegram node in question mode pauses and resumes on user reply', async () => {
    const graph = await createGraph(
      'Telegram Question Flow',
      [
        {
          id: 'start',
          type: 'trigger',
          data: { definitionType: 'trigger', name: 'start' },
        },
        {
          id: 'ask_user',
          type: 'telegram',
          data: {
            definitionType: 'telegram',
            name: 'ask_user',
            config: {
              mode: 'question',
              chatId: '445566',
              question: 'Please choose target server: A or B?',
            },
          },
        },
        {
          id: 'finish',
          type: 'script',
          data: {
            definitionType: 'script',
            name: 'finish',
            config: { code: 'return input;' },
          },
        },
      ],
      [
        { source: 'start', target: 'ask_user' },
        { source: 'ask_user', target: 'finish' },
      ],
    );

    const runResult = await runner.runGraph(String(graph._id), {});
    assert.strictEqual(runResult.status, 'waiting');

    const stored = await telegramMessageModel
      .findOne({ runId: runResult.runId, status: 'waiting' })
      .lean()
      .exec();
    assert.ok(stored, 'Question must be recorded');
    assert.strictEqual(stored.chatId, '445566');

    // Simulate reply with Server B
    const replyUpdate = {
      update_id: 10003,
      message: {
        message_id: 88,
        chat: { id: 445566 },
        from: { id: 445566, username: 'devops' },
        text: 'Server B',
        date: Math.floor(Date.now() / 1000),
        reply_to_message: {
          message_id: stored.messageId,
          text: stored.question,
        },
      },
    };

    const replyResult = await telegramService.processUpdate(replyUpdate);
    assert.strictEqual(replyResult.handled, true);
    assert.strictEqual(replyResult.scenario, 'question_answered');

    const finishedRun = await runModel.findOne({ runId: runResult.runId }).lean().exec();
    assert.strictEqual(finishedRun?.status, 'completed');
  });

  // -------------------------------------------------------------------------
  // 4. Local Polling Worker Lifecycle
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Local Polling Worker Lifecycle ---');

  await test('Local polling worker starts and stops cleanly with configurable seconds', async () => {
    const worker = telegramService.startPolling('test-bot-token-12345', 3);
    assert.strictEqual(worker.active, true);
    assert.strictEqual(worker.intervalSeconds, 3);

    // Stop polling
    telegramService.stopPolling('test-bot-token-12345');
    assert.strictEqual(worker.active, false);
    assert.strictEqual(worker.timer, null);
  });

  // -------------------------------------------------------------------------
  // 5. Settings Project Scoping and Poller Deduplication
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Settings Scoping & Poller Deduplication ---');

  await test('Settings service provides project-specific override with global fallback', async () => {
    const settingsService = new SettingsService(settingModel as any);

    // Initial global setup
    await settingsService.updateSettings({
      telegramBotToken: 'global-bot-token-999',
      telegramUpdateMode: 'polling',
      telegramPollIntervalSeconds: 7,
    });

    // Project without override should receive global values
    const inherited = await settingsService.getSettings('proj-alpha');
    assert.strictEqual(inherited.telegramBotToken, 'global-bot-token-999');
    assert.strictEqual(inherited.telegramPollIntervalSeconds, 7);

    // Project with specific override
    await settingsService.updateSettings(
      {
        telegramBotToken: 'alpha-custom-token-111',
      },
      'proj-alpha',
    );

    const overridden = await settingsService.getSettings('proj-alpha');
    assert.strictEqual(overridden.telegramBotToken, 'alpha-custom-token-111');
    assert.strictEqual(overridden.telegramPollIntervalSeconds, 7); // Inherited fallback
  });

  await test('ensurePolling deduplicates and prevents starting multiple workers for the same token', async () => {
    const settingsService = new SettingsService(settingModel as any);
    const tgService = new TelegramService(
      telegramMessageModel as any,
      graphModel as any,
      null as any,
      configService,
      settingsService,
    );

    // First call starts poller
    const worker1 = await tgService.ensurePolling('proj-alpha');
    assert.strictEqual(worker1?.active, true);
    assert.strictEqual(tgService.isPolling('alpha-custom-token-111'), true);

    // Second call with same project / token does not spawn another worker
    const worker2 = await tgService.ensurePolling('proj-alpha');
    assert.strictEqual(worker2, worker1);

    tgService.stopPolling('alpha-custom-token-111');
    assert.strictEqual(tgService.isPolling('alpha-custom-token-111'), false);
  });

  await connection.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
