import * as fs from 'fs';
import * as path from 'path';
import { BlockRuntimeService } from '../src/blocks/block-runtime.service';
import { RunTopologyService } from '../src/runs/services/run-topology.service';

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING ORCHESTRATOR 5-OUTPUT FANOUT TESTS');
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

  // 1. Tool JSON Definition checks
  const toolJsonPath = path.resolve(__dirname, '../src/tools/orchestrator.json');
  const toolDef = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8'));

  assert(toolDef.name === 'Orchestrator', 'orchestrator.json has name "Orchestrator"');
  assert(toolDef.type === 'orchestrator', 'orchestrator.json has type "orchestrator"');

  const agentOutputsInput = toolDef.inputs.find((i: any) => i.name === 'agentOutputs');
  assert(Boolean(agentOutputsInput), 'orchestrator.json declares "agentOutputs" input');
  assert(Array.isArray(toolDef.outputs) && toolDef.outputs.length === 5, 'orchestrator.json has exactly 5 default outputs');

  const outputNames = toolDef.outputs.map((o: any) => o.name);
  assert(
    outputNames.includes('agent_1') &&
    outputNames.includes('agent_2') &&
    outputNames.includes('agent_3') &&
    outputNames.includes('agent_4') &&
    outputNames.includes('done'),
    'Default outputs contain agent_1, agent_2, agent_3, agent_4, and done'
  );

  // 2. Block Runtime Execution in Visual Fan-Out Mode
  const blockRuntime = new BlockRuntimeService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const defaultExecution = await blockRuntime.execute('orchestrator', {
    config: {
      goal: 'Conduct 4-way PR review',
      strategy: 'parallel',
    },
  });

  assert(defaultExecution.status === 'completed', 'Default orchestrator execution status is "completed"');
  assert(defaultExecution.goal === 'Conduct 4-way PR review', 'Goal is preserved in output');
  assert(Boolean(defaultExecution.agent_1 && defaultExecution.agent_1.agentId === 'agent_1'), 'agent_1 output is populated with task payload');
  assert(Boolean(defaultExecution.agent_2 && defaultExecution.agent_2.agentId === 'agent_2'), 'agent_2 output is populated with task payload');
  assert(Boolean(defaultExecution.agent_3 && defaultExecution.agent_3.agentId === 'agent_3'), 'agent_3 output is populated with task payload');
  assert(Boolean(defaultExecution.agent_4 && defaultExecution.agent_4.agentId === 'agent_4'), 'agent_4 output is populated with task payload');
  assert(Boolean(defaultExecution.result && defaultExecution.result.agentCount === 4), 'result output contains composite summary with agentCount: 4');

  // 3. Custom Agent Outputs
  const customExecution = await blockRuntime.execute('orchestrator', {
    config: {
      goal: 'Audit security and performance',
      agentOutputs: [
        { name: 'sec_agent', label: 'Security Auditor', role: 'security' },
        { name: 'perf_agent', label: 'Performance Engineer', role: 'performance' },
      ],
    },
  });

  assert(Boolean(customExecution.sec_agent && customExecution.sec_agent.role === 'security'), 'Custom output sec_agent is populated');
  assert(Boolean(customExecution.perf_agent && customExecution.perf_agent.role === 'performance'), 'Custom output perf_agent is populated');
  assert(Boolean(customExecution.result && customExecution.result.agentCount === 2), 'Custom output result reports agentCount: 2');

  // 4. Graph Topology: Orchestrator -> Agent -> WebSearch -> Proceed
  const topologyService = new RunTopologyService();

  const nodes: any[] = [
    { id: 'orch_1', data: { definitionType: 'orchestrator', name: 'orch' } },
    { id: 'agent_1', data: { definitionType: 'agent', name: 'researcher' } },
    { id: 'websearch_1', data: { definitionType: 'web-search', name: 'search' } },
    { id: 'agent_2', data: { definitionType: 'agent', name: 'architect' } },
    { id: 'aggregate_1', data: { definitionType: 'aggregate', name: 'final_join' } },
  ];

  const edges: any[] = [
    // Branch 1: orch -> agent_1 -> websearch_1 -> aggregate_1
    { source: 'orch_1', sourceHandle: 'agent_1', target: 'agent_1' },
    { source: 'agent_1', sourceHandle: 'flow', target: 'websearch_1' },
    { source: 'websearch_1', sourceHandle: 'flow', target: 'aggregate_1' },
    // Branch 2: orch -> agent_2 -> aggregate_1
    { source: 'orch_1', sourceHandle: 'agent_2', target: 'agent_2' },
    { source: 'agent_2', sourceHandle: 'flow', target: 'aggregate_1' },
  ];

  // When orch_1 completes, readyNodes schedules agent_1 and agent_2 concurrently
  const completedNodes = new Set<string>(['orch_1']);
  const readyAfterOrch = topologyService.readyNodes(
    nodes,
    edges,
    ['orch_1'],
    completedNodes,
    { orch_1: defaultExecution },
    new Set(),
  );

  assert(
    readyAfterOrch.includes('agent_1') && readyAfterOrch.includes('agent_2'),
    'Both agent_1 and agent_2 are scheduled in parallel after Orchestrator'
  );

  // When agent_1 completes, websearch_1 is scheduled next
  completedNodes.add('agent_1');
  const readyAfterAgent1 = topologyService.readyNodes(
    nodes,
    edges,
    ['orch_1'],
    completedNodes,
    { orch_1: defaultExecution, agent_1: { text: 'find query' } },
    new Set(),
  );

  assert(
    readyAfterAgent1.includes('websearch_1'),
    'WebSearch job is scheduled after agent_1 in the sub-pipeline'
  );
  assert(
    !readyAfterAgent1.includes('aggregate_1'),
    'Aggregate join node does NOT run early while branches are still executing'
  );

  // When all parallel branches complete (websearch_1 and agent_2 finish), aggregate_1 is scheduled!
  completedNodes.add('websearch_1');
  completedNodes.add('agent_2');
  const readyAfterAllBranches = topologyService.readyNodes(
    nodes,
    edges,
    ['orch_1'],
    completedNodes,
    {
      orch_1: defaultExecution,
      agent_1: { text: 'find query' },
      websearch_1: { results: ['milvus benchmark'] },
      agent_2: { architectureScore: 9 },
    },
    new Set(),
  );

  assert(
    readyAfterAllBranches.includes('aggregate_1'),
    'Aggregate join node executes and proceeds cleanly after all branch jobs (including websearch) finish'
  );

  // 5. Test Dedicated 'done' Output Handle Wiring
  // Graph:
  //   orch_node -> [agent_1] -> a1 -> ws1
  //   orch_node -> [agent_2] -> a2
  //   orch_node -> [done]    -> finalize_node
  const doneNodes: any[] = [
    { id: 'orch_2', data: { definitionType: 'orchestrator', name: 'orch_main' } },
    { id: 'a1', data: { definitionType: 'agent', name: 'agent_one' } },
    { id: 'ws1', data: { definitionType: 'web-search', name: 'search_one' } },
    { id: 'a2', data: { definitionType: 'agent', name: 'agent_two' } },
    { id: 'finalize_node', data: { definitionType: 'notify', name: 'final_notification' } },
  ];

  const doneEdges: any[] = [
    { source: 'orch_2', sourceHandle: 'agent_1', target: 'a1' },
    { source: 'a1', sourceHandle: 'flow', target: 'ws1' },
    { source: 'orch_2', sourceHandle: 'agent_2', target: 'a2' },
    // Notice: finalize_node is ONLY connected to the orchestrator's 'done' output!
    { source: 'orch_2', sourceHandle: 'done', target: 'finalize_node' },
  ];

  // Immediately after orchestrator finishes, jobs are still pending: finalize_node must NOT run
  const orch2Completed = new Set<string>(['orch_2']);
  const readyAfterOrch2 = topologyService.readyNodes(
    doneNodes,
    doneEdges,
    ['orch_2'],
    orch2Completed,
    { orch_2: defaultExecution },
    new Set(),
  );

  assert(
    readyAfterOrch2.includes('a1') && readyAfterOrch2.includes('a2'),
    'Parallel branches a1 and a2 are triggered immediately'
  );
  assert(
    !readyAfterOrch2.includes('finalize_node'),
    'Dedicated "done" target (finalize_node) is NOT called while jobs are pending'
  );

  // When a1 completes, ws1 runs. finalize_node must still NOT run
  orch2Completed.add('a1');
  const readyAfterA1 = topologyService.readyNodes(
    doneNodes,
    doneEdges,
    ['orch_2'],
    orch2Completed,
    { orch_2: defaultExecution, a1: { text: 'query' } },
    new Set(),
  );
  assert(
    readyAfterA1.includes('ws1'),
    'Sub-pipeline ws1 is triggered after a1'
  );
  assert(
    !readyAfterA1.includes('finalize_node'),
    'Dedicated "done" target (finalize_node) is STILL not called while ws1 and a2 are unfinished'
  );

  // When a2 completes but ws1 is still running: finalize_node must still NOT run
  orch2Completed.add('a2');
  const readyAfterA2 = topologyService.readyNodes(
    doneNodes,
    doneEdges,
    ['orch_2'],
    orch2Completed,
    { orch_2: defaultExecution, a1: { text: 'query' }, a2: { summary: 'ok' } },
    new Set(),
  );
  assert(
    !readyAfterA2.includes('finalize_node'),
    'Dedicated "done" target (finalize_node) waits for ws1 to finish'
  );

  // When ws1 also completes: all jobs are finished! finalize_node MUST be called!
  orch2Completed.add('ws1');
  const readyAfterAllJobsDone = topologyService.readyNodes(
    doneNodes,
    doneEdges,
    ['orch_2'],
    orch2Completed,
    {
      orch_2: defaultExecution,
      a1: { text: 'query' },
      ws1: { results: ['done'] },
      a2: { summary: 'ok' },
    },
    new Set(),
  );
  assert(
    readyAfterAllJobsDone.includes('finalize_node'),
    'Dedicated "done" target (finalize_node) IS CALLED when all delegated jobs finish!'
  );

  console.log('\n=============================================');
  console.log(`📊 RESULTS: ${passed} passed, ${failed} failed`);
  console.log('=============================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
