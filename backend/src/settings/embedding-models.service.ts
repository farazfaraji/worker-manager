import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmbeddingModel, EmbeddingModelDocument } from './schemas/embedding-model.schema';

@Injectable()
export class EmbeddingModelsService implements OnModuleInit {
  constructor(@InjectModel(EmbeddingModel.name) private readonly model: Model<EmbeddingModelDocument>) {}

  async onModuleInit() {
    if (!(await this.model.exists({}))) {
      await this.model.create({ label: 'OpenAI Small Embedding', modelId: 'text-embedding-3-small', provider: 'openai', endpoint: 'https://api.openai.com/v1', dimensions: 1536, isDefault: true, description: 'General-purpose compact embedding model.' });
    }
  }

  async findAll(): Promise<any[]> { return this.model.find().sort({ isDefault: -1, createdAt: 1 }).lean().exec(); }

  async findByIdOrModelId(identifier: string): Promise<any | null> {
    if (!identifier) return this.model.findOne({ isDefault: true }).lean().exec();
    const filter: any = /^[0-9a-fA-F]{24}$/.test(identifier) ? { $or: [{ modelId: identifier }, { _id: identifier }] } : { modelId: identifier };
    return this.model.findOne(filter).lean().exec();
  }

  async create(data: any): Promise<any> {
    if (data.isDefault) await this.model.updateMany({}, { $set: { isDefault: false } }).exec();
    return this.model.create(data);
  }

  async update(id: string, data: any): Promise<any> {
    if (data.isDefault) await this.model.updateMany({ _id: { $ne: id } }, { $set: { isDefault: false } }).exec();
    const result = await this.model.findByIdAndUpdate(id, { $set: data }, { new: true }).lean().exec();
    if (!result) throw new NotFoundException(`Embedding model "${id}" not found`);
    return result;
  }

  async remove(id: string): Promise<any> {
    const result = await this.model.findByIdAndDelete(id).lean().exec();
    if (!result) throw new NotFoundException(`Embedding model "${id}" not found`);
    return { success: true, id };
  }
}
