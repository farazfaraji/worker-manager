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

// ============================================================================
// Constants & Defaults
// ============================================================================

export const DEFAULT_AGENT_MODEL = 'gpt-4o';
export const DEFAULT_AGENT_PROVIDER = 'openai';
export const DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1';
export const DEFAULT_ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1';
export const DEFAULT_LLM_TIMEOUT_MS = 90000;
export const DEFAULT_TEMPERATURE = 0.7;
export const DEFAULT_MAX_STEPS = 5;
export const MAX_AGENT_STEPS = 20;
export const CIRCUIT_BREAKER_INVALID_CALL_LIMIT = 3;

// ============================================================================
// Type Definitions
// ============================================================================

export interface ResolvedModelConfig {
  modelId: string;
  provider: string;
  endpoint: string;
  apiKey: string;
  modelRecord?: any;
}

export interface ResolvedAgentExecutionConfig {
  model: ResolvedModelConfig;
  systemPrompt: string;
  userPrompt: string;
  enableTools: boolean;
  allowedTools: string[];
  maxSteps: number;
  isJsonMode: boolean;
  outputSchema?: string;
  temperature?: number;
  attachmentDataUrl: string | null;
  reasoningEffort: string;
  reasoningFormat: string;
  timeoutMs: number;
}

export interface ModelToolSupportResult {
  supported: boolean;
  reason?: string;
}

export interface LlmExecutionResult {
  rawContent: string | null;
  extractedReasoning?: string;
  toolCallsTrace: AgentToolTraceItem[];
}

