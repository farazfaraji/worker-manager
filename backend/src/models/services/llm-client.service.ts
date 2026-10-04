import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { resolveCompletionTarget, LlmCompletionTarget } from '../utils/llm-endpoint.util';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  modelId: string;
  provider: string;
  endpoint: string;
  apiKey?: string;
  messages: ChatMessage[];
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  responseFormat?: { type: 'json_object' | 'text' };
  clientLabel?: string;
}

export interface ChatCompletionResult {
  text: string;
  modelId: string;
  provider: string;
  endpoint: string;
  durationMs: number;
}

@Injectable()
export class LlmClientService {
  private readonly logger = new Logger(LlmClientService.name);

  /**
   * Executes a chat completion against any supported provider
   * with standardized payload construction, error translation, and timing.
   */
  async executeChatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const {
      modelId,
      provider,
      endpoint,
      apiKey = '',
      messages,
      systemInstruction,
      temperature = 0.7,
      maxTokens = 4096,
      timeoutMs = 60000,
      clientLabel = 'Flow Builder',
    } = options;

    const target: LlmCompletionTarget = resolveCompletionTarget(provider, endpoint);
    const startTime = Date.now();
    const abortSignal = AbortSignal.timeout(timeoutMs);

    this.logger.debug(
      `Executing LLM completion [${target.provider}/${modelId}] via ${target.url} (timeout=${timeoutMs}ms)`,
    );

    try {
      let outputText = '';

      switch (target.protocol) {
        case 'anthropic':
          outputText = await this.callAnthropic({
            url: target.url,
            modelId,
            apiKey,
            messages,
            systemInstruction,
            temperature,
            maxTokens,
            signal: abortSignal,
          });
          break;

        case 'lmstudio_native':
          outputText = await this.callLmStudioNative({
            url: target.url,
            modelId,
            apiKey,
            messages,
            systemInstruction,
            temperature,
            signal: abortSignal,
          });
          break;

        case 'openai':
        default:
          outputText = await this.callOpenAiCompatible({
            url: target.url,
            provider: target.provider,
            modelId,
            apiKey,
            messages,
            systemInstruction,
            temperature,
            maxTokens,
            clientLabel,
            responseFormat: options.responseFormat,
            signal: abortSignal,
          });
          break;
      }

      const durationMs = Date.now() - startTime;
      return {
        text: outputText,
        modelId,
        provider: target.provider,
        endpoint: target.url,
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      this.handleExecutionError(err, target, modelId, durationMs);
    }
  }

  // ---------------------------------------------------------------------------
  // Protocol Handlers
  // ---------------------------------------------------------------------------

  private async callAnthropic(opts: {
    url: string;
    modelId: string;
    apiKey: string;
    messages: ChatMessage[];
    systemInstruction?: string;
    temperature: number;
    maxTokens: number;
    signal: AbortSignal;
  }): Promise<string> {
    const userAndAssistantMessages = opts.messages.filter((m) => m.role !== 'system');

    const res = await fetch(opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: opts.modelId,
        max_tokens: opts.maxTokens,
        ...(opts.systemInstruction ? { system: opts.systemInstruction } : {}),
        messages: userAndAssistantMessages,
        temperature: opts.temperature,
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      await this.throwParsedHttpError(res, 'Anthropic');
    }

    const json = await res.json();
    return json.content?.[0]?.text || '';
  }

  private async callLmStudioNative(opts: {
    url: string;
    modelId: string;
    apiKey: string;
    messages: ChatMessage[];
    systemInstruction?: string;
    temperature: number;
    signal: AbortSignal;
  }): Promise<string> {
    const lastUserMessage = [...opts.messages].reverse().find((m) => m.role === 'user')?.content || '';

    const res = await fetch(opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: opts.modelId,
        ...(opts.systemInstruction ? { system_prompt: opts.systemInstruction } : {}),
        input: lastUserMessage,
        temperature: opts.temperature,
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      await this.throwParsedHttpError(res, 'LM Studio');
    }

    const json = await res.json();
    if (Array.isArray(json.output)) {
      const msg = json.output.find((p: any) => p.type === 'message');
      return msg?.content || '';
    } else if (typeof json.output === 'string') {
      return json.output;
    }
    return JSON.stringify(json.output || {});
  }

  private async callOpenAiCompatible(opts: {
    url: string;
    provider: string;
    modelId: string;
    apiKey: string;
    messages: ChatMessage[];
    systemInstruction?: string;
    temperature: number;
    maxTokens: number;
    clientLabel: string;
    responseFormat?: { type: 'json_object' | 'text' };
    signal: AbortSignal;
  }): Promise<string> {
    const formattedMessages: ChatMessage[] = [];

    if (opts.systemInstruction) {
      formattedMessages.push({ role: 'system', content: opts.systemInstruction });
    }
    formattedMessages.push(...opts.messages);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
    };

    if (opts.provider === 'openrouter' || opts.url.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'http://localhost:6301';
      headers['X-Title'] = opts.clientLabel;
    }

    const payload: Record<string, any> = {
      model: opts.modelId,
      messages: formattedMessages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
    };

    if (opts.responseFormat) {
      payload.response_format = opts.responseFormat;
    }

    const res = await fetch(opts.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: opts.signal,
    });

    if (!res.ok) {
      await this.throwParsedHttpError(res, opts.provider);
    }

    const json = await res.json();
    return json.choices?.[0]?.message?.content || '';
  }

  // ---------------------------------------------------------------------------
  // Error Handling & Mapping
  // ---------------------------------------------------------------------------

  private async throwParsedHttpError(res: Response, providerName: string): Promise<never> {
    const errBody = await res.json().catch(() => ({}));
    const message =
      errBody?.error?.message ||
      errBody?.message ||
      `${providerName} API returned status ${res.status}: ${res.statusText}`;

    throw new BadRequestException(
      `${providerName} API error (${res.status}): ${message}`,
    );
  }

  private handleExecutionError(
    err: any,
    target: LlmCompletionTarget,
    modelId: string,
    durationMs: number,
  ): never {
    const isTimeout =
      err.name === 'TimeoutError' ||
      err.name === 'AbortError' ||
      err.code === 'ETIMEDOUT' ||
      err.message?.toLowerCase().includes('timeout');

    this.logger.error(
      `LLM completion failed for [${target.provider}/${modelId}] after ${durationMs}ms: ${err.message}`,
    );

    if (isTimeout) {
      throw new BadRequestException(
        `Request to model "${modelId}" at "${target.url}" timed out. The model server may be slow or overloaded.`,
      );
    }

    if (err instanceof BadRequestException) {
      throw err;
    }

    throw new BadRequestException(
      `Failed to communicate with model "${modelId}" (${target.url}): ${err.message}. Please verify the model endpoint is reachable.`,
    );
  }
}
