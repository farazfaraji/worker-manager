import * as assert from 'node:assert/strict';
import { RouterPlugin } from '../src/runs/plugins/router.plugin';
import { ForeachPlugin } from '../src/runs/plugins/foreach.plugin';
import { OrchestratorPlugin } from '../src/runs/plugins/orchestrator.plugin';
import { SetVariablePlugin } from '../src/runs/plugins/set-variable.plugin';
import { ArtifactPlugin } from '../src/runs/plugins/artifact.plugin';
import { BrowserPlugin } from '../src/runs/plugins/browser.plugin';
import { HumanGatePlugin } from '../src/runs/plugins/human-gate.plugin';
import { TelegramPlugin } from '../src/runs/plugins/telegram.plugin';
import { ToolPluginRegistry } from '../src/runs/plugins/tool-plugin.registry';
import { GraphEnrichmentService } from '../src/graphs/services/graph-enrichment.service';
import { NodeDefinitionsService } from '../src/node-definitions/node-definitions.service';
import { GraphValidationService } from '../src/graphs/services/graph-validation.service';
import { BadRequestException } from '@nestjs/common';

async function run() {
  console.log('=============================================');
  console.log('🧪 RUNNING NODE SERVICE & PLUGIN INTEGRATION TESTS');
  console.log('=============================================\n');

  // --- 1. RouterPlugin.synthesizeOutputs ---
  console.log('--- 1. RouterPlugin Dynamic Output Synthesis ---');
  const routerPlugin = new RouterPlugin();
  {
    const outputs = routerPlugin.synthesizeOutputs({
      defType: 'router',
      data: {},
      config: {
        routes: JSON.stringify([{ name: 'billing' }, { name: 'support' }]),
        defaultRoute: 'fallback',
      },
    });
    assert.strictEqual(outputs.length, 3);
    assert.strictEqual(outputs[0].name, 'billing');
    assert.strictEqual(outputs[1].name, 'support');
    assert.strictEqual(outputs[2].name, 'fallback');
    console.log('  ✅ PASS: RouterPlugin dynamically synthesizes route branches');
  }

  // --- 2. ForeachPlugin.synthesizeOutputs ---
  console.log('\n--- 2. ForeachPlugin Output Synthesis ---');
  const foreachPlugin = new ForeachPlugin();
  {
    const canvasOutputs = foreachPlugin.synthesizeOutputs({
      defType: 'foreach',
      data: {},
      config: { mode: 'canvas' },
    });
    assert.deepStrictEqual(canvasOutputs.map((o) => o.name), ['item', 'done', 'result']);

    const subgraphOutputs = foreachPlugin.synthesizeOutputs({
      defType: 'foreach',
      data: {},
      config: { mode: 'subgraph' },
    });
    assert.deepStrictEqual(subgraphOutputs.map((o) => o.name), ['result']);
    console.log('  ✅ PASS: ForeachPlugin generates correct sockets based on canvas vs subgraph mode');
  }

  // --- 3. OrchestratorPlugin.synthesizeOutputs ---
  console.log('\n--- 3. OrchestratorPlugin Dynamic Output Synthesis ---');
  const orchPlugin = new OrchestratorPlugin();
  {
    const outputs = orchPlugin.synthesizeOutputs({
      defType: 'orchestrator',
      data: {},
      config: {
        agentOutputs: [{ name: 'researcher' }, { name: 'writer' }],
      },
    });
    assert.deepStrictEqual(outputs.map((o) => o.name), ['researcher', 'writer', 'result']);
    console.log('  ✅ PASS: OrchestratorPlugin synthesizes custom agent handles plus result handle');
  }

  // --- 4. SetVariablePlugin.synthesizeOutputs & getUpstreamVariables ---
  console.log('\n--- 4. SetVariablePlugin Upstream Variables & Outputs ---');
  const varResolverMock: any = {
    resolveTemplate: (val: any) => val,
    resolveValue: (val: any) => val,
  };
  const setVarPlugin = new SetVariablePlugin(varResolverMock);
  {
    const outputs = setVarPlugin.synthesizeOutputs({
      defType: 'set-variable',
      data: {},
      config: {},
    });
    assert.deepStrictEqual(outputs.map((o) => o.name), ['value']);

    const upstream = setVarPlugin.getUpstreamVariables('node_1', 'my_var', {
      key: 'userCount',
      valueType: 'number',
    }, outputs);
    assert.strictEqual(upstream.length, 2);
    assert.strictEqual(upstream[0].path, 'my_var.userCount');
    assert.strictEqual(upstream[0].type, 'number');
    assert.strictEqual(upstream[1].path, 'state.userCount');
    assert.strictEqual(upstream[1].type, 'number');
    console.log('  ✅ PASS: SetVariablePlugin exports qualified node and state variable paths');
  }

  // --- 5. Waiting Gate Detection in Node Plugins ---
  console.log('\n--- 5. Waiting Gate Detection in HumanGate & Telegram Plugins ---');
  const humanGatePlugin = new HumanGatePlugin();
  const telegramPlugin = new TelegramPlugin();
  {
    assert.strictEqual(humanGatePlugin.isWaitingGate(), true);
    assert.strictEqual(telegramPlugin.isWaitingGate({ mode: 'question' }), true);
    assert.strictEqual(telegramPlugin.isWaitingGate({ mode: 'message' }), false);
    console.log('  ✅ PASS: HumanGatePlugin and TelegramPlugin accurately identify waiting gate suspension');
  }

  // --- 6. End-to-End Enrichment Service Delegation via Plugin Registry ---
  console.log('\n--- 6. End-to-End Enrichment Service Delegation ---');
  const registryMock: any = {
    get: (type: string) => {
      const normalized = type.toLowerCase();
      if (normalized === 'router') return routerPlugin;
      if (normalized === 'foreach') return foreachPlugin;
      if (normalized === 'orchestrator') return orchPlugin;
      if (normalized === 'set-variable' || normalized === 'variable') return setVarPlugin;
      if (normalized === 'human-gate' || normalized === 'humangate') return humanGatePlugin;
      if (normalized === 'telegram') return telegramPlugin;
      return undefined;
    },
  };

  const defService = new NodeDefinitionsService();
  const enrichmentService = new GraphEnrichmentService(defService, registryMock);

  {
    const enriched = await enrichmentService.enrichNodesWithOutputs([
      {
        id: 'r1',
        type: 'router',
        data: {
          definitionType: 'router',
          name: 'my_router',
          config: { routes: [{ name: 'branch_a' }, { name: 'branch_b' }] },
        },
      },
      {
        id: 'f1',
        type: 'foreach',
        data: {
          definitionType: 'foreach',
          name: 'my_loop',
          config: { mode: 'canvas' },
        },
      },
    ]);

    assert.strictEqual(enriched.length, 2);
    const r1Outputs = enriched[0].data.outputs.map((o) => o.name);
    assert.deepStrictEqual(r1Outputs, ['branch_a', 'branch_b', 'default']);

    const f1Outputs = enriched[1].data.outputs.map((o) => o.name);
    assert.deepStrictEqual(f1Outputs, ['item', 'done', 'result']);
    console.log('  ✅ PASS: GraphEnrichmentService successfully delegates output synthesis to individual plugins');
  }

  // --- 7. ArtifactPlugin prefers resolved nodeInput over raw config ---
  console.log('\n--- 7. ArtifactPlugin resolved nodeInput precedence ---');
  {
    let capturedTitle = '';
    const plugin = new ArtifactPlugin({
      create: async (payload: any) => {
        capturedTitle = payload.title;
        return {
          artifactId: 'art_1',
          logicalId: payload.logicalId,
          title: payload.title,
          content: payload.content,
          version: 1,
          isLatest: true,
        };
      },
    } as any);
    await plugin.run({
      node: {
        id: 'save_1',
        data: {
          config: {
            operation: 'create',
            title: { mode: 'literal', value: 'Screenshot: {{each_png.item.path}}' },
          },
        },
      },
      nodeInput: {
        operation: 'create',
        title: 'Screenshot: 1.png',
        logicalId: 'screenshot-1.png',
        content: 'analysis',
      },
      context: {},
      initialInput: { projectId: 'proj-1' },
      runId: 'run-1',
    });
    assert.strictEqual(capturedTitle, 'Screenshot: 1.png');
    console.log('  ✅ PASS: ArtifactPlugin uses resolved nodeInput instead of raw valueOrVariable config');
  }

  // --- 8. Validation Service Waiting Gate Checking ---
  console.log('\n--- 8. GraphValidationService assertNoWaitingGatesInChildGraph ---');
  const fakeModel: any = {
    findById: (id: string) => ({
      lean: () => ({
        exec: async () => ({
          _id: id,
          flow: {
            blocks: [
              {
                id: 'gate_1',
                kind: 'telegram',
                config: { mode: 'question' },
              },
            ],
          },
        }),
      }),
    }),
  };
  const validationService = new GraphValidationService(fakeModel, enrichmentService, registryMock);

  {
    let caught = false;
    const testGraphId = '507f1f77bcf86cd799439011';
    try {
      await validationService.assertNoWaitingGatesInChildGraph(testGraphId);
    } catch (err: any) {
      caught = true;
      assert.ok(err instanceof BadRequestException);
      assert.strictEqual((err.getResponse() as any).code, 'NESTED_WAITING_GATE_UNSUPPORTED');
    }
    assert.strictEqual(caught, true, 'Must reject child graph containing Telegram question gate');
    console.log('  ✅ PASS: Nested waiting gates in child flows caught via plugin.isWaitingGate()');
  }

  console.log('\n=============================================');
  console.log('📊 ALL NODE SERVICE & PLUGIN INTEGRATION TESTS PASSED');
  console.log('=============================================\n');
}

run().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
