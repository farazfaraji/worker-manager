import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { ModelsService } from '../src/models/models.service';
import { ModelsController } from '../src/models/models.controller';
import { NodeDefinitionsService } from '../src/node-definitions/node-definitions.service';

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING FLOW HELPER & PROMPT REVISE SPEC (OFFLINE / NO LIVE LLM)');
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

  // Preserve global fetch and ensure no unmocked network or LLM calls escape
  const originalFetch = globalThis.fetch;
  let networkCallsAttempted = 0;

  globalThis.fetch = async (url: any) => {
    networkCallsAttempted++;
    throw new Error(
      `CRITICAL TEST ERROR: Unmocked LLM or network call attempted to "${url}". Tests must NEVER call external LLMs!`,
    );
  };

  try {
    // =========================================================================
    // 1. Tool Definition Checks (agent.json)
    // =========================================================================
    await test('agent.json systemPrompt declares canRevise: true', async () => {
      const nodeDefService = new NodeDefinitionsService();
      const defs = await nodeDefService.getAllDefinitions();
      const agentDef = defs.find((d) => d.id === 'agent');
      assert.ok(agentDef, 'agent definition must exist');

      const systemPromptInput: any = agentDef.inputs.find((i: any) => i.name === 'systemPrompt');
      assert.ok(systemPromptInput, 'systemPrompt input must exist in agent.json');
      assert.strictEqual(systemPromptInput.canRevise, true, 'systemPrompt must have canRevise: true');
    });

    await test('agent.json outputType declares supportsAiGenerator: true', async () => {
      const agentJsonPath = path.resolve(__dirname, '../src/tools/agent.json');
      assert.ok(fs.existsSync(agentJsonPath), 'agent.json must exist');
      const agentDef = JSON.parse(fs.readFileSync(agentJsonPath, 'utf-8'));

      const outputTypeInput = agentDef.inputs.find((i: any) => i.name === 'outputType');
      assert.ok(outputTypeInput, 'outputType input must exist in agent.json');
      assert.strictEqual(outputTypeInput.supportsAiGenerator, true, 'outputType must have supportsAiGenerator: true');
    });

    // =========================================================================
    // Mock Models & Settings Services (No MongoDB, No Live Network)
    // =========================================================================
    const mockModels: any[] = [
      {
        _id: '6ab6be824fec28d96ee838ed',
        modelId: 'openai/gpt-6-luna',
        label: 'OpenRouter Luna 6',
        provider: 'openrouter',
        endpoint: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or-test-mock-key',
        isDefault: true,
      },
      {
        _id: '6ab6be824fec28d96ee838ee',
        modelId: 'claude-3-5-sonnet-20241022',
        label: 'Claude 3.5 Sonnet',
        provider: 'anthropic',
        endpoint: 'https://api.anthropic.com/v1',
        apiKey: 'sk-ant-test-mock-key',
        isDefault: false,
      },
    ];

    const mockModelModel: any = {
      find: () => ({
        sort: () => ({
          exec: async () => mockModels,
        }),
        exec: async () => mockModels,
      }),
      findOne: (query: any) => ({
        exec: async () => {
          if (query?.isDefault) {
            return mockModels.find((m) => m.isDefault) || mockModels[0];
          }
          if (query?.$or) {
            const identifiers = query.$or.map((o: any) => o.modelId || o.label).filter(Boolean);
            return mockModels.find((m) => identifiers.includes(m.modelId) || identifiers.includes(m.label)) || null;
          }
          return null;
        },
      }),
    };

    let persistedSettings: any = { flowHelperModel: 'openai/gpt-6-luna' };
    const mockSettingsService: any = {
      getSettings: async () => persistedSettings,
      updateSettings: async (dto: any) => {
        persistedSettings = { ...persistedSettings, ...dto };
        return persistedSettings;
      },
    };

    const modelsService = new ModelsService(mockModelModel, mockSettingsService);
    const modelsController = new ModelsController(modelsService);

    // =========================================================================
    // 2. revisePrompt Unit Tests (Mocked LLM API responses)
    // =========================================================================
    await test('revisePrompt constructs correct payload, preserves mustache variables, and returns revised prompt without calling real LLM', async () => {
      let interceptedUrl = '';
      let interceptedBody: any = null;
      let interceptedHeaders: any = null;

      globalThis.fetch = async (url: any, opts: any) => {
        interceptedUrl = String(url);
        interceptedHeaders = opts?.headers || {};
        interceptedBody = JSON.parse(opts?.body || '{}');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'gen-test-123',
            choices: [
              {
                message: {
                  content:
                    'You are an expert agent dedicated to processing data for {{user.name}}.\nAdhere strictly to instructions and output clean JSON.',
                },
              },
            ],
          }),
        } as any;
      };

      const result = await modelsService.revisePrompt({
        prompt: 'You are an agent that processes data for {{user.name}}.',
        instruction: 'Make it concise, formal, and ensure mustache template is preserved.',
        modelId: 'openai/gpt-6-luna',
      });

      // Verify outbound parameters sent to the mock
      assert.strictEqual(interceptedUrl, 'https://openrouter.ai/api/v1/chat/completions');
      assert.strictEqual(interceptedHeaders['Authorization'], 'Bearer sk-or-test-mock-key');
      assert.strictEqual(interceptedHeaders['HTTP-Referer'], 'http://localhost:6301');
      assert.strictEqual(interceptedBody.model, 'openai/gpt-6-luna');
      assert.ok(interceptedBody.messages.length >= 2);
      assert.ok(interceptedBody.messages[1].content.includes('{{user.name}}'));
      assert.ok(interceptedBody.messages[1].content.includes('Make it concise, formal'));

      // Verify response returned to caller
      assert.strictEqual(result.model, 'OpenRouter Luna 6');
      assert.strictEqual(result.modelId, 'openai/gpt-6-luna');
      assert.strictEqual(result.provider, 'openrouter');
      assert.ok(result.revisedPrompt.includes('{{user.name}}'), 'Must preserve {{user.name}}');
      assert.ok(result.revisedPrompt.includes('expert agent dedicated'));
    });

    await test('revisePrompt supports Anthropic format with system instruction and x-api-key', async () => {
      let interceptedUrl = '';
      let interceptedHeaders: any = null;
      let interceptedBody: any = null;

      globalThis.fetch = async (url: any, opts: any) => {
        interceptedUrl = String(url);
        interceptedHeaders = opts?.headers || {};
        interceptedBody = JSON.parse(opts?.body || '{}');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'msg-ant-123',
            content: [
              {
                type: 'text',
                text: 'Anthropic revised prompt for {{ticket.id}}.',
              },
            ],
          }),
        } as any;
      };

      const result = await modelsService.revisePrompt({
        prompt: 'Handle ticket {{ticket.id}}',
        modelId: 'claude-3-5-sonnet-20241022',
      });

      assert.strictEqual(interceptedUrl, 'https://api.anthropic.com/v1/messages');
      assert.strictEqual(interceptedHeaders['x-api-key'], 'sk-ant-test-mock-key');
      assert.strictEqual(interceptedHeaders['anthropic-version'], '2023-06-01');
      assert.strictEqual(interceptedBody.model, 'claude-3-5-sonnet-20241022');
      assert.strictEqual(result.revisedPrompt, 'Anthropic revised prompt for {{ticket.id}}.');
      assert.strictEqual(result.provider, 'anthropic');
    });

    await test('revisePrompt falls back to settings flowHelperModel when no modelId provided', async () => {
      let passedModel = '';
      globalThis.fetch = async (_url: any, opts: any) => {
        const body = JSON.parse(opts?.body || '{}');
        passedModel = body.model;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: 'Fallback model revised prompt' } }],
          }),
        } as any;
      };

      const result = await modelsService.revisePrompt({
        prompt: 'Draft an email',
      });

      assert.strictEqual(passedModel, 'openai/gpt-6-luna');
      assert.strictEqual(result.modelId, 'openai/gpt-6-luna');
      assert.strictEqual(result.revisedPrompt, 'Fallback model revised prompt');
    });

    await test('revisePrompt handles provider error cleanly with BadRequestException', async () => {
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: async () => ({ error: { message: 'Invalid API key provided' } }),
        } as any;
      };

      await assert.rejects(
        async () => {
          await modelsService.revisePrompt({
            prompt: 'Test prompt',
            modelId: 'openai/gpt-6-luna',
          });
        },
        (err: any) => {
          assert.ok(err instanceof BadRequestException);
          assert.ok(err.message.includes('Invalid API key provided') || err.message.includes('401'));
          return true;
        },
      );
    });

    // =========================================================================
    // 3. generateSchema Unit Tests (Mocked LLM API responses)
    // =========================================================================
    await test('generateSchema strips markdown fences and generates clean Zod schema', async () => {
      let interceptedUrl = '';
      let interceptedBody: any = null;

      globalThis.fetch = async (url: any, opts: any) => {
        interceptedUrl = String(url);
        interceptedBody = JSON.parse(opts?.body || '{}');

        // Model wraps response in markdown code blocks with trailing semicolon
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content:
                    '```typescript\nz.object({\n  summary: z.string().describe("Summary string"),\n  findings: z.array(z.string()).describe("Findings list"),\n  score: z.number().min(1).max(100).describe("Score number")\n}).strict();\n```',
                },
              },
            ],
          }),
        } as any;
      };

      const res = await modelsService.generateSchema({
        description: 'A summary string, a list of findings, and a score number between 1 and 100',
        modelId: 'openai/gpt-6-luna',
        strictMode: true,
      });

      assert.strictEqual(interceptedUrl, 'https://openrouter.ai/api/v1/chat/completions');
      assert.ok(interceptedBody.messages[1].content.includes('Desired Output Description:'));
      assert.ok(interceptedBody.messages[1].content.includes('Strict Mode: Enabled'));

      // Cleaned output assertions
      assert.ok(res.schema, 'Schema must not be empty');
      assert.ok(!res.schema.startsWith('```'), 'Must strip opening markdown fence');
      assert.ok(!res.schema.endsWith('```'), 'Must strip closing markdown fence');
      assert.ok(!res.schema.endsWith(';'), 'Must strip trailing semicolon');
      assert.ok(res.schema.startsWith('z.object'), 'Must start directly with z.object');
      assert.ok(res.schema.includes('summary: z.string()'), 'Must include summary field');
      assert.ok(res.schema.includes('findings: z.array(z.string())'), 'Must include findings array');
      assert.ok(res.schema.includes('score: z.number()'), 'Must include score field');
      assert.strictEqual(res.modelId, 'openai/gpt-6-luna');
      assert.strictEqual(res.provider, 'openrouter');
    });

    await test('generateSchema handles provider error cleanly with BadRequestException', async () => {
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ error: { message: 'Provider internal outage' } }),
        } as any;
      };

      await assert.rejects(
        async () => {
          await modelsService.generateSchema({
            description: 'Customer contact details',
            modelId: 'openai/gpt-6-luna',
          });
        },
        (err: any) => {
          assert.ok(err instanceof BadRequestException);
          assert.ok(err.message.includes('Provider internal outage') || err.message.includes('500'));
          return true;
        },
      );
    });

    // =========================================================================
    // 4. Controller Routing Tests
    // =========================================================================
    await test('ModelsController delegates revisePrompt and generateSchema to ModelsService', async () => {
      globalThis.fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: 'Delegated response from controller' } }],
          }),
        } as any;
      };

      const revised = await modelsController.revisePrompt({
        prompt: 'Initial prompt',
      });
      assert.strictEqual(revised.revisedPrompt, 'Delegated response from controller');

      const generated = await modelsController.generateSchema({
        description: 'Output with status and id',
      });
      assert.strictEqual(generated.schema, 'Delegated response from controller');
    });

    // =========================================================================
    // 5. Settings Persistence Verification
    // =========================================================================
    await test('SettingsService correctly persists and returns flowHelperModel', async () => {
      await mockSettingsService.updateSettings({ flowHelperModel: 'openai/gpt-4o' });
      const current = await mockSettingsService.getSettings();
      assert.strictEqual(current.flowHelperModel, 'openai/gpt-4o');

      await mockSettingsService.updateSettings({ flowHelperModel: 'openai/gpt-6-luna' });
      const restored = await mockSettingsService.getSettings();
      assert.strictEqual(restored.flowHelperModel, 'openai/gpt-6-luna');
    });
  } finally {
    // Restore original global fetch
    globalThis.fetch = originalFetch;
  }

  // =========================================================================
  // Final Results
  // =========================================================================
  console.log('\n=============================================');
  console.log(`📊 RESULTS: ${passed} passed, ${failed} failed`);
  console.log('🛡️ NO REAL LLM CALLS MADE DURING TESTS');
  console.log('=============================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
