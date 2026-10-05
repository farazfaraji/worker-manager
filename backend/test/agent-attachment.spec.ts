import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentRunnerService } from '../src/runs/services/agent-runner.service';
import { VariableResolverService } from '../src/runs/services/variable-resolver.service';
import { NodeDefinitionsService } from '../src/node-definitions/node-definitions.service';
import { FileStorageService } from '../src/blocks/file-storage.service';

function modelMock(provider: string, endpoint: string): any {
  return {
    findByModelIdOrLabel: async () => ({
      modelId: provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o',
      provider,
      endpoint,
      apiKey: 'test-api-key',
    }),
  };
}

function openAiResponse(content: string): any {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { role: 'assistant', content } }] }),
  } as any;
}

function anthropicResponse(text: string): any {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }),
  } as any;
}

async function runTests() {
  console.log('\n=============================================');
  console.log('RUNNING AGENT ATTACHMENT SUITE');
  console.log('=============================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  FAIL: ${name}`);
      console.error(`     Error: ${err?.message || err}`);
      if (err?.stack) console.error(err.stack);
      failed++;
    }
  }

  const originalFetch = globalThis.fetch;
  const sandboxBase = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-files-'));
  const storage = new FileStorageService();
  storage.setBaseOverride(sandboxBase);

  const writeSandboxFile = (projectId: string, rel: string, content: string | Buffer) => {
    const target = path.join(sandboxBase, projectId, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return target;
  };

  const buildRunner = (provider: string, endpoint: string) =>
    new AgentRunnerService(new VariableResolverService(), modelMock(provider, endpoint), undefined, storage);

  const agentNode = (config: Record<string, any>): any => ({
    id: 'agent_attachment',
    data: { config: { systemPrompt: 'You are a test agent.', outputFormat: 'text', ...config } },
  });

  // =========================================================================
  // 1. Tool definition
  // =========================================================================
  await test('agent.json exposes the attachmentUpload control and the maxSizeMb guard', async () => {
    const service = new NodeDefinitionsService();
    const defs = await service.getAllDefinitions();
    const agentDef = defs.find((d: any) => d.id === 'agent');
    assert.ok(agentDef, 'agent definition must exist');

    const attachment: any = agentDef.inputs.find((i: any) => i.name === 'attachment');
    assert.ok(attachment, 'Must have attachment input');
    assert.strictEqual(attachment.type, 'attachmentUpload');

    const maxSize: any = agentDef.inputs.find((i: any) => i.name === 'maxSizeMb');
    assert.ok(maxSize, 'Must have maxSizeMb input');
    assert.strictEqual(maxSize.type, 'number');
    assert.strictEqual(maxSize.defaultValue, 2);
  });

  // =========================================================================
  // 2. FileStorageService.readBuffer
  // =========================================================================
  await test('FileStorageService.readBuffer returns base64 plus the detected mime type', async () => {
    writeSandboxFile('proj_read', 'notes/summary.txt', 'hello from the sandbox');
    const result = await storage.readBuffer('proj_read', 'notes/summary.txt');
    assert.strictEqual(result.mimeType, 'text/plain');
    assert.strictEqual(Buffer.from(result.base64, 'base64').toString('utf8'), 'hello from the sandbox');
    assert.strictEqual(result.path, 'notes/summary.txt');
  });

  await test('FileStorageService.readBuffer refuses paths that escape the sandbox', async () => {
    await assert.rejects(() => storage.readBuffer('proj_read', '../../etc/passwd'), /sandbox/i);
  });

  // =========================================================================
  // 3. OpenAI-compatible flow
  // =========================================================================
  await test('Image data URL is still sent as an image_url part', async () => {
    const png = `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`;
    let sent: any;
    globalThis.fetch = async (_url: any, opts: any) => {
      sent = JSON.parse(opts.body);
      return openAiResponse('ok');
    };

    const runner = buildRunner('openai', 'https://api.openai.com/v1');
    const output = await runner.executeAgentNode(
      agentNode({ enableAttachment: true, attachment: png, userPrompt: 'Describe this' }),
      undefined,
      {},
    );
    globalThis.fetch = originalFetch;

    assert.strictEqual(output.text, 'ok');
    const userMessage = sent.messages.find((m: any) => m.role === 'user');
    const imagePart = userMessage.content.find((p: any) => p.type === 'image_url');
    assert.ok(imagePart, 'Must include an image_url part');
    assert.strictEqual(imagePart.image_url.url, png);
  });

  await test('Audio data URL is sent as an input_audio part with the detected format', async () => {
    const wav = `data:audio/wav;base64,${Buffer.from('RIFFfake').toString('base64')}`;
    let sent: any;
    globalThis.fetch = async (_url: any, opts: any) => {
      sent = JSON.parse(opts.body);
      return openAiResponse('ok');
    };

    const runner = buildRunner('openai', 'https://api.openai.com/v1');
    await runner.executeAgentNode(
      agentNode({ enableAttachment: true, attachment: wav, userPrompt: 'Transcribe this' }),
      undefined,
      {},
    );
    globalThis.fetch = originalFetch;

    const userMessage = sent.messages.find((m: any) => m.role === 'user');
    const audioPart = userMessage.content.find((p: any) => p.type === 'input_audio');
    assert.ok(audioPart, 'Must include an input_audio part');
    assert.strictEqual(audioPart.input_audio.format, 'wav');
  });

  await test('File block text output is inlined into the prompt instead of sent as media', async () => {
    let sent: any;
    globalThis.fetch = async (_url: any, opts: any) => {
      sent = JSON.parse(opts.body);
      return openAiResponse('ok');
    };

    const runner = buildRunner('openai', 'https://api.openai.com/v1');
    const context = {
      file_1: { result: { path: 'notes/summary.txt', content: 'quarterly revenue is flat', mimeType: 'text/plain' } },
    };
    await runner.executeAgentNode(
      agentNode({
        enableAttachment: true,
        attachment: { mode: 'variable', value: 'file_1.result' },
        userPrompt: 'Summarize the notes',
      }),
      undefined,
      context,
    );
    globalThis.fetch = originalFetch;

    const userMessage = sent.messages.find((m: any) => m.role === 'user');
    const textPart = userMessage.content.find((p: any) => p.type === 'text');
    assert.ok(textPart, 'Must send a text part');
    assert.ok(
      textPart.text.includes('quarterly revenue is flat'),
      'Text content must reach the prompt',
    );
    assert.ok(
      !userMessage.content.some((p: any) => p.type === 'image_url'),
      'Text attachments must not be sent as images',
    );
  });

  await test('PDF attachments are rejected with an actionable message for OpenAI-compatible models', async () => {
    const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 fake').toString('base64')}`;
    globalThis.fetch = async () => openAiResponse('ok');

    const runner = buildRunner('openai', 'https://api.openai.com/v1');
    await assert.rejects(
      () =>
        runner.executeAgentNode(
          agentNode({ enableAttachment: true, attachment: pdf, userPrompt: 'Read this' }),
          undefined,
          {},
        ),
      /cannot accept PDF attachments/i,
    );
    globalThis.fetch = originalFetch;
  });

  // =========================================================================
  // 4. Anthropic flow
  // =========================================================================
  await test('A PDF stored in the project sandbox is sent as an Anthropic document block', async () => {
    const pdfBytes = '%PDF-1.4 sandbox report';
    writeSandboxFile('proj_pdf', 'reports/report.pdf', pdfBytes);
    let sent: any;
    globalThis.fetch = async (_url: any, opts: any) => {
      sent = JSON.parse(opts.body);
      return anthropicResponse('ok');
    };

    const runner = buildRunner('anthropic', 'https://api.anthropic.com/v1');
    const output = await runner.executeAgentNode(
      agentNode({
        enableAttachment: true,
        attachment: 'reports/report.pdf',
        userPrompt: 'Summarize the report',
      }),
      undefined,
      { projectId: 'proj_pdf' },
    );
    globalThis.fetch = originalFetch;

    assert.strictEqual(output.text, 'ok');
    const userMessage = sent.messages.find((m: any) => m.role === 'user');
    const documentPart = userMessage.content.find((p: any) => p.type === 'document');
    assert.ok(documentPart, 'Must include a document block');
    assert.strictEqual(documentPart.source.media_type, 'application/pdf');
    assert.strictEqual(
      Buffer.from(documentPart.source.data, 'base64').toString('utf8'),
      pdfBytes,
    );
  });

  await test('Audio attachments are rejected with an actionable message for Anthropic models', async () => {
    const wav = `data:audio/wav;base64,${Buffer.from('RIFFfake').toString('base64')}`;
    globalThis.fetch = async () => anthropicResponse('ok');

    const runner = buildRunner('anthropic', 'https://api.anthropic.com/v1');
    await assert.rejects(
      () =>
        runner.executeAgentNode(
          agentNode({ enableAttachment: true, attachment: wav, userPrompt: 'Transcribe' }),
          undefined,
          {},
        ),
      /cannot ingest audio/i,
    );
    globalThis.fetch = originalFetch;
  });

  // =========================================================================
  // 5. Loud failures
  // =========================================================================
  await test('A sandbox path that does not exist fails the node instead of dropping the file', async () => {
    globalThis.fetch = async () => openAiResponse('ok');

    const runner = buildRunner('openai', 'https://api.openai.com/v1');
    await assert.rejects(
      () =>
        runner.executeAgentNode(
          agentNode({
            enableAttachment: true,
            attachment: 'reports/missing.png',
            userPrompt: 'Describe',
          }),
          undefined,
          { projectId: 'proj_pdf' },
        ),
      /Attachment not found in the "proj_pdf" project sandbox: reports\/missing\.png/,
    );
    globalThis.fetch = originalFetch;
  });

  await test('A missing absolute host path fails the node with the offending path', async () => {
    globalThis.fetch = async () => openAiResponse('ok');

    const runner = buildRunner('openai', 'https://api.openai.com/v1');
    await assert.rejects(
      () =>
        runner.executeAgentNode(
          agentNode({
            enableAttachment: true,
            attachment: '/tmp/definitely-not-here-9d8f7.png',
            userPrompt: 'Describe',
          }),
          undefined,
          {},
        ),
      /Attachment file not found: \/tmp\/definitely-not-here-9d8f7\.png/,
    );
    globalThis.fetch = originalFetch;
  });

  await test('A File block path resolves against the project sandbox', async () => {
    writeSandboxFile('proj_path', 'images/chart.png', 'fake-png-bytes');
    let sent: any;
    globalThis.fetch = async (_url: any, opts: any) => {
      sent = JSON.parse(opts.body);
      return openAiResponse('ok');
    };

    const runner = buildRunner('openai', 'https://api.openai.com/v1');
    await runner.executeAgentNode(
      agentNode({
        enableAttachment: true,
        attachment: { mode: 'variable', value: 'file_1.result' },
        userPrompt: 'Describe the chart',
      }),
      undefined,
      {
        projectId: 'proj_path',
        file_1: { result: { path: 'images/chart.png', size: 14, mimeType: 'image/png' } },
      },
    );
    globalThis.fetch = originalFetch;

    const userMessage = sent.messages.find((m: any) => m.role === 'user');
    const imagePart = userMessage.content.find((p: any) => p.type === 'image_url');
    assert.ok(imagePart, 'Must include an image_url part');
    assert.ok(imagePart.image_url.url.startsWith('data:image/png;base64,'));
  });

  await test('Attachments stay untouched when the feature is disabled', async () => {
    let sent: any;
    globalThis.fetch = async (_url: any, opts: any) => {
      sent = JSON.parse(opts.body);
      return openAiResponse('ok');
    };

    const runner = buildRunner('openai', 'https://api.openai.com/v1');
    await runner.executeAgentNode(
      agentNode({ enableAttachment: false, attachment: 'reports/missing.png', userPrompt: 'Plain run' }),
      undefined,
      { projectId: 'proj_pdf' },
    );
    globalThis.fetch = originalFetch;

    const userMessage = sent.messages.find((m: any) => m.role === 'user');
    assert.strictEqual(userMessage.content, 'Plain run');
  });

  globalThis.fetch = originalFetch;
  fs.rmSync(sandboxBase, { recursive: true, force: true });

  console.log('\n=============================================');
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('=============================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});