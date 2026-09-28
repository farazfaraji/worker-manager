import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { VariableResolverService, RuntimeNode } from './variable-resolver.service';
import { ModelsService } from '../../models/models.service';
import {
  AgentToolRegistryService,
  AgentToolTraceItem,
} from './agent-tool-registry.service';
import { redactSecrets } from './redaction.util';
import { validateResearchFindings } from '../../research/research.contract';

@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);
  private readonly toolRegistry: AgentToolRegistryService;

  constructor(
    private readonly variableResolver: VariableResolverService,
    private readonly modelsService: ModelsService,
    @Optional()
    toolRegistry?: AgentToolRegistryService,
  ) {
    this.toolRegistry = toolRegistry || new AgentToolRegistryService();
  }

  private isReasoningModel(modelId: string): boolean {
    const lower = (modelId || '').toLowerCase();
    return lower.startsWith('o1') || lower.startsWith('o3') || lower.includes('reasoning');
  }

  /**
   * Determine whether a model/provider combination supports structured tool calling
   */
  isToolSupportedModel(
    provider: string,
    modelId: string,
    endpoint: string,
  ): { supported: boolean; reason?: string } {
    const p = (provider || 'openai').toLowerCase();
    const m = (modelId || '').toLowerCase();

    // Specific known unsupported reasoning models
    if (m.startsWith('o1-mini') || m.startsWith('o1-preview')) {
      return {
        supported: false,
        reason: `Reasoning model "${modelId}" does not support structured tool calling or function calls. Please choose a tool-capable model such as GPT-4o, GPT-4o Mini, or Claude 3.5 Sonnet.`,
      };
    }

    // LM Studio native endpoint /api/v1/chat does not support OpenAI function calling API
    if (p === 'lmstudio' && endpoint.includes('/api/v1/chat')) {
      return {
        supported: false,
        reason: `LM Studio native chat endpoint (/api/v1/chat) does not support structured tool calling. Configure the OpenAI-compatible endpoint (/v1/chat/completions) with a tool-capable model instead.`,
      };
    }

    // Supported provider families
    if (
      p === 'openai' ||
      p === 'openrouter' ||
      p === 'groq' ||
      p === 'anthropic' ||
      p === 'ollama' ||
      p === 'custom' ||
      endpoint.includes('openai') ||
      endpoint.includes('groq') ||
      endpoint.includes('openrouter')
    ) {
      return { supported: true };
    }

    return {
      supported: false,
      reason: `Provider "${provider}" with model "${modelId}" does not support autonomous tool calling. Supported providers: openai, openrouter, groq, anthropic, ollama (OpenAI API).`,
    };
  }

  private encodeLocalFileToBase64(filePath: string): { base64: string; mimeType: string } | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      const ext = path.extname(filePath).toLowerCase();
      let mimeType = 'image/png';
      if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      else if (ext === '.webp') mimeType = 'image/webp';
      else if (ext === '.gif') mimeType = 'image/gif';
      else if (ext === '.mp3') mimeType = 'audio/mp3';
      else if (ext === '.wav') mimeType = 'audio/wav';
      else if (ext === '.pdf') mimeType = 'application/pdf';

      const fileBuffer = fs.readFileSync(filePath);
      return {
        base64: fileBuffer.toString('base64'),
        mimeType,
      };
    } catch {
      return null;
    }
  }

  async executeAgentNode(
    node: RuntimeNode,
    nodeInput: any,
    context: Record<string, any>,
    runId?: string,
  ): Promise<any> {
    const data = node.data || {};
    const config = data.config || {};
    const modelKey = config.model || 'gpt-4o';

    // Find model config from DB
    const modelRecord = await this.modelsService.findByModelIdOrLabel(modelKey);
    const modelId = modelRecord?.modelId || modelKey;
    const provider = modelRecord?.provider || 'openai';
    const rawEndpoint = String(config.endpoint || modelRecord?.endpoint || 'https://api.openai.com/v1').trim();
    const endpoint = rawEndpoint;
    let apiKey =
      modelRecord?.apiKey ||
      (provider === 'openrouter' || rawEndpoint.includes('openrouter.ai')
        ? process.env.OPENROUTER_API_KEY
        : '') ||
      process.env.OPENAI_API_KEY ||
      '';
    if (typeof apiKey === 'string') {
      apiKey = apiKey.trim();
      if (apiKey.includes('=')) {
        apiKey = apiKey.split('=').pop()!.trim();
      }
      if (apiKey.startsWith('Bearer ')) {
        apiKey = apiKey.slice(7).trim();
      }
    }

    // Prompts
    const rawSystemPrompt = config.systemPrompt || 'You are an AI assistant in a LangGraph workflow.';
    const systemPrompt = this.variableResolver.resolveValue(rawSystemPrompt, context) || '';

    const rawUserPrompt = config.userPrompt || config.prompt || config.input;
    let resolvedUserPrompt = '';
    if (rawUserPrompt !== undefined && rawUserPrompt !== null) {
      const resolved = this.variableResolver.resolveValue(rawUserPrompt, context);
      resolvedUserPrompt = typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
    } else if (nodeInput !== undefined && nodeInput !== null) {
      resolvedUserPrompt = typeof nodeInput === 'string' ? nodeInput : JSON.stringify(nodeInput);
    }

    // Resolve Tool Use settings
    const enableTools = Boolean(config.enableTools || config.toolsEnabled);
    let allowedTools: string[] = [];
    const rawTools = config.allowedTools !== undefined ? config.allowedTools : config.tools;
    if (Array.isArray(rawTools)) {
      allowedTools = rawTools.map(String).filter(Boolean);
    } else if (typeof rawTools === 'object' && rawTools !== null && rawTools.value !== undefined) {
      if (Array.isArray(rawTools.value)) {
        allowedTools = rawTools.value.map(String).filter(Boolean);
      } else if (typeof rawTools.value === 'string') {
        allowedTools = rawTools.value.split(/[\r\n,]+/).map((s: string) => s.trim()).filter(Boolean);
      }
    } else if (typeof rawTools === 'string') {
      try {
        const parsed = JSON.parse(rawTools);
        if (Array.isArray(parsed)) allowedTools = parsed.map(String).filter(Boolean);
        else allowedTools = rawTools.split(/[\r\n,]+/).map((s: string) => s.trim()).filter(Boolean);
      } catch {
        allowedTools = rawTools.split(/[\r\n,]+/).map((s: string) => s.trim()).filter(Boolean);
      }
    }
    if (enableTools && allowedTools.length === 0) {
      allowedTools = this.toolRegistry.getRegisteredToolNames();
    }

    // Validate provider & model compatibility if tool use is requested
    if (enableTools) {
      const compatibility = this.isToolSupportedModel(provider, modelId, endpoint);
      if (!compatibility.supported) {
        this.logger.error(`   ❌ Incompatible model for tool calling: ${compatibility.reason}`);
        throw new BadRequestException(
          compatibility.reason ||
            `Model "${modelId}" (${provider}) is incompatible with autonomous tool calling.`,
        );
      }
    }

    // JSON output instructions
    const isJsonMode = config.outputFormat === 'json';
    const outputSchema = config.outputType || config.outputSchema;
    let augmentedSystemPrompt = systemPrompt;
    if (isJsonMode) {
      augmentedSystemPrompt += `\n\nCRITICAL REQUIREMENT: You MUST respond ONLY with a valid JSON object matching the requested schema. Do not enclose in codeblocks or add explanations outside the JSON.`;
      if (outputSchema) {
        augmentedSystemPrompt += `\nExpected Schema:\n${outputSchema}`;
      }
    }

    // Temperature resolution
    let temperature: number | undefined;
    if (!this.isReasoningModel(modelId)) {
      if (config.customTemperature && config.temperature !== undefined) {
        temperature = Number(config.temperature);
      } else if (modelRecord?.defaultTemperature !== undefined) {
        temperature = modelRecord.defaultTemperature;
      } else {
        temperature = 0.7;
      }
    }

    // Handle Attachments
    let attachmentDataUrl: string | null = null;
    let attachmentType = config.attachmentType || 'auto';
    if (config.enableAttachment && config.attachment !== undefined) {
      const resolvedAttachment = this.variableResolver.resolveValue(config.attachment, context);
      if (typeof resolvedAttachment === 'string' && resolvedAttachment.trim()) {
        const attStr = resolvedAttachment.trim();
        if (attStr.startsWith('data:')) {
          attachmentDataUrl = attStr;
        } else if (attStr.startsWith('http://') || attStr.startsWith('https://')) {
          attachmentDataUrl = attStr;
        } else {
          const encoded = this.encodeLocalFileToBase64(attStr);
          if (encoded) {
            attachmentDataUrl = `data:${encoded.mimeType};base64,${encoded.base64}`;
          }
        }
      } else if (typeof resolvedAttachment === 'object' && resolvedAttachment?.path) {
        const encoded = this.encodeLocalFileToBase64(resolvedAttachment.path);
        if (encoded) {
          attachmentDataUrl = `data:${encoded.mimeType};base64,${encoded.base64}`;
        }
      }
    }

    // Reasoning settings (Groq, Qwen, DeepSeek, o1, etc.)
    const reasoningEffort =
      config.reasoningEffort && config.reasoningEffort !== 'model_default'
        ? config.reasoningEffort
        : modelRecord?.reasoningEffort || 'default';

    const reasoningFormat =
      config.reasoningFormat || modelRecord?.reasoningFormat || (isJsonMode ? 'hidden' : 'hidden');

    this.logger.log(`   🤖 [Agent Execution] Model: ${modelId} (${provider}) | Endpoint: ${endpoint}`);
    if (enableTools) {
      this.logger.log(
        `   🛠️ Autonomous Tool Use: ENABLED | Allowed: [${allowedTools.join(', ')}] | Max Steps: ${
          config.maxSteps || config.maxToolCalls || 5
        }`,
      );
    }
    if (reasoningEffort !== 'default') {
      this.logger.log(`   🧠 Reasoning Effort: ${reasoningEffort} | Reasoning Format: ${reasoningFormat}`);
    }
    this.logger.log(`   🤖 System Prompt: "${String(augmentedSystemPrompt).substring(0, 100)}..."`);
    this.logger.log(`   🤖 User Prompt: "${String(resolvedUserPrompt).substring(0, 100)}..."`);
    if (attachmentDataUrl) {
      this.logger.log(`   📎 Attachment attached (${attachmentDataUrl.substring(0, 35)}...)`);
    }

    let rawResponseContent: string | null = null;
    let extractedReasoning: string | undefined;
    let agentResult: any;
    const toolCallsTrace: AgentToolTraceItem[] = [];

    let targetUrl = '';
    const isLocalOrCustomEndpoint =
      provider === 'lmstudio' ||
      provider === 'ollama' ||
      provider === 'custom' ||
      endpoint.includes('localhost') ||
      endpoint.includes('127.0.0.1') ||
      !endpoint.includes('api.openai.com');

    if (apiKey || isLocalOrCustomEndpoint) {
      try {
        const timeoutMs = Math.min(Number(config.maxTimeoutMs || Infinity), Number(process.env.LLM_TIMEOUT_MS || config.timeoutMs || 90000));
        const maxSteps = Math.min(20, Math.max(1, Number(config.maxSteps || config.maxToolCalls || 5)));
        const abortSignal = AbortSignal.timeout(timeoutMs);

        const isLmStudioNative = provider === 'lmstudio' && endpoint.includes('/api/v1/chat');

        // =====================================================================
        // ANTHROPIC MESSAGES API
        // =====================================================================
        if (provider === 'anthropic') {
          const messages: any[] = [];
          if (attachmentDataUrl && attachmentDataUrl.startsWith('data:')) {
            const [header, base64Part] = attachmentDataUrl.split(';base64,');
            const mediaType = header.replace('data:', '');
            messages.push({
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: base64Part,
                  },
                },
                { type: 'text', text: resolvedUserPrompt },
              ],
            });
          } else {
            messages.push({ role: 'user', content: resolvedUserPrompt });
          }

          const cleanAnthropicEndpoint = endpoint.replace(/\/+$/, '');
          const anthropicUrl =
            cleanAnthropicEndpoint === 'https://api.anthropic.com/v1'
              ? 'https://api.anthropic.com/v1/messages'
              : cleanAnthropicEndpoint;
          targetUrl = anthropicUrl;

          if (!enableTools) {
            // Standard single-turn execution
            this.logger.log(`   🚀 Dispatching Anthropic request -> [POST] ${targetUrl}`);
            const res = await fetch(anthropicUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: modelId,
                system: augmentedSystemPrompt,
                messages,
                max_tokens: 4096,
                ...(temperature !== undefined ? { temperature } : {}),
              }),
              signal: abortSignal,
            });
            let json: any;
            try {
              json = await res.json();
            } catch (parseErr: any) {
              if (res.ok) {
                throw new Error(
                  `Failed to parse Anthropic response JSON (connection may have timed out or aborted): ${parseErr.message}`,
                );
              }
              json = {};
            }
            if (!res.ok) {
              this.logger.error(`   ❌ Anthropic API returned HTTP ${res.status}: ${JSON.stringify(json)}`);
              throw new Error(`Anthropic error (${res.status}): ${json.error?.message || res.statusText}`);
            }
            rawResponseContent = json.content?.[0]?.text || '';
          } else {
            // Autonomous multi-step tool loop for Anthropic
            const anthropicTools = this.toolRegistry.getAnthropicToolSchemas(allowedTools);
            let stepCount = 0;
            let consecutiveInvalidCalls = 0;

            while (stepCount < maxSteps) {
              stepCount++;
              this.logger.log(
                `   🔄 [Anthropic Tool Loop] Step ${stepCount}/${maxSteps} -> [POST] ${targetUrl}`,
              );

              const res = await fetch(anthropicUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': apiKey,
                  'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                  model: modelId,
                  system: augmentedSystemPrompt,
                  messages,
                  tools: anthropicTools,
                  max_tokens: 4096,
                  ...(temperature !== undefined ? { temperature } : {}),
                }),
                signal: abortSignal,
              });

              let json: any;
              try {
                json = await res.json();
              } catch (parseErr: any) {
                if (res.ok) {
                  throw new Error(`Failed to parse Anthropic response JSON: ${parseErr.message}`);
                }
                json = {};
              }
              if (!res.ok) {
                this.logger.error(`   ❌ Anthropic API returned HTTP ${res.status}: ${JSON.stringify(json)}`);
                throw new Error(`Anthropic error (${res.status}): ${json.error?.message || res.statusText}`);
              }

              const contentBlocks = Array.isArray(json.content) ? json.content : [];
              const toolUseBlocks = contentBlocks.filter((b: any) => b.type === 'tool_use');

              if (!toolUseBlocks.length) {
                const textBlocks = contentBlocks.filter((b: any) => b.type === 'text');
                rawResponseContent = textBlocks.map((b: any) => b.text).join('\n');
                break;
              }

              messages.push({
                role: 'assistant',
                content: contentBlocks,
              });

              const toolResultBlocks: any[] = [];
              let turnHadInvalidCall = false;

              for (const block of toolUseBlocks) {
                const callId = block.id;
                const toolName = block.name;
                const rawArgs = block.input;

                const validation = this.toolRegistry.validateToolCall(toolName, rawArgs, allowedTools);
                if (!validation.isValid) {
                  turnHadInvalidCall = true;
                  const errorMsg = validation.error || `Tool "${toolName}" is not valid or not authorized.`;
                  toolCallsTrace.push({
                    id: callId,
                    tool: toolName,
                    args: redactSecrets(rawArgs || {}),
                    status: 'failed',
                    startedAt: new Date().toISOString(),
                    finishedAt: new Date().toISOString(),
                    durationMs: 0,
                    error: errorMsg,
                  });
                  toolResultBlocks.push({
                    type: 'tool_result',
                    tool_use_id: callId,
                    content: JSON.stringify({ error: errorMsg }),
                    is_error: true,
                  });
                  continue;
                }

                const toolStartTime = new Date().toISOString();
                const toolExec = await this.toolRegistry.executeTool(toolName, validation.cleanArgs, context);
                const toolEndTime = new Date().toISOString();

                toolCallsTrace.push({
                  id: callId,
                  tool: toolName,
                  args: redactSecrets(validation.cleanArgs),
                  status: toolExec.success ? 'completed' : 'failed',
                  startedAt: toolStartTime,
                  finishedAt: toolEndTime,
                  durationMs: toolExec.durationMs,
                  resultSummary: toolExec.summary,
                  result: redactSecrets(toolExec.result),
                  error: toolExec.error,
                });

                const responsePayload = toolExec.success ? toolExec.result : { error: toolExec.error };

                toolResultBlocks.push({
                  type: 'tool_result',
                  tool_use_id: callId,
                  content: JSON.stringify(responsePayload),
                  is_error: !toolExec.success,
                });
              }

              messages.push({
                role: 'user',
                content: toolResultBlocks,
              });

              if (turnHadInvalidCall) {
                consecutiveInvalidCalls++;
                if (consecutiveInvalidCalls >= 3) {
                  this.logger.warn(
                    `   ⚠️ Repeated invalid tool calls (${consecutiveInvalidCalls}). Halting tool loop.`,
                  );
                  rawResponseContent = 'Execution stopped due to repeated invalid tool calls.';
                  break;
                }
              } else {
                consecutiveInvalidCalls = 0;
              }

              if (stepCount >= maxSteps) {
                this.logger.warn(`   ⚠️ Reached maximum tool steps (${maxSteps}). Halting tool loop.`);
                const textBlocks = contentBlocks.filter((b: any) => b.type === 'text');
                rawResponseContent =
                  textBlocks.map((b: any) => b.text).join('\n') ||
                  `Reached maximum step limit of ${maxSteps} tool iterations.`;
                break;
              }
            }
          }
        } else if (isLmStudioNative) {
          // =====================================================================
          // LM STUDIO NATIVE REST API (POST /api/v1/chat)
          // =====================================================================
          targetUrl = endpoint.trim().replace(/\/+$/, '');
          let inputPayload: any = resolvedUserPrompt;
          if (attachmentDataUrl) {
            inputPayload = [
              { type: 'text', content: resolvedUserPrompt },
              { type: 'image', data_url: attachmentDataUrl },
            ];
          }

          const payload: any = {
            model: modelId,
            input: inputPayload,
            ...(augmentedSystemPrompt ? { system_prompt: augmentedSystemPrompt } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
          };

          this.logger.log(
            `   🚀 Dispatching LM Studio request -> [POST] ${targetUrl} (payload: ${
              JSON.stringify(payload).length
            } bytes, timeout: ${timeoutMs}ms)`,
          );

          const res = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify(payload),
            signal: abortSignal,
          });

          let json: any;
          try {
            json = await res.json();
          } catch (parseErr: any) {
            if (res.ok) {
              throw new Error(
                `Failed to parse LM Studio response JSON (connection may have timed out or aborted): ${parseErr.message}`,
              );
            }
            json = {};
          }
          if (!res.ok) {
            this.logger.error(`   ❌ LM Studio API returned HTTP ${res.status}: ${JSON.stringify(json)}`);
            throw new Error(`LM Studio error (${res.status}): ${json.error?.message || res.statusText}`);
          }

          if (Array.isArray(json.output)) {
            const msgPart = json.output.find((p: any) => p.type === 'message');
            const reasoningPart = json.output.find((p: any) => p.type === 'reasoning');
            rawResponseContent = msgPart?.content || '';
            if (reasoningPart?.content) {
              extractedReasoning = reasoningPart.content;
            }
          } else if (typeof json.output === 'string') {
            rawResponseContent = json.output;
          } else {
            rawResponseContent = JSON.stringify(json.output || {});
          }
        } else {
          // =====================================================================
          // OPENAI & OPENAI-COMPATIBLE (Groq, Ollama, OpenRouter, Custom)
          // =====================================================================
          const cleanEndpoint = endpoint.trim().replace(/\/+$/, '');
          let completionsUrl = cleanEndpoint;
          if (cleanEndpoint.endsWith('/chat/completions') || cleanEndpoint.endsWith('/completions')) {
            completionsUrl = cleanEndpoint;
          } else if (cleanEndpoint.endsWith('/chat')) {
            completionsUrl = `${cleanEndpoint}/completions`;
          } else if (
            cleanEndpoint.endsWith('/v1') ||
            cleanEndpoint.endsWith('/v1beta/openai') ||
            cleanEndpoint.endsWith('/openai/v1')
          ) {
            completionsUrl = `${cleanEndpoint}/chat/completions`;
          } else if (cleanEndpoint === 'https://api.openai.com') {
            completionsUrl = 'https://api.openai.com/v1/chat/completions';
          }
          targetUrl = completionsUrl;

          const messages: any[] = [{ role: 'system', content: augmentedSystemPrompt }];

          if (attachmentDataUrl) {
            messages.push({
              role: 'user',
              content: [
                { type: 'text', text: resolvedUserPrompt },
                {
                  type: 'image_url',
                  image_url: { url: attachmentDataUrl },
                },
              ],
            });
          } else {
            messages.push({ role: 'user', content: resolvedUserPrompt });
          }

          const reqHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          };
          if (provider === 'openrouter' || completionsUrl.includes('openrouter.ai')) {
            reqHeaders['HTTP-Referer'] = 'http://localhost:6301';
            reqHeaders['X-Title'] = 'Flow Builder';
          }

          if (!enableTools) {
            // Standard single-turn execution
            const payload: any = {
              model: modelId,
              messages,
              ...(temperature !== undefined ? { temperature } : {}),
            };

            if (isJsonMode && modelRecord?.capabilities?.supportsJson && provider !== 'lmstudio') {
              payload.response_format = { type: 'json_object' };
            }

            if (reasoningEffort && reasoningEffort !== 'default') {
              payload.reasoning_effort = reasoningEffort;
            }

            if (endpoint.includes('groq.com') || provider === 'groq') {
              payload.reasoning_format = isJsonMode ? 'hidden' : reasoningFormat || 'hidden';
            }

            this.logger.log(
              `   🚀 Dispatching LLM request -> [POST] ${targetUrl} (payload: ${
                JSON.stringify(payload).length
              } bytes, timeout: ${timeoutMs}ms)`,
            );

            const res = await fetch(completionsUrl, {
              method: 'POST',
              headers: reqHeaders,
              body: JSON.stringify(payload),
              signal: abortSignal,
            });

            let json: any;
            try {
              json = await res.json();
            } catch (parseErr: any) {
              if (res.ok) {
                throw new Error(
                  `Failed to parse LLM response JSON (stream may have timed out or aborted): ${parseErr.message}`,
                );
              }
              json = {};
            }
            if (!res.ok) {
              this.logger.error(`   ❌ LLM API returned HTTP ${res.status}: ${JSON.stringify(json)}`);
              throw new Error(`LLM API error (${res.status}): ${json.error?.message || res.statusText}`);
            }

            if (res.ok && (!json.choices || !json.choices.length)) {
              throw new Error(`LLM API returned HTTP 200 but payload has no choices: ${JSON.stringify(json)}`);
            }

            if (json.choices?.[0]?.message?.reasoning) {
              extractedReasoning = json.choices[0].message.reasoning;
            }

            rawResponseContent = json.choices?.[0]?.message?.content || '';
          } else {
            // Autonomous multi-step tool loop for OpenAI-compatible models
            const openAiTools = this.toolRegistry.getOpenAiToolSchemas(allowedTools);
            let stepCount = 0;
            let consecutiveInvalidCalls = 0;

            while (stepCount < maxSteps) {
              stepCount++;
              this.logger.log(
                `   🔄 [OpenAI Tool Loop] Step ${stepCount}/${maxSteps} -> [POST] ${targetUrl}`,
              );

              const payload: any = {
                model: modelId,
                messages,
                tools: openAiTools,
                tool_choice: 'auto',
                ...(temperature !== undefined ? { temperature } : {}),
              };

              if (reasoningEffort && reasoningEffort !== 'default') {
                payload.reasoning_effort = reasoningEffort;
              }

              if (endpoint.includes('groq.com') || provider === 'groq') {
                payload.reasoning_format = isJsonMode ? 'hidden' : reasoningFormat || 'hidden';
              }

              const res = await fetch(completionsUrl, {
                method: 'POST',
                headers: reqHeaders,
                body: JSON.stringify(payload),
                signal: abortSignal,
              });

              let json: any;
              try {
                json = await res.json();
              } catch (parseErr: any) {
                if (res.ok) {
                  throw new Error(`Failed to parse LLM response JSON: ${parseErr.message}`);
                }
                json = {};
              }
              if (!res.ok) {
                this.logger.error(`   ❌ LLM API returned HTTP ${res.status}: ${JSON.stringify(json)}`);
                throw new Error(`LLM API error (${res.status}): ${json.error?.message || res.statusText}`);
              }

              const choice = json.choices?.[0];
              if (!choice) {
                throw new Error(
                  `LLM API returned HTTP 200 but payload has no choices: ${JSON.stringify(json)}`,
                );
              }

              const choiceMessage = choice.message || {};
              if (choiceMessage.reasoning) {
                extractedReasoning = choiceMessage.reasoning;
              }

              const rawToolCalls = choiceMessage.tool_calls;
              const hasToolCalls = Array.isArray(rawToolCalls) && rawToolCalls.length > 0;

              if (!hasToolCalls) {
                rawResponseContent = choiceMessage.content || '';
                break;
              }

              messages.push({
                role: 'assistant',
                content: choiceMessage.content || null,
                tool_calls: rawToolCalls,
              });

              let turnHadInvalidCall = false;
              for (const tc of rawToolCalls) {
                const callId = tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                const toolName = tc.function?.name || '';
                const rawArgs = tc.function?.arguments;

                const validation = this.toolRegistry.validateToolCall(toolName, rawArgs, allowedTools);
                if (!validation.isValid) {
                  turnHadInvalidCall = true;
                  const errorMsg = validation.error || `Tool "${toolName}" is not valid or not authorized.`;
                  toolCallsTrace.push({
                    id: callId,
                    tool: toolName,
                    args: redactSecrets(typeof rawArgs === 'string' ? { raw: rawArgs } : rawArgs || {}),
                    status: 'failed',
                    startedAt: new Date().toISOString(),
                    finishedAt: new Date().toISOString(),
                    durationMs: 0,
                    error: errorMsg,
                  });
                  messages.push({
                    role: 'tool',
                    tool_call_id: callId,
                    content: JSON.stringify({ error: errorMsg }),
                  });
                  continue;
                }

                const toolStartTime = new Date().toISOString();
                const toolExec = await this.toolRegistry.executeTool(
                  toolName,
                  validation.cleanArgs,
                  context,
                );
                const toolEndTime = new Date().toISOString();

                toolCallsTrace.push({
                  id: callId,
                  tool: toolName,
                  args: redactSecrets(validation.cleanArgs),
                  status: toolExec.success ? 'completed' : 'failed',
                  startedAt: toolStartTime,
                  finishedAt: toolEndTime,
                  durationMs: toolExec.durationMs,
                  resultSummary: toolExec.summary,
                  result: redactSecrets(toolExec.result),
                  error: toolExec.error,
                });

                const responsePayload = toolExec.success
                  ? toolExec.result
                  : { error: toolExec.error };

                messages.push({
                  role: 'tool',
                  tool_call_id: callId,
                  content: JSON.stringify(responsePayload),
                });
              }

              if (turnHadInvalidCall) {
                consecutiveInvalidCalls++;
                if (consecutiveInvalidCalls >= 3) {
                  this.logger.warn(
                    `   ⚠️ Repeated invalid tool calls (${consecutiveInvalidCalls}). Halting tool loop.`,
                  );
                  rawResponseContent =
                    choiceMessage.content || 'Execution stopped due to repeated invalid tool calls.';
                  break;
                }
              } else {
                consecutiveInvalidCalls = 0;
              }

              if (stepCount >= maxSteps) {
                this.logger.warn(`   ⚠️ Reached maximum tool steps (${maxSteps}). Halting tool loop.`);
                rawResponseContent =
                  choiceMessage.content ||
                  `Reached maximum step limit of ${maxSteps} tool iterations.`;
                break;
              }
            }
          }

          // If content is empty but model reasoning exists in text mode, fall back to reasoning
          if (!rawResponseContent && extractedReasoning && !isJsonMode) {
            rawResponseContent = extractedReasoning;
          }

          // Sanitize <think>...</think> tags if reasoningFormat is not 'raw'
          if (
            reasoningFormat !== 'raw' &&
            typeof rawResponseContent === 'string' &&
            rawResponseContent.includes('<think>')
          ) {
            const thinkMatch = rawResponseContent.match(/<think>([\s\S]*?)<\/think>/i);
            if (thinkMatch) {
              if (!extractedReasoning) {
                extractedReasoning = thinkMatch[1].trim();
              }
              rawResponseContent = rawResponseContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            }
          }
        }

        this.logger.log(`   🤖 LLM API returned response (${rawResponseContent?.length || 0} chars)`);

        if (isJsonMode && rawResponseContent) {
          try {
            // Strip markdown code fence if present
            let cleaned = rawResponseContent.trim();
            if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
            else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
            if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
            cleaned = cleaned.trim();
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
              cleaned = cleaned.slice(firstBrace, lastBrace + 1);
            }
            agentResult = JSON.parse(cleaned);
          } catch {
            agentResult = { result: rawResponseContent, text: rawResponseContent };
          }
        } else {
          agentResult = {
            text: rawResponseContent,
            result: rawResponseContent,
          };
        }

        if (extractedReasoning) {
          agentResult.reasoning = extractedReasoning;
        }

        if (enableTools) {
          agentResult.toolCalls = toolCallsTrace;
          agentResult.toolTrace = toolCallsTrace;
        }
      } catch (llmErr: any) {
        if (llmErr instanceof BadRequestException) {
          throw llmErr;
        }
        const cause = llmErr.cause;
        const causeCode = cause?.code || llmErr.code || '';
        const causeMsg = cause?.message || (typeof cause === 'string' ? cause : '');
        const causeSyscall = cause?.syscall ? ` (syscall: ${cause.syscall})` : '';
        const causeAddress = cause?.address ? ` (address: ${cause.address}:${cause.port})` : '';

        this.logger.error(`   ❌ LLM call failed [POST ${targetUrl || endpoint}]: ${llmErr.message}`);
        if (cause) {
          this.logger.error(
            `   🔍 Cause Details: ${causeCode ? `[${causeCode}] ` : ''}${causeMsg}${causeSyscall}${causeAddress}`,
          );
        }
        if (cause?.errors && Array.isArray(cause.errors)) {
          cause.errors.forEach((subErr: any, i: number) => {
            this.logger.error(`      Sub-error #${i + 1}: ${subErr.code || subErr.message || subErr}`);
          });
        }

        let diagnosis = '';
        if (causeCode === 'ECONNREFUSED' || causeMsg.includes('ECONNREFUSED')) {
          diagnosis = `Connection refused at ${targetUrl || endpoint}. The model server is not running or not listening on that port.`;
        } else if (
          causeCode === 'ETIMEDOUT' ||
          causeMsg.includes('ETIMEDOUT') ||
          llmErr.name === 'TimeoutError' ||
          llmErr.message?.includes('timeout')
        ) {
          diagnosis = `Connection timed out connecting to ${targetUrl || endpoint}. If LM Studio / Ollama is on a remote LAN machine, ensure 'Serve on Local Network' (0.0.0.0) is enabled and the host firewall allows port ${
            endpoint.split(':').pop()?.replace(/\D/g, '') || '1234'
          }.`;
        } else if (causeCode === 'ENOTFOUND') {
          diagnosis = `Host not found for ${targetUrl || endpoint}. Check the hostname or IP address in model settings.`;
        }

        const enrichedMessage = `LLM call failed [${targetUrl || endpoint}]: ${llmErr.message}${
          causeCode ? ` (${causeCode})` : ''
        }${diagnosis ? ` -> ${diagnosis}` : ''}`;
        const err = new Error(enrichedMessage);
        err.name = llmErr.name;
        (err as any).cause = cause;
        (err as any).code = causeCode || 'LLM_CALL_FAILED';
        throw err;
      }
    }

    if (!agentResult) {
      if (isJsonMode) {
        agentResult = {
          summary: `Agent mock structured output for input [${resolvedUserPrompt.substring(0, 50)}]`,
          status: 'success',
          model: modelId,
          timestamp: new Date().toISOString(),
        };
      } else {
        const textVal = `Agent [${modelId}] processed input: "${resolvedUserPrompt.substring(0, 60)}..."`;
        agentResult = {
          text: textVal,
          result: textVal,
          model: modelId,
          status: 'success',
        };
      }
      if (enableTools) {
        agentResult.toolCalls = toolCallsTrace;
        agentResult.toolTrace = toolCallsTrace;
      }
    }

    if (config.researchOutput === true) {
      const limit = config.evidenceLimit === undefined ? undefined : Number(config.evidenceLimit);
      const validation = validateResearchFindings(agentResult, limit);
      if (!validation.valid) throw new BadRequestException({ code: 'INVALID_RESEARCH_FINDINGS', errors: validation.errors });
    }
    this.logger.log(`   🤖 [Agent Execution Complete] Result keys: ${Object.keys(agentResult).join(', ')}`);
    return {
      ...agentResult,
      result: agentResult.result !== undefined ? agentResult.result : agentResult,
      ...(enableTools ? { toolCalls: toolCallsTrace, toolTrace: toolCallsTrace } : {}),
    };
  }
}
