import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { NodeDefinitionsService } from '../src/node-definitions/node-definitions.service';
import { NodeCacheService } from '../src/runs/services/node-cache.service';

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING NODE CACHING SYSTEM SPEC');
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

  // =========================================================================
  // 1. Tool Definition Checks
  // =========================================================================
  await test('agent.json has cacheResult checkbox input option', async () => {
    const nodeDefService = new NodeDefinitionsService();
    const defs = await nodeDefService.getAllDefinitions();
    const agentDef = defs.find((d) => d.id === 'agent');
    assert.ok(agentDef, 'agent definition must exist');

    const cacheInput = agentDef.inputs.find((i: any) => i.name === 'cacheResult');
    assert.ok(cacheInput, 'cacheResult input must exist in agent.json');
    assert.strictEqual(cacheInput.type, 'checkbox');
    assert.strictEqual(cacheInput.defaultValue, true);
  });

  await test('web-search.json has cacheResult checkbox input option', async () => {
    const nodeDefService = new NodeDefinitionsService();
    const defs = await nodeDefService.getAllDefinitions();
    const wsDef = defs.find((d) => d.id === 'web-search');
    assert.ok(wsDef, 'web-search definition must exist');

    const cacheInput = wsDef.inputs.find((i: any) => i.name === 'cacheResult');
    assert.ok(cacheInput, 'cacheResult input must exist in web-search.json');
    assert.strictEqual(cacheInput.type, 'checkbox');
    assert.strictEqual(cacheInput.defaultValue, true);
  });

  await test('repo-inspect.json has cacheResult checkbox input option', async () => {
    const nodeDefService = new NodeDefinitionsService();
    const defs = await nodeDefService.getAllDefinitions();
    const repoDef = defs.find((d) => d.id === 'repo-inspect');
    assert.ok(repoDef, 'repo-inspect definition must exist');

    const cacheInput = repoDef.inputs.find((i: any) => i.name === 'cacheResult');
    assert.ok(cacheInput, 'cacheResult input must exist in repo-inspect.json');
    assert.strictEqual(cacheInput.type, 'checkbox');
    assert.strictEqual(cacheInput.defaultValue, true);
  });

  // =========================================================================
  // 2. NodeCacheService Unit Tests (In-Memory Mock Model)
  // =========================================================================
  await test('NodeCacheService stores, retrieves, and updates single cache entry per node', async () => {
    const storage = new Map<string, any>();

    const mockModel: any = {
      findOne: (query: any) => ({
        lean: () => ({
          exec: async () => {
            const key = `${query.graphId}:::${query.nodeId}`;
            return storage.get(key) || null;
          },
        }),
      }),
      findOneAndUpdate: (query: any, update: any) => ({
        exec: async () => {
          const key = `${query.graphId}:::${query.nodeId}`;
          const doc = { ...update, updatedAt: new Date() };
          storage.set(key, doc);
          return doc;
        },
      }),
      find: (query: any) => ({
        sort: () => ({
          lean: () => ({
            exec: async () => {
              const results: any[] = [];
              for (const [k, v] of storage.entries()) {
                if (!query.graphId || k.startsWith(`${query.graphId}:::`)) {
                  results.push(v);
                }
              }
              return results;
            },
          }),
        }),
        lean: () => ({
          exec: async () => {
            const results: any[] = [];
            for (const [k, v] of storage.entries()) {
              if (!query.graphId || k.startsWith(`${query.graphId}:::`)) {
                results.push(v);
              }
            }
            return results;
          },
        }),
      }),
      deleteMany: (query: any) => ({
        exec: async () => {
          let deletedCount = 0;
          for (const [k] of Array.from(storage.entries())) {
            const [gId, nId] = k.split(':::');
            if (gId === query.graphId && (!query.nodeId || nId === query.nodeId)) {
              storage.delete(k);
              deletedCount++;
            }
          }
          return { deletedCount };
        },
      }),
    };

    const cacheService = new NodeCacheService(mockModel);

    // Initial cache should be null
    const empty = await cacheService.getCachedResult('graph_1', 'agent_node');
    assert.strictEqual(empty, null);

    // Save initial result
    await cacheService.saveCachedResult('graph_1', 'agent_node', 'Agent 1', 'agent', {
      text: 'First LLM generation',
    });

    const cached1 = await cacheService.getCachedResult('graph_1', 'agent_node');
    assert.ok(cached1, 'Cache record must exist');
    assert.strictEqual(cached1.result.text, 'First LLM generation');
    assert.strictEqual(cached1.nodeType, 'agent');

    // Update result for the same node - single entry constraint!
    await cacheService.saveCachedResult('graph_1', 'agent_node', 'Agent 1', 'agent', {
      text: 'Second updated LLM generation',
    });

    const cached2 = await cacheService.getCachedResult('graph_1', 'agent_node');
    assert.strictEqual(cached2.result.text, 'Second updated LLM generation');

    // Check graph-wide listing
    await cacheService.saveCachedResult('graph_1', 'web_node', 'Web Search', 'web-search', {
      results: ['https://example.com'],
    });

    const allGraphCaches = await cacheService.getGraphCaches('graph_1');
    assert.strictEqual(allGraphCaches.length, 2, 'Should have exactly 2 node caches for graph_1');

    // Clear single node cache
    await cacheService.clearCache('graph_1', 'agent_node');
    const afterDelete = await cacheService.getCachedResult('graph_1', 'agent_node');
    assert.strictEqual(afterDelete, null);

    const remaining = await cacheService.getGraphCaches('graph_1');
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].nodeId, 'web_node');

    // Clear entire graph cache
    await cacheService.clearCache('graph_1');
    const cleared = await cacheService.getGraphCaches('graph_1');
    assert.strictEqual(cleared.length, 0);
  });

  // =========================================================================
  // 3. Execution Cache Simulation (HIT / MISS / SKIP)
  // =========================================================================
  await test('Debug run with useCache=true uses cache and avoids service invocation', async () => {
    let serviceInvocations = 0;

    const mockCacheService = {
      cache: new Map<string, any>(),
      async getCachedResult(graphId: string, nodeId: string) {
        return this.cache.get(`${graphId}:${nodeId}`) || null;
      },
      async saveCachedResult(graphId: string, nodeId: string, nodeName: string, nodeType: string, result: any) {
        this.cache.set(`${graphId}:${nodeId}`, { graphId, nodeId, nodeName, nodeType, result });
      },
    };

    // Pre-populate cache
    await mockCacheService.saveCachedResult('test_graph', 'node_agent', 'AI Agent', 'agent', {
      response: 'Cached response from previous run',
    });

    // Simulate node execution logic with options: { debugMode: true, useCache: true }
    const simulateNodeRun = async (options: { debugMode?: boolean; useCache?: boolean }, nodeConfig: any) => {
      const nodeType = 'agent';
      const nodeName = 'AI Agent';
      const nodeId = 'node_agent';
      const isCacheEligible = ['agent', 'web-search', 'repo-inspect'].includes(nodeType);
      const hasCacheEnabled = Boolean(nodeConfig.cacheResult);
      const isDebugSession = Boolean(options.debugMode);
      const isUseCacheSession = Boolean(options.useCache);

      let isCacheHit = false;
      let rawOutput: any;
      const record: any = {};

      if (isCacheEligible && hasCacheEnabled && isUseCacheSession) {
        const cached = await mockCacheService.getCachedResult('test_graph', nodeId);
        if (cached && cached.result !== undefined) {
          isCacheHit = true;
          rawOutput = cached.result;
          record.cached = true;
        }
      }

      if (!isCacheHit) {
        serviceInvocations++;
        rawOutput = { response: `Live service call #${serviceInvocations}` };
      }

      const durationMs = isCacheHit ? 0 : 150;
      record.durationMs = durationMs;

      if (isCacheEligible && hasCacheEnabled && !isCacheHit) {
        await mockCacheService.saveCachedResult('test_graph', nodeId, nodeName, nodeType, rawOutput);
      }

      return { rawOutput, record };
    };

    // 1. Run in debug mode WITH useCache
    const resultWithCache = await simulateNodeRun({ debugMode: true, useCache: true }, { cacheResult: true });
    assert.strictEqual(serviceInvocations, 0, 'Service must NOT be invoked when cache hit occurs');
    assert.strictEqual(resultWithCache.record.cached, true, 'Record must be marked as cached');
    assert.strictEqual(resultWithCache.record.durationMs, 0, 'Cache hit duration must be 0ms');
    assert.strictEqual(resultWithCache.rawOutput.response, 'Cached response from previous run');

    // 2. Run in normal mode WITH useCache
    const resultNormalWithCache = await simulateNodeRun({ debugMode: false, useCache: true }, { cacheResult: true });
    assert.strictEqual(serviceInvocations, 0, 'Service must NOT be invoked when normal run has useCache=true');
    assert.strictEqual(resultNormalWithCache.record.cached, true);

    // 3. Run without useCache
    const resultWithoutCache = await simulateNodeRun({ debugMode: false, useCache: false }, { cacheResult: true });
    assert.strictEqual(serviceInvocations, 1, 'Service MUST be invoked when useCache is false');
    assert.strictEqual(resultWithoutCache.record.cached, undefined);
    assert.strictEqual(resultWithoutCache.rawOutput.response, 'Live service call #1');

    // Verify cache was updated with the new live call result
    const updatedCache = await mockCacheService.getCachedResult('test_graph', 'node_agent');
    assert.strictEqual(updatedCache.result.response, 'Live service call #1');
  });

  console.log('\n=============================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('=============================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
