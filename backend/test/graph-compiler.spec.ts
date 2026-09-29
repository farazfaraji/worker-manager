import { GraphCompilerService } from '../src/runs/compiler/graph-compiler.service';
import { MongoCheckpointSaver } from '../src/runs/compiler/mongo-checkpoint-saver';
import { VariableResolverService } from '../src/runs/services/variable-resolver.service';
import { RunTopologyService } from '../src/runs/services/run-topology.service';
import {
  ToolPluginRegistry,
  TriggerPlugin,
  RoutePlugin,
  WebserverPlugin,
  HttpResponsePlugin,
  IncrementVariablePlugin,
  DecrementVariablePlugin,
  SetVariablePlugin,
  AgentPlugin,
  RepoInspectPlugin,
  ResearchReviewPlugin,
  ScriptPlugin,
  TransformPlugin,
  ConditionPlugin,
  ValidatorPlugin,
  BrowserPlugin,
  WebSearchPlugin,
  JsonParserPlugin,
  OutputPlugin,
  SubgraphPlugin,
  ArtifactPlugin,
  HumanGatePlugin,
  ActionPlugin,
  MemoryPlugin,
  RetrievalPlugin,
  EmbeddingPlugin,
  RouterPlugin,
  TelegramPlugin,
  OrchestratorPlugin,
  LoopPlugin,
  ForeachPlugin,
  AggregatePlugin,
  ExecutionPlugin,
  NotificationPlugin,
} from '../src/runs/plugins';
import { GraphRunnerService } from '../src/runs/graph-runner.service';
import { NodeExecutorService } from '../src/runs/services/node-executor.service';

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING LANGGRAPH COMPILER TEST SUITE');
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

  const variableResolver = new VariableResolverService();
  const runTopologyService = new RunTopologyService();

  const registry = new ToolPluginRegistry(
    new TriggerPlugin(),
    new RoutePlugin(),
    new WebserverPlugin(),
    new HttpResponsePlugin(variableResolver),
    new IncrementVariablePlugin(variableResolver),
    new DecrementVariablePlugin(variableResolver),
    new SetVariablePlugin(variableResolver),
    new AgentPlugin({} as any),
    new RepoInspectPlugin(),
    new ResearchReviewPlugin(variableResolver),
    new ScriptPlugin(),
    new TransformPlugin(),
    new ConditionPlugin(variableResolver),
    new ValidatorPlugin(),
    new BrowserPlugin({} as any),
    new WebSearchPlugin(),
    new JsonParserPlugin(variableResolver),
    new OutputPlugin(variableResolver),
    new SubgraphPlugin(),
    new ArtifactPlugin(),
    new HumanGatePlugin(),
    new ActionPlugin(),
    new MemoryPlugin(),
    new RetrievalPlugin(),
    new EmbeddingPlugin(),
    new RouterPlugin(),
    new TelegramPlugin(),
    new OrchestratorPlugin(),
    new LoopPlugin(),
    new ForeachPlugin(),
    new AggregatePlugin(),
    new ExecutionPlugin(),
    new NotificationPlugin(),
  );

  const checkpointer = new MongoCheckpointSaver();
  const compiler = new GraphCompilerService(
    registry,
    variableResolver,
    checkpointer,
    runTopologyService,
  );

  // --------------------------------------------------------------------------
  // Test 1: Sequential Flow (trigger -> set-variable -> script -> output)
  // --------------------------------------------------------------------------
  console.log('--- Test 1: Sequential Flow Execution ---');

  const nodes1 = [
    {
      id: 'node_trigger',
      type: 'trigger',
      data: { name: 'start', definitionType: 'trigger', config: {} },
    },
    {
      id: 'node_set',
      type: 'set-variable',
      data: {
        name: 'set_msg',
        definitionType: 'set-variable',
        config: { key: 'greeting', value: 'Hello from LangGraph' },
      },
    },
    {
      id: 'node_script',
      type: 'script',
      data: {
        name: 'uppercase',
        definitionType: 'script',
        config: {
          code: 'return { message: String(context.greeting || "").toUpperCase() };',
        },
      },
    },
    {
      id: 'node_out',
      type: 'output',
      data: {
        name: 'final_output',
        definitionType: 'output',
        config: { value: '{{uppercase.message}}' },
      },
    },
  ];

  const edges1 = [
    { source: 'node_trigger', target: 'node_set' },
    { source: 'node_set', target: 'node_script' },
    { source: 'node_script', target: 'node_out' },
  ];

  const compiled1 = compiler.compile(nodes1, edges1);
  assert(!!compiled1, 'Compiler produces valid CompiledStateGraph for sequential flow');

  const result1 = await compiler.execute(compiled1, {
    runId: 'run-seq-1',
    initialInput: { user: 'Antigravity' },
  });

  assert(result1.context.greeting === 'Hello from LangGraph', 'Context contains set-variable value');
  assert(result1.context.uppercase?.message === 'HELLO FROM LANGGRAPH', 'Script executed with context access');
  assert(result1.context.final_output?.value === 'HELLO FROM LANGGRAPH', 'Output node resolved interpolated variable');
  assert(result1.lastOutput?.value === 'HELLO FROM LANGGRAPH', 'lastOutput accurately tracks the final node');

  // Checkpointing verification
  const savedTuple = await checkpointer.getTuple({ configurable: { thread_id: 'run-seq-1' } });
  assert(!!savedTuple, 'MongoCheckpointSaver successfully recorded checkpoint for run-seq-1');
  assert((savedTuple?.checkpoint?.channel_values as any)?.context?.greeting === 'Hello from LangGraph', 'Checkpoint state preserves variable context');

  // --------------------------------------------------------------------------
  // Test 2: Conditional Branching Flow (trigger -> condition -> branchTrue / branchFalse)
  // --------------------------------------------------------------------------
  console.log('\n--- Test 2: Conditional Branching Flow ---');

  const nodes2 = [
    {
      id: 'n_trigger',
      type: 'trigger',
      data: { name: 'trig', definitionType: 'trigger', config: {} },
    },
    {
      id: 'n_cond',
      type: 'condition',
      data: {
        name: 'is_vip',
        definitionType: 'condition',
        config: {
          leftValue: '{{trig.vip}}',
          rightValue: 'true',
          operator: 'equals',
        },
      },
    },
    {
      id: 'n_vip',
      type: 'set-variable',
      data: {
        name: 'vip_action',
        definitionType: 'set-variable',
        config: { key: 'status', value: 'VIP_CUSTOMER' },
      },
    },
    {
      id: 'n_standard',
      type: 'set-variable',
      data: {
        name: 'standard_action',
        definitionType: 'set-variable',
        config: { key: 'status', value: 'STANDARD_CUSTOMER' },
      },
    },
  ];

  const edges2 = [
    { source: 'n_trigger', target: 'n_cond' },
    { source: 'n_cond', target: 'n_vip', sourceHandle: 'true' },
    { source: 'n_cond', target: 'n_standard', sourceHandle: 'false' },
  ];

  const compiled2 = compiler.compile(nodes2, edges2);

  // Run with VIP = true
  const vipResult = await compiler.execute(compiled2, {
    runId: 'run-cond-vip',
    initialInput: { vip: 'true' },
  });

  assert(vipResult.context.status === 'VIP_CUSTOMER', 'Condition routed to true branch (VIP_CUSTOMER)');
  assert(!vipResult.context.standard_action, 'False branch was skipped');

  // Run with VIP = false
  const standardResult = await compiler.execute(compiled2, {
    runId: 'run-cond-std',
    initialInput: { vip: 'false' },
  });

  assert(standardResult.context.status === 'STANDARD_CUSTOMER', 'Condition routed to false branch (STANDARD_CUSTOMER)');
  assert(!standardResult.context.vip_action, 'True branch was skipped');

  // --------------------------------------------------------------------------
  // Test 3: Parallel Fan-Out (trigger -> nodeA & nodeB -> joinNode)
  // --------------------------------------------------------------------------
  console.log('\n--- Test 3: Parallel Fan-Out Execution ---');

  const nodes3 = [
    {
      id: 't_root',
      type: 'trigger',
      data: { name: 't', definitionType: 'trigger', config: {} },
    },
    {
      id: 'branch_a',
      type: 'set-variable',
      data: {
        name: 'ba',
        definitionType: 'set-variable',
        config: { key: 'branchA', value: 'doneA' },
      },
    },
    {
      id: 'branch_b',
      type: 'set-variable',
      data: {
        name: 'bb',
        definitionType: 'set-variable',
        config: { key: 'branchB', value: 'doneB' },
      },
    },
    {
      id: 'join_node',
      type: 'script',
      data: {
        name: 'join',
        definitionType: 'script',
        config: {
          code: 'return { combined: context.branchA + "_" + context.branchB };',
        },
      },
    },
  ];

  const edges3 = [
    { source: 't_root', target: 'branch_a' },
    { source: 't_root', target: 'branch_b' },
    { source: 'branch_a', target: 'join_node' },
    { source: 'branch_b', target: 'join_node' },
  ];

  const compiled3 = compiler.compile(nodes3, edges3);
  const result3 = await compiler.execute(compiled3, {
    runId: 'run-fanout-1',
    initialInput: {},
  });

  assert(result3.context.branchA === 'doneA', 'Parallel Branch A executed');
  assert(result3.context.branchB === 'doneB', 'Parallel Branch B executed');
  assert(result3.context.join?.combined === 'doneA_doneB', 'Fan-in join node received data from both parallel branches');

  // --------------------------------------------------------------------------
  // Test 4: Human Gate with LangGraph interrupt() & resume()
  // --------------------------------------------------------------------------
  console.log('\n--- Test 4: Human Gate Pause & Resume Execution ---');

  const nodes4 = [
    {
      id: 'g_trigger',
      type: 'trigger',
      data: { name: 'g_trig', definitionType: 'trigger', config: {} },
    },
    {
      id: 'g_gate',
      type: 'human-gate',
      data: {
        name: 'approval_gate',
        definitionType: 'human-gate',
        config: {
          question: 'Do you approve this deployment?',
          options: ['Approve', 'Reject'],
        },
      },
    },
    {
      id: 'g_approved',
      type: 'set-variable',
      data: {
        name: 'on_approved',
        definitionType: 'set-variable',
        config: { key: 'deployStatus', value: 'DEPLOYED' },
      },
    },
    {
      id: 'g_rejected',
      type: 'set-variable',
      data: {
        name: 'on_rejected',
        definitionType: 'set-variable',
        config: { key: 'deployStatus', value: 'CANCELLED' },
      },
    },
  ];

  const edges4 = [
    { source: 'g_trigger', target: 'g_gate' },
    { source: 'g_gate', target: 'g_approved', sourceHandle: 'approved' },
    { source: 'g_gate', target: 'g_rejected', sourceHandle: 'rejected' },
  ];

  const gateCheckpointer = new MongoCheckpointSaver();
  const compiled4 = compiler.compile(nodes4, edges4, { checkpointer: gateCheckpointer });
  const runId4 = 'run-human-gate-1';

  // 1. Initial invoke should pause at gate
  await compiler.execute(compiled4, {
    runId: runId4,
    initialInput: { env: 'production' },
  });

  const isWaiting = await compiler.isWaiting(compiled4, runId4);
  assert(isWaiting, 'Graph execution paused at human-gate node');

  const interruptPayload = await compiler.getInterruptPayload(compiled4, runId4);
  assert(interruptPayload?.question === 'Do you approve this deployment?', 'Interrupt payload contains gate question and options');

  // 2. Resume with decision approved = true
  const resumedRun = await compiler.resume(compiled4, runId4, {
    approved: true,
    feedback: 'Approved by Release Manager',
  });

  assert(resumedRun.context.deployStatus === 'DEPLOYED', 'Graph resumed and successfully followed approved branch');
  assert(!resumedRun.context.on_rejected, 'Rejected branch was skipped');

  // --------------------------------------------------------------------------
  // Test 5: Agent with LangGraph ReAct Agent Loop
  // --------------------------------------------------------------------------
  console.log('\n--- Test 5: Agent Plugin with LangGraph ReAct ---');

  const nodes5 = [
    {
      id: 'a_trigger',
      type: 'trigger',
      data: { name: 'agent_trig', definitionType: 'trigger', config: {} },
    },
    {
      id: 'a_agent',
      type: 'agent',
      data: {
        name: 'react_agent',
        definitionType: 'agent',
        config: {
          useLangGraphAgent: true,
          prompt: 'What is the sum of 5 and 7?',
          tools: [],
        },
      },
    },
    {
      id: 'a_output',
      type: 'output',
      data: {
        name: 'agent_out',
        definitionType: 'output',
        config: { value: '{{react_agent.result}}' },
      },
    },
  ];

  const edges5 = [
    { source: 'a_trigger', target: 'a_agent' },
    { source: 'a_agent', target: 'a_output' },
  ];

  const compiled5 = compiler.compile(nodes5, edges5);
  const result5 = await compiler.execute(compiled5, {
    runId: 'run-agent-react-1',
    initialInput: {},
  });

  assert(!!result5.context.react_agent?.result, 'ReAct Agent executed via LangGraph and produced result');
  assert(result5.context.agent_out?.value === result5.context.react_agent?.result, 'Downstream output node received ReAct agent result');

  // --------------------------------------------------------------------------
  // Test 6: GraphRunnerService Integration with LangGraph Engine
  // --------------------------------------------------------------------------
  console.log('\n--- Test 6: GraphRunnerService Integration (useLangGraph: true) ---');

  const mockRuns = new Map<string, any>();
  const mockCheckpoints = new Map<string, any>();

  const runModelMock: any = {
    create: async (data: any) => {
      const doc = {
        ...data,
        _id: 'run-doc-' + data.runId,
        save: async function () {
          mockRuns.set(this.runId, this);
          return this;
        },
        toObject: function () {
          return { ...this };
        },
      };
      mockRuns.set(data.runId, doc);
      return doc;
    },
    findOne: (filter: any) => ({
      exec: async () => {
        const runId = filter.runId;
        return mockRuns.get(runId) || null;
      },
    }),
    findOneAndUpdate: async (filter: any, update: any) => {
      const doc = mockRuns.get(filter.runId);
      if (!doc) return null;
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$unset) {
        for (const k of Object.keys(update.$unset)) delete doc[k];
      }
      return doc;
    },
    updateOne: (filter: any, update: any) => ({
      exec: async () => {
        const doc = mockRuns.get(filter.runId);
        if (doc && update.$set) Object.assign(doc, update.$set);
        if (doc && update.$unset) {
          for (const k of Object.keys(update.$unset)) delete doc[k];
        }
        return { modifiedCount: doc ? 1 : 0 };
      },
    }),
    deleteOne: async (filter: any) => {
      const deleted = mockRuns.delete(filter.runId);
      return { deletedCount: deleted ? 1 : 0 };
    },
    find: () => ({
      sort: () => ({
        limit: () => ({
          exec: async () => Array.from(mockRuns.values()),
        }),
      }),
    }),
  };

  const checkpointModelMock: any = {
    create: async (data: any) => {
      const doc = {
        ...data,
        _id: 'chk-' + (data.checkpointId || Date.now()),
        save: async function () {
          mockCheckpoints.set(data.runId, this);
          return this;
        },
        toObject: function () {
          return { ...this };
        },
      };
      mockCheckpoints.set(data.runId, doc);
      return doc;
    },
    findOne: (filter: any) => ({
      sort: () => ({
        exec: async () => mockCheckpoints.get(filter.runId) || null,
      }),
      exec: async () => mockCheckpoints.get(filter.runId) || null,
    }),
    findOneAndUpdate: (filter: any, update: any) => ({
      exec: async () => {
        const doc = mockCheckpoints.get(filter.runId) || {};
        if (update.$set) Object.assign(doc, update.$set);
        mockCheckpoints.set(filter.runId, doc);
        return doc;
      },
    }),
    find: (filter: any) => ({
      sort: () => ({
        exec: async () => {
          const doc = mockCheckpoints.get(filter.runId);
          return doc ? [doc] : [];
        },
      }),
    }),
    deleteMany: (filter: any) => ({
      exec: async () => {
        mockCheckpoints.delete(filter.runId);
        return { deletedCount: 1 };
      },
    }),
  };

  const mockGraphs = new Map<string, any>();
  const graphsServiceMock: any = {
    findOne: async (id: string) => mockGraphs.get(id) || null,
    validateGraphVariables: async () => {},
  };

  const nodeExecutor = new NodeExecutorService(registry);
  const browserRunnerMock: any = {
    closeRuntimeApps: async () => {},
  };

  const graphRunner = new GraphRunnerService(
    graphsServiceMock,
    runModelMock,
    checkpointModelMock,
    variableResolver,
    nodeExecutor,
    browserRunnerMock,
    undefined,
    undefined,
    runTopologyService,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    compiler,
  );

  const testGraphId = '507f1f77bcf86cd799439011';
  mockGraphs.set(testGraphId, {
    _id: testGraphId,
    name: 'LangGraph Test Flow',
    nodes: [
      {
        id: 'start_node',
        type: 'trigger',
        data: { name: 'start', definitionType: 'trigger', config: {} },
      },
      {
        id: 'set_node',
        type: 'set-variable',
        data: {
          name: 'setter',
          definitionType: 'set-variable',
          config: { key: 'statusMsg', value: 'Hello from GraphRunner LangGraph' },
        },
      },
      {
        id: 'out_node',
        type: 'output',
        data: {
          name: 'out',
          definitionType: 'output',
          config: { value: '{{setter.statusMsg}}' },
        },
      },
    ],
    edges: [
      { source: 'start_node', target: 'set_node' },
      { source: 'set_node', target: 'out_node' },
    ],
  });

  const runResult = await graphRunner.runGraph(
    testGraphId,
    { initial: 'data' },
    { useLangGraph: true },
  );

  assert(runResult.status === 'completed', 'GraphRunner executed flow via LangGraph to completion');
  assert(runResult.metadata?.engine === 'langgraph', 'Run metadata confirms engine is langgraph');
  assert(runResult.nodes?.length >= 3, 'Run contains NodeRunRecords for all executed nodes');
  assert(runResult.output?.value === 'Hello from GraphRunner LangGraph', 'Run output correctly resolved via LangGraph');

  // --------------------------------------------------------------------------
  // Test 7: GraphRunnerService Human-Gate Pause & Resume via LangGraph
  // --------------------------------------------------------------------------
  console.log('\n--- Test 7: GraphRunnerService Human-Gate Pause & Resume ---');

  const gateGraphId = '507f1f77bcf86cd799439022';
  mockGraphs.set(gateGraphId, {
    _id: gateGraphId,
    name: 'LangGraph Human Gate Flow',
    nodes: [
      {
        id: 'hg_trigger',
        type: 'trigger',
        data: { name: 'trig', definitionType: 'trigger', config: {} },
      },
      {
        id: 'hg_gate',
        type: 'human-gate',
        data: {
          name: 'gate',
          definitionType: 'human-gate',
          config: { question: 'Approve production deployment?' },
        },
      },
      {
        id: 'hg_approved',
        type: 'set-variable',
        data: {
          name: 'appr',
          definitionType: 'set-variable',
          config: { key: 'deployResult', value: 'DEPLOY_SUCCESS' },
        },
      },
    ],
    edges: [
      { source: 'hg_trigger', target: 'hg_gate' },
      { source: 'hg_gate', target: 'hg_approved', sourceHandle: 'approved' },
    ],
  });

  const gateRun = await graphRunner.runGraph(
    gateGraphId,
    { env: 'prod' },
    { useLangGraph: true },
  );

  assert(gateRun.status === 'waiting', 'GraphRunner paused run at human-gate node');
  assert(gateRun.waitingNodeId === 'hg_gate', 'waitingNodeId is set to human-gate node ID');
  assert(!!gateRun.resumeToken, 'Public run response includes resumeToken');

  const resumedGateRun = await graphRunner.resumeRun(gateRun.runId, {
    token: gateRun.resumeToken,
    decision: { approved: true, feedback: 'Approved by Ops' },
  });

  assert(resumedGateRun.status === 'completed', 'Resumed run finished with status completed');
  assert(resumedGateRun.nodes?.some((n: any) => n.nodeId === 'hg_approved'), 'Resumed run executed downstream approved branch');

  console.log('\n=============================================');
  console.log(`📊 RESULTS: ${passed} passed, ${failed} failed`);
  console.log('=============================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner failure:', err);
  process.exit(1);
});
