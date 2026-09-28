import { VariableResolverService } from '../src/runs/services/variable-resolver.service';
import { NodeExecutorService } from '../src/runs/services/node-executor.service';

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING SET VARIABLE TESTS');
  console.log('=============================================\n');

  const variableResolver = new VariableResolverService();
  const nodeExecutor = new NodeExecutorService(
    variableResolver,
    {} as any,
    {} as any,
    {} as any,
  );

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

  const context: Record<string, any> = {
    node: { id: 'abc-123' },
    state: {},
  };

  // 1. String with template interpolation: test_{{node.id}}
  const strNode = {
    id: 'n1',
    data: {
      definitionType: 'set-variable',
      config: {
        key: 'prefix_id',
        valueType: 'string',
        stringValue: 'test_{{node.id}}',
      },
    },
  };
  const strRes = await nodeExecutor.executeNode(strNode, {}, context, undefined, 'run-1');
  assert(strRes.prefix_id === 'test_abc-123', 'String value interpolates test_{{node.id}}');
  assert(context.state.prefix_id === 'test_abc-123', 'Variable saved to context.state.prefix_id');
  assert(context.prefix_id === 'test_abc-123', 'Variable saved to context.prefix_id directly');

  // 2. Number variable
  const numNode = {
    id: 'n2',
    data: {
      definitionType: 'set-variable',
      config: {
        key: 'counter',
        valueType: 'number',
        numberValue: 10,
      },
    },
  };
  const numRes = await nodeExecutor.executeNode(numNode, {}, context, undefined, 'run-1');
  assert(numRes.counter === 10 && typeof numRes.counter === 'number', 'Number value stored as numeric type');
  assert(context.state.counter === 10, 'Numeric counter saved to context.state');

  // 3. Increment variable on set-variable counter
  const incNode = {
    id: 'n3',
    data: {
      definitionType: 'increment-variable',
      definitionId: 'increment',
      config: {
        variable: 'counter',
        amount: 5,
      },
    },
  };
  const incRes = await nodeExecutor.executeNode(incNode, {}, context, undefined, 'run-1');
  assert(incRes.value === 15, 'Increment variable resolves and adds 5');
  assert(context.state.counter === 15, 'Increment variable mutates context.state.counter to 15');
  assert(context.counter === 15, 'Increment variable mutates context.counter to 15');

  // 4. Overwrite existing variable
  const overwriteNode = {
    id: 'n4',
    data: {
      definitionType: 'set-variable',
      config: {
        key: 'counter',
        valueType: 'number',
        numberValue: 99,
      },
    },
  };
  await nodeExecutor.executeNode(overwriteNode, {}, context, undefined, 'run-1');
  assert(context.state.counter === 99, 'Overwrites existing variable in state');

  // 5. JSON variable with nested templates
  const jsonNode = {
    id: 'n5',
    data: {
      definitionType: 'set-variable',
      config: {
        key: 'payload',
        valueType: 'json',
        jsonValue: JSON.stringify({
          session_id: 'test_{{node.id}}',
          total: 50,
        }),
      },
    },
  };
  const jsonRes = await nodeExecutor.executeNode(jsonNode, {}, context, undefined, 'run-1');
  assert(typeof jsonRes.payload === 'object', 'JSON value parsed into an object');
  assert(jsonRes.payload.session_id === 'test_abc-123', 'JSON value contains interpolated template');
  assert(context.state.payload.session_id === 'test_abc-123', 'JSON saved into context.state.payload');

  // 6. Merge JSON operation
  const mergeNode = {
    id: 'n6',
    data: {
      definitionType: 'set-variable',
      config: {
        key: 'payload',
        operation: 'merge',
        valueType: 'json',
        jsonValue: JSON.stringify({
          status: 'success',
        }),
      },
    },
  };
  const mergeRes = await nodeExecutor.executeNode(mergeNode, {}, context, undefined, 'run-1');
  assert(mergeRes.payload.session_id === 'test_abc-123', 'Merge preserves existing session_id');
  assert(mergeRes.payload.status === 'success', 'Merge adds new status property');

  // 7. Append to Array operation
  const appendNode1 = {
    id: 'n7',
    data: {
      definitionType: 'set-variable',
      config: {
        key: 'items',
        operation: 'append',
        valueType: 'string',
        stringValue: 'first',
      },
    },
  };
  const appendNode2 = {
    id: 'n8',
    data: {
      definitionType: 'set-variable',
      config: {
        key: 'items',
        operation: 'append',
        valueType: 'string',
        stringValue: 'second',
      },
    },
  };
  await nodeExecutor.executeNode(appendNode1, {}, context, undefined, 'run-1');
  await nodeExecutor.executeNode(appendNode2, {}, context, undefined, 'run-1');
  assert(Array.isArray(context.state.items) && context.state.items.length === 2, 'Append creates and adds to array');
  assert(context.state.items[0] === 'first' && context.state.items[1] === 'second', 'Append items in order');

  // 8. Delete variable operation
  const deleteNode = {
    id: 'n9',
    data: {
      definitionType: 'set-variable',
      config: {
        key: 'items',
        operation: 'delete',
      },
    },
  };
  await nodeExecutor.executeNode(deleteNode, {}, context, undefined, 'run-1');
  assert(context.state.items === undefined && context.items === undefined, 'Delete removes variable from state');

  console.log(`\n=============================================`);
  console.log(`📊 RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`=============================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
