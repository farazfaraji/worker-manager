import * as assert from 'node:assert/strict';
import { FlowAssistantService } from '../src/models/services/flow-assistant.service';
import { NodeDefinitionsService } from '../src/node-definitions/node-definitions.service';
import { FlowAssistantChatDto } from '../src/models/dto/flow-assistant.dto';

const context = {
  modelId: 'test-model',
  provider: 'openai',
  endpoint: 'https://api.openai.com/v1',
  apiKey: 'test-key',
  label: 'Test Model',
};

const outline = {
  title: 'Notify on trigger',
  trigger: 'Manual',
  steps: [
    { id: 'trigger_1', kind: 'trigger', summary: 'Start' },
    { id: 'telegram_1', kind: 'telegram', summary: 'Notify' },
  ],
  outputs: ['Notify'],
  assumptions: [],
};

async function run() {
  console.log('=============================================');
  console.log('🧪 RUNNING FLOW ASSISTANT PROMPT & MUSTACHE TEST');
  console.log('=============================================\n');

  let nextText = '';
  let capturedSystemInstruction = '';
  let capturedMessages: any[] = [];

  const mockLlmClient: any = {
    executeChatCompletion: async (params: any) => {
      capturedSystemInstruction = params.systemInstruction;
      capturedMessages = params.messages;
      return { text: nextText };
    },
  };

  const defService = new NodeDefinitionsService();
  const service = new FlowAssistantService(mockLlmClient, defService);

  const execute = async (dto: Partial<FlowAssistantChatDto>, text: string) => {
    nextText = text;
    capturedSystemInstruction = '';
    capturedMessages = [];
    return service.execute(dto as FlowAssistantChatDto, context);
  };

  const userContent = () => capturedMessages[capturedMessages.length - 1].content as string;

  const buildPayload = {
    reply: 'Created a new telegram notification flow.',
    flowChanges: ['Added trigger and telegram nodes'],
    graph: {
      blocks: [
        { id: 'trigger_1', kind: 'trigger', name: 'Start', config: {} },
        { id: 'telegram_1', kind: 'telegram', name: 'Notify', config: { message: 'Hello' } },
      ],
      connections: [{ id: 'c1', from: 'trigger_1', to: 'telegram_1', output: 'done', input: 'in' }],
    },
  };

  // 1. Prompt rendering + unconfirmed build on an empty canvas becomes an outline
  const rendered = await execute(
    {
      message: 'Create a flow that sends a telegram notification on trigger',
      currentGraph: { blocks: [], connections: [] },
      history: [],
    },
    JSON.stringify(buildPayload),
  );

  assert.ok(capturedSystemInstruction.includes('AVAILABLE BLOCK KINDS & CAPABILITIES:'));
  assert.ok(capturedSystemInstruction.includes('"kind": "trigger"'));
  assert.ok(capturedSystemInstruction.includes('{{blockId.property}}'), 'Mustache example variables must be preserved verbatim');
  assert.ok(capturedSystemInstruction.includes('{{search_1.results}}'), 'Mustache example variables must be preserved verbatim');
  assert.ok(capturedSystemInstruction.includes('{{...}}'), 'Condition example must be preserved verbatim');
  assert.strictEqual(capturedMessages.length, 1);
  assert.ok(userContent().includes('Current Flow Graph State:'));
  assert.ok(userContent().includes('"blocks": []'));
  assert.ok(userContent().includes('Create a flow that sends a telegram notification on trigger'));
  assert.strictEqual(rendered.mode, 'confirm');
  assert.strictEqual(rendered.outline?.steps.length, 2);
  assert.equal(rendered.graph, undefined);
  console.log('  ✅ PASS: Prompts render, and an unconfirmed build becomes an outline');

  // 2. Vague clarify response is capped at 3 questions
  const clarify = await execute(
    { message: 'Notify me about news', currentGraph: { blocks: [], connections: [] } },
    JSON.stringify({
      mode: 'clarify',
      reply: 'A few choices change the flow.',
      questions: [1, 2, 3, 4, 5].map((n) => ({
        id: `q${n}`,
        question: `Question ${n}?`,
        options: [{ id: 'a', label: 'A' }],
        allowFreeText: true,
      })),
    }),
  );
  assert.strictEqual(clarify.mode, 'clarify');
  assert.strictEqual(clarify.questions?.length, 3);
  assert.strictEqual(clarify.questions?.[0].id, 'q1');
  console.log('  ✅ PASS: Clarify questions are capped at 3');

  // 3. Answers are rendered, and a confirm response stays confirm
  const confirmedWait = await execute(
    {
      message: 'Here are my answers.',
      answers: { trigger: 'On a schedule' },
      currentGraph: { blocks: [], connections: [] },
    },
    JSON.stringify({ mode: 'confirm', reply: 'Outline ready.', outline }),
  );
  assert.ok(userContent().includes('Clarified requirements'));
  assert.ok(userContent().includes('On a schedule'));
  assert.strictEqual(confirmedWait.mode, 'confirm');
  assert.strictEqual(confirmedWait.outline?.title, 'Notify on trigger');
  console.log('  ✅ PASS: Answers are sent to the model and confirm is preserved');

  // 4. Confirmed outline is allowed to build
  const built = await execute(
    {
      message: 'Build it.',
      confirmed: true,
      confirmedOutline: outline,
      currentGraph: { blocks: [], connections: [] },
    },
    JSON.stringify({ mode: 'build', ...buildPayload }),
  );
  assert.ok(userContent().includes('Return mode "build" now'));
  assert.ok(userContent().includes('Confirmed outline'));
  assert.strictEqual(built.mode, 'build');
  assert.strictEqual(built.graph?.blocks.length, 2);
  assert.strictEqual(built.graph?.connections.length, 1);
  console.log('  ✅ PASS: A confirmed outline returns a graph');

  // 5. Unconfirmed build against an existing graph becomes an edit diff
  const edited = await execute(
    {
      message: 'Add telegram',
      currentGraph: {
        blocks: [{ id: 'trigger_1', kind: 'trigger', name: 'Start', config: {} }],
        connections: [],
      },
    },
    JSON.stringify(buildPayload),
  );
  assert.strictEqual(edited.mode, 'edit');
  assert.ok(edited.operations?.some((op) => op.op === 'addBlock' && op.block.id === 'telegram_1'));
  assert.ok(edited.operations?.some((op) => op.op === 'addConnection'));
  assert.ok(!edited.operations?.some((op) => op.op === 'removeBlock'));
  console.log('  ✅ PASS: An unconfirmed build on an existing graph becomes an edit');

  // 6. Invalid edit operations are dropped and reported
  const invalid = await execute(
    {
      message: 'Change it',
      currentGraph: {
        blocks: [{ id: 'search_1', kind: 'web-search', name: 'Search', config: {} }],
        connections: [],
      },
    },
    JSON.stringify({
      mode: 'edit',
      reply: 'Updating the flow.',
      operations: [
        { op: 'updateBlock', blockId: 'missing', name: 'Nope' },
        { op: 'addBlock', block: { id: 'bad_1', kind: 'not-a-kind', name: 'Bad' } },
        {
          op: 'addConnection',
          from: 'search_1',
          to: 'search_1',
          output: 'nope',
        },
        {
          op: 'addBlock',
          block: { id: 'notify_1', kind: 'telegram', name: 'Notify', config: { message: 'Hi' } },
          after: 'search_1',
        },
      ],
    }),
  );
  assert.strictEqual(invalid.mode, 'edit');
  assert.strictEqual(invalid.operations?.length, 1);
  assert.strictEqual(invalid.operations?.[0].op, 'addBlock');
  const notes = (invalid.flowChanges || []).join(' ');
  assert.ok(notes.includes('missing'));
  assert.ok(notes.includes('not-a-kind'));
  assert.ok(notes.includes('nope'));
  console.log('  ✅ PASS: Invalid edit operations are dropped and reported');

  // 7. Unknown references and [[id]] tokens are stripped
  const answered = await execute(
    {
      message: 'Where is the web search?',
      currentGraph: {
        blocks: [{ id: 'search_1', kind: 'web-search', name: 'Web Search', config: {} }],
        connections: [],
      },
    },
    JSON.stringify({
      mode: 'answer',
      reply: 'Look at [[missing]] and [[search_1]].',
      references: [
        { blockId: 'missing', role: 'primary' },
        { blockId: 'search_1', role: 'related' },
      ],
    }),
  );
  assert.strictEqual(answered.mode, 'answer');
  assert.ok(!answered.reply.includes('[[missing]]'));
  assert.ok(!answered.reply.includes('missing'));
  assert.ok(answered.reply.includes('[[search_1]]'));
  assert.deepStrictEqual(answered.references, [{ blockId: 'search_1', role: 'primary' }]);
  console.log('  ✅ PASS: Unknown block references are stripped and the remaining one becomes primary');

  // 8. Skip and the two-round limit inject the no-questions directive
  await execute(
    {
      message: 'Skip the questions and use sensible defaults.',
      skipClarification: true,
      currentGraph: { blocks: [], connections: [] },
    },
    JSON.stringify({ mode: 'confirm', reply: 'Outline.', outline }),
  );
  assert.ok(userContent().includes('Do not ask more questions.'));

  await execute(
    {
      message: 'Still unclear',
      currentGraph: { blocks: [], connections: [] },
      history: [
        { role: 'assistant', content: 'First questions', mode: 'clarify' },
        { role: 'user', content: 'Morning' },
        { role: 'assistant', content: 'Second questions', mode: 'clarify' },
      ],
    },
    JSON.stringify({ mode: 'confirm', reply: 'Outline.', outline }),
  );
  assert.ok(userContent().includes('Do not ask more questions.'));
  console.log('  ✅ PASS: Skip and the two-round limit stop further questions');

  // 9. Malformed JSON falls back to answer
  const broken = await execute(
    { message: 'Hello', currentGraph: { blocks: [], connections: [] } },
    'Sorry, I could not reply with JSON.',
  );
  assert.strictEqual(broken.mode, 'answer');
  assert.ok(broken.reply.includes('could not reply with JSON'));
  console.log('  ✅ PASS: Malformed JSON falls back to an answer');

  // 10. A question that echoes the current graph stays an answer
  const explained = await execute(
    {
      message: 'what is this flow for',
      currentGraph: {
        blocks: [
          { id: 'trigger_1', kind: 'trigger', name: 'Start', config: { triggerType: 'manual' } },
          { id: 'agent_1', kind: 'agent', name: 'Writer', config: { prompt: 'Write' } },
        ],
        connections: [{ from: 'trigger_1', to: 'agent_1', output: 'done', input: 'in' }],
      },
    },
    JSON.stringify({
      reply: 'This flow writes a document from a manual trigger.',
      flowChanges: [],
      graph: {
        blocks: [
          { id: 'trigger_1', kind: 'trigger', name: 'Start', config: { triggerType: 'manual' } },
          { id: 'agent_1', kind: 'agent', name: 'Writer', config: { prompt: 'Write something else' } },
        ],
        connections: [{ from: 'trigger_1', to: 'agent_1', output: 'done', input: 'in' }],
      },
    }),
  );
  assert.strictEqual(explained.mode, 'answer');
  assert.strictEqual(explained.reply, 'This flow writes a document from a manual trigger.');
  assert.equal(explained.graph, undefined);
  assert.equal(explained.operations, undefined);
  console.log('  ✅ PASS: An echoed graph on a question stays an answer');

  // 11. A truncated JSON dump still surfaces the reply text
  const truncated = await execute(
    {
      message: 'what is this flow for',
      currentGraph: {
        blocks: [{ id: 'trigger_1', kind: 'trigger', name: 'Start', config: {} }],
        connections: [],
      },
    },
    '{"reply":"This flow turns a request into a PRD.\\nIt saves the result.","flowChanges":[],"graph":{"blocks":[{"id":"final_brief","label"',
  );
  assert.strictEqual(truncated.mode, 'answer');
  assert.strictEqual(truncated.reply, 'This flow turns a request into a PRD.\nIt saves the result.');
  assert.ok(!truncated.reply.includes('flowChanges'));
  assert.ok(!truncated.reply.includes('final_brief'));
  console.log('  ✅ PASS: A truncated JSON response keeps the reply and drops the graph');

  // 12. Selected blocks are included in the prompt
  await execute(
    {
      message: 'What does this do?',
      focusBlockIds: ['search_1', 'missing'],
      currentGraph: {
        blocks: [{ id: 'search_1', kind: 'web-search', name: 'Web Search', config: {} }],
        connections: [],
      },
    },
    JSON.stringify({ mode: 'answer', reply: 'It searches the web.', references: [] }),
  );
  assert.ok(userContent().includes('Selected blocks on the canvas'));
  assert.ok(userContent().includes('search_1'));
  assert.ok(!userContent().includes('missing'));
  console.log('  ✅ PASS: Selected canvas blocks are included in the prompt');

  console.log('\n=============================================');
  console.log('📊 ALL FLOW ASSISTANT TESTS PASSED');
  console.log('=============================================\n');
}

run().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
