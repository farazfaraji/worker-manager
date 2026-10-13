import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LLMModel, LLMModelDocument } from './schemas/llm-model.schema';
import { SettingsService } from '../settings/settings.service';
import { NodeDefinitionsService } from '../node-definitions/node-definitions.service';
import { RevisePromptDto } from './dto/revise-prompt.dto';
import { GenerateSchemaDto } from './dto/generate-schema.dto';
import { FlowAssistantChatDto, FlowAssistantResponse } from './dto/flow-assistant.dto';
import { LlmClientService } from './services/llm-client.service';
import {
  PromptReviserService,
  PromptRevisionResponse,
} from './services/prompt-reviser.service';
import {
  SchemaGeneratorService,
  SchemaGeneratorResponse,
} from './services/schema-generator.service';
import { FlowAssistantService } from './services/flow-assistant.service';
import { validateEndpointUrl, isMaskedKey, maskApiKey } from './utils/llm-endpoint.util';
import { GenerateEvaluationCriteriaDto } from './dto/generate-evaluation-criteria.dto';
import { CliLlmService, isCliProvider } from './cli-llm.service';
import { postLlmJson } from '../runs/services/llm-http.util';

export interface ResolvedModelContext {
  modelId: string;
  provider: string;
  endpoint: string;
  apiKey: string;
  label: string;
  document: LLMModelDocument | null;
}

@Injectable()
export class ModelsService implements OnModuleInit {
  private readonly logger = new Logger(ModelsService.name);
  private readonly promptReviser: PromptReviserService;
  private readonly schemaGenerator: SchemaGeneratorService;
  private readonly flowAssistant: FlowAssistantService;
  private readonly cliLlm: CliLlmService;

  constructor(
    @InjectModel(LLMModel.name)
    private readonly modelModel: Model<LLMModelDocument>,
    private readonly settingsService: SettingsService,
    @Optional()
    promptReviser?: PromptReviserService,
    @Optional()
    schemaGenerator?: SchemaGeneratorService,
    @Optional()
    flowAssistant?: FlowAssistantService,
    @Optional()
    private readonly nodeDefinitionsService?: NodeDefinitionsService,
    @Optional()
    cliLlm?: CliLlmService,
  ) {
    const defaultLlmClient = new LlmClientService();
    this.promptReviser = promptReviser || new PromptReviserService(defaultLlmClient);
    this.schemaGenerator = schemaGenerator || new SchemaGeneratorService(defaultLlmClient);
    this.flowAssistant =
      flowAssistant || new FlowAssistantService(defaultLlmClient, this.nodeDefinitionsService);
    this.cliLlm = cliLlm || new CliLlmService();
  }

  async onModuleInit(): Promise<void> {
    await this.seedDefaultsAtomic();
  }

  // ---------------------------------------------------------------------------
  // Database Seeding & Initialization
  // ---------------------------------------------------------------------------

