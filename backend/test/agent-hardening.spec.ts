import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { AgentRunnerService, normalizeAgentConfig } from '../src/runs/services/agent-runner.service';
import { AgentToolRegistryService } from '../src/runs/services/agent-tool-registry.service';
import { VariableResolverService } from '../src/runs/services/variable-resolver.service';
import { parseOutputSchema, validateAgainstSchema } from '../src/runs/services/output-schema.util';
import { assertPublicHttpUrl, isBlockedAddress, safeFetch } from '../src/runs/services/url-safety.util';
import { flattenAttachmentSources, resolveAttachment } from '../src/runs/services/agent-attachments.util';

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING AGENT HARDENING SUITE');
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

  const originalFetch = globalThis.fetch;
  const originalRoots = process.env.AGENT_ATTACHMENT_ROOTS;
  const variableResolver = new VariableResolverService();
  const openAiModel = (extra: Record<string, any> = {}): any => ({
    findByModelIdOrLabel: async () => ({
      modelId: 'gpt-4o',
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      apiKey: 'test-api-key',
      defaultTemperature: 0.4,
      ...extra,
    }),
  });
  const anthropicModel: any = {
    findByModelIdOrLabel: async () => ({
      modelId: 'claude-test',
      provider: 'anthropic',
      endpoint: 'https://api.anthropic.com/v1',
      apiKey: 'anthropic-key',
    }),
  };
  const okJson = (body: any) => ({ ok: true, status: 200, json: async () => body } as any);
  const openAiReply = (content: string, usage?: any) =>
    okJson({ choices: [{ message: { role: 'assistant', content } }], ...(usage ? { usage } : {}) });

  // ===========================================================================
  // Output schema parser / validator
  // ===========================================================================
  await test('parses Zod schema and reports field-level issues', () => {
    const schema = parseOutputSchema(`z.object({
      sentiment: z.enum(["positive", "neutral", "negative"]),
      summary: z.string().min(3).describe('short'),
      keyPoints: z.array(z.string()),
      urgencyScore: z.number().int().min(1).max(10),
      sources: z.array(z.object({ url: z.string().url(), title: z.string().nullable() })).optional(),
      score: z.number().refine((n) => n > 0, { message: 'positive' }),
    })`);
    const ok = validateAgainstSchema(schema, {
      sentiment: 'neutral',
      summary: 'All good',
      keyPoints: ['a'],
      urgencyScore: 3,
      score: 1,
      extra: 'kept',
    });
    assert.strictEqual(ok.valid, true, JSON.stringify(ok.issues));
    assert.strictEqual(ok.value.extra, 'kept', 'Unknown keys are preserved');

    const bad = validateAgainstSchema(schema, {
      sentiment: 'angry',
      summary: 'x',
      keyPoints: 'nope',
      urgencyScore: 11.5,
      sources: [{ url: 'not a url', title: null }],
    });
    const paths = bad.issues.map((i) => i.path);
    assert.strictEqual(bad.valid, false);
    for (const p of ['sentiment', 'summary', 'keyPoints', 'urgencyScore', 'sources[0].url', 'score']) {
      assert.ok(paths.includes(p), `Expected issue at ${p}; got ${paths.join(', ')}`);
    }
  });

  await test('parses TypeScript and JSON Schema styles, rejects unsupported Zod types', () => {
    const ts = parseOutputSchema(`{ title: string; tags?: string[]; level: 'low' | 'high'; meta: { count: number } }`);
    assert.strictEqual(validateAgainstSchema(ts, { title: 't', level: 'low', meta: { count: 1 } }).valid, true);
    assert.strictEqual(validateAgainstSchema(ts, { title: 't', level: 'mid', meta: { count: 'x' } }).issues.length, 2);

    const js = parseOutputSchema({ type: 'object', properties: { a: { type: 'integer' } }, required: ['a'] });
    assert.strictEqual(validateAgainstSchema(js, {}).valid, false);
    assert.strictEqual(validateAgainstSchema(js, { a: 2 }).valid, true);

    assert.throws(() => parseOutputSchema('z.object({ a: z.foo() })'), /Unsupported Zod type/);
    // Never evaluated as code
    assert.throws(() => parseOutputSchema('process.exit(1)'));
  });

  // ===========================================================================
  // Config normalization
  // ===========================================================================
  await test('normalizeAgentConfig folds legacy aliases and infers JSON mode from schema', () => {
    const legacy = normalizeAgentConfig({ toolsEnabled: true, tools: 'search_web, read_url', maxToolCalls: 3, outputSchema: 'z.object({})', prompt: 'hi' });
    assert.strictEqual(legacy.enableTools, true);
    assert.deepStrictEqual(legacy.allowedTools, ['search_web', 'read_url']);
    assert.strictEqual(legacy.maxSteps, 3);
    assert.strictEqual(legacy.jsonMode, true);
    assert.strictEqual(legacy.rawUserPrompt, 'hi');
    assert.strictEqual(normalizeAgentConfig({ outputFormat: 'json' }).jsonMode, true);
    assert.strictEqual(normalizeAgentConfig({ outputType: '  ' }).jsonMode, false);
  });

  // ===========================================================================
  // Schema validation with correction retries
  // ===========================================================================
  await test('validateOutput sends issues back to the model and accepts the corrected answer', async () => {
    const runner = new AgentRunnerService(variableResolver, openAiModel());
    const bodies: any[] = [];
    globalThis.fetch = async (_url: any, opts: any) => {
      bodies.push(JSON.parse(opts.body));
      return bodies.length === 1
        ? openAiReply('```json\n{"category":"billing","priority":"urgent"}\n```', { prompt_tokens: 10, completion_tokens: 5 })
        : openAiReply('{"category":"billing","priority":"high"}', { prompt_tokens: 20, completion_tokens: 6, prompt_tokens_details: { cached_tokens: 8 } });
    };
    const output = await runner.executeAgentNode(
      {
        id: 'agent_validate',
        data: {
          config: {
            userPrompt: 'Classify',
            outputType: "z.object({ category: z.enum(['billing','technical']), priority: z.enum(['low','medium','high']) })",
            validateOutput: true,
          },
        },
      } as any,
      null,
      {},
    );
    globalThis.fetch = originalFetch;

    assert.strictEqual(bodies.length, 2);
    const correction = bodies[1].messages[bodies[1].messages.length - 1];
    assert.strictEqual(correction.role, 'user');
    assert.ok(correction.content.includes('priority'), 'Correction prompt must name the failing field');
    assert.strictEqual(output.result.priority, 'high');
    assert.strictEqual(output.priority, 'high');
    assert.deepStrictEqual(
      { in: output.usage.inputTokens, out: output.usage.outputTokens, cached: output.usage.cachedInputTokens, calls: output.usage.llmCalls },
      { in: 30, out: 11, cached: 8, calls: 2 },
    );
    assert.strictEqual(output.stopReason, 'completed');
  });

  await test('validateOutput fails the node with field errors after exhausting retries', async () => {
    const runner = new AgentRunnerService(variableResolver, openAiModel());
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return openAiReply('not json at all');
    };
    let error: any;
    try {
      await runner.executeAgentNode(
        { id: 'a', data: { config: { userPrompt: 'x', outputType: 'z.object({ a: z.string() })', validateOutput: true, outputRetries: 1 } } } as any,
        null,
        {},
      );
    } catch (err) {
      error = err;
    }
    globalThis.fetch = originalFetch;
    assert.ok(error instanceof BadRequestException, 'Must throw BadRequestException');
    assert.strictEqual((error.getResponse() as any).code, 'OUTPUT_SCHEMA_VALIDATION_FAILED');
    assert.strictEqual(calls, 2, '1 initial call + 1 correction retry');
  });

  await test('without validateOutput, unparseable JSON keeps the legacy raw-text fallback', async () => {
    const runner = new AgentRunnerService(variableResolver, openAiModel());
    globalThis.fetch = async () => openAiReply('plain words');
    const output = await runner.executeAgentNode(
      { id: 'a', data: { config: { userPrompt: 'x', outputType: 'z.object({ a: z.string() })' } } } as any,
      null,
      {},
    );
    globalThis.fetch = originalFetch;
    assert.strictEqual(output.result, 'plain words');
    assert.strictEqual(output.toolTrace, undefined, 'Duplicate toolTrace output was removed');
  });

  // ===========================================================================
  // Temperature resolution (merged field, legacy compatible)
  // ===========================================================================
  await test('temperature: empty or legacy-disabled uses model default, explicit value wins', async () => {
    const runner = new AgentRunnerService(variableResolver, openAiModel());
    const sent: any[] = [];
    globalThis.fetch = async (_u: any, opts: any) => {
      sent.push(JSON.parse(opts.body).temperature);
      return openAiReply('ok');
    };
    for (const config of [
      { temperature: '' },
      { customTemperature: false, temperature: 0.7 },
      { temperature: 0.2 },
      { customTemperature: true, temperature: 0.9 },
    ]) {
      await runner.executeAgentNode({ id: 't', data: { config: { userPrompt: 'x', ...config } } } as any, null, {});
    }
    globalThis.fetch = originalFetch;
    assert.deepStrictEqual(sent, [0.4, 0.4, 0.2, 0.9]);
  });

  // ===========================================================================
  // Endpoint override never leaks stored credentials
  // ===========================================================================
  await test('foreign endpoint override is called without the stored API key', async () => {
    const runner = new AgentRunnerService(variableResolver, openAiModel());
    const seen: Array<{ url: string; auth?: string }> = [];
    globalThis.fetch = async (url: any, opts: any) => {
      seen.push({ url: String(url), auth: opts.headers?.Authorization });
      return openAiReply('ok');
    };
    await runner.executeAgentNode({ id: 'e1', data: { config: { userPrompt: 'x', endpoint: 'https://evil.example.net/v1' } } } as any, null, {});
    await runner.executeAgentNode({ id: 'e2', data: { config: { userPrompt: 'x', endpoint: 'https://api.openai.com/v1/chat/completions' } } } as any, null, {});
    globalThis.fetch = originalFetch;
    assert.strictEqual(seen[0].url, 'https://evil.example.net/v1/chat/completions');
    assert.strictEqual(seen[0].auth, undefined, 'Key must not be sent to a different origin');
    assert.strictEqual(seen[1].auth, 'Bearer test-api-key', 'Same-origin override keeps credentials');
  });

  // ===========================================================================
  // Retries with backoff
  // ===========================================================================
  await test('retries 429 responses honoring Retry-After', async () => {
    const runner = new AgentRunnerService(variableResolver, openAiModel());
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) {
        return { ok: false, status: 429, statusText: 'Too Many Requests', headers: { get: (k: string) => (k === 'retry-after' ? '0' : null) }, json: async () => ({ error: { message: 'rate limited' } }) } as any;
      }
      return openAiReply('recovered');
    };
    const output = await runner.executeAgentNode({ id: 'r', data: { config: { userPrompt: 'x' } } } as any, null, {});
    globalThis.fetch = originalFetch;
    assert.strictEqual(calls, 2);
    assert.strictEqual(output.text, 'recovered');
  });

  await test('does not retry non-retryable 400 errors', async () => {
    const runner = new AgentRunnerService(variableResolver, openAiModel());
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: false, status: 400, statusText: 'Bad Request', json: async () => ({ error: { message: 'bad' } }) } as any;
    };
    await assert.rejects(runner.executeAgentNode({ id: 'r', data: { config: { userPrompt: 'x' } } } as any, null, {}), /LLM API error \(400\)/);
    globalThis.fetch = originalFetch;
    assert.strictEqual(calls, 1);
  });

  // ===========================================================================
  // SSRF guard
  // ===========================================================================
  await test('SSRF guard blocks private, loopback, metadata and mapped addresses', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      assert.strictEqual(isBlockedAddress(ip), true, `${ip} must be blocked`);
    }
    assert.strictEqual(isBlockedAddress('93.184.216.34'), false);
    await assert.rejects(assertPublicHttpUrl('http://169.254.169.254/latest/meta-data'), /blocked/);
    await assert.rejects(assertPublicHttpUrl('http://localhost:3000'), /blocked/);
    await assert.rejects(assertPublicHttpUrl('file:///etc/passwd'), /Only HTTP/);
    await assert.rejects(
      assertPublicHttpUrl('https://internal.example.com', async () => [{ address: '10.0.0.5', family: 4 }]),
      /resolves to private/,
    );
    await assertPublicHttpUrl('https://public.example.com', async () => [{ address: '93.184.216.34', family: 4 }]);
  });

  await test('safeFetch re-validates redirect targets', async () => {
    globalThis.fetch = async () =>
      ({ ok: false, status: 302, headers: { get: (k: string) => (k === 'location' ? 'http://127.0.0.1/admin' : null) } } as any);
    await assert.rejects(safeFetch('http://93.184.216.34/start'), /blocked/);
    globalThis.fetch = originalFetch;
  });

  await test('read_url tool refuses internal URLs chosen by the model', async () => {
    const registry = new AgentToolRegistryService();
    let fetched = false;
    globalThis.fetch = async () => {
      fetched = true;
      return { ok: true, status: 200, text: async () => '' } as any;
    };
    const res = await registry.executeTool('read_url', { url: 'http://169.254.169.254/latest/meta-data/' });
    globalThis.fetch = originalFetch;
    assert.strictEqual(res.success, false);
    assert.ok(/blocked/.test(res.error || ''), res.error);
    assert.strictEqual(fetched, false, 'No request may be made to the internal address');
  });

  // ===========================================================================
  // Attachments
  // ===========================================================================
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-att-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-out-'));
  fs.writeFileSync(path.join(root, 'shot.png'), Buffer.from('png-bytes'));
  fs.writeFileSync(path.join(root, 'doc.pdf'), Buffer.from('%PDF-1.4'));
  fs.writeFileSync(path.join(root, 'clip.mp3'), Buffer.from('mp3'));
  fs.writeFileSync(path.join(root, 'notes.docx'), Buffer.from('docx'));
  fs.writeFileSync(path.join(outside, 'secret.png'), Buffer.from('secret'));
  process.env.AGENT_ATTACHMENT_ROOTS = root;

  await test('local attachment paths are restricted to the allowed roots', () => {
    assert.strictEqual(resolveAttachment(path.join(root, 'shot.png')).kind, 'image');
    assert.throws(() => resolveAttachment(path.join(outside, 'secret.png')), /outside the allowed/);
    assert.throws(() => resolveAttachment(path.join(root, '..', path.basename(outside), 'secret.png')), /outside the allowed/);
    assert.throws(() => resolveAttachment(path.join(root, 'notes.docx')), /Unsupported attachment file type/);
    assert.throws(() => resolveAttachment(path.join(root, 'shot.png'), 'document'), /detected as image/);
    const linkPath = path.join(root, 'link.png');
    try {
      fs.symlinkSync(path.join(outside, 'secret.png'), linkPath);
      assert.throws(() => resolveAttachment(linkPath), /outside the allowed/, 'Symlinks escaping the root are rejected');
    } catch (err: any) {
      if (err?.code !== 'EPERM') throw err;
    }
  });

  await test('multiple attachments map to the correct OpenAI content parts', async () => {
    assert.deepStrictEqual(flattenAttachmentSources(`a.png\n b.pdf \n`), ['a.png', 'b.pdf']);
    const runner = new AgentRunnerService(variableResolver, openAiModel({ capabilities: { supportsAudio: true } }));
    let body: any;
    globalThis.fetch = async (_u: any, opts: any) => {
      body = JSON.parse(opts.body);
      return openAiReply('ok');
    };
    await runner.executeAgentNode(
      {
        id: 'att',
        data: {
          config: {
            userPrompt: 'Describe',
            enableAttachment: true,
            attachment: [path.join(root, 'shot.png'), { path: path.join(root, 'doc.pdf') }, path.join(root, 'clip.mp3')],
          },
        },
      } as any,
      null,
      {},
    );
    globalThis.fetch = originalFetch;
    const parts = body.messages[1].content.map((p: any) => p.type);
    assert.deepStrictEqual(parts, ['text', 'image_url', 'file', 'input_audio']);
    assert.ok(body.messages[1].content[2].file.file_data.startsWith('data:application/pdf;base64,'));
    assert.strictEqual(body.messages[1].content[3].input_audio.format, 'mp3');
  });

  await test('Anthropic: PDFs become document blocks, system prompt is cached, audio is rejected', async () => {
    const runner = new AgentRunnerService(variableResolver, anthropicModel);
    let body: any;
    globalThis.fetch = async (_u: any, opts: any) => {
      body = JSON.parse(opts.body);
      return okJson({ content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 2 } });
    };
    const output = await runner.executeAgentNode(
      { id: 'an', data: { config: { userPrompt: 'Read', enableAttachment: true, attachment: path.join(root, 'doc.pdf') } } } as any,
      null,
      {},
    );
    const content = body.messages[0].content;
    assert.strictEqual(content[0].type, 'document');
    assert.strictEqual(content[0].source.media_type, 'application/pdf');
    assert.deepStrictEqual(body.system[0].cache_control, { type: 'ephemeral' });
    assert.strictEqual(output.usage.inputTokens, 105);
    assert.strictEqual(output.usage.cachedInputTokens, 100);

    await assert.rejects(
      runner.executeAgentNode(
        { id: 'an2', data: { config: { userPrompt: 'Listen', enableAttachment: true, attachment: path.join(root, 'clip.mp3') } } } as any,
        null,
        {},
      ),
      (err: any) => err instanceof BadRequestException && /audio/.test((err.getResponse() as any).message),
    );
    globalThis.fetch = originalFetch;
  });

  await test('Anthropic tool loop forces a final answer with tool_choice none at maxSteps', async () => {
    const registry = new AgentToolRegistryService();
    registry.registerTool({
      name: 'search_web',
      description: 's',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      execute: async () => ({ results: [] }),
    });
    const runner = new AgentRunnerService(variableResolver, anthropicModel, registry);
    const bodies: any[] = [];
    globalThis.fetch = async (_u: any, opts: any) => {
      const body = JSON.parse(opts.body);
      bodies.push(body);
      if (body.tool_choice?.type === 'none') return okJson({ content: [{ type: 'text', text: 'Final synthesized answer' }] });
      return okJson({ content: [{ type: 'tool_use', id: `tu_${bodies.length}`, name: 'search_web', input: { query: 'q' } }] });
    };
    const output = await runner.executeAgentNode(
      { id: 'loop', data: { config: { userPrompt: 'Research', enableTools: true, allowedTools: ['search_web'], maxSteps: 2 } } } as any,
      null,
      {},
    );
    globalThis.fetch = originalFetch;
    assert.strictEqual(bodies.length, 3);
    assert.strictEqual(output.stopReason, 'max_steps');
    assert.strictEqual(output.text, 'Final synthesized answer');
    assert.ok(bodies[0].system[0].text.includes('untrusted external data'), 'System prompt warns about untrusted tool output');
    const lastUser = bodies[2].messages[bodies[2].messages.length - 1];
    assert.strictEqual(lastUser.content[0].type, 'tool_result');
    assert.strictEqual(lastUser.content[lastUser.content.length - 1].type, 'text');
  });

  process.env.AGENT_ATTACHMENT_ROOTS = originalRoots;
  if (originalRoots === undefined) delete process.env.AGENT_ATTACHMENT_ROOTS;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });

  console.log('\n=============================================');
  console.log(`📊 TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log('=============================================\n');
  if (failed > 0) process.exit(1);
}

runTests();
