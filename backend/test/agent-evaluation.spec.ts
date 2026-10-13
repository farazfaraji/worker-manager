import * as assert from 'assert';
import { BadRequestException } from '@nestjs/common';
import { AgentRunnerService } from '../src/runs/services/agent-runner.service';
import { VariableResolverService } from '../src/runs/services/variable-resolver.service';
import { buildRepairPrompt, computeReview, parseCriteria } from '../src/runs/services/agent-evaluation.util';

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING AGENT EVALUATION (LLM JUDGE) SUITE');
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
    'claude-judge': { modelId: 'claude-judge', label: 'Claude Judge', provider: 'anthropic', endpoint: 'https://api.anthropic.com/v1', apiKey: 'judge-key' },
  };
  const modelsService: any = { findByModelIdOrLabel: async (key: string) => records[key] || records['gpt-4o'] };
  const openAiReply = (content: string, usage?: any) =>
    ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { role: 'assistant', content } }], ...(usage ? { usage } : {}) }) } as any);
  const verdict = (pass: boolean[], issues: any[] = []) =>
    JSON.stringify({
      criteria: pass.map((p, i) => ({ id: `C${i + 1}`, name: `c${i + 1}`, mustHave: i === 0, pass: p })),
      issues,
      summary: 'review',
    });
  const isEvaluatorCall = (body: any) =>
    JSON.stringify(body.system ?? body.messages?.[0]?.content ?? '').includes('independent quality reviewer');
  const criteriaText = '[must] Answers the question\n- [should] Cites a source\n2. should: Under 100 words';
  const node = (extra: Record<string, any> = {}): any => ({
    id: 'agent_eval',
    data: {
      config: {
        model: 'gpt-4o',
        systemPrompt: 'You answer questions.',
        userPrompt: 'What is LangGraph?',
        enableEvaluation: true,
        evaluationCriteria: criteriaText,
        evaluationThreshold: 80,
        maxEvaluationRounds: 2,
        ...extra,
      },
    },
  });

  // ===========================================================================
  // Pure helpers
  // ===========================================================================
  await test('parseCriteria reads [must]/[should] tags, bullets and numbering', () => {
    const c = parseCriteria(criteriaText);
    assert.deepStrictEqual(c, [
      { id: 'C1', name: 'Answers the question', mustHave: true },
      { id: 'C2', name: 'Cites a source', mustHave: false },
      { id: 'C3', name: 'Under 100 words', mustHave: false },
    ]);
    assert.deepStrictEqual(parseCriteria(''), []);
  });

  await test('computeReview weighs must-haves, treats skipped criteria as failed, and requires all must-haves', () => {
    const configured = parseCriteria(criteriaText);
    // must passes (2) + C2 passes (1) of total 4 -> 75; C3 missing -> failed
    const r = computeReview(
      { criteria: [{ id: 'c1', pass: true }, { id: 'C2', pass: true }], issues: [{ severity: 'HIGH', problem: 'p', fix: 'f' }] },
      configured,
      70,
    );
    assert.strictEqual(r.score, 75);
    assert.strictEqual(r.passed, true);
    assert.strictEqual(r.criteria[2].pass, false);
    assert.strictEqual(r.issues[0].severity, 'critical');

    const mustFails = computeReview({ criteria: [{ id: 'C1', pass: false }, { id: 'C2', pass: true }, { id: 'C3', pass: true }] }, configured, 0);
    assert.strictEqual(mustFails.passed, false, 'A failed [must] criterion fails regardless of score');

    const noCriteria = computeReview({ criteria: [], issues: [{ severity: 'major', problem: 'x', fix: 'y' }] }, [], 80);
    assert.strictEqual(noCriteria.score, 80);
    assert.strictEqual(noCriteria.passed, true);
    assert.ok(buildRepairPrompt(mustFails, 80, true).includes('ONLY the corrected JSON'));
  });

  // ===========================================================================
  // Evaluator–optimizer loop
  // ===========================================================================
  await test('below threshold -> problems sent back in the same conversation, repaired answer passes', async () => {
    const runner = new AgentRunnerService(variableResolver, modelsService);
    const agentBodies: any[] = [];
    let evalCalls = 0;
    globalThis.fetch = async (_u: any, opts: any) => {
      const body = JSON.parse(opts.body);
      if (isEvaluatorCall(body)) {
        evalCalls++;
        return evalCalls === 1
          ? openAiReply(verdict([true, false, true], [{ severity: 'major', problem: 'No source', fix: 'Add the docs URL' }]), { prompt_tokens: 50, completion_tokens: 20 })
          : openAiReply(verdict([true, true, true]), { prompt_tokens: 60, completion_tokens: 20 });
      }
      agentBodies.push(body);
      return agentBodies.length === 1
        ? openAiReply('LangGraph is a library.', { prompt_tokens: 30, completion_tokens: 10 })
        : openAiReply('LangGraph is a library (https://langchain-ai.github.io/langgraph/).', { prompt_tokens: 45, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 30 } });
    };
    const output = await runner.executeAgentNode(node(), null, {});
    globalThis.fetch = originalFetch;

    assert.strictEqual(agentBodies.length, 2);
    assert.strictEqual(evalCalls, 2);
    const repair = agentBodies[1].messages;
    assert.deepStrictEqual(repair.slice(0, 2), agentBodies[0].messages, 'Repair keeps the original prompt prefix (cacheable)');
    assert.strictEqual(repair[2].role, 'assistant');
    assert.strictEqual(repair[2].content, 'LangGraph is a library.');
    assert.ok(repair[3].content.includes('No source') && repair[3].content.includes('Add the docs URL'));

    assert.ok(output.text.includes('https://'), 'Repaired answer is returned');
    assert.strictEqual(output.evaluation.passed, true);
    assert.strictEqual(output.evaluation.score, 100);
    assert.strictEqual(output.evaluation.repairRounds, 1);
    assert.strictEqual(output.evaluation.selectedAttempt, 1);
    assert.deepStrictEqual(output.evaluation.history.map((h: any) => h.score), [75, 100]);
    assert.strictEqual(output.usage.llmCalls, 4, 'Usage includes evaluator calls');
    assert.strictEqual(output.usage.cachedInputTokens, 30);
  });

  await test('stops early when a repair does not improve, and returns the best attempt', async () => {
    const runner = new AgentRunnerService(variableResolver, modelsService);
    let agentCalls = 0;
    let evalCalls = 0;
    globalThis.fetch = async (_u: any, opts: any) => {
      const body = JSON.parse(opts.body);
      if (isEvaluatorCall(body)) {
        evalCalls++;
        return openAiReply(evalCalls === 1 ? verdict([true, true, false]) : verdict([true, false, false]));
      }
      agentCalls++;
      return openAiReply(agentCalls === 1 ? 'first answer' : 'worse answer');
    };
    const output = await runner.executeAgentNode(node({ maxEvaluationRounds: 5 }), null, {});
    globalThis.fetch = originalFetch;
    assert.strictEqual(agentCalls, 2, 'Only one repair attempt before stopping');
    assert.strictEqual(output.text, 'first answer');
    assert.strictEqual(output.evaluation.passed, false);
    assert.strictEqual(output.evaluation.selectedAttempt, 0);
    assert.strictEqual(output.evaluation.score, 75);
  });

  await test('onEvaluationFail=fail throws EVALUATION_FAILED with the evaluation attached', async () => {
    const runner = new AgentRunnerService(variableResolver, modelsService);
    globalThis.fetch = async (_u: any, opts: any) =>
      isEvaluatorCall(JSON.parse(opts.body)) ? openAiReply(verdict([false, false, false])) : openAiReply('bad');
    let error: any;
    try {
      await runner.executeAgentNode(node({ onEvaluationFail: 'fail', maxEvaluationRounds: 0 }), null, {});
    } catch (err) {
      error = err;
    }
    globalThis.fetch = originalFetch;
    assert.ok(error instanceof BadRequestException);
    const body: any = error.getResponse();
    assert.strictEqual(body.code, 'EVALUATION_FAILED');
    assert.strictEqual(body.evaluation.score, 0);
  });

  await test('evaluator returning garbage -> evaluation skipped, agent answer still returned', async () => {
    const runner = new AgentRunnerService(variableResolver, modelsService);
    let evalCalls = 0;
    globalThis.fetch = async (_u: any, opts: any) => {
      if (isEvaluatorCall(JSON.parse(opts.body))) {
        evalCalls++;
        return openAiReply('I think it is fine!');
      }
      return openAiReply('agent answer');
    };
    const output = await runner.executeAgentNode(node(), null, {});
    globalThis.fetch = originalFetch;
    assert.strictEqual(evalCalls, 2, 'One evaluator call + one format correction');
    assert.strictEqual(output.text, 'agent answer');
    assert.strictEqual(output.evaluation.skipped, true);
    assert.strictEqual(output.evaluation.score, null);
  });

  await test('separate evaluator model uses its own provider and credentials; JSON answers are re-validated', async () => {
    const runner = new AgentRunnerService(variableResolver, modelsService);
    const seen: Array<{ url: string; key?: string; auth?: string }> = [];
    let agentCalls = 0;
    globalThis.fetch = async (url: any, opts: any) => {
      seen.push({ url: String(url), key: opts.headers['x-api-key'], auth: opts.headers.Authorization });
      const body = JSON.parse(opts.body);
      if (isEvaluatorCall(body)) {
        const ok = agentCalls > 1;
        return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: verdict([ok, ok, ok]) }] }) } as any;
      }
      agentCalls++;
      return openAiReply(agentCalls === 1 ? '{"answer":"short"}' : '{"answer":"long and sourced"}');
    };
    const output = await runner.executeAgentNode(
      node({ evaluatorModel: 'claude-judge', outputType: 'z.object({ answer: z.string() })', validateOutput: true }),
      null,
      {},
    );
    globalThis.fetch = originalFetch;
    const judgeCalls = seen.filter((s) => s.url.includes('anthropic'));
    assert.strictEqual(judgeCalls.length, 2);
    assert.ok(judgeCalls.every((s) => s.key === 'judge-key' && !s.auth), 'Evaluator uses its own key only');
    assert.ok(seen.filter((s) => s.url.includes('openai')).every((s) => s.auth === 'Bearer agent-key'));
    assert.strictEqual(output.result.answer, 'long and sourced');
    assert.strictEqual(output.evaluation.evaluatorModel, 'Claude Judge');
    assert.strictEqual(output.evaluation.passed, true);
  });

  console.log('\n=============================================');
  console.log(`📊 TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log('=============================================\n');
  if (failed > 0) process.exit(1);
}

runTests();
