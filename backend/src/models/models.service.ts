import { Injectable, Logger, OnModuleInit, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LLMModel, LLMModelDocument } from './schemas/llm-model.schema';
import { SettingsService } from '../settings/settings.service';
import { RevisePromptDto } from './dto/revise-prompt.dto';
import { GenerateSchemaDto } from './dto/generate-schema.dto';
import { NodeDefinitionsService } from '../node-definitions/node-definitions.service';
import { FlowAssistantChatDto, FlowAssistantResponse } from './dto/flow-assistant.dto';

@Injectable()
export class ModelsService implements OnModuleInit {
  private readonly logger = new Logger(ModelsService.name);

  constructor(
    @InjectModel(LLMModel.name)
    private readonly modelModel: Model<LLMModelDocument>,
    private readonly settingsService: SettingsService,
    @Optional()
    private readonly nodeDefinitionsService?: NodeDefinitionsService,
  ) {}

  async onModuleInit() {
    await this.cleanupDuplicates();
    await this.seedDefaultsIfEmpty();
  }

  async cleanupDuplicates(): Promise<void> {
    try {
      const allDocs = await this.modelModel.find().exec();
      const seen = new Set<string>();
      for (const doc of allDocs) {
        const key = `${doc.modelId}_${doc.provider}`;
        if (seen.has(key)) {
          await this.modelModel.findByIdAndDelete(doc._id).exec();
        } else {
          seen.add(key);
        }
      }
    } catch (err: any) {
      this.logger.warn(`Failed to cleanup duplicate models: ${err.message}`);
    }
  }

  async seedDefaultsIfEmpty(): Promise<void> {
    const defaultModels: Partial<LLMModel>[] = [
      {
        label: 'GPT-4o (Vision & Audio)',
        modelId: 'gpt-4o',
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY || '',
        capabilities: {
          supportsVision: true,
          supportsAudio: true,
          supportsDocuments: true,
          supportsJson: true,
        },
        defaultTemperature: 0.7,
        isDefault: false,
        description: 'Omni flagship model for reasoning, vision, and audio tasks.',
      },
      {
        label: 'GPT-4o Mini (Fast)',
        modelId: 'gpt-4o-mini',
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY || '',
        capabilities: {
          supportsVision: true,
          supportsAudio: false,
          supportsDocuments: true,
          supportsJson: true,
        },
        defaultTemperature: 0.7,
        isDefault: false,
        description: 'Affordable, fast, lightweight model for general tasks.',
      },
      {
        label: 'o1-mini (Reasoning)',
        modelId: 'o1-mini',
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY || '',
        capabilities: {
          supportsVision: false,
          supportsAudio: false,
          supportsDocuments: false,
          supportsJson: true,
        },
        defaultTemperature: 1.0,
        isDefault: false,
        description: 'Deep reasoning model for math, coding, and complex logic.',
      },
      {
        label: 'Claude 3.5 Sonnet',
        modelId: 'claude-3-5-sonnet-20241022',
        provider: 'anthropic',
        endpoint: 'https://api.anthropic.com/v1',
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        capabilities: {
          supportsVision: true,
          supportsAudio: false,
          supportsDocuments: true,
          supportsJson: true,
        },
        defaultTemperature: 0.7,
        isDefault: false,
        description: 'Anthropic state-of-the-art model with exceptional coding and vision.',
      },
      {
        label: 'Local Ollama (Llama 3.2)',
        modelId: 'llama3.2',
        provider: 'ollama',
        endpoint: 'http://localhost:11434/v1',
        apiKey: '',
        capabilities: {
          supportsVision: false,
          supportsAudio: false,
          supportsDocuments: false,
          supportsJson: true,
        },
        defaultTemperature: 0.7,
        isDefault: false,
        description: 'Locally hosted model via Ollama.',
      },
      {
        label: 'Qwen3.8 27B (LM Studio)',
        modelId: 'qwen3.8-27b',
        provider: 'lmstudio',
        endpoint: 'http://192.168.178.71:1234/api/v1/chat',
        apiKey: '',
        capabilities: {
          supportsVision: true,
          supportsAudio: false,
          supportsDocuments: true,
          supportsJson: true,
        },
        defaultTemperature: 0.7,
        isDefault: false,
        description: 'Qwen3.8 27B (MLX 4-bit) local model hosted on LM Studio.',
      },
    ];

    for (const dm of defaultModels) {
      const exists = await this.modelModel.findOne({ modelId: dm.modelId, provider: dm.provider }).exec();
      if (!exists) {
        await this.modelModel.create(dm);
      }
    }
  }

