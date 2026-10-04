import { LogPlugin } from '../src/runs/plugins/log.plugin';
import { VariableResolverService } from '../src/runs/services/variable-resolver.service';
import { redactSecrets } from '../src/runs/services/redaction.util';

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING LOG PLUGIN TESTS');
  console.log('=============================================\n');

  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  const plugin = new LogPlugin(new VariableResolverService());
  const context: Record<string, any> = {
    projectId: 'p1',
    runId: 'run-1',
    agent_1: { result: { score: 0.4, token: 'super-secret-token' } },
    state: { count: 2 },
  };

  const logged = await plugin.run({
    node: { data: { config: { operation: 'log', level: 'info', message: 'hello', data: { token: 'super-secret-token' } } } },
    nodeInput: { operation: 'log', level: 'info', message: 'hello', data: { token: 'super-secret-token' } },
    context,
    initialInput: {},
    runId: 'run-1',
  });
  assert(logged.status === 'completed' && logged.result.message === 'hello', 'log returns the message');
  assert(logged.result.data.token === '[REDACTED]', 'log redacts sensitive keys');

  const inspected = await plugin.run({
    node: { data: { config: { operation: 'inspect', paths: ['agent_1.result', 'state.count'] } } },
    nodeInput: { operation: 'inspect', paths: ['agent_1.result', 'state.count'] },
    context,
    initialInput: {},
    runId: 'run-1',
  });
  assert(inspected.result.data['state.count'] === 2, 'inspect reads a context path');
  assert(inspected.result.data['agent_1.result'].token === '[REDACTED]', 'inspect redacts nested secrets');

  let threw = false;
  try {
    await plugin.run({
      node: {
        data: {
          config: {
            operation: 'assert',
            mode: 'comparison',
            leftValue: 1,
            operator: 'greaterThan',
            rightValue: 5,
            onFail: 'fail',
            message: 'too small',
          },
        },
      },
      nodeInput: { operation: 'assert', mode: 'comparison', leftValue: 1, operator: 'greaterThan', rightValue: 5, onFail: 'fail', message: 'too small' },
      context,
      initialInput: {},
      runId: 'run-1',
    });
  } catch (err: any) {
    threw = err.code === 'ASSERTION_FAILED';
  }
  assert(threw, 'assert with onFail=fail throws ASSERTION_FAILED');

  const routed = await plugin.run({
    node: {
      data: {
        config: {
          operation: 'assert',
          mode: 'expression',
          expression: 'return context.agent_1.result.score >= 0.8;',
          onFail: 'route',
        },
      },
    },
    nodeInput: { operation: 'assert', mode: 'expression', expression: 'return context.agent_1.result.score >= 0.8;', onFail: 'route' },
    context,
    initialInput: {},
    runId: 'run-1',
  });
  assert(routed.conditionMet === false, 'assert with onFail=route sets conditionMet false');

  const metric = await plugin.run({
    node: { data: { config: { operation: 'metric', name: 'items', value: 3, tags: { source: 'web' } } } },
    nodeInput: { operation: 'metric', name: 'items', value: 3, tags: { source: 'web' } },
    context,
    initialInput: {},
    runId: 'run-1',
  });
  assert(context.__customMetrics?.[0]?.name === 'items' && context.__customMetrics[0].value === 3, 'metric appends to context.__customMetrics');
  assert(metric.result.data.name === 'items', 'metric result echoes the entry');

  await plugin.run({
    node: { data: { config: { operation: 'timer', phase: 'start', label: 'fetch' } } },
    nodeInput: { operation: 'timer', phase: 'start', label: 'fetch' },
    context,
    initialInput: {},
    runId: 'run-1',
  });
  const stopped = await plugin.run({
    node: { data: { config: { operation: 'timer', phase: 'stop', label: 'fetch' } } },
    nodeInput: { operation: 'timer', phase: 'stop', label: 'fetch' },
    context,
    initialInput: {},
    runId: 'run-1',
  });
  assert(typeof stopped.result.elapsedMs === 'number' && stopped.result.elapsedMs >= 0, 'timer stop returns elapsedMs');
  assert(redactSecrets('token stays') === 'token stays', 'unrelated strings are unchanged');

  console.log(`\n=============================================`);
  console.log(`📊 RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`=============================================\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
