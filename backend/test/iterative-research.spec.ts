import * as assert from 'node:assert/strict';
import { SubgraphRunnerService } from '../src/runs/services/subgraph-runner.service';
import { BlockRuntimeService } from '../src/blocks/block-runtime.service';
import { AgentToolRegistryService } from '../src/runs/services/agent-tool-registry.service';
import { GraphsService } from '../src/graphs/graphs.service';
import { NodeDefinitionsService } from '../src/node-definitions/node-definitions.service';
import { validateResearchFindings } from '../src/research/research.contract';
import { redactSecrets } from '../src/runs/services/redaction.util';

const graphId = '507f1f77bcf86cd799439011';
const runner = new SubgraphRunnerService();
async function main() {
  const seen: any[] = [];
  const loopNode = { id: 'research-loop', type: 'loop', data: { config: { mode: 'research', graphId, maxRounds: 3, initialInput: { idea: 'A' } } } };
  const completed = await runner.executeIterativeLoopNode(loopNode, {}, 'parent', 0, [], async (_id, input, options) => {
    seen.push({ input, options });
    return { status: 'completed', runId: `round-${input.iteration}`, output: { decision: input.iteration === 2 ? 'pass' : 'needs_more_research', gaps: input.iteration === 1 ? ['missing user interviews'] : [] } };
  });
  assert.equal(completed.result.stopReason, 'condition_met');
  assert.equal(completed.result.count, 2);
  assert.deepEqual(seen[1].input.gaps, ['missing user interviews']);
  assert.equal(seen[1].input.priorResult.decision, 'needs_more_research');
  assert.equal(seen[0].options.idempotencyKey, 'research-loop:parent:research-loop:1');
  const wrapped = await runner.executeIterativeLoopNode({ ...loopNode, data: { config: { ...loopNode.data.config, completionPath: 'review.decision', gapPath: 'review.gaps' } } }, {}, 'wrapped-parent', 0, [], async () => ({ status: 'completed', runId: 'wrapped-child', output: { review: { decision: 'pass', gaps: [] } } }));
  assert.equal(wrapped.result.stopReason, 'condition_met');
  await assert.rejects(() => runner.executeIterativeLoopNode(loopNode, {}, 'bad-path', 0, [], async () => ({ status: 'completed', runId: 'child', output: { wrong: true } })), /completionPath/);
  const limited = await runner.executeIterativeLoopNode({ ...loopNode, data: { config: { ...loopNode.data.config, maxRounds: 2 } } }, {}, 'parent2', 0, [], async (_id, input) => ({ status: 'completed', runId: `r-${input.iteration}`, output: { decision: 'needs_more_research', gaps: ['open'] } }));
  assert.equal(limited.result.stopReason, 'iteration_limit');
  assert.equal(limited.result.limitReached, true);
  assert.equal(limited.result.status, 'incomplete');
  await assert.rejects(() => runner.executeIterativeLoopNode(loopNode, {}, 'parent3', 0, [], async () => ({ status: 'failed', runId: 'bad', error: 'source unavailable' })), /source unavailable/);
  await assert.rejects(() => runner.executeIterativeLoopNode(loopNode, {}, 'cancelled-parent', 0, [], async () => ({ status: 'completed', runId: 'should-not-run', output: { decision: 'pass', gaps: [] } }), async () => true), (error: any) => error.code === 'RUN_CANCELLED');

  const calls: any[] = [];
  const agentRunner: any = { executeAgentNode: async (node: any) => {
    calls.push(node.data.config);
    if (node.id === 'delegated-bad') throw new Error('simulated provider failure');
    await new Promise(resolve => setTimeout(resolve, node.id === 'delegated-slow' ? 20 : 1));
    return { finding: node.id };
  } };
  const blocks = new BlockRuntimeService({} as any, {} as any, {} as any, agentRunner, {} as any, {} as any, {} as any);
  const sequential = await blocks.execute('orchestrator', { config: { goal: 'Research idea', strategy: 'sequential', agents: [{ id: 'first', role: 'Market', task: 'Find market size' }, { id: 'second', role: 'Risks', task: 'Find risks' }] } });
  assert.equal(sequential.result.results[1].id, 'second');
  assert.equal(calls[1].userPrompt.priorResults[0].result.finding, 'delegated-first');
  assert.equal(calls[1].userPrompt.goal, 'Research idea');
  await blocks.execute('orchestrator', { config: { goal: 'Independent', strategy: 'sequential', agents: [{ id: 'one' }, { id: 'two', includePriorResults: false }] } });
  assert.equal(calls[calls.length - 1].userPrompt, 'Independent');
  const parallel = await blocks.execute('orchestrator', { config: { goal: 'A', strategy: 'parallel', agents: [{ id: 'slow' }, { id: 'bad' }, { id: 'fast' }] } });
  assert.deepEqual(parallel.result.results.map((r: any) => r.id), ['slow', 'bad', 'fast']);
  assert.equal(parallel.result.status, 'partial');
  assert.equal(parallel.result.successCount, 2);
  const legacy = await blocks.execute('orchestrator', { config: { goal: 'Legacy goal', agents: [{ name: 'legacy' }] } });
  assert.equal(legacy.result.results[0].id, 'legacy');
  assert.equal(calls[calls.length - 1].userPrompt, 'Legacy goal');

  const webRunner: any = { executeWebSearchNode: async (node: any) => node.data.config.mode === 'search'
    ? { provider: 'tavily', status: 200, results: [{ title: 'Original report', url: 'https://example.org/report', content: 'Direct evidence', score: 0.92, publishedDate: '2026-09-01' }] }
    : { status: 200, url: 'https://example.org/final', title: '', text: 'Direct page text', links: [] } };
  const tools = new AgentToolRegistryService(webRunner);
  const search = await tools.executeTool('search_web', { query: 'provider count' });
  assert.equal(search.success, true);
  assert.equal(search.result.results[0].score, 0.92);
  assert.equal(search.result.results[0].publishedAt, '2026-09-01');
  assert.equal(search.result.results[0].query, 'provider count');
  assert.ok(search.result.results[0].accessedAt);
  const read = await tools.executeTool('read_url', { url: 'https://example.org/start' });
  assert.equal(read.result.originalUrl, 'https://example.org/start');
  assert.equal(read.result.resolvedUrl, 'https://example.org/final');
  assert.equal(read.result.title, null);
  assert.equal(read.result.publishedAt, null);
  assert.ok(read.result.accessedAt);
  assert.ok(validateResearchFindings([{ id: 'f1', claim: 'A', evidence: 'B', sources: [{ url: 'bad', title: '', publishedAt: null, accessedAt: '', type: 'other', evidence: 'B', role: 'supports' }], confidence: 0.5, limitations: '', researchArea: 'market', questionIds: [] }]).errors.some(e => e.path.endsWith('sources[0].url')));
  const secret = `sk-${'x'.repeat(25)}`;
  assert.equal(redactSecrets(`first ${secret}`), 'first [REDACTED]');
  assert.equal(redactSecrets(`second ${secret}`), 'second [REDACTED]');

  const graphs = new GraphsService({} as any, new NodeDefinitionsService(), {} as any);
  (graphs as any).findOne = async () => ({ nodes: [{ id: 'gate', type: 'human-gate', data: {} }] });
  await assert.rejects(() => graphs.assertNoWaitingGatesInChildGraph(graphId), (error: any) => error.response?.code === 'NESTED_WAITING_GATE_UNSUPPORTED');
  await assert.rejects(() => graphs.validateGraphVariables([{ id: 'each', type: 'foreach', data: { config: { mode: 'subgraph', graphId, concurrency: 2 } } }], []), (error: any) => error.response?.code === 'NESTED_WAITING_GATE_UNSUPPORTED');
  const foreachNodes = [{ id: 'each', type: 'foreach', data: { config: { mode: 'canvas' } } }, { id: 'gate', type: 'human-gate', data: {} }];
  await assert.rejects(() => runner.executeForeachNode(foreachNodes[0], { mode: 'canvas', items: ['x'] }, 'parent', 0, [], async () => ({ status: 'completed' }), { nodes: foreachNodes, edges: [{ source: 'each', sourceHandle: 'item', target: 'gate' }] }), /Human gates inside a foreach item branch/);
  console.log('Iterative research workflow tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
