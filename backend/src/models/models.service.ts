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
  ) {
    const defaultLlmClient = new LlmClientService();
    this.promptReviser = promptReviser || new PromptReviserService(defaultLlmClient);
    this.schemaGenerator = schemaGenerator || new SchemaGeneratorService(defaultLlmClient);
    this.flowAssistant =
      flowAssistant || new FlowAssistantService(defaultLlmClient, this.nodeDefinitionsService);
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
      p === 'lmstudio' ||
      p === 'ollama' ||
      e.includes('localhost') ||
      e.includes('127.0.0.1') ||
      e.includes('0.0.0.0')
    );
  }
}
