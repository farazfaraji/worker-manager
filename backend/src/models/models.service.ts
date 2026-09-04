import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LLMModel, LLMModelDocument } from './schemas/llm-model.schema';

@Injectable()
export class ModelsService implements OnModuleInit {
  private readonly logger = new Logger(ModelsService.name);

  constructor(
    @InjectModel(LLMModel.name)
    private readonly modelModel: Model<LLMModelDocument>,
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
}