  async findAll(): Promise<LLMModelDocument[]> {
    return this.modelModel.find().sort({ isDefault: -1, createdAt: 1 }).exec();
  }

  async findById(id: string): Promise<LLMModelDocument> {
    const doc = await this.modelModel.findById(id).exec();
    if (!doc) {
      throw new NotFoundException(`Model with ID ${id} not found`);
    }
    return doc;
  }

  async findByModelIdOrLabel(identifier: string): Promise<LLMModelDocument | null> {
    if (!identifier) return null;
    return this.modelModel
      .findOne({
        $or: [{ modelId: identifier }, { label: identifier }, { _id: identifier.match(/^[0-9a-fA-F]{24}$/) ? identifier : null }],
      })
      .exec();
  }

  async create(data: Partial<LLMModel>): Promise<LLMModelDocument> {
    if (data.isDefault) {
      await this.modelModel.updateMany({}, { isDefault: false });
    }
    const created = new this.modelModel(data);
    return created.save();
  }

  async update(id: string, data: Partial<LLMModel>): Promise<LLMModelDocument> {
    if (data.isDefault) {
      await this.modelModel.updateMany({ _id: { $ne: id } }, { isDefault: false });
    }
    const updated = await this.modelModel.findByIdAndUpdate(id, { $set: data }, { new: true }).exec();
    if (!updated) {
      throw new NotFoundException(`Model with ID ${id} not found`);
    }
    return updated;
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const res = await this.modelModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException(`Model with ID ${id} not found`);
    }
    return { success: true, message: `Model ${id} deleted successfully` };
  }

  async revisePrompt(dto: RevisePromptDto): Promise<{
    revisedPrompt: string;
    model: string;
    modelId: string;
    provider: string;
  }> {
    // 1. Resolve which model to use
    let modelRecord: LLMModelDocument | null = null;

    if (dto.modelId) {
      modelRecord = await this.findByModelIdOrLabel(dto.modelId);
    }

    if (!modelRecord) {
      try {
        const settings = await this.settingsService.getSettings(dto.projectId);
        if (settings?.flowHelperModel) {
          modelRecord = await this.findByModelIdOrLabel(settings.flowHelperModel);
        }
      } catch (err: any) {
        this.logger.warn(`Failed to fetch settings for flowHelperModel: ${err.message}`);
      }
    }

    if (!modelRecord) {
      modelRecord = await this.modelModel.findOne({ isDefault: true }).exec();
    }
    if (!modelRecord) {
      const all = await this.findAll();
      modelRecord = all[0] || null;
    }

    const modelId = modelRecord?.modelId || 'gpt-4o';
    const provider = modelRecord?.provider || 'openai';
    const rawEndpoint = String(modelRecord?.endpoint || 'https://api.openai.com/v1').trim();

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

    const isLocal =
      provider === 'lmstudio' ||
      provider === 'ollama' ||
      rawEndpoint.includes('localhost') ||
      rawEndpoint.includes('127.0.0.1');

    if (!isLocal && !apiKey) {
      throw new BadRequestException(
        `API key is missing for model "${modelRecord?.label || modelId}" (${provider}). Please configure it in Settings -> Models.`,
      );
    }

    const systemInstruction = `You are an expert AI prompt engineer specializing in crafting optimal system prompts for AI agents in automated workflows and LangGraph graphs.

Your mission is to revise, structure, and elevate the provided System Prompt so the AI agent achieves maximum precision, reliability, and instruction following.

Key Guidelines:
1. Structure & Clarity: Organize the prompt with a clear persona/role definition, primary objectives, operational guidelines, constraints, and error-handling steps.
2. Variables & Templates: Preserve all mustache template variables (such as {{variable.property}} or {{trigger.input}}) exactly as intended without modifying variable names.
3. Actionable & Direct: Write in imperative, unambiguous instructions. Avoid fluff or redundant conversational filler.
4. Output Formatting: If the prompt specifies or hints at an output format (JSON, markdown, text schema), ensure formatting expectations are razor-sharp.
5. User Customization: If specific revision goals or user instructions are provided, follow them closely.

OUTPUT FORMAT:
Output ONLY the revised system prompt text directly. Do not include markdown code block ticks (\`\`\`) surrounding the prompt, introductory greetings ("Here is your revised prompt:"), or closing remarks. Return the exact system prompt content ready to paste into the agent's configuration.`;

    const userContent = `${
      dto.instruction && dto.instruction.trim()
        ? `User's Revision Goal / Specific Instructions:\n${dto.instruction.trim()}\n\n`
        : ''
    }Original System Prompt to Revise:\n"""\n${
      dto.prompt?.trim()
        ? dto.prompt.trim()
        : '(Currently empty. Please draft a complete, production-ready system prompt for a general-purpose AI agent in a workflow.)'
    }\n"""`;

    let revisedPrompt = '';
    const abortSignal = AbortSignal.timeout(60000);

    try {
      if (provider === 'anthropic') {
        let completionsUrl = rawEndpoint.replace(/\/+$/, '');
        if (completionsUrl.endsWith('/v1/messages')) {
          // already full URL
        } else if (completionsUrl.endsWith('/v1')) {
          completionsUrl = `${completionsUrl}/messages`;
        } else {
          completionsUrl = `${completionsUrl}/v1/messages`;
        }

        const res = await fetch(completionsUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: modelId,
            max_tokens: 4096,
            system: systemInstruction,
            messages: [{ role: 'user', content: userContent }],
            temperature: 0.7,
          }),
          signal: abortSignal,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody?.error?.message || `Anthropic API error (${res.status}): ${res.statusText}`);
        }

        const json = await res.json();
        revisedPrompt = json.content?.[0]?.text || '';
      } else if (provider === 'lmstudio' && rawEndpoint.includes('/api/v1/chat')) {
        const res = await fetch(rawEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: modelId,
            system_prompt: systemInstruction,
            input: userContent,
            temperature: 0.7,
          }),
          signal: abortSignal,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody?.error?.message || `LM Studio error (${res.status}): ${res.statusText}`);
        }

        const json = await res.json();
        if (Array.isArray(json.output)) {
          const msg = json.output.find((p: any) => p.type === 'message');
          revisedPrompt = msg?.content || '';
        } else if (typeof json.output === 'string') {
          revisedPrompt = json.output;
        } else {
          revisedPrompt = JSON.stringify(json.output || {});
        }
      } else {
        // OpenAI & OpenAI-compatible
        const cleanEndpoint = rawEndpoint.replace(/\/+$/, '');
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

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        };
        if (provider === 'openrouter' || completionsUrl.includes('openrouter.ai')) {
          headers['HTTP-Referer'] = 'http://localhost:6301';
          headers['X-Title'] = 'Flow Builder - Prompt Reviser';
        }

        const res = await fetch(completionsUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: modelId,
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: userContent },
            ],
            temperature: 0.7,
          }),
          signal: abortSignal,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody?.error?.message || `LLM API error (${res.status}): ${res.statusText}`);
        }

        const json = await res.json();
        revisedPrompt = json.choices?.[0]?.message?.content || '';
      }
    } catch (err: any) {
      this.logger.error(`Prompt revision failed with model ${modelId} (${provider}): ${err.message}`);
      throw new BadRequestException(
        `Failed to revise prompt with model "${modelRecord?.label || modelId}" (${rawEndpoint}): ${err.message}. Please verify the model server is online or select another model in Settings.`,
      );
    }

    // Clean up any surrounding markdown code block if model wrapped it
    revisedPrompt = revisedPrompt.trim();
    if (revisedPrompt.startsWith('```') && revisedPrompt.endsWith('```')) {
      const firstLineBreak = revisedPrompt.indexOf('\n');
      if (firstLineBreak !== -1) {
        revisedPrompt = revisedPrompt.slice(firstLineBreak + 1, -3).trim();
      }
    }

    return {
      revisedPrompt,
      model: modelRecord?.label || modelId,
      modelId,
      provider,
    };
  }

  async generateSchema(dto: GenerateSchemaDto): Promise<{
    schema: string;
    model: string;
    modelId: string;
    provider: string;
  }> {
    // 1. Resolve which model to use (typeGeneratorModel or flowHelperModel or override)
    let modelRecord: LLMModelDocument | null = null;
    let strictMode = true;

    try {
      const settings = await this.settingsService.getSettings(dto.projectId);
      if (settings?.typeGeneratorStrictMode !== undefined) {
        strictMode = settings.typeGeneratorStrictMode;
      }
      if (dto.strictMode !== undefined) {
        strictMode = dto.strictMode;
      }
      if (!dto.modelId && settings?.typeGeneratorModel) {
        modelRecord = await this.findByModelIdOrLabel(settings.typeGeneratorModel);
      }
      if (!modelRecord && !dto.modelId && settings?.flowHelperModel) {
        modelRecord = await this.findByModelIdOrLabel(settings.flowHelperModel);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to fetch settings for type generator: ${err.message}`);
    }

    if (dto.modelId) {
      modelRecord = await this.findByModelIdOrLabel(dto.modelId);
    }

    if (!modelRecord) {
      modelRecord = await this.modelModel.findOne({ isDefault: true }).exec();
    }
    if (!modelRecord) {
      const all = await this.findAll();
      modelRecord = all[0] || null;
    }

    const modelId = modelRecord?.modelId || 'gpt-4o';
    const provider = modelRecord?.provider || 'openai';
    const rawEndpoint = String(modelRecord?.endpoint || 'https://api.openai.com/v1').trim();

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

    const isLocal =
      provider === 'lmstudio' ||
      provider === 'ollama' ||
      rawEndpoint.includes('localhost') ||
      rawEndpoint.includes('127.0.0.1');

    if (!isLocal && !apiKey) {
      throw new BadRequestException(
        `API key is missing for model "${modelRecord?.label || modelId}" (${provider}). Please configure it in Settings -> Models.`,
      );
    }

    const schemaType = dto.schemaType || 'zod';

    const systemInstruction = `You are an expert TypeScript and Zod schema engineer.
Your task is to synthesize a valid Zod schema definition based on the user's natural language description of their desired output.

Requirements:
1. Syntax: Produce a valid Zod object schema expression starting with z.object({ ... }).
2. Use standard Zod constructs: z.string(), z.number(), z.boolean(), z.array(...), z.object({...}), z.enum([...]), .optional(), .min(...), .max(...).
3. Add informative .describe("...") annotations to fields to explain their purpose for downstream autocomplete.
4. Clean Output:
   - Output ONLY the raw Zod schema expression starting with z.object({ ... }).
   - Do NOT include markdown code blocks or triple backticks (\`\`\`).
   - Do NOT include variable declarations like 'const schema = ...;' or 'export ...'.
   - Do NOT include 'import { z } from "zod";'.
5. If strict mode is enabled, add .strict() to the top-level z.object({ ... }).`;

    const userContent = `Desired Output Description:
"""
${dto.description.trim()}
"""

Configuration:
- Target Schema: ${schemaType === 'zod' ? 'Zod Schema (z.object({ ... }))' : 'TypeScript Structure'}
- Strict Mode: ${strictMode ? 'Enabled (use .strict())' : 'Disabled'}`;

    let schemaResult = '';
    const abortSignal = AbortSignal.timeout(60000);

    try {
      if (provider === 'anthropic') {
        let completionsUrl = rawEndpoint.replace(/\/+$/, '');
        if (completionsUrl.endsWith('/v1/messages')) {
          // already full URL
        } else if (completionsUrl.endsWith('/v1')) {
          completionsUrl = `${completionsUrl}/messages`;
        } else {
          completionsUrl = `${completionsUrl}/v1/messages`;
        }

        const res = await fetch(completionsUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: modelId,
            max_tokens: 4096,
            system: systemInstruction,
            messages: [{ role: 'user', content: userContent }],
            temperature: 0.2,
          }),
          signal: abortSignal,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody?.error?.message || `Anthropic API error (${res.status}): ${res.statusText}`);
        }

        const json = await res.json();
        schemaResult = json.content?.[0]?.text || '';
      } else if (provider === 'lmstudio' && rawEndpoint.includes('/api/v1/chat')) {
        const res = await fetch(rawEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: modelId,
            system_prompt: systemInstruction,
            input: userContent,
            temperature: 0.2,
          }),
          signal: abortSignal,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody?.error?.message || `LM Studio error (${res.status}): ${res.statusText}`);
        }

        const json = await res.json();
        if (Array.isArray(json.output)) {
          const msg = json.output.find((p: any) => p.type === 'message');
          schemaResult = msg?.content || '';
        } else if (typeof json.output === 'string') {
          schemaResult = json.output;
        } else {
          schemaResult = JSON.stringify(json.output || {});
        }
      } else {
        // OpenAI & OpenAI-compatible
        const cleanEndpoint = rawEndpoint.replace(/\/+$/, '');
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

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        };
        if (provider === 'openrouter' || completionsUrl.includes('openrouter.ai')) {
          headers['HTTP-Referer'] = 'http://localhost:6301';
          headers['X-Title'] = 'Flow Builder - Schema Generator';
        }

        const res = await fetch(completionsUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: modelId,
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: userContent },
            ],
            temperature: 0.2,
          }),
          signal: abortSignal,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody?.error?.message || `LLM API error (${res.status}): ${res.statusText}`);
        }

        const json = await res.json();
        schemaResult = json.choices?.[0]?.message?.content || '';
      }
    } catch (err: any) {
      this.logger.error(`Schema generation failed with model ${modelId} (${provider}): ${err.message}`);
      throw new BadRequestException(
        `Failed to generate schema with model "${modelRecord?.label || modelId}" (${rawEndpoint}): ${err.message}. Please verify the model server is online or select another model in Settings.`,
      );
    }

    // Clean up code blocks if model wrapped output in ```typescript or ```
    schemaResult = schemaResult.trim();
    if (schemaResult.startsWith('```') && schemaResult.endsWith('```')) {
      const firstLineBreak = schemaResult.indexOf('\n');
      if (firstLineBreak !== -1) {
        schemaResult = schemaResult.slice(firstLineBreak + 1, -3).trim();
      }
    }

    // Remove any trailing semicolons or prefix const declarations if generated
    if (schemaResult.startsWith('const ') || schemaResult.startsWith('export const ')) {
      const eqIdx = schemaResult.indexOf('=');
      if (eqIdx !== -1) {
        schemaResult = schemaResult.slice(eqIdx + 1).trim();
      }
    }
    if (schemaResult.endsWith(';')) {
      schemaResult = schemaResult.slice(0, -1).trim();
    }

    return {
      schema: schemaResult,
      model: modelRecord?.label || modelId,
      modelId,
      provider,
    };
  }

  async executeFlowAssistant(dto: FlowAssistantChatDto): Promise<FlowAssistantResponse> {
    // 1. Resolve which model to use
    let modelRecord: LLMModelDocument | null = null;

    if (dto.modelId) {
      modelRecord = await this.findByModelIdOrLabel(dto.modelId);
    }

    if (!modelRecord) {
      try {
        const settings = await this.settingsService.getSettings(dto.projectId);
        if (settings?.flowAssistantModel) {
          modelRecord = await this.findByModelIdOrLabel(settings.flowAssistantModel);
        } else if (settings?.flowHelperModel) {
          modelRecord = await this.findByModelIdOrLabel(settings.flowHelperModel);
        }
      } catch (err: any) {
        this.logger.warn(`Failed to fetch settings for flowAssistantModel: ${err.message}`);
      }
    }

    if (!modelRecord) {
      modelRecord = await this.modelModel.findOne({ isDefault: true }).exec();
    }
    if (!modelRecord) {
      const all = await this.findAll();
      modelRecord = all[0] || null;
    }

    const modelId = modelRecord?.modelId || 'gpt-4o';
    const provider = modelRecord?.provider || 'openai';
    const rawEndpoint = String(modelRecord?.endpoint || 'https://api.openai.com/v1').trim();

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

    const isLocal =
      provider === 'lmstudio' ||
      provider === 'ollama' ||
      rawEndpoint.includes('localhost') ||
      rawEndpoint.includes('127.0.0.1');

    if (!isLocal && !apiKey) {
      throw new BadRequestException(
        `API key is missing for model "${modelRecord?.label || modelId}" (${provider}). Please configure it in Settings -> Models.`,
      );
    }

    // 2. Fetch tool definitions catalog
    let availableToolsSummary = '';
    try {
      if (this.nodeDefinitionsService) {
        const definitions = await this.nodeDefinitionsService.getAllDefinitions();
        const compactCatalog = definitions.map((d) => ({
          kind: d.type,
          name: d.name,
          description: d.description,
          outputs: d.outputs?.map((o) => o.name) || ['done'],
          inputs: d.inputs?.map((i) => i.name) || [],
        }));
        availableToolsSummary = JSON.stringify(compactCatalog, null, 2);
      }
    } catch (e: any) {
      this.logger.warn(`Could not load tool definitions: ${e.message}`);
    }

    // 3. System Prompt
    const systemInstruction = `You are an expert AI Flow Architect specializing in the LangGraph Flow Builder.
You help users build, modify, extend, and optimize automated agent workflows.

AVAILABLE BLOCK KINDS & CAPABILITIES:
${availableToolsSummary || `Available block kinds include: trigger, agent, condition, web-search, telegram, transform, set-variable, foreach, loop, human-gate, http-response, output, repo-inspect, script.`}

GRAPH SCHEMA SPECIFICATION:
A workflow graph is composed of blocks and connections:
- "blocks": Array of objects:
  {
    "id": "unique_string_id (e.g. trigger_1, search_1, agent_1, condition_1, notify_1)",
    "kind": "must match an available block kind (e.g. 'trigger', 'web-search', 'agent', 'condition', 'telegram', 'transform')",
    "name": "Human-readable node title",
    "label": "Display label",
    "config": {
      // Configuration parameters specific to the block kind.
      // For agent: { "prompt": "...", "model": "gpt-4o", "temperature": 0.7 }
      // For web-search: { "query": "..." }
      // For telegram: { "chatId": "...", "message": "..." }
      // For condition: { "mode": "comparison", "leftValue": "{{...}}", "operator": "equals", "rightValue": "..." }
    }
  }
- "connections": Array of objects connecting blocks:
  {
    "id": "conn_from_to",
    "from": "source_block_id",
    "to": "target_block_id",
    "output": "source_output_port (usually 'done'; for 'condition', it is 'true' or 'false')",
    "input": "in"
  }

VARIABLE REFERENCE SYNTAX:
Downstream blocks can reference data from upstream blocks using mustache syntax: {{blockId.property}}.
For example:
- {{search_1.results}}
- {{agent_1.output}}
- {{trigger.input}}

OPERATIONAL RULES:
1. When asked to create a flow or modify the current flow, output a complete, valid set of blocks and connections.
2. Wire connections logically from trigger/start nodes to downstream processing and output blocks.
3. For condition blocks, ensure you connect both the 'true' and 'false' outputs if appropriate.
4. Keep block IDs concise, readable, and unique (e.g., trigger_1, search_1, agent_1, filter_1).
5. If the user asks a general question about their flow without requesting changes, you may return the existing blocks and connections unchanged.
6. Always return a concise, friendly Markdown reply and a bulleted list of flowChanges.

MANDATORY OUTPUT FORMAT:
You must reply with ONLY a single, valid JSON object matching this structure:
{
  "reply": "Clear explanation of what was created or changed (markdown allowed)",
  "flowChanges": ["Bullet point 1 of what was added/updated", "Bullet point 2..."],
  "graph": {
    "blocks": [ ... ],
    "connections": [ ... ]
  }
}
Do NOT include preamble, markdown fences (\`\`\`json), or trailing text outside the JSON object.`;

    // 4. Build Conversation Messages
    const currentGraph: { blocks: any[]; connections: any[] } = {
      blocks: Array.isArray(dto.currentGraph?.blocks) ? dto.currentGraph.blocks : [],
      connections: Array.isArray(dto.currentGraph?.connections) ? dto.currentGraph.connections : [],
    };
    const currentGraphJson = JSON.stringify(currentGraph, null, 2);

    const userMessageContent = `Current Flow Graph State:
\`\`\`json
${currentGraphJson}
\`\`\`

User Request:
${dto.message}`;

    const conversationHistory = (dto.history || []).map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    }));

    let rawOutput = '';
    const abortSignal = AbortSignal.timeout(90000);

    try {
      if (provider === 'anthropic') {
        let completionsUrl = rawEndpoint.replace(/\/+$/, '');
        if (completionsUrl.endsWith('/v1/messages')) {
          // ok
        } else if (completionsUrl.endsWith('/v1')) {
          completionsUrl = `${completionsUrl}/messages`;
        } else {
          completionsUrl = `${completionsUrl}/v1/messages`;
        }

        const messages = [
          ...conversationHistory,
          { role: 'user', content: userMessageContent },
        ];

        const res = await fetch(completionsUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: modelId,
            max_tokens: 4096,
            system: systemInstruction,
            messages,
            temperature: 0.2,
          }),
          signal: abortSignal,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody?.error?.message || `Anthropic API error (${res.status}): ${res.statusText}`);
        }

        const json = await res.json();
        rawOutput = json.content?.[0]?.text || '';
      } else if (provider === 'lmstudio' && rawEndpoint.includes('/api/v1/chat')) {
        const res = await fetch(rawEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: modelId,
            system_prompt: systemInstruction,
            input: userMessageContent,
            temperature: 0.2,
          }),
          signal: abortSignal,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody?.error?.message || `LM Studio error (${res.status}): ${res.statusText}`);
        }

        const json = await res.json();
        if (Array.isArray(json.output)) {
          const msg = json.output.find((p: any) => p.type === 'message');
          rawOutput = msg?.content || '';
        } else if (typeof json.output === 'string') {
          rawOutput = json.output;
        } else {
          rawOutput = JSON.stringify(json.output || {});
        }
      } else {
        // OpenAI / OpenRouter / Ollama
        const cleanEndpoint = rawEndpoint.replace(/\/+$/, '');
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

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        };
        if (provider === 'openrouter' || completionsUrl.includes('openrouter.ai')) {
          headers['HTTP-Referer'] = 'http://localhost:6301';
          headers['X-Title'] = 'Flow Builder - Flow Assistant';
        }

        const messages = [
          { role: 'system', content: systemInstruction },
          ...conversationHistory,
          { role: 'user', content: userMessageContent },
        ];

        const res = await fetch(completionsUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: modelId,
            messages,
            temperature: 0.2,
          }),
          signal: abortSignal,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody?.error?.message || `LLM API error (${res.status}): ${res.statusText}`);
        }

        const json = await res.json();
        rawOutput = json.choices?.[0]?.message?.content || '';
      }
    } catch (err: any) {
      this.logger.error(`Flow Assistant chat failed with model ${modelId} (${provider}): ${err.message}`);
      throw new BadRequestException(
        `Flow Assistant call failed with model "${modelRecord?.label || modelId}": ${err.message}. Please verify the model server is online or select another model in Settings.`,
      );
    }

    // 5. Parse JSON
    let parsed: any = null;
    let cleaned = rawOutput.trim();

    if (cleaned.startsWith('```')) {
      const firstLineBreak = cleaned.indexOf('\n');
      const lastFence = cleaned.lastIndexOf('```');
      if (firstLineBreak !== -1 && lastFence > firstLineBreak) {
        cleaned = cleaned.slice(firstLineBreak + 1, lastFence).trim();
      }
    }

    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const startIdx = cleaned.indexOf('{');
      const endIdx = cleaned.lastIndexOf('}');
      if (startIdx !== -1 && endIdx > startIdx) {
        try {
          parsed = JSON.parse(cleaned.slice(startIdx, endIdx + 1));
        } catch {
          parsed = null;
        }
      }
    }

    if (!parsed) {
      return {
        reply: rawOutput || 'I was unable to structure the response properly. Please try asking again.',
        flowChanges: [],
        graph: currentGraph,
        modelUsed: modelRecord?.label || modelId,
        provider,
      };
    }

    // Normalize returned graph blocks and connections
    let finalGraph = currentGraph;
    if (parsed.graph && Array.isArray(parsed.graph.blocks)) {
      finalGraph = {
        blocks: parsed.graph.blocks.map((b: any, idx: number) => ({
          id: b.id || `node_${Date.now()}_${idx}`,
          kind: b.kind || 'agent',
          name: b.name || b.id || `Node ${idx + 1}`,
          label: b.label || b.name || b.id || `Node ${idx + 1}`,
          config: b.config || {},
        })),
        connections: Array.isArray(parsed.graph.connections)
          ? parsed.graph.connections.map((c: any, idx: number) => ({
              id: c.id || `conn_${c.from}_${c.to}_${idx}`,
              from: c.from,
              to: c.to,
              output: c.output || 'done',
              input: c.input || 'in',
              data: c.data || {},
            }))
          : [],
      };
    }

    return {
      reply: parsed.reply || 'Workflow updated successfully.',
      flowChanges: Array.isArray(parsed.flowChanges) ? parsed.flowChanges : [],
      graph: finalGraph,
      modelUsed: modelRecord?.label || modelId,
      provider,
    };
  }
}

