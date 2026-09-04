import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { VariableResolverService, RuntimeNode } from './variable-resolver.service';
import { ModelsService } from '../../models/models.service';

@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);

  constructor(
    private readonly variableResolver: VariableResolverService,
    private readonly modelsService: ModelsService,
  ) {}

  private isReasoningModel(modelId: string): boolean {
    const lower = (modelId || '').toLowerCase();
    return lower.startsWith('o1') || lower.startsWith('o3') || lower.includes('reasoning');
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
  ): Promise<any> {
    const data = node.data || {};
    const config = data.config || {};
    const modelKey = config.model || 'gpt-4o';

    // Find model config from DB
    const modelRecord = await this.modelsService.findByModelIdOrLabel(modelKey);
    const modelId = modelRecord?.modelId || modelKey;
    const provider = modelRecord?.provider || 'openai';
    const endpoint = modelRecord?.endpoint || 'https://api.openai.com/v1';
    const apiKey = modelRecord?.apiKey || process.env.OPENAI_API_KEY || '';

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
    const reasoningEffort = config.reasoningEffort && config.reasoningEffort !== 'model_default'
      ? config.reasoningEffort
      : (modelRecord?.reasoningEffort || 'default');

    const reasoningFormat = config.reasoningFormat || modelRecord?.reasoningFormat || (isJsonMode ? 'hidden' : 'hidden');

    this.logger.log(`   🤖 [Agent Execution] Model: ${modelId} (${provider}) | Endpoint: ${endpoint}`);
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

    if (apiKey || endpoint.includes('localhost') || endpoint.includes('127.0.0.1')) {
      try {
        if (provider === 'anthropic') {
          // Anthropic Messages API
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

          const anthropicUrl = endpoint.endsWith('/v1') ? `${endpoint}/messages` : `${endpoint}/v1/messages`;
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
          });
          const json = await res.json();
          if (!res.ok) throw new Error(`Anthropic error: ${json.error?.message || res.statusText}`);
          rawResponseContent = json.content?.[0]?.text || '';
        } else {
          // OpenAI & OpenAI-compatible (Groq, Ollama, Gemini OpenAI endpoint, Custom)
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

          const completionsUrl = endpoint.endsWith('/chat/completions')
            ? endpoint
            : endpoint.endsWith('/v1')
            ? `${endpoint}/chat/completions`
            : `${endpoint}/v1/chat/completions`;

          const payload: any = {
            model: modelId,
            messages,
            ...(temperature !== undefined ? { temperature } : {}),
          };

          if (isJsonMode && modelRecord?.capabilities?.supportsJson) {
            payload.response_format = { type: 'json_object' };
          }

          // Groq / OpenAI reasoning_effort
          if (reasoningEffort && reasoningEffort !== 'default') {
            payload.reasoning_effort = reasoningEffort;
          }

          // Groq reasoning_format control
          if (endpoint.includes('groq.com') || provider === 'groq') {
            payload.reasoning_format = isJsonMode ? 'hidden' : (reasoningFormat || 'hidden');
          }

          const res = await fetch(completionsUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify(payload),
          });

          const json = await res.json();
          if (!res.ok) throw new Error(`LLM API error (${res.status}): ${json.error?.message || res.statusText}`);
          
          if (json.choices?.[0]?.message?.reasoning) {
            extractedReasoning = json.choices[0].message.reasoning;
          }

          rawResponseContent = json.choices?.[0]?.message?.content || '';

          // Sanitize <think>...</think> tags if reasoningFormat is not 'raw'
          if (reasoningFormat !== 'raw' && typeof rawResponseContent === 'string' && rawResponseContent.includes('<think>')) {
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
      } catch (llmErr: any) {
        this.logger.error(`   ❌ LLM call failed: ${llmErr.message}`);
        throw llmErr;
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
    }

    this.logger.log(`   🤖 [Agent Execution Complete] Result keys: ${Object.keys(agentResult).join(', ')}`);
    return { ...agentResult, result: agentResult.result !== undefined ? agentResult.result : agentResult };
  }
}
