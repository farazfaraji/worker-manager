import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import {
  AgentToolRegistryService,
  AgentToolDefinition,
} from '../src/runs/services/agent-tool-registry.service';
import { AgentRunnerService } from '../src/runs/services/agent-runner.service';
import { redactSecrets } from '../src/runs/services/redaction.util';
import { VariableResolverService } from '../src/runs/services/variable-resolver.service';
import { NodeDefinitionsService } from '../src/node-definitions/node-definitions.service';
import { BlockRuntimeService } from '../src/blocks/block-runtime.service';

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING AGENT AUTONOMOUS TOOL USE SUITE');
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

  // Preserve global fetch
  const originalFetch = globalThis.fetch;

  // =========================================================================
  // 1. Definition Test (agent.json)
  // =========================================================================
  await test('agent.json tool definition includes enableTools, allowedTools, maxSteps, and toolCalls output', async () => {
    const service = new NodeDefinitionsService();
    const defs = await service.getAllDefinitions();
    const agentDef = defs.find((d) => d.id === 'agent');
    assert.ok(agentDef, 'agent definition must exist');

    const inputNames = agentDef.inputs.map((i) => i.name);
    assert.ok(inputNames.includes('enableTools'), 'Must have enableTools input');
    assert.ok(inputNames.includes('allowedTools'), 'Must have allowedTools input');
    assert.ok(inputNames.includes('maxSteps'), 'Must have maxSteps input');

    const enableToolsInput: any = agentDef.inputs.find((i) => i.name === 'enableTools')!;
    assert.strictEqual(enableToolsInput.type, 'checkbox');
    assert.strictEqual(enableToolsInput.defaultValue, false);

    const allowedToolsInput = agentDef.inputs.find((i) => i.name === 'allowedTools')!;
    assert.strictEqual(allowedToolsInput.type, 'valueOrVariable');
    assert.strictEqual((allowedToolsInput as any).multiselect, true);
    const toolOptionValues = (allowedToolsInput.options || []).map((o: any) => o.value);
    assert.ok(toolOptionValues.includes('search_web'), 'Must include search_web option');
    assert.ok(toolOptionValues.includes('read_url'), 'Must include read_url option');

    const maxStepsInput: any = agentDef.inputs.find((i) => i.name === 'maxSteps')!;
    assert.strictEqual(maxStepsInput.type, 'number');
    assert.strictEqual(maxStepsInput.defaultValue, 5);

    const outputNames = agentDef.outputs.map((o) => o.name);
    assert.ok(outputNames.includes('result'), 'Must have result output');
    assert.ok(outputNames.includes('text'), 'Must have text output');
    assert.ok(outputNames.includes('toolCalls'), 'Must have toolCalls output');
  });

  // =========================================================================
  // 2. AgentToolRegistryService: Built-in Registration & Schemas
  // =========================================================================
  await test('AgentToolRegistryService initializes with search_web and read_url tools', () => {
    const registry = new AgentToolRegistryService();
    const names = registry.getRegisteredToolNames();
    assert.ok(names.includes('search_web'), 'search_web must be registered');
    assert.ok(names.includes('read_url'), 'read_url must be registered');
    assert.strictEqual(registry.hasTool('search_web'), true);
    assert.strictEqual(registry.hasTool('read_url'), true);
    assert.strictEqual(registry.hasTool('nonexistent_tool'), false);
  });

  await test('AgentToolRegistryService generates valid OpenAI and Anthropic schemas', () => {
    const registry = new AgentToolRegistryService();

    // OpenAI format
    const openAiSchemas = registry.getOpenAiToolSchemas(['search_web', 'read_url']);
    assert.strictEqual(openAiSchemas.length, 2);
    assert.strictEqual(openAiSchemas[0].type, 'function');
    assert.strictEqual(openAiSchemas[0].function.name, 'search_web');
    assert.ok(openAiSchemas[0].function.description);
    assert.ok(openAiSchemas[0].function.parameters.properties.query);
    assert.strictEqual(openAiSchemas[1].function.name, 'read_url');
    assert.ok(openAiSchemas[1].function.parameters.properties.url);

    // Anthropic format
    const anthropicSchemas = registry.getAnthropicToolSchemas(['search_web', 'read_url']);
    assert.strictEqual(anthropicSchemas.length, 2);
    assert.strictEqual(anthropicSchemas[0].name, 'search_web');
    assert.ok(anthropicSchemas[0].description);
    assert.strictEqual(anthropicSchemas[0].input_schema.type, 'object');
    assert.ok(anthropicSchemas[0].input_schema.properties.query);
    assert.strictEqual(anthropicSchemas[1].name, 'read_url');
    assert.ok(anthropicSchemas[1].input_schema.properties.url);
  });

  // =========================================================================
  // 3. Tool Authorization (Allowlist)
  // =========================================================================
  await test('AgentToolRegistryService validates allowlist authorization', () => {
    const registry = new AgentToolRegistryService();

    // Allowed tool
    const resAllowed = registry.validateToolCall('search_web', { query: 'test' }, ['search_web']);
    assert.strictEqual(resAllowed.isValid, true);

    // Tool not in allowlist
    const resForbidden = registry.validateToolCall('read_url', { url: 'https://example.com' }, ['search_web']);
    assert.strictEqual(resForbidden.isValid, false);
    assert.ok(resForbidden.error?.includes('allowed tools list'));

    // Unknown tool entirely
    const resUnknown = registry.validateToolCall('run_code', { code: 'exit(0)' }, ['run_code']);
    assert.strictEqual(resUnknown.isValid, false);
    assert.ok(resUnknown.error?.includes('not a recognized tool'));
  });

  // =========================================================================
  // 4. Tool Argument Validation
  // =========================================================================
  await test('search_web validates required query and optional parameters', () => {
    const registry = new AgentToolRegistryService();

    // Missing query
    const resMissing = registry.validateToolCall('search_web', {}, ['search_web']);
    assert.strictEqual(resMissing.isValid, false);
    assert.ok(resMissing.error?.includes('query'));

    // Blank query
    const resBlank = registry.validateToolCall('search_web', { query: '   ' }, ['search_web']);
    assert.strictEqual(resBlank.isValid, false);

    // Valid query with stringified JSON string arguments (LLM behavior)
    const resStringified = registry.validateToolCall(
      'search_web',
      JSON.stringify({ query: 'LangGraph architecture', maxResults: 5 }),
      ['search_web'],
    );
    assert.strictEqual(resStringified.isValid, true);
    assert.strictEqual(resStringified.cleanArgs.query, 'LangGraph architecture');
    assert.strictEqual(resStringified.cleanArgs.maxResults, 5);

    // Bounds check on maxResults
    const resCapped = registry.validateToolCall(
      'search_web',
      { query: 'test', maxResults: 100 },
      ['search_web'],
    );
    assert.strictEqual(resCapped.isValid, true);
    assert.strictEqual(resCapped.cleanArgs.maxResults, 10, 'maxResults must be bounded to safe limit');
  });

  await test('read_url validates URL formatting and limits', () => {
    const registry = new AgentToolRegistryService();

    // Missing URL
    const resMissing = registry.validateToolCall('read_url', {}, ['read_url']);
    assert.strictEqual(resMissing.isValid, false);
    assert.ok(resMissing.error?.includes('url'));

    // Invalid scheme
    const resInvalid = registry.validateToolCall('read_url', { url: 'ftp://invalidscheme.com' }, ['read_url']);
    assert.strictEqual(resInvalid.isValid, false);
    assert.ok(resInvalid.error?.includes('HTTP'));

    // Valid URL
    const resValid = registry.validateToolCall(
      'read_url',
      { url: 'https://docs.nestjs.com/modules', maxLength: 10000 },
      ['read_url'],
    );
    assert.strictEqual(resValid.isValid, true);
    assert.strictEqual(resValid.cleanArgs.url, 'https://docs.nestjs.com/modules');
    assert.strictEqual(resValid.cleanArgs.maxContentLength, 10000);
  });

  // =========================================================================
  // 5. Tool Execution & Bounding (search_web & read_url)
  // =========================================================================
  await test('search_web executes and returns bounded results', async () => {
    const mockWebSearchRunner = {
      executeWebSearchNode: async (node: any) => ({
        query: node.data?.config?.query,
        results: [
          {
            title: 'Test Result 1',
            url: 'https://example.com/1',
            content: 'A'.repeat(2000), // Exceeds snippet bound
            score: 0.95,
          },
        ],
        totalResults: 1,
      }),
    };

    const registry = new AgentToolRegistryService(mockWebSearchRunner as any);
    const execResult = await registry.executeTool('search_web', { query: 'test query', maxResults: 5 });

    assert.strictEqual(execResult.success, true);
    assert.strictEqual(execResult.result.query, 'test query');
    assert.strictEqual(execResult.result.results.length, 1);
    assert.ok(execResult.result.results[0].content.length <= 1500, 'Content snippet must be bounded');
    assert.ok(execResult.summary.includes('1 search results') || execResult.summary.includes('1 web results'));
  });

  await test('read_url executes, bounds text length, and extracts links', async () => {
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Test Article</title></head>
        <body>
          <header><nav><a href="/home">Home</a></nav></header>
          <main>
            <h1>Article Title</h1>
            <p>This is paragraph 1 of the article.</p>
            <p>Here is an external link: <a href="https://example.com/source">Source Reference</a></p>
            <p>${'Long body text. '.repeat(500)}</p>
          </main>
        </body>
      </html>
    `;

    globalThis.fetch = async (url: any) => {
      return {
        ok: true,
        status: 200,
        text: async () => mockHtml,
      } as any;
    };

    const registry = new AgentToolRegistryService();
    const execResult = await registry.executeTool('read_url', {
      url: 'https://example.com/article',
      maxLength: 500, // Small limit to test truncation
    });

    globalThis.fetch = originalFetch;

    assert.strictEqual(execResult.success, true);
    assert.strictEqual(execResult.result.title, 'Test Article');
    assert.ok(execResult.result.text.length <= 500, 'Text must be bounded to maxLength');
    assert.strictEqual(execResult.result.truncated, true);
    assert.ok(Array.isArray(execResult.result.links));
    assert.ok(execResult.result.links.includes('https://example.com/source'));
    assert.ok(execResult.summary.includes('Test Article'));
  });

  // =========================================================================
  // 6. Secret Redaction
  // =========================================================================
  await test('redactSecrets sanitizes API keys and sensitive tokens in tool calls and results', () => {
    const sensitivePayload = {
      apiKey: 'tvly-secretkey1234567890abcdef',
      query: 'search with sk-ant-api03-abcdef1234567890 embedded',
      authorization: 'Bearer super-secret-jwt-token',
      nested: {
        token: 'secret-token-value',
        safeField: 'hello world',
      },
    };

    const sanitized = redactSecrets(sensitivePayload);
    assert.strictEqual(sanitized.apiKey, '[REDACTED]');
    assert.strictEqual(sanitized.authorization, '[REDACTED]');
    assert.strictEqual(sanitized.nested.token, '[REDACTED]');
    assert.strictEqual(sanitized.nested.safeField, 'hello world');
    assert.ok(!sanitized.query.includes('sk-ant-api03-abcdef1234567890'));
    assert.ok(sanitized.query.includes('[REDACTED]'));
  });

  // =========================================================================
  // 7. Provider & Model Compatibility Checks
  // =========================================================================
  await test('AgentRunnerService detects unsupported reasoning models and endpoints', () => {
    const variableResolver = new VariableResolverService();
    const mockModelsService: any = {
      findByModelIdOrLabel: async (id: string) => null,
    };
    const runner = new AgentRunnerService(variableResolver, mockModelsService);

    // Supported
    assert.strictEqual(runner.isToolSupportedModel('openai', 'gpt-4o', 'https://api.openai.com/v1').supported, true);
    assert.strictEqual(runner.isToolSupportedModel('anthropic', 'claude-3-5-sonnet', 'https://api.anthropic.com/v1').supported, true);
    assert.strictEqual(runner.isToolSupportedModel('groq', 'llama-3.3-70b-versatile', 'https://api.groq.com/openai/v1').supported, true);

    // Unsupported: reasoning models
    const o1Mini = runner.isToolSupportedModel('openai', 'o1-mini', 'https://api.openai.com/v1');
    assert.strictEqual(o1Mini.supported, false);
    assert.ok(o1Mini.reason?.includes('Reasoning model "o1-mini" does not support structured tool calling'));

    const o1Preview = runner.isToolSupportedModel('openai', 'o1-preview', 'https://api.openai.com/v1');
    assert.strictEqual(o1Preview.supported, false);

    // Unsupported: LM Studio native chat endpoint
    const lmStudioNative = runner.isToolSupportedModel('lmstudio', 'qwen2.5-7b', 'http://localhost:1234/api/v1/chat');
    assert.strictEqual(lmStudioNative.supported, false);
    assert.ok(lmStudioNative.reason?.includes('LM Studio native chat endpoint (/api/v1/chat)'));
  });

  await test('AgentRunnerService throws BadRequestException when tool use enabled with incompatible model', async () => {
    const variableResolver = new VariableResolverService();
    const mockModelsService: any = {
      findByModelIdOrLabel: async (id: string) => ({
        modelId: 'o1-mini',
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1',
      }),
    };
    const runner = new AgentRunnerService(variableResolver, mockModelsService);

    const node: any = {
      id: 'agent_node_1',
      data: {
        config: {
          model: 'o1-mini',
          enableTools: true,
          allowedTools: ['search_web'],
          userPrompt: 'Research something',
        },
      },
    };

    let caughtError: any;
    try {
      await runner.executeAgentNode(node, 'input', {});
    } catch (err: any) {
      caughtError = err;
    }

    assert.ok(caughtError instanceof BadRequestException);
    assert.ok(caughtError.message.includes('Reasoning model "o1-mini" does not support structured tool calling'));
  });

  // =========================================================================
  // 8. Multi-Step Autonomous Tool Calling Loop (OpenAI Provider)
  // =========================================================================
  await test('AgentRunnerService executes autonomous multi-step tool loop and records trace', async () => {
    const variableResolver = new VariableResolverService();
    const mockModelsService: any = {
      findByModelIdOrLabel: async () => ({
        modelId: 'gpt-4o',
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'test-api-key',
      }),
    };

    const toolRegistry = new AgentToolRegistryService();
    // Register mock tool implementations for testing loop
    toolRegistry.registerTool({
      name: 'search_web',
      description: 'Search the web',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
      execute: async (args) => ({
        query: args.query,
        results: [{ title: 'Doc Page', url: 'https://example.com/doc', content: 'Doc content' }],
      }),
      summarizeResult: () => 'Found 1 page',
    });

    toolRegistry.registerTool({
      name: 'read_url',
      description: 'Read URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
        },
        required: ['url'],
      },
      execute: async (args) => ({
        url: args.url,
        title: 'Doc Page Title',
        text: 'Detailed specifications of LangGraph',
      }),
      summarizeResult: () => 'Read 35 chars',
    });

    const runner = new AgentRunnerService(variableResolver, mockModelsService, toolRegistry);

    let callCount = 0;
    globalThis.fetch = async (url: any, opts: any) => {
      callCount++;
      const body = JSON.parse(opts.body);

      if (callCount === 1) {
        // Turn 1: Model requests search_web
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Let me search for LangGraph specifications.',
                  tool_calls: [
                    {
                      id: 'call_search_1',
                      type: 'function',
                      function: {
                        name: 'search_web',
                        arguments: JSON.stringify({ query: 'LangGraph specs' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        } as any;
      } else if (callCount === 2) {
        // Turn 2: Model requests read_url based on previous search result
        // Verify previous messages include tool response
        const lastMsg = body.messages[body.messages.length - 1];
        assert.strictEqual(lastMsg.role, 'tool');
        assert.strictEqual(lastMsg.tool_call_id, 'call_search_1');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'I will now inspect the doc URL.',
                  tool_calls: [
                    {
                      id: 'call_read_1',
                      type: 'function',
                      function: {
                        name: 'read_url',
                        arguments: JSON.stringify({ url: 'https://example.com/doc' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        } as any;
      } else {
        // Turn 3: Final structured answer
        const lastMsg = body.messages[body.messages.length - 1];
        assert.strictEqual(lastMsg.role, 'tool');
        assert.strictEqual(lastMsg.tool_call_id, 'call_read_1');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: JSON.stringify({
                    topic: 'LangGraph',
                    summary: 'Detailed specs retrieved successfully',
                  }),
                },
              },
            ],
          }),
        } as any;
      }
    };

    const node: any = {
      id: 'agent_autonomous_1',
      data: {
        config: {
          model: 'gpt-4o',
          enableTools: true,
          allowedTools: ['search_web', 'read_url'],
          maxSteps: 5,
          outputFormat: 'json',
          userPrompt: 'Research LangGraph specs and return JSON summary.',
        },
      },
    };

    const output = await runner.executeAgentNode(node, 'test goal', {});

    globalThis.fetch = originalFetch;

    assert.strictEqual(callCount, 3, 'LLM should have been called 3 times in loop');
    assert.strictEqual(output.result.topic, 'LangGraph');
    assert.strictEqual(output.result.summary, 'Detailed specs retrieved successfully');
    assert.ok(Array.isArray(output.toolCalls), 'output.toolCalls must be an array');
    assert.strictEqual(output.toolCalls.length, 2, 'Must record 2 tool calls in trace');

    const trace1 = output.toolCalls[0];
    assert.strictEqual(trace1.tool, 'search_web');
    assert.strictEqual(trace1.status, 'completed');
    assert.strictEqual(trace1.args.query, 'LangGraph specs');
    assert.ok(trace1.durationMs >= 0);
    assert.ok(trace1.startedAt);
    assert.ok(trace1.finishedAt);

    const trace2 = output.toolCalls[1];
    assert.strictEqual(trace2.tool, 'read_url');
    assert.strictEqual(trace2.status, 'completed');
    assert.strictEqual(trace2.args.url, 'https://example.com/doc');
  });

  // =========================================================================
  // 9. Guardrails: Max Steps & Circuit Breaker on Repeated Invalid Calls
  // =========================================================================
  await test('AgentRunnerService enforces maximum steps limit', async () => {
    const variableResolver = new VariableResolverService();
    const mockModelsService: any = {
      findByModelIdOrLabel: async () => ({
        modelId: 'gpt-4o',
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'test-api-key',
      }),
    };
    const toolRegistry = new AgentToolRegistryService();
    toolRegistry.registerTool({
      name: 'search_web',
      description: 'search',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      execute: async () => ({ results: [] }),
    });

    const runner = new AgentRunnerService(variableResolver, mockModelsService, toolRegistry);

    // Infinite tool call simulator
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: `call_${callCount}`,
                    type: 'function',
                    function: { name: 'search_web', arguments: JSON.stringify({ query: `step ${callCount}` }) },
                  },
                ],
              },
            },
          ],
        }),
      } as any;
    };

    const node: any = {
      id: 'agent_max_steps',
      data: {
        config: {
          enableTools: true,
          allowedTools: ['search_web'],
          maxSteps: 2, // Limit to 2 steps
          userPrompt: 'Keep searching forever',
        },
      },
    };

    const output = await runner.executeAgentNode(node, 'goal', {});
    globalThis.fetch = originalFetch;

    assert.strictEqual(callCount, 2, 'Execution must stop when maxSteps (2) is reached');
    assert.strictEqual(output.toolCalls.length, 2);
    assert.ok(output.text.includes('Reached maximum step limit'));
  });

  await test('AgentRunnerService circuit breaker halts on 3 consecutive invalid tool calls', async () => {
    const variableResolver = new VariableResolverService();
    const mockModelsService: any = {
      findByModelIdOrLabel: async () => ({
        modelId: 'gpt-4o',
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'test-api-key',
      }),
    };
    const toolRegistry = new AgentToolRegistryService();
    const runner = new AgentRunnerService(variableResolver, mockModelsService, toolRegistry);

    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: `invalid_call_${callCount}`,
                    type: 'function',
                    function: { name: 'unauthorized_tool', arguments: '{}' },
                  },
                ],
              },
            },
          ],
        }),
      } as any;
    };

    const node: any = {
      id: 'agent_circuit_breaker',
      data: {
        config: {
          enableTools: true,
          allowedTools: ['search_web'],
          maxSteps: 10,
          userPrompt: 'Try invalid calls',
        },
      },
    };

    const output = await runner.executeAgentNode(node, 'goal', {});
    globalThis.fetch = originalFetch;

    assert.strictEqual(callCount, 3, 'Circuit breaker must trigger after 3 consecutive invalid tool calls');
    assert.ok(output.text.includes('repeated invalid tool calls'));
    assert.strictEqual(output.toolCalls.length, 3);
    assert.strictEqual(output.toolCalls[0].status, 'failed');
  });

  // =========================================================================
  // 10. Backward Compatibility & Non-Tool Agent Regression
  // =========================================================================
  await test('Agent node with enableTools disabled retains single-turn legacy behavior', async () => {
    const variableResolver = new VariableResolverService();
    const mockModelsService: any = {
      findByModelIdOrLabel: async () => ({
        modelId: 'gpt-4o',
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'test-api-key',
      }),
    };
    const runner = new AgentRunnerService(variableResolver, mockModelsService);

    let sentPayload: any;
    globalThis.fetch = async (url: any, opts: any) => {
      sentPayload = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({ answer: 'Legacy single turn response' }),
              },
            },
          ],
        }),
      } as any;
    };

    const node: any = {
      id: 'legacy_agent',
      data: {
        config: {
          enableTools: false,
          outputFormat: 'json',
          userPrompt: 'Simple prompt',
        },
      },
    };

    const output = await runner.executeAgentNode(node, 'legacy goal', {});
    globalThis.fetch = originalFetch;

    assert.strictEqual(sentPayload.tools, undefined, 'Payload must not include tools when enableTools is false');
    assert.strictEqual(output.result.answer, 'Legacy single turn response');
    assert.strictEqual(output.toolCalls, undefined, 'output.toolCalls should be undefined for legacy agents');
  });

  // =========================================================================
  // 11. Orchestrator Compatibility (Delegated Agent Tool Use)
  // =========================================================================
  await test('Orchestrator delegates tool configurations safely to child agents', async () => {
    let agent1ToolsPassed: any = null;
    let agent2ToolsPassed: any = null;

    const mockAgentRunner: any = {
      executeAgentNode: async (node: any, goal: string, context: any) => {
        const config = node.data?.config || {};
        if (node.id.includes('researcher')) {
          agent1ToolsPassed = {
            enableTools: config.enableTools,
            allowedTools: config.allowedTools,
            maxSteps: config.maxSteps,
          };
          return {
            result: { findings: 'Discovered facts' },
            text: 'Discovered facts',
            toolCalls: [
              {
                id: 'call_1',
                tool: 'search_web',
                args: { query: 'test' },
                status: 'completed',
              },
            ],
          };
        } else {
          agent2ToolsPassed = {
            enableTools: config.enableTools,
            allowedTools: config.allowedTools,
          };
          return {
            result: { summary: 'Synthesized report' },
            text: 'Synthesized report',
          };
        }
      },
    };

    const blockRuntime = new BlockRuntimeService(
      {} as any,
      {} as any,
      {} as any,
      mockAgentRunner,
      {} as any,
      {} as any,
      {} as any,
    );

    const orchestratorInput = {
      input: 'Perform market research and summarize',
      config: {
        strategy: 'sequential',
        maxToolStepsPerAgent: 10,
        agents: [
          {
            id: 'researcher',
            role: 'Web Researcher',
            enableTools: true,
            allowedTools: ['search_web', 'read_url'],
            maxSteps: 6,
          },
          {
            id: 'writer',
            role: 'Report Writer',
            enableTools: false,
          },
        ],
      },
    };

    const out = await blockRuntime.execute('orchestrator', orchestratorInput);
    assert.strictEqual(out.status, 'completed');
    const agentOutputs = out.result.results;
    assert.strictEqual(agentOutputs.length, 2);

    // Verify Agent 1 (researcher) was configured with tools
    assert.strictEqual(agent1ToolsPassed.enableTools, true);
    assert.deepStrictEqual(agent1ToolsPassed.allowedTools, ['search_web', 'read_url']);
    assert.strictEqual(agent1ToolsPassed.maxSteps, 6);
    assert.ok(agentOutputs[0].toolCalls, 'Researcher agent must expose its toolCalls');
    assert.strictEqual(agentOutputs[0].toolCalls.length, 1);

    // Verify Agent 2 (writer) ran without tools
    assert.strictEqual(agent2ToolsPassed.enableTools, false);
    assert.deepStrictEqual(agent2ToolsPassed.allowedTools, []);
    assert.strictEqual(agentOutputs[1].toolCalls, undefined);
  });

  // =========================================================================
  // Final Results
  // =========================================================================
  console.log('\n=============================================');
  console.log(`📊 TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log('=============================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
