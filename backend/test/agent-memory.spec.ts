import * as assert from 'assert';
import { AgentRunnerService } from '../src/runs/services/agent-runner.service';
import { AgentToolRegistryService } from '../src/runs/services/agent-tool-registry.service';
import { VariableResolverService } from '../src/runs/services/variable-resolver.service';
import {
  createMemoryTools,
  detectPersonalData,
  resolveAgentMemoryMode,
  executeMemorySearch,
} from '../src/runs/services/agent-memory-tools';

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING AGENT MEMORY TOOLS SUITE');
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
  const variableResolver = new VariableResolverService();
  const records: Record<string, any> = {
    'gpt-4o': { modelId: 'gpt-4o', label: 'GPT-4o', provider: 'openai', endpoint: 'https://api.openai.com/v1', apiKey: 'agent-key' },
    'cheap-filter': { modelId: 'cheap-filter', label: 'Cheap Filter', provider: 'openai', endpoint: 'https://filter.example.com/v1', apiKey: 'filter-key' },
  };
  const modelsService: any = { findByModelIdOrLabel: async (key: string) => records[key] || records['gpt-4o'] };

  function fakes(opts: { embedFails?: boolean } = {}) {
    const calls: any = { search: [] as any[], embed: [] as any[], recall: [] as any[], remember: [] as any[] };
    const vectors: any = {
      search: async (input: any) => {
        calls.search.push(input);
        return [
          { vectorId: 'v1', artifactId: 'a1', chunkId: 'c0', text: 'Pricing page launches on 2026-11-01', metadata: { title: 'Launch plan' }, score: 0.82, version: 2, updatedAt: '2026-10-01T00:00:00Z' },
          { vectorId: 'v2', artifactId: 'a2', chunkId: 'c0', text: 'Unrelated onboarding notes', metadata: { title: 'Onboarding' }, score: 0.2 },
        ];
      },
    };
    const embeddings: any = {
      embed: async (text: string, config: any) => {
        calls.embed.push({ text, config });
        if (opts.embedFails) throw new Error('External embedding is disabled by server policy');
        return [1, 0, 0];
      },
    };
    const memory: any = {
      recall: async (input: any) => {
        calls.recall.push(input);
        return [{ key: 'decision-pricing', value: 'We chose usage-based pricing', relevance: 0.5, updatedAt: '2026-09-01T00:00:00Z' }];
      },
      remember: async (input: any) => {
        calls.remember.push(input);
        return input;
      },
    };
    return { vectors, embeddings, memory, calls };
  }

  const openAiToolCall = (name: string, args: any, id = 'call_1') =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
      }),
    } as any);
  const openAiReply = (content: string) =>
    ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { role: 'assistant', content } }] }) } as any);

  // ===========================================================================
  await test('detectPersonalData flags emails, IBANs and Luhn-valid card numbers only', () => {
    assert.strictEqual(detectPersonalData('contact jane@example.com'), 'an email address');
    assert.strictEqual(detectPersonalData('IBAN DE89 3704 0044 0532 0130 00'), 'an IBAN');
    assert.strictEqual(detectPersonalData('card 4111 1111 1111 1111'), 'a payment card number');
    assert.strictEqual(detectPersonalData('order 1234567890123 shipped'), null, 'Non-Luhn long numbers are allowed');
    assert.strictEqual(detectPersonalData('Launch date is 2026-11-01'), null);
  });

  await test('withExtraTools scopes per-run tools without changing the shared registry', () => {
    const shared = new AgentToolRegistryService();
    const scoped = shared.withExtraTools(createMemoryTools({}, {
      sources: 'all', embeddingModel: '', minScore: 0.35, maxResults: 5, namespace: 'default', projectId: 'p1', allowWrite: false, maxWritesPerRun: 5, nodeId: 'n',
    }));
    assert.ok(scoped.hasTool('search_memory'));
    assert.ok(scoped.hasTool('search_web'), 'Shared tools remain available');
    assert.strictEqual(shared.hasTool('search_memory'), false);
  });

  await test('resolveAgentMemoryMode maps legacy enableMemory to agent', () => {
    assert.strictEqual(resolveAgentMemoryMode({ memoryMode: 'off' }), 'off');
    assert.strictEqual(resolveAgentMemoryMode({ memoryMode: 'required' }), 'required');
    assert.strictEqual(resolveAgentMemoryMode({ enableMemory: true }), 'agent');
    assert.strictEqual(resolveAgentMemoryMode({}), 'off');
  });

  await test('required memory mode preloads search results into the system prompt', async () => {
    const f = fakes();
    const runner = new AgentRunnerService(variableResolver, modelsService, undefined, f.memory, f.embeddings, f.vectors);
    globalThis.fetch = async () => openAiReply('Launch is on 2026-11-01 [artifact:v1].');
    const output = await runner.executeAgentNode(
      {
        id: 'mem-req',
        data: {
          config: {
            userPrompt: 'When does the pricing page launch?',
            memoryMode: 'required',
            memoryEmbeddingModel: 'text-embedding-3-small',
          },
        },
      } as any,
      null,
      { projectId: 'p1' },
    );
    globalThis.fetch = originalFetch;
    assert.ok(output.memoryPreload, 'Preload metadata is returned');
    assert.ok(output.memoryPreload.resultsCount >= 1);
    assert.strictEqual(f.calls.search.length, 1, 'Preload runs one vector search');
    assert.strictEqual(output.text, 'Launch is on 2026-11-01 [artifact:v1].');
  });

  await test('Memory-only agent gets just search_memory; results merge both stores above the threshold', async () => {
    const f = fakes();
    const runner = new AgentRunnerService(variableResolver, modelsService, undefined, f.memory, f.embeddings, f.vectors);
    const bodies: any[] = [];
    globalThis.fetch = async (_u: any, opts: any) => {
      const body = JSON.parse(opts.body);
      bodies.push(body);
      return bodies.length === 1 ? openAiToolCall('search_memory', { query: 'pricing launch date' }) : openAiReply('Launch is on 2026-11-01 [artifact:v1].');
    };
    const output = await runner.executeAgentNode(
      {
        id: 'mem',
        data: { config: { userPrompt: 'When does the pricing page launch?', memoryMode: 'agent', memoryEmbeddingModel: 'text-embedding-3-small' } },
      } as any,
      null,
      { projectId: 'p1' },
    );
    globalThis.fetch = originalFetch;

    const toolNames = bodies[0].tools.map((t: any) => t.function.name);
    assert.deepStrictEqual(toolNames, ['search_memory'], 'Web tools are not granted when only memory is enabled');
    assert.ok(bodies[0].messages[0].content.includes('search_memory'), 'System prompt explains the memory tool');
    assert.strictEqual(f.calls.embed[0].config.embeddingModel, 'text-embedding-3-small');
    assert.strictEqual(f.calls.search[0].projectId, 'p1');

    const result = output.toolCalls[0].result;
    assert.strictEqual(output.toolCalls[0].tool, 'search_memory');
    assert.deepStrictEqual(result.results.map((r: any) => r.id), ['artifact:v1', 'memory:decision-pricing'], 'Low-similarity chunk dropped');
    assert.strictEqual(result.retrieval.artifacts, 'vector');
    assert.strictEqual(output.text, 'Launch is on 2026-11-01 [artifact:v1].');
  });

  await test('Falls back to keyword search when embeddings are unavailable', async () => {
    const f = fakes({ embedFails: true });
    const [search] = createMemoryTools(
      { memory: f.memory, embeddings: f.embeddings, vectors: f.vectors },
      { sources: 'artifacts', embeddingModel: '', minScore: 0.35, maxResults: 5, namespace: 'default', projectId: 'p1', allowWrite: false, maxWritesPerRun: 5, nodeId: 'n' },
    );
    const res = await search.execute({ query: 'pricing launch', limit: 5, source: 'all' });
    assert.deepStrictEqual(f.calls.search[0].keywords, ['pricing', 'launch']);
    assert.strictEqual(res.retrieval.artifacts, 'keyword');
    assert.strictEqual(f.calls.recall.length, 0, 'Memories not searched when sources = artifacts');
    assert.ok(res.notes[0].includes('keyword search'));
  });

  await test('Relevance filter model keeps only hits it judges relevant', async () => {
    const f = fakes();
    const runner = new AgentRunnerService(variableResolver, modelsService, undefined, f.memory, f.embeddings, f.vectors);
    const urls: string[] = [];
    let agentCalls = 0;
    globalThis.fetch = async (url: any, opts: any) => {
      urls.push(String(url));
      if (String(url).includes('filter.example.com')) {
        assert.strictEqual(opts.headers.Authorization, 'Bearer filter-key');
        return openAiReply(JSON.stringify({ relevant: [{ id: 'memory:decision-pricing', relevance: 0.9 }, { id: 'artifact:v1', relevance: 0.3 }] }));
      }
      agentCalls++;
      return agentCalls === 1 ? openAiToolCall('search_memory', { query: 'pricing model' }) : openAiReply('Usage-based.');
    };
    const output = await runner.executeAgentNode(
      { id: 'mem', data: { config: { userPrompt: 'Which pricing model?', memoryMode: 'agent', memoryFilterModel: 'cheap-filter' } } } as any,
      null,
      { projectId: 'p1' },
    );
    globalThis.fetch = originalFetch;
    const result = output.toolCalls[0].result;
    assert.deepStrictEqual(result.results.map((r: any) => r.id), ['memory:decision-pricing']);
    assert.strictEqual(result.filteredBy, 'Cheap Filter');
    assert.strictEqual(urls.filter((u) => u.includes('filter.example.com')).length, 1);
    assert.strictEqual(output.usage.llmCalls, 3, 'Filter call is counted in usage');
  });

  await test('remember_memory: only with write enabled, prefixed keys, PII refused, per-run limit', async () => {
    const f = fakes();
    const opts = { sources: 'all' as const, embeddingModel: '', minScore: 0.35, maxResults: 5, namespace: 'team-a', projectId: 'p1', allowWrite: true, maxWritesPerRun: 1, nodeId: 'n1', runId: 'r1' };
    const readOnly = createMemoryTools({ memory: f.memory }, { ...opts, allowWrite: false });
    assert.deepStrictEqual(readOnly.map((t) => t.name), ['search_memory']);

    const [, remember] = createMemoryTools({ memory: f.memory }, opts);
    const pii = remember.validateArgs!({ key: 'contact', value: 'Email jane@example.com about it' });
    assert.strictEqual(pii.isValid, false);
    assert.ok(/personal or payment data/i.test(pii.error!));

    const ok = remember.validateArgs!({ key: 'Launch Date!', value: 'Pricing page launches 2026-11-01', importance: 42 });
    assert.strictEqual(ok.isValid, true);
    const saved = await remember.execute(ok.cleanArgs);
    assert.strictEqual(saved.key, 'agent:launch-date');
    assert.deepStrictEqual(
      { ns: f.calls.remember[0].namespace, kind: f.calls.remember[0].kind, importance: f.calls.remember[0].importance, source: f.calls.remember[0].metadata.source },
      { ns: 'team-a', kind: 'knowledge', importance: 10, source: 'agent' },
    );
    await assert.rejects(remember.execute(ok.cleanArgs), /Write limit reached/);
  });

  await test('All-zero similarity scores surface an embedding-model mismatch note', async () => {
    const f = fakes();
    f.vectors.search = async () => [{ vectorId: 'v9', text: 'x', metadata: {}, score: 0 }];
    const [search] = createMemoryTools(
      { embeddings: f.embeddings, vectors: f.vectors },
      { sources: 'artifacts', embeddingModel: 'other-model', minScore: 0.35, maxResults: 5, namespace: 'default', projectId: 'p1', allowWrite: false, maxWritesPerRun: 5, nodeId: 'n' },
    );
    const res = await search.execute({ query: 'anything', limit: 5, source: 'all' });
    assert.strictEqual(res.resultsCount, 0);
    assert.ok(res.notes[0].includes('embedding model probably differs'));
  });

  console.log('\n=============================================');
  console.log(`📊 TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log('=============================================\n');
  if (failed > 0) process.exit(1);
}

runTests();