// ============================================================================
// Agent Runner Service
// ============================================================================

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

  // --------------------------------------------------------------------------
  // Public Entry Point
  // --------------------------------------------------------------------------

  /**
   * Main entry point to execute an Agent node within a workflow run.
   */
  public async executeAgentNode(
    node: RuntimeNode,
    nodeInput: any,
    context: Record<string, any>,
    runId?: string,
  ): Promise<any> {
    const config = await this.resolveExecutionConfig(node, nodeInput, context);
    this.logExecutionStart(config);

    let executionResult: LlmExecutionResult = {
      rawContent: null,
      toolCallsTrace: [],
    };

    if (config.model.apiKey || this.isLocalOrCustomEndpoint(config.model.provider, config.model.endpoint)) {
      try {
        executionResult = await this.dispatchLlmRequest(config, context);
      } catch (err: any) {
        this.handleAndEnrichLlmError(err, config.model.endpoint);
      }
    }

    // Process output or build mock response
    let agentResult = this.processLlmResponse(executionResult, config);

    // Validate research contract if researchOutput mode is active
    const rawConfig = (node.data || {}).config || {};
    if (rawConfig.researchOutput === true) {
      const limit = rawConfig.evidenceLimit === undefined ? undefined : Number(rawConfig.evidenceLimit);
      const validation = validateResearchFindings(agentResult, limit);
      if (!validation.valid) {
        throw new BadRequestException({
          code: 'INVALID_RESEARCH_FINDINGS',
          errors: validation.errors,
        });
      }
    }

    this.logger.log(`   🤖 [Agent Execution Complete] Result keys: ${Object.keys(agentResult).join(', ')}`);

    return {
      ...agentResult,
      result: agentResult.result !== undefined ? agentResult.result : agentResult,
      ...(config.enableTools ? { toolCalls: executionResult.toolCallsTrace, toolTrace: executionResult.toolCallsTrace } : {}),
    };
  }

  // --------------------------------------------------------------------------
  // Model Capability & Tool Compatibility
  // --------------------------------------------------------------------------

  /**
   * Determine whether a model/provider combination supports structured tool calling.
   */
  public isToolSupportedModel(
    provider: string,
    modelId: string,
    endpoint: string,
  ): ModelToolSupportResult {
    const p = (provider || DEFAULT_AGENT_PROVIDER).toLowerCase();
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

  // --------------------------------------------------------------------------
  // Configuration Resolution Helpers
  // --------------------------------------------------------------------------

  private async resolveExecutionConfig(
    node: RuntimeNode,
    nodeInput: any,
    context: Record<string, any>,
  ): Promise<ResolvedAgentExecutionConfig> {
    const data = node.data || {};
    const config = data.config || {};
    const modelKey = config.model || DEFAULT_AGENT_MODEL;

    // 1. Resolve model record from database
    const modelRecord = await this.modelsService.findByModelIdOrLabel(modelKey);
    const model = this.resolveModelCredentials(modelKey, config, modelRecord);

    // 2. Resolve prompts
    const isJsonMode = config.outputFormat === 'json';
    const outputSchema = config.outputType || config.outputSchema;
    const systemPrompt = this.resolveSystemPrompt(config, context, isJsonMode, outputSchema);
    const userPrompt = this.resolveUserPrompt(config, nodeInput, context);

    // 3. Resolve tools
    const { enableTools, allowedTools, maxSteps } = this.resolveToolConfiguration(
      config,
      model.provider,
      model.modelId,
      model.endpoint,
    );

    // 4. Resolve temperature
    const temperature = this.resolveTemperature(config, model.modelId, modelRecord);

    // 5. Resolve file attachment
    const attachmentDataUrl = this.resolveAttachment(config, context);

    // 6. Resolve reasoning settings
    const reasoningEffort =
      config.reasoningEffort && config.reasoningEffort !== 'model_default'
        ? config.reasoningEffort
        : modelRecord?.reasoningEffort || 'default';

    const reasoningFormat =
      config.reasoningFormat || modelRecord?.reasoningFormat || 'hidden';

    // 7. Resolve timeout
    const timeoutMs = Math.min(
      Number(config.maxTimeoutMs || Infinity),
      Number(process.env.LLM_TIMEOUT_MS || config.timeoutMs || DEFAULT_LLM_TIMEOUT_MS),
    );

    return {
      model,
      systemPrompt,
      userPrompt,
      enableTools,
      allowedTools,
      maxSteps,
      isJsonMode,
      outputSchema,
      temperature,
      attachmentDataUrl,
      reasoningEffort,
      reasoningFormat,
      timeoutMs,
    };
  }

  private resolveModelCredentials(
    modelKey: string,
    config: Record<string, any>,
    modelRecord: any,
  ): ResolvedModelConfig {
    const modelId = modelRecord?.modelId || modelKey;
    const provider = modelRecord?.provider || DEFAULT_AGENT_PROVIDER;
    const endpoint = String(config.endpoint || modelRecord?.endpoint || DEFAULT_OPENAI_ENDPOINT).trim();

    let apiKey =
      modelRecord?.apiKey ||
      (provider === 'openrouter' || endpoint.includes('openrouter.ai')
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

    return { modelId, provider, endpoint, apiKey, modelRecord };
  }

  private resolveSystemPrompt(
    config: Record<string, any>,
    context: Record<string, any>,
    isJsonMode: boolean,
    outputSchema?: string,
  ): string {
    const rawSystemPrompt = config.systemPrompt || 'You are an AI assistant in a LangGraph workflow.';
    let resolved = this.variableResolver.resolveValue(rawSystemPrompt, context) || '';

    if (isJsonMode) {
      resolved += `\n\nCRITICAL REQUIREMENT: You MUST respond ONLY with a valid JSON object matching the requested schema. Do not enclose in codeblocks or add explanations outside the JSON.`;
      if (outputSchema) {
        resolved += `\nExpected Schema:\n${outputSchema}`;
      }
    }
    return resolved;
  }

  private resolveUserPrompt(
    config: Record<string, any>,
    nodeInput: any,
    context: Record<string, any>,
  ): string {
    const rawUserPrompt = config.userPrompt || config.prompt || config.input;
    if (rawUserPrompt !== undefined && rawUserPrompt !== null) {
      const resolved = this.variableResolver.resolveValue(rawUserPrompt, context);
      return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
    }
    if (nodeInput !== undefined && nodeInput !== null) {
      return typeof nodeInput === 'string' ? nodeInput : JSON.stringify(nodeInput);
    }
    return '';
  }

  private resolveToolConfiguration(
    config: Record<string, any>,
    provider: string,
    modelId: string,
    endpoint: string,
  ): { enableTools: boolean; allowedTools: string[]; maxSteps: number } {
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
        if (Array.isArray(parsed)) {
          allowedTools = parsed.map(String).filter(Boolean);
        } else {
          allowedTools = rawTools.split(/[\r\n,]+/).map((s: string) => s.trim()).filter(Boolean);
        }
      } catch {
        allowedTools = rawTools.split(/[\r\n,]+/).map((s: string) => s.trim()).filter(Boolean);
      }
    }

    if (enableTools && allowedTools.length === 0) {
      allowedTools = this.toolRegistry.getRegisteredToolNames();
    }

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

    const maxSteps = Math.min(
      MAX_AGENT_STEPS,
      Math.max(1, Number(config.maxSteps || config.maxToolCalls || DEFAULT_MAX_STEPS)),
    );

    return { enableTools, allowedTools, maxSteps };
  }

  private resolveTemperature(
    config: Record<string, any>,
    modelId: string,
    modelRecord: any,
  ): number | undefined {
    if (this.isReasoningModel(modelId)) {
      return undefined;
    }
    if (config.customTemperature && config.temperature !== undefined) {
      return Number(config.temperature);
    }
    if (modelRecord?.defaultTemperature !== undefined) {
      return modelRecord.defaultTemperature;
    }
    return DEFAULT_TEMPERATURE;
  }

  private resolveAttachment(config: Record<string, any>, context: Record<string, any>): string | null {
    if (!config.enableAttachment || config.attachment === undefined) {
      return null;
    }

    const resolved = this.variableResolver.resolveValue(config.attachment, context);
    if (typeof resolved === 'string' && resolved.trim()) {
      const attStr = resolved.trim();
      if (attStr.startsWith('data:') || attStr.startsWith('http://') || attStr.startsWith('https://')) {
        return attStr;
      }
      const encoded = this.encodeLocalFileToBase64(attStr);
      return encoded ? `data:${encoded.mimeType};base64,${encoded.base64}` : null;
    }
    if (typeof resolved === 'object' && resolved?.path) {
      const encoded = this.encodeLocalFileToBase64(resolved.path);
      return encoded ? `data:${encoded.mimeType};base64,${encoded.base64}` : null;
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // LLM Dispatcher
  // --------------------------------------------------------------------------

  private async dispatchLlmRequest(
    config: ResolvedAgentExecutionConfig,
    context: Record<string, any>,
  ): Promise<LlmExecutionResult> {
    const { provider, endpoint } = config.model;
    const isLmStudioNative = provider === 'lmstudio' && endpoint.includes('/api/v1/chat');

    if (provider === 'anthropic') {
      return this.executeAnthropicFlow(config, context);
    }
    if (isLmStudioNative) {
      return this.executeLmStudioFlow(config);
    }
    return this.executeOpenAiFlow(config, context);
  }

  // --------------------------------------------------------------------------
  // 1. Anthropic Flow
  // --------------------------------------------------------------------------

  private async executeAnthropicFlow(
    config: ResolvedAgentExecutionConfig,
    context: Record<string, any>,
  ): Promise<LlmExecutionResult> {
    const { model, systemPrompt, userPrompt, attachmentDataUrl, timeoutMs } = config;
    const abortSignal = AbortSignal.timeout(timeoutMs);

    const cleanAnthropicEndpoint = model.endpoint.replace(/\/+$/, '');
    const anthropicUrl =
      cleanAnthropicEndpoint === DEFAULT_ANTHROPIC_ENDPOINT
        ? `${DEFAULT_ANTHROPIC_ENDPOINT}/messages`
        : cleanAnthropicEndpoint;

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
          { type: 'text', text: userPrompt },
        ],
      });
    } else {
      messages.push({ role: 'user', content: userPrompt });
    }

    if (!config.enableTools) {
      return this.executeAnthropicSingleTurn(anthropicUrl, messages, config, abortSignal);
    }
    return this.executeAnthropicToolLoop(anthropicUrl, messages, config, context, abortSignal);
  }

  private async executeAnthropicSingleTurn(
    url: string,
    messages: any[],
    config: ResolvedAgentExecutionConfig,
    abortSignal: AbortSignal,
  ): Promise<LlmExecutionResult> {
    this.logger.log(`   🚀 Dispatching Anthropic request -> [POST] ${url}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.model.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model.modelId,
        system: config.systemPrompt,
        messages,
        max_tokens: 4096,
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      }),
      signal: abortSignal,
    });

    const json = await this.safeParseJsonResponse(res, 'Anthropic');
    const rawContent = json.content?.[0]?.text || '';
    return { rawContent, toolCallsTrace: [] };
  }

  private async executeAnthropicToolLoop(
    url: string,
    messages: any[],
    config: ResolvedAgentExecutionConfig,
    context: Record<string, any>,
    abortSignal: AbortSignal,
  ): Promise<LlmExecutionResult> {
    const anthropicTools = this.toolRegistry.getAnthropicToolSchemas(config.allowedTools);
    const toolCallsTrace: AgentToolTraceItem[] = [];
    let stepCount = 0;
    let consecutiveInvalidCalls = 0;
    let rawContent: string | null = null;

    while (stepCount < config.maxSteps) {
      stepCount++;
      this.logger.log(`   🔄 [Anthropic Tool Loop] Step ${stepCount}/${config.maxSteps} -> [POST] ${url}`);

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.model.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.model.modelId,
          system: config.systemPrompt,
          messages,
          tools: anthropicTools,
          max_tokens: 4096,
          ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        }),
        signal: abortSignal,
      });

      const json = await this.safeParseJsonResponse(res, 'Anthropic');
      const contentBlocks = Array.isArray(json.content) ? json.content : [];
      const toolUseBlocks = contentBlocks.filter((b: any) => b.type === 'tool_use');

      if (!toolUseBlocks.length) {
        const textBlocks = contentBlocks.filter((b: any) => b.type === 'text');
        rawContent = textBlocks.map((b: any) => b.text).join('\n');
        break;
      }

      messages.push({ role: 'assistant', content: contentBlocks });

      const toolResultBlocks: any[] = [];
      let turnHadInvalidCall = false;

      for (const block of toolUseBlocks) {
        const callId = block.id;
        const toolName = block.name;
        const rawArgs = block.input;

        const validation = this.toolRegistry.validateToolCall(toolName, rawArgs, config.allowedTools);
        if (!validation.isValid) {
          turnHadInvalidCall = true;
          const errorMsg = validation.error || `Tool "${toolName}" is not valid or not authorized.`;
          toolCallsTrace.push(this.createFailedTraceItem(callId, toolName, rawArgs, errorMsg));
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

      messages.push({ role: 'user', content: toolResultBlocks });

      if (turnHadInvalidCall) {
        consecutiveInvalidCalls++;
        if (consecutiveInvalidCalls >= CIRCUIT_BREAKER_INVALID_CALL_LIMIT) {
          this.logger.warn(`   ⚠️ Repeated invalid tool calls (${consecutiveInvalidCalls}). Halting tool loop.`);
          rawContent = 'Execution stopped due to repeated invalid tool calls.';
          break;
        }
      } else {
        consecutiveInvalidCalls = 0;
      }

      if (stepCount >= config.maxSteps) {
        this.logger.warn(`   ⚠️ Reached maximum tool steps (${config.maxSteps}). Halting tool loop.`);
        const textBlocks = contentBlocks.filter((b: any) => b.type === 'text');
        rawContent =
          textBlocks.map((b: any) => b.text).join('\n') ||
          `Reached maximum step limit of ${config.maxSteps} tool iterations.`;
        break;
      }
    }

    return { rawContent, toolCallsTrace };
  }

  // --------------------------------------------------------------------------
  // 2. LM Studio Native Flow
  // --------------------------------------------------------------------------

  private async executeLmStudioFlow(
    config: ResolvedAgentExecutionConfig,
  ): Promise<LlmExecutionResult> {
    const { model, systemPrompt, userPrompt, attachmentDataUrl, timeoutMs } = config;
    const targetUrl = model.endpoint.trim().replace(/\/+$/, '');
    const abortSignal = AbortSignal.timeout(timeoutMs);

    let inputPayload: any = userPrompt;
    if (attachmentDataUrl) {
      inputPayload = [
        { type: 'text', content: userPrompt },
        { type: 'image', data_url: attachmentDataUrl },
      ];
    }

    const payload: any = {
      model: model.modelId,
      input: inputPayload,
      ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
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
        ...(model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: abortSignal,
    });

    const json = await this.safeParseJsonResponse(res, 'LM Studio');
    let rawContent = '';
    let extractedReasoning: string | undefined;

    if (Array.isArray(json.output)) {
      const msgPart = json.output.find((p: any) => p.type === 'message');
      const reasoningPart = json.output.find((p: any) => p.type === 'reasoning');
      rawContent = msgPart?.content || '';
      if (reasoningPart?.content) {
        extractedReasoning = reasoningPart.content;
      }
    } else if (typeof json.output === 'string') {
      rawContent = json.output;
    } else {
      rawContent = JSON.stringify(json.output || {});
    }

    return { rawContent, extractedReasoning, toolCallsTrace: [] };
  }

  // --------------------------------------------------------------------------
  // 3. OpenAI & OpenAI-Compatible Flow
  // --------------------------------------------------------------------------

  private async executeOpenAiFlow(
    config: ResolvedAgentExecutionConfig,
    context: Record<string, any>,
  ): Promise<LlmExecutionResult> {
    const completionsUrl = this.resolveOpenAiCompletionsUrl(config.model.endpoint);
    const abortSignal = AbortSignal.timeout(config.timeoutMs);

    const messages: any[] = [{ role: 'system', content: config.systemPrompt }];
    if (config.attachmentDataUrl) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: config.userPrompt },
          { type: 'image_url', image_url: { url: config.attachmentDataUrl } },
        ],
      });
    } else {
      messages.push({ role: 'user', content: config.userPrompt });
    }

    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(config.model.apiKey ? { Authorization: `Bearer ${config.model.apiKey}` } : {}),
    };
    if (config.model.provider === 'openrouter' || completionsUrl.includes('openrouter.ai')) {
      reqHeaders['HTTP-Referer'] = 'http://localhost:6301';
      reqHeaders['X-Title'] = 'Flow Builder';
    }

    if (!config.enableTools) {
      return this.executeOpenAiSingleTurn(completionsUrl, messages, reqHeaders, config, abortSignal);
    }
    return this.executeOpenAiToolLoop(completionsUrl, messages, reqHeaders, config, context, abortSignal);
  }

  private async executeOpenAiSingleTurn(
    url: string,
    messages: any[],
    headers: Record<string, string>,
    config: ResolvedAgentExecutionConfig,
    abortSignal: AbortSignal,
  ): Promise<LlmExecutionResult> {
    const payload: any = {
      model: config.model.modelId,
      messages,
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    };

    if (config.isJsonMode && config.model.modelRecord?.capabilities?.supportsJson && config.model.provider !== 'lmstudio') {
      payload.response_format = { type: 'json_object' };
    }

    if (config.reasoningEffort && config.reasoningEffort !== 'default') {
      payload.reasoning_effort = config.reasoningEffort;
    }

    if (url.includes('groq.com') || config.model.provider === 'groq') {
      payload.reasoning_format = config.isJsonMode ? 'hidden' : config.reasoningFormat || 'hidden';
    }

    this.logger.log(
      `   🚀 Dispatching LLM request -> [POST] ${url} (payload: ${
        JSON.stringify(payload).length
      } bytes, timeout: ${config.timeoutMs}ms)`,
    );

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: abortSignal,
    });

    const json = await this.safeParseJsonResponse(res, 'OpenAI');
    if (!json.choices || !json.choices.length) {
      throw new Error(`LLM API returned HTTP 200 but payload has no choices: ${JSON.stringify(json)}`);
    }

    const choice = json.choices[0];
    const rawContent = choice?.message?.content || '';
    const extractedReasoning = choice?.message?.reasoning || undefined;

    return { rawContent, extractedReasoning, toolCallsTrace: [] };
  }

  private async executeOpenAiToolLoop(
    url: string,
    messages: any[],
    headers: Record<string, string>,
    config: ResolvedAgentExecutionConfig,
    context: Record<string, any>,
    abortSignal: AbortSignal,
  ): Promise<LlmExecutionResult> {
    const openAiTools = this.toolRegistry.getOpenAiToolSchemas(config.allowedTools);
    const toolCallsTrace: AgentToolTraceItem[] = [];
    let stepCount = 0;
    let consecutiveInvalidCalls = 0;
    let rawContent: string | null = null;
    let extractedReasoning: string | undefined;

    while (stepCount < config.maxSteps) {
      stepCount++;
      this.logger.log(`   🔄 [OpenAI Tool Loop] Step ${stepCount}/${config.maxSteps} -> [POST] ${url}`);

      const payload: any = {
        model: config.model.modelId,
        messages,
        tools: openAiTools,
        tool_choice: 'auto',
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      };

      if (config.reasoningEffort && config.reasoningEffort !== 'default') {
        payload.reasoning_effort = config.reasoningEffort;
      }

      if (url.includes('groq.com') || config.model.provider === 'groq') {
        payload.reasoning_format = config.isJsonMode ? 'hidden' : config.reasoningFormat || 'hidden';
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: abortSignal,
      });

      const json = await this.safeParseJsonResponse(res, 'OpenAI');
      const choice = json.choices?.[0];
      if (!choice) {
        throw new Error(`LLM API returned HTTP 200 but payload has no choices: ${JSON.stringify(json)}`);
      }

      const choiceMessage = choice.message || {};
      if (choiceMessage.reasoning) {
        extractedReasoning = choiceMessage.reasoning;
      }

      const rawToolCalls = choiceMessage.tool_calls;
      const hasToolCalls = Array.isArray(rawToolCalls) && rawToolCalls.length > 0;

      if (!hasToolCalls) {
        rawContent = choiceMessage.content || '';
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

        const validation = this.toolRegistry.validateToolCall(toolName, rawArgs, config.allowedTools);
        if (!validation.isValid) {
          turnHadInvalidCall = true;
          const errorMsg = validation.error || `Tool "${toolName}" is not valid or not authorized.`;
          toolCallsTrace.push(this.createFailedTraceItem(callId, toolName, rawArgs, errorMsg));
          messages.push({
            role: 'tool',
            tool_call_id: callId,
            content: JSON.stringify({ error: errorMsg }),
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
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: JSON.stringify(responsePayload),
        });
      }

      if (turnHadInvalidCall) {
        consecutiveInvalidCalls++;
        if (consecutiveInvalidCalls >= CIRCUIT_BREAKER_INVALID_CALL_LIMIT) {
          this.logger.warn(`   ⚠️ Repeated invalid tool calls (${consecutiveInvalidCalls}). Halting tool loop.`);
          rawContent = choiceMessage.content || 'Execution stopped due to repeated invalid tool calls.';
          break;
        }
      } else {
        consecutiveInvalidCalls = 0;
      }

      if (stepCount >= config.maxSteps) {
        this.logger.warn(`   ⚠️ Reached maximum tool steps (${config.maxSteps}). Halting tool loop.`);
        rawContent = choiceMessage.content || `Reached maximum step limit of ${config.maxSteps} tool iterations.`;
        break;
      }
    }

    return { rawContent, extractedReasoning, toolCallsTrace };
  }

  // --------------------------------------------------------------------------
  // Output Processing & Sanitization
  // --------------------------------------------------------------------------

  private processLlmResponse(
    executionResult: LlmExecutionResult,
    config: ResolvedAgentExecutionConfig,
  ): any {
    let { rawContent, extractedReasoning } = executionResult;

    // In text mode, if content is empty but model reasoning exists, fall back to reasoning
    if (!rawContent && extractedReasoning && !config.isJsonMode) {
      rawContent = extractedReasoning;
    }

    // Sanitize <think> tags unless format is explicitly raw
    if (config.reasoningFormat !== 'raw' && typeof rawContent === 'string' && rawContent.includes('<think>')) {
      const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/i);
      if (thinkMatch) {
        if (!extractedReasoning) {
          extractedReasoning = thinkMatch[1].trim();
        }
        rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      }
    }

    this.logger.log(`   🤖 LLM API returned response (${rawContent?.length || 0} chars)`);

    let agentResult: any;
    if (config.isJsonMode && rawContent) {
      agentResult = this.parseJsonSafe(rawContent);
    } else if (rawContent !== null && rawContent !== undefined) {
      agentResult = {
        text: rawContent,
        result: rawContent,
      };
    } else {
      // Fallback mock output when no LLM response was produced
      agentResult = this.createFallbackResult(config);
    }

    if (extractedReasoning) {
      agentResult.reasoning = extractedReasoning;
    }

    if (config.enableTools) {
      agentResult.toolCalls = executionResult.toolCallsTrace;
      agentResult.toolTrace = executionResult.toolCallsTrace;
    }

    return agentResult;
  }

  private parseJsonSafe(raw: string): any {
    try {
      let cleaned = raw.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
      else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
      cleaned = cleaned.trim();

      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }
      return JSON.parse(cleaned);
    } catch {
      return { result: raw, text: raw };
    }
  }

  private createFallbackResult(config: ResolvedAgentExecutionConfig): any {
    if (config.isJsonMode) {
      return {
        summary: `Agent mock structured output for input [${config.userPrompt.substring(0, 50)}]`,
        status: 'success',
        model: config.model.modelId,
        timestamp: new Date().toISOString(),
      };
    }
    const textVal = `Agent [${config.model.modelId}] processed input: "${config.userPrompt.substring(0, 60)}..."`;
    return {
      text: textVal,
      result: textVal,
      model: config.model.modelId,
      status: 'success',
    };
  }

  // --------------------------------------------------------------------------
  // Utility & Helper Methods
  // --------------------------------------------------------------------------

  private isReasoningModel(modelId: string): boolean {
    const lower = (modelId || '').toLowerCase();
    return lower.startsWith('o1') || lower.startsWith('o3') || lower.includes('reasoning');
  }

  private isLocalOrCustomEndpoint(provider: string, endpoint: string): boolean {
    return (
      provider === 'lmstudio' ||
      provider === 'ollama' ||
      provider === 'custom' ||
      endpoint.includes('localhost') ||
      endpoint.includes('127.0.0.1') ||
      !endpoint.includes('api.openai.com')
    );
  }

  private resolveOpenAiCompletionsUrl(endpoint: string): string {
    const clean = endpoint.trim().replace(/\/+$/, '');
    if (clean.endsWith('/chat/completions') || clean.endsWith('/completions')) {
      return clean;
    }
    if (clean.endsWith('/chat')) {
      return `${clean}/completions`;
    }
    if (
      clean.endsWith('/v1') ||
      clean.endsWith('/v1beta/openai') ||
      clean.endsWith('/openai/v1')
    ) {
      return `${clean}/chat/completions`;
    }
    if (clean === 'https://api.openai.com') {
      return 'https://api.openai.com/v1/chat/completions';
    }
    return clean;
  }

  private async safeParseJsonResponse(res: Response, providerName: string): Promise<any> {
    let json: any;
    try {
      json = await res.json();
    } catch (parseErr: any) {
      if (res.ok) {
        throw new Error(
          `Failed to parse ${providerName} response JSON (stream may have timed out or aborted): ${parseErr.message}`,
        );
      }
      json = {};
    }
    if (!res.ok) {
      this.logger.error(`   ❌ ${providerName} API returned HTTP ${res.status}: ${JSON.stringify(json)}`);
      throw new Error(`${providerName} error (${res.status}): ${json.error?.message || res.statusText}`);
    }
    return json;
  }

  private createFailedTraceItem(
    callId: string,
    toolName: string,
    rawArgs: any,
    errorMsg: string,
  ): AgentToolTraceItem {
    const now = new Date().toISOString();
    return {
      id: callId,
      tool: toolName,
      args: redactSecrets(typeof rawArgs === 'string' ? { raw: rawArgs } : rawArgs || {}),
      status: 'failed',
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      error: errorMsg,
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

  private logExecutionStart(config: ResolvedAgentExecutionConfig): void {
    const { model, enableTools, allowedTools, maxSteps, reasoningEffort, reasoningFormat, systemPrompt, userPrompt, attachmentDataUrl } = config;
    this.logger.log(`   🤖 [Agent Execution] Model: ${model.modelId} (${model.provider}) | Endpoint: ${model.endpoint}`);
    if (enableTools) {
      this.logger.log(`   🛠️ Autonomous Tool Use: ENABLED | Allowed: [${allowedTools.join(', ')}] | Max Steps: ${maxSteps}`);
    }
    if (reasoningEffort !== 'default') {
      this.logger.log(`   🧠 Reasoning Effort: ${reasoningEffort} | Reasoning Format: ${reasoningFormat}`);
    }
    this.logger.log(`   🤖 System Prompt: "${String(systemPrompt).substring(0, 100)}..."`);
    this.logger.log(`   🤖 User Prompt: "${String(userPrompt).substring(0, 100)}..."`);
    if (attachmentDataUrl) {
      this.logger.log(`   📎 Attachment attached (${attachmentDataUrl.substring(0, 35)}...)`);
    }
  }

  private handleAndEnrichLlmError(llmErr: any, endpoint: string): never {
    if (llmErr instanceof BadRequestException) {
      throw llmErr;
    }

    const cause = llmErr.cause;
    const causeCode = cause?.code || llmErr.code || '';
    const causeMsg = cause?.message || (typeof cause === 'string' ? cause : '');
    const causeSyscall = cause?.syscall ? ` (syscall: ${cause.syscall})` : '';
    const causeAddress = cause?.address ? ` (address: ${cause.address}:${cause.port})` : '';

    this.logger.error(`   ❌ LLM call failed [POST ${endpoint}]: ${llmErr.message}`);
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
      diagnosis = `Connection refused at ${endpoint}. The model server is not running or not listening on that port.`;
    } else if (
      causeCode === 'ETIMEDOUT' ||
      causeMsg.includes('ETIMEDOUT') ||
      llmErr.name === 'TimeoutError' ||
      llmErr.message?.includes('timeout')
    ) {
      diagnosis = `Connection timed out connecting to ${endpoint}. If LM Studio / Ollama is on a remote LAN machine, ensure 'Serve on Local Network' (0.0.0.0) is enabled and the host firewall allows port ${
        endpoint.split(':').pop()?.replace(/\D/g, '') || '1234'
      }.`;
    } else if (causeCode === 'ENOTFOUND') {
      diagnosis = `Host not found for ${endpoint}. Check the hostname or IP address in model settings.`;
    }

    const enrichedMessage = `LLM call failed [${endpoint}]: ${llmErr.message}${
      causeCode ? ` (${causeCode})` : ''
    }${diagnosis ? ` -> ${diagnosis}` : ''}`;

    const err = new Error(enrichedMessage);
    err.name = llmErr.name;
    (err as any).cause = cause;
    (err as any).code = causeCode || 'LLM_CALL_FAILED';
    throw err;
  }
}
