import * as assert from 'node:assert/strict';
import { applyFlowOperations, previewFlowOperations } from '../../frontend/src/lib/flow-operations';

function run() {
  console.log('=============================================');
  console.log('🧪 RUNNING FLOW OPERATION APPLY TEST');
  console.log('=============================================\n');

  const nodes = [
    {
      id: 'trigger_1',
      type: 'langgraphNode',
      position: { x: 100, y: 40 },
      data: {
        name: 'Start',
        label: 'Start',
        definitionType: 'trigger',
        config: { triggerType: 'manual' },
        outputs: [{ name: 'input', label: 'Input', type: 'object' }],
      },
    },
  ];
  const edges: any[] = [];
  const definitions = [
    {
      id: 'telegram',
      name: 'Telegram',
      type: 'telegram',
      outputs: [{ name: 'result', label: 'Result', type: 'object' }],
      inputs: [{ name: 'message', label: 'Message', type: 'textarea' }],
    },
    {
      id: 'condition',
      name: 'Condition',
      type: 'condition',
      outputs: [
        { name: 'true', label: 'True', type: 'branch' },
        { name: 'false', label: 'False', type: 'branch' },
      ],
    },
  ];

  const preview = previewFlowOperations(nodes, edges, [
    {
      op: 'addBlock',
      after: 'trigger_1',
      block: { id: 'notify_1', kind: 'telegram', name: 'Notify', config: { message: 'Hi' } },
    },
    { op: 'updateBlock', blockId: 'trigger_1', name: 'Kickoff' },
    { op: 'addConnection', from: 'trigger_1', to: 'notify_1', output: 'done' },
  ], definitions);

  assert.strictEqual(nodes[0].data.name, 'Start', 'preview must not mutate the original node');
  assert.strictEqual(preview.nodes.length, 2);
  const ghost = preview.nodes.find((node) => node.id === 'notify_1');
  assert.equal((ghost?.data as any).assistantGhost, true);
  assert.equal((ghost?.data as any).assistantDiff, 'added');
  assert.equal(ghost?.data.definitionType, 'telegram');
  assert.equal(ghost?.data.outputs[0].name, 'result');
  assert.ok(ghost && ghost.position.y > nodes[0].position.y);
  assert.equal((preview.nodes[0].data as any).assistantDiff, 'changed');
  assert.equal(preview.nodes[0].data.name, 'Start', 'preview does not apply the rename yet');
  assert.equal(preview.edges[0].data.assistantPreview, true);
  console.log('  ✅ PASS: Preview marks ghosts and leaves the original graph alone');

  const applied = applyFlowOperations(nodes, edges, [
    {
      op: 'addBlock',
      after: 'trigger_1',
      block: { id: 'notify_1', kind: 'telegram', name: 'Notify', config: { message: 'Hi' } },
    },
    { op: 'updateBlock', blockId: 'trigger_1', configPatch: { question: 'Go?' } },
    { op: 'addConnection', from: 'trigger_1', to: 'notify_1', output: 'done', input: 'in' },
    {
      op: 'addBlock',
      after: 'notify_1',
      block: { id: 'check_1', kind: 'condition', name: 'Check', config: {} },
    },
    { op: 'removeBlock', blockId: 'missing' },
  ], definitions);

  assert.strictEqual(applied.nodes.length, 3);
  const start = applied.nodes.find((node) => node.id === 'trigger_1');
  assert.equal(start?.data.config.triggerType, 'manual');
  assert.equal((start?.data.config as any).question, 'Go?');
  assert.equal(start?.position.x, 100, 'existing position is kept');
  const notify = applied.nodes.find((node) => node.id === 'notify_1');
  assert.equal(notify?.data.outputs[0].name, 'result');
  const check = applied.nodes.find((node) => node.id === 'check_1');
  assert.deepStrictEqual(check?.data.outputs.map((output: any) => output.name), ['true', 'false']);
  assert.strictEqual(applied.edges.length, 1);
  assert.equal(applied.edges[0].source, 'trigger_1');
  assert.equal(applied.edges[0].target, 'notify_1');
  assert.equal(applied.edges[0].sourceHandle, 'done');
  console.log('  ✅ PASS: Apply keeps positions, merges config, and uses definition outputs');

  const removed = applyFlowOperations(applied.nodes, applied.edges, [
    { op: 'removeConnection', from: 'trigger_1', to: 'notify_1', output: 'done' },
    { op: 'removeBlock', blockId: 'notify_1' },
  ], definitions);
  assert.ok(!removed.nodes.some((node) => node.id === 'notify_1'));
  assert.strictEqual(removed.edges.length, 0);
  console.log('  ✅ PASS: Remove drops the block and its connections');

  console.log('\n=============================================');
  console.log('📊 ALL FLOW OPERATION TESTS PASSED');
  console.log('=============================================\n');
}

run();
