import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { JiraCliService } from '../src/runs/services/jira-cli.service';
import { RunTopologyService } from '../src/runs/services/run-topology.service';

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING JIRA TOOL SUITE');
  console.log('=============================================\n');

  let passed = 0;
  let failed = 0;
  const test = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ❌ ${name}\n     ${err.message}`);
    }
  };

  const service = new JiraCliService();

  await test('definition JSON lists every supported action', () => {
    const def = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/tools/jira.json'), 'utf8'));
    const actionInput = def.inputs.find((i: any) => i.name === 'action');
    assert.deepStrictEqual(actionInput.options.map((o: any) => o.value).sort(), [
      'custom', 'epic-list', 'issue-assign', 'issue-comment', 'issue-create', 'issue-edit',
      'issue-link', 'issue-list', 'issue-move', 'issue-view', 'me', 'sprint-list',
    ]);
    assert.deepStrictEqual(def.outputs.map((o: any) => o.name), ['done', 'onFailed']);
  });

  await test('issue list: filters, capped pagination, raw output, project', () => {
    assert.deepStrictEqual(
      service.buildArgs('issue-list', { query: 'timeout', status: 'To Do, In Progress', labels: ['a', 'b'], limit: 500, project: 'PAY' }),
      ['issue', 'list', 'timeout', '--status', 'To Do', '--status', 'In Progress', '--label', 'a', '--label', 'b', '--paginate', '0:100', '--raw', '--project', 'PAY'],
    );
  });

  await test('issue create: non-interactive and validates required fields', () => {
    assert.deepStrictEqual(
      service.buildArgs('issue-create', { issueType: 'Bug', summary: 'Broken', body: 'Details' }),
      ['issue', 'create', '--no-input', '--raw', '--type', 'Bug', '--summary', 'Broken', '--body', 'Details'],
    );
    assert.throws(() => service.buildArgs('issue-create', { issueType: 'Bug' }), /summary/);
  });

  await test('move / comment / link use positional arguments', () => {
    assert.deepStrictEqual(service.buildArgs('issue-move', { issueKey: 'PAY-1', state: 'Done', comment: 'shipped' }), ['issue', 'move', 'PAY-1', 'Done', '--comment', 'shipped']);
    assert.deepStrictEqual(service.buildArgs('issue-comment', { issueKey: 'PAY-1', body: 'hi' }), ['issue', 'comment', 'add', 'PAY-1', 'hi', '--no-input']);
    assert.deepStrictEqual(service.buildArgs('issue-link', { inwardKey: 'PAY-1', outwardKey: 'PAY-2', linkType: 'Blocks' }), ['issue', 'link', 'PAY-1', 'PAY-2', 'Blocks']);
  });

  await test('sprint scopes and extra args', () => {
    assert.deepStrictEqual(
      service.buildArgs('sprint-list', { sprintScope: 'current', limit: 10, extraArgs: '["--order-by","rank"]' }),
      ['sprint', 'list', '--current', '--paginate', '0:10', '--raw', '--order-by', 'rank'],
    );
    assert.deepStrictEqual(service.buildArgs('sprint-list', { sprintScope: 'sprints', sprintState: 'active' }), ['sprint', 'list', '--table', '--plain', '--state', 'active']);
  });

  await test('custom args pass through and strip leading "jira"', () => {
    assert.deepStrictEqual(service.buildArgs('custom', { args: '["jira","issue","list","--plain"]' }), ['issue', 'list', '--plain']);
    assert.throws(() => service.buildArgs('custom', { args: '{}' }), /JSON array/);
  });

  await test('missing binary returns a failed result instead of throwing', async () => {
    process.env.JIRA_CLI_PATH = '/nonexistent/jira';
    const out = await service.run({ action: 'me' });
    delete process.env.JIRA_CLI_PATH;
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.status, 'failed');
    assert.match(out.error, /not found/);
  });

  await test('topology routes done vs onFailed', () => {
    const topology = new (RunTopologyService as any)();
    const node = { id: 'j', data: { definitionType: 'jira' } };
    const edges = [{ source: 'j', target: 'ok', sourceHandle: 'done' }, { source: 'j', target: 'bad', sourceHandle: 'onFailed' }];
    assert.deepStrictEqual(topology.resolveNextTargets(node, { ok: true }, edges), ['ok']);
    assert.deepStrictEqual(topology.resolveNextTargets(node, { ok: false }, edges), ['bad']);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
