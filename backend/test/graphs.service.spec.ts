import * as assert from 'node:assert/strict';
import { GraphsService, parseSchema } from '../src/graphs/graphs.service';
import { NodeDefinitionsService } from '../src/node-definitions/node-definitions.service';
import { GraphShapeService } from '../src/graphs/graph-shape.service';
import { GraphValidationService } from '../src/graphs/services/graph-validation.service';
import { GraphEnrichmentService } from '../src/graphs/services/graph-enrichment.service';
import { BadRequestException } from '@nestjs/common';

async function run() {
  console.log('=============================================');
  console.log('🧪 RUNNING GRAPHS SERVICE PRODUCTION TEST SUITE');
  console.log('=============================================\n');

  const defService = new NodeDefinitionsService();
  const shapeService = new GraphShapeService();
  const enrichmentService = new GraphEnrichmentService(defService);
  const fakeModel: any = {
    findById: () => ({ lean: () => ({ exec: async () => null }) }),
  };
  const validationService = new GraphValidationService(fakeModel, enrichmentService);
  const graphsService = new GraphsService(
    fakeModel,
    defService,
    shapeService,
    undefined,
    validationService,
    enrichmentService,
  );

  // 1. Schema Parsing Tests
  console.log('--- 1. Schema Parser Robustness Tests ---');
  {
    const parsed = parseSchema(`z.object({
      orderId: z.string(),
      count: z.number().optional(),
      active: z.boolean(),
      tags: z.array(z.string()),
      metadata: z.record(z.any()),
      commentWithComma: z.string().default("hello, world}"),
    })`);

    assert.ok(parsed, 'Parsed schema must exist');
    assert.strictEqual(parsed.orderId, 'string');
    assert.strictEqual(parsed.count, 'number');
    assert.strictEqual(parsed.active, 'boolean');
    assert.strictEqual(parsed.tags, 'array');
    assert.strictEqual(parsed.metadata, 'object');
    console.log('  ✅ PASS: Zod schema with method chaining and quoted strings correctly parsed');
  }

  // 2. Variable Validation: Literal strings with dots do NOT cause false positives
  console.log('\n--- 2. Variable Validation & Heuristic False-Positive Prevention ---');
  {
    const nodes = [
      {
        id: 'start_node',
        type: 'trigger',
        data: { name: 'start', definitionType: 'trigger' },
      },
      {
        id: 'worker_node',
        type: 'script',
        data: {
          name: 'worker',
          definitionType: 'script',
          config: {
            // "config.json" contains a dot but is a string literal, NOT a variable reference
            filename: 'config.json',
            version: '2.0.1',
          },
        },
      },
    ];
    const edges = [{ source: 'start_node', target: 'worker_node' }];

    const res = await graphsService.validateGraphVariables(nodes, edges);
    assert.strictEqual(res.valid, true);
    console.log('  ✅ PASS: Literal strings with dots (config.json, 2.0.1) do not trigger false-positive variable errors');
  }

  // 3. Variable Validation: Explicit template variables are strictly validated
  {
    const nodes = [
      {
        id: 'start_node',
        type: 'trigger',
        data: { name: 'start', definitionType: 'trigger' },
      },
      {
        id: 'worker_node',
        type: 'script',
        data: {
          name: 'worker',
          definitionType: 'script',
          config: {
            inputVal: '{{ non_existent_node.value }}',
          },
        },
      },
    ];
    const edges = [{ source: 'start_node', target: 'worker_node' }];

    await assert.rejects(
      async () => graphsService.validateGraphVariables(nodes, edges),
      (err: any) => {
        assert.ok(err instanceof BadRequestException);
        assert.match(err.message, /Invalid variable reference/);
        return true;
      },
    );
    console.log('  ✅ PASS: Non-existent node references in {{ ... }} templates are strictly rejected');
  }

  {
    const nodes = [
      { id: 'start_node', type: 'trigger', data: { name: 'start', definitionType: 'trigger' } },
      { id: 'other_node', type: 'script', data: { name: 'other', definitionType: 'script' } },
      {
        id: 'worker_node',
        type: 'script',
        data: {
          name: 'worker',
          definitionType: 'script',
          config: { inputVal: '{{ other.result }}' },
        },
      },
    ];
    const edges = [{ source: 'start_node', target: 'worker_node' }];

    await assert.rejects(
      async () => graphsService.validateGraphVariables(nodes, edges),
      (err: any) => {
        assert.ok(err instanceof BadRequestException);
        assert.match(err.message, /Invalid variable reference/);
        assert.match(JSON.stringify(err.getResponse()), /not upstream/);
        return true;
      },
    );
    console.log('  ✅ PASS: A node that exists but is not upstream is rejected');
  }

  // 4. Cycle Detection Tests
  console.log('\n--- 3. Cycle Detection Tests ---');
  {
    // Self-cycle (A -> A)
    const selfCycleEdges = [{ source: 'node_a', target: 'node_a' }];
    const nodes = [
      { id: 'node_a', type: 'trigger', data: { name: 'node_a' } },
    ];
    await assert.rejects(
      async () => graphsService.validateGraphVariables(nodes, selfCycleEdges),
      (err: any) => {
        assert.ok(err instanceof BadRequestException);
        assert.match(err.message, /Self-referencing cycle/);
        return true;
      },
    );
    console.log('  ✅ PASS: Length-1 self-referencing cycle rejected');

    // Multi-node cycle (A -> B -> A)
    const circularEdges = [
      { source: 'node_a', target: 'node_b' },
      { source: 'node_b', target: 'node_a' },
    ];
    const circularNodes = [
      { id: 'node_a', type: 'trigger', data: { name: 'node_a' } },
      { id: 'node_b', type: 'script', data: { name: 'node_b' } },
    ];
    await assert.rejects(
      async () => graphsService.validateGraphVariables(circularNodes, circularEdges),
      (err: any) => {
        assert.ok(err instanceof BadRequestException);
        assert.match(err.message, /Cycle detected in graph topology/);
        return true;
      },
    );
    console.log('  ✅ PASS: Multi-node circular dependency (A -> B -> A) detected and rejected');
  }

  // 5. Upstream Variables & Schema Path Computation
  console.log('\n--- 4. Upstream Variables & Nested Schema Expansion ---');
  {
    const mockGraph = {
      _id: '507f1f77bcf86cd799439011',
      nodes: [
        {
          id: 'route_1',
          type: 'route',
          data: {
            name: 'route_1',
            config: {
              type: `z.object({
                user: z.object({
                  id: z.string(),
                  name: z.string()
                }),
                count: z.number()
              })`,
            },
          },
        },
        {
          id: 'worker_1',
          type: 'script',
          data: { name: 'worker_1' },
        },
      ],
      edges: [{ source: 'route_1', target: 'worker_1' }],
    };

    const vars = await enrichmentService.computeUpstreamVariables(
      mockGraph,
      'worker_1',
      () => new Set(),
    );

    assert.ok(vars.variables.length > 0);
    const paths = vars.variables.map((v) => v.path);
    assert.ok(paths.includes('route_1.body'));
    assert.ok(paths.includes('route_1.body.user'));
    assert.ok(paths.includes('route_1.body.user.id'));
    assert.ok(paths.includes('route_1.body.user.name'));
    assert.ok(paths.includes('route_1.body.count'));
    console.log('  ✅ PASS: Deeply nested schema paths recursively extracted for upstream consumers');
  }

  // 6. config.key is a variable name only on Set Variable nodes
  console.log('\n--- 5. Output Schema Source ---');
  {
    const enriched = await enrichmentService.enrichNodesWithOutputs([
      {
        id: 'mem',
        type: 'memory',
        data: {
          name: 'memory',
          definitionType: 'memory',
          config: { key: 'user_pref', value: 'dark mode' },
        },
      },
      {
        id: 'counter',
        type: 'variable',
        data: {
          name: 'counter',
          definitionId: 'set-variable',
          definitionType: 'variable',
          config: { key: 'userCount', valueType: 'number', numberValue: 3 },
        },
      },
    ]);

    const memoryResult = enriched[0].data.outputs.find((output) => output.name === 'result');
    assert.ok(memoryResult, 'memory node keeps its result output');
    assert.strictEqual(memoryResult.schema, undefined);

    const assigned = enriched[1].data.outputs.find((output) => output.name === 'value');
    assert.ok(assigned, 'set-variable node keeps its value output');
    assert.deepStrictEqual(assigned.schema, { userCount: 'number' });
    console.log('  ✅ PASS: config.key shapes only Set Variable schemas, and stores a type rather than the value');
  }

  // 7. A block after an orchestrator can read the orchestrator's job nodes
  console.log('\n--- 6. Orchestrator Result Reaches Downstream Blocks ---');
  {
    const graph = {
      id: 'orch-graph',
      nodes: [
        { id: 'job', type: 'script', data: { name: 'job', definitionType: 'script' } },
        { id: 'orch', type: 'orchestrator', data: { name: 'orch', definitionType: 'orchestrator' } },
        { id: 'after', type: 'script', data: { name: 'after', definitionType: 'script' } },
        { id: 'stranger', type: 'script', data: { name: 'stranger', definitionType: 'script' } },
      ],
      edges: [{ source: 'orch', target: 'after', sourceHandle: 'done' }],
    };

    const vars = await enrichmentService.computeUpstreamVariables(
      graph,
      'after',
      () => new Set(['job']),
    );
    const names = new Set(vars.variables.map((variable) => variable.nodeName));
    assert.ok(names.has('job'));
    assert.ok(names.has('orch'));
    assert.strictEqual(names.has('stranger'), false);
    console.log('  ✅ PASS: done/result socket exposes orchestrator job nodes, and unrelated nodes stay hidden');
  }

  console.log('\n--- 7. Foreach Gates and Orchestrator Jobs ---');
  {
    const foreachNodes = [
      { id: 'each', type: 'foreach', data: { definitionType: 'foreach', config: { mode: 'canvas' } } },
      { id: 'safe', type: 'script', data: { definitionType: 'script' } },
      { id: 'gate', type: 'human-gate', data: { definitionType: 'human-gate' } },
    ];

    await assert.rejects(
      () =>
        validationService.validateNestedWaitingGates(foreachNodes, [
          { source: 'each', sourceHandle: 'item', target: 'safe' },
          { source: 'each', sourceHandle: 'item', target: 'gate' },
        ]),
      (err: any) => {
        assert.strictEqual(err.getResponse().code, 'NESTED_WAITING_GATE_UNSUPPORTED');
        return true;
      },
    );

    await validationService.validateNestedWaitingGates(foreachNodes, [
      { source: 'each', sourceHandle: 'result', target: 'gate' },
    ]);

    const jobs = validationService.getOrchestratedJobNodeIds('orch', [], [
      { source: 'orch', target: 'job_a', sourceHandle: 'agent_1' },
      { source: 'job_a', target: 'job_b' },
      { source: 'job_b', target: 'after' },
      { source: 'orch', target: 'after', sourceHandle: 'done' },
    ]);
    assert.deepStrictEqual([...jobs].sort(), ['job_a', 'job_b']);
    console.log('  ✅ PASS: Every foreach item branch rejects a gate, and orchestrator jobs stop at done');
  }

  console.log('\n=============================================');
  console.log('📊 ALL GRAPHS SERVICE PRODUCTION TESTS PASSED');
  console.log('=============================================\n');
}

run().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