  /**
   * Concurrency-safe atomic seeding using bulkWrite with upsert.
   * Ensures idempotency across multi-replica or clustered deployments.
   */
  async seedDefaultsAtomic(): Promise<void> {
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
        isDefault: true,
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
        label: 'LM Studio (Local Host)',
        modelId: 'local-model',
        provider: 'lmstudio',
        endpoint: 'http://localhost:1234/v1',
        apiKey: '',
        capabilities: {
          supportsVision: true,
          supportsAudio: false,
          supportsDocuments: true,
          supportsJson: true,
        },
        defaultTemperature: 0.7,
        isDefault: false,
        description: 'Local model hosted on LM Studio (OpenAI-compatible server).',
      },
    ];

    try {
      const operations = defaultModels.map((dm) => ({
        updateOne: {
          filter: { modelId: dm.modelId, provider: dm.provider },
          update: { $setOnInsert: dm },
          upsert: true,
        },
      }));

      await this.modelModel.bulkWrite(operations, { ordered: false });
      this.logger.log('Default LLM models verified and seeded.');
    } catch (err: any) {
      this.logger.warn(`Default models atomic seed warning: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD Operations
  // ---------------------------------------------------------------------------

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
    const isMongoId = identifier.match(/^[0-9a-fA-F]{24}$/);

    return this.modelModel
      .findOne({
        $or: [
          { modelId: identifier },
          { label: identifier },
          ...(isMongoId ? [{ _id: identifier }] : []),
        ],
      })
      .exec();
  }

  async create(data: Partial<LLMModel>): Promise<LLMModelDocument> {
    if (data.endpoint && !validateEndpointUrl(data.endpoint)) {
      throw new BadRequestException(`Invalid endpoint URL: "${data.endpoint}". Must be valid HTTP or HTTPS.`);
    }

    if (data.isDefault) {
      await this.modelModel.updateMany({}, { isDefault: false }).exec();
    }

    const created = new this.modelModel(data);
    return created.save();
  }

  async update(id: string, data: Partial<LLMModel>): Promise<LLMModelDocument> {
    if (data.endpoint && !validateEndpointUrl(data.endpoint)) {
      throw new BadRequestException(`Invalid endpoint URL: "${data.endpoint}". Must be valid HTTP or HTTPS.`);
    }

    const existing = await this.findById(id);

    // If apiKey is passed as a masked placeholder or omitted, retain existing key
    if (data.apiKey !== undefined && isMaskedKey(data.apiKey)) {
      delete data.apiKey;
    }

    if (data.isDefault) {
      await this.modelModel.updateMany({ _id: { $ne: id } }, { isDefault: false }).exec();
    }

    const updated = await this.modelModel
      .findByIdAndUpdate(id, { $set: data }, { new: true })
      .exec();

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

  // ---------------------------------------------------------------------------
  // AI Feature Orchestrations (Delegated to Domain Services)
  // ---------------------------------------------------------------------------

  async revisePrompt(dto: RevisePromptDto): Promise<PromptRevisionResponse> {
    const context = await this.resolveModelContext({
      requestedModelId: dto.modelId,
      projectId: dto.projectId,
      settingsKey: 'flowHelperModel',
    });

    return this.promptReviser.revise(dto, context);
  }

  async generateSchema(dto: GenerateSchemaDto): Promise<SchemaGeneratorResponse> {
    let strictMode = true;

    if (dto.projectId) {
      try {
        const settings = await this.settingsService.getSettings(dto.projectId);
        if (settings?.typeGeneratorStrictMode !== undefined) {
          strictMode = settings.typeGeneratorStrictMode;
        }
      } catch (err: any) {
        this.logger.warn(`Could not read project settings for strictMode: ${err.message}`);
      }
    }
    if (dto.strictMode !== undefined) {
      strictMode = dto.strictMode;
    }

    const context = await this.resolveModelContext({
      requestedModelId: dto.modelId,
      projectId: dto.projectId,
      settingsKey: 'typeGeneratorModel',
      fallbackSettingsKey: 'flowHelperModel',
    });

    return this.schemaGenerator.generate(dto, {
      ...context,
      strictMode,
    });
  }

  async executeFlowAssistant(dto: FlowAssistantChatDto): Promise<FlowAssistantResponse> {
    const context = await this.resolveModelContext({
      requestedModelId: dto.modelId,
      projectId: dto.projectId,
      settingsKey: 'flowAssistantModel',
      fallbackSettingsKey: 'flowHelperModel',
    });

    return this.flowAssistant.execute(dto, context);
  }

  // ---------------------------------------------------------------------------
  // Model & Credentials Resolution Helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolves the target LLM model document, API key, and endpoint
   * following precedence: DTO override -> Project Settings -> Default Model -> First Model.
   */
  async resolveModelContext(opts: {
    requestedModelId?: string;
    projectId?: string;
    settingsKey?: 'flowHelperModel' | 'typeGeneratorModel' | 'flowAssistantModel';
    fallbackSettingsKey?: 'flowHelperModel';
  }): Promise<ResolvedModelContext> {
    let modelRecord: LLMModelDocument | null = null;

    // 1. Direct explicit request
    if (opts.requestedModelId) {
      modelRecord = await this.findByModelIdOrLabel(opts.requestedModelId);
    }

    // 2. Project settings lookup
    if (!modelRecord && opts.projectId && opts.settingsKey) {
      try {
        const settings = await this.settingsService.getSettings(opts.projectId);
        const configuredIdentifier =
          (settings as any)?.[opts.settingsKey] ||
          (opts.fallbackSettingsKey ? (settings as any)?.[opts.fallbackSettingsKey] : null);

        if (configuredIdentifier) {
          modelRecord = await this.findByModelIdOrLabel(configuredIdentifier);
        }
      } catch (err: any) {
        this.logger.warn(`Failed to resolve settings model for ${opts.settingsKey}: ${err.message}`);
      }
    }

    // 3. System default model
    if (!modelRecord) {
      modelRecord = await this.modelModel.findOne({ isDefault: true }).exec();
    }

    // 4. Any available model
    if (!modelRecord) {
      const all = await this.findAll();
      modelRecord = all[0] || null;
    }

    const modelId = modelRecord?.modelId || 'gpt-4o';
    const provider = modelRecord?.provider || 'openai';
    const rawEndpoint = String(modelRecord?.endpoint || 'https://api.openai.com/v1').trim();
    const label = modelRecord?.label || modelId;

    const apiKey = this.extractApiKey(modelRecord, provider, rawEndpoint);
    const isLocal = this.isLocalEndpoint(provider, rawEndpoint);

    if (!isLocal && !apiKey) {
      throw new BadRequestException(
        `API key is missing for model "${label}" (${provider}). Please configure it in Settings -> Models.`,
      );
    }

    return {
      modelId,
      provider,
      endpoint: rawEndpoint,
      apiKey,
      label,
      document: modelRecord,
    };
  }

  private extractApiKey(
    modelRecord: LLMModelDocument | null,
    provider: string,
    rawEndpoint: string,
  ): string {
    let apiKey = modelRecord?.apiKey || '';

    // Environment fallback
    if (!apiKey) {
      if (provider === 'openrouter' || rawEndpoint.includes('openrouter.ai')) {
        apiKey = process.env.OPENROUTER_API_KEY || '';
      } else {
        apiKey = process.env.OPENAI_API_KEY || '';
      }
    }

    if (typeof apiKey === 'string') {
      apiKey = apiKey.trim();
      if (apiKey.includes('=')) {
        apiKey = apiKey.split('=').pop()!.trim();
      }
      if (apiKey.startsWith('Bearer ')) {
        apiKey = apiKey.slice(7).trim();
      }
    }

    return apiKey;
  }

  private isLocalEndpoint(provider: string, endpoint: string): boolean {
    const p = provider.toLowerCase();
    const e = endpoint.toLowerCase();
    return (
      isCliProvider(p) ||
      p === 'lmstudio' ||
      p === 'ollama' ||
      e.includes('localhost') ||
      e.includes('127.0.0.1') ||
      e.includes('0.0.0.0')
    );
  }

  async testCliModel(data: Partial<LLMModel>): Promise<{
    ok: boolean;
    reply?: string;
    binary?: string;
    durationMs?: number;
    error?: string;
  }> {
    const provider = String(data.provider || '');
    if (!isCliProvider(provider)) {
      throw new BadRequestException(`Provider "${provider}" is not a subscription CLI provider.`);
    }
    try {
      const result = await this.cliLlm.complete({
        provider,
        modelId: String(data.modelId || '').trim(),
        prompt: 'Reply with exactly the word OK and nothing else.',
        reasoningEffort: data.reasoningEffort,
        cliPath: data.cliPath,
        signal: AbortSignal.timeout(120000),
      });
      return {
        ok: true,
        reply: result.text.trim().slice(0, 200),
        binary: result.binary,
        durationMs: result.durationMs,
      };
    } catch (err: any) {
      return {
        ok: false,
        error:
          err?.name === 'TimeoutError'
            ? 'The CLI did not answer within 120 seconds.'
            : err?.message || String(err),
      };
    }
  }

  async generateEvaluationCriteria(dto: GenerateEvaluationCriteriaDto): Promise<{
    criteria: string;
    model: string;
    modelId: string;
    provider: string;
  }> {
    const ctx = await this.resolveModelContext({
      explicitModelId: dto.modelId,
      projectId: dto.projectId,
      settingsKey: 'flowHelperModel',
    });

    if (!dto.systemPrompt?.trim() && !dto.userPrompt?.trim()) {
      throw new BadRequestException(
        'Write the System Prompt or User Prompt first; criteria are generated from them.',
      );
    }

    const systemInstruction = `You write evaluation checklists used by an independent AI reviewer to grade another AI agent's answers.

Rules:
1. Write 3 to 7 criteria, one per line, each starting with "[must]" (essential; failing it makes the answer unacceptable) or "[should]" (quality improvement).
2. Each criterion must be objectively checkable from the answer alone (or from the agent's tool evidence), e.g. "[must] Every factual claim cites a source URL".
3. Derive criteria from the agent's instructions and expected output. Do not invent requirements the task does not imply.
4. Template variables like {{node.field}} are filled at runtime; refer to them generically.
5. Output ONLY the criteria lines. No numbering, headings, markdown fences or commentary.`;

    const userContent = [
      dto.instruction?.trim() ? `Extra guidance from the user:\n${dto.instruction.trim()}\n` : '',
      `Agent system prompt:\n"""\n${dto.systemPrompt?.trim() || '(none)'}\n"""`,
      `Agent user prompt template:\n"""\n${dto.userPrompt?.trim() || '(none)'}\n"""`,
      dto.outputType?.trim() ? `Required output schema:\n"""\n${dto.outputType.trim()}\n"""` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const signal = AbortSignal.timeout(60000);
    let text = '';
    try {
      text = await this.completeHelperText(ctx, systemInstruction, userContent, signal);
    } catch (err: any) {
      this.logger.error(
        `Evaluation criteria generation failed with model ${ctx.modelId} (${ctx.provider}): ${err.message}`,
      );
      throw new BadRequestException(
        `Failed to generate evaluation criteria with model "${ctx.label}": ${err.message}`,
      );
    }

    const criteria = text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^```[a-z]*\n?|```$/gim, '')
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, ''))
      .filter((line) => /^\[(must|should)\]/i.test(line))
      .join('\n');
    if (!criteria) {
      throw new BadRequestException(
        `Model "${ctx.label}" did not return usable criteria. Try again or pick another model.`,
      );
    }

    return { criteria, model: ctx.label, modelId: ctx.modelId, provider: ctx.provider };
  }

  private async completeHelperText(
    ctx: ResolvedModelContext,
    system: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    const { modelId, provider, endpoint: rawEndpoint, apiKey, document: modelRecord } = ctx;
    if (isCliProvider(provider)) {
      const result = await this.cliLlm.complete({
        provider,
        modelId,
        system,
        prompt,
        reasoningEffort: modelRecord?.reasoningEffort,
        cliPath: modelRecord?.cliPath,
        signal,
      });
      return result.text;
    }

    if (provider === 'anthropic') {
      const url = rawEndpoint.endsWith('/messages')
        ? rawEndpoint
        : rawEndpoint.endsWith('/v1')
          ? `${rawEndpoint}/messages`
          : `${rawEndpoint}/v1/messages`;
      const json = await postLlmJson(
        url,
        {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        {
          model: modelId,
          max_tokens: 1024,
          system,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
        },
        { signal, label: 'Anthropic', logger: this.logger },
      );
      return (json.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');
    }

    if (provider === 'lmstudio' && rawEndpoint.includes('/api/v1/chat')) {
      const json = await postLlmJson(
        rawEndpoint,
        {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        { model: modelId, system_prompt: system, input: prompt, temperature: 0.2 },
        { signal, label: 'LM Studio', logger: this.logger },
      );
      return Array.isArray(json.output)
        ? json.output.find((p: any) => p.type === 'message')?.content || ''
        : typeof json.output === 'string'
          ? json.output
          : '';
    }

    let url = rawEndpoint;
    if (rawEndpoint.endsWith('/chat')) url = `${rawEndpoint}/completions`;
    else if (!rawEndpoint.endsWith('/completions')) {
      url =
        rawEndpoint === 'https://api.openai.com'
          ? `${rawEndpoint}/v1/chat/completions`
          : `${rawEndpoint}/chat/completions`;
    }
    const json = await postLlmJson(
      url,
      {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      {
        model: modelId,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        ...(/^o[13]/i.test(modelId) ? {} : { temperature: 0.2 }),
      },
      { signal, label: 'LLM API', logger: this.logger },
    );
    return json.choices?.[0]?.message?.content || '';
  }
}
