import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Memory, MemoryDocument } from './schemas/memory.schema';

@Injectable()
export class MemoryService {
  constructor(@InjectModel(Memory.name) private readonly model: Model<MemoryDocument>) {}

  async remember(input: any): Promise<any> {
    const projectId = String(input.projectId || 'default');
    const namespace = String(input.namespace || 'default');
    const key = String(input.key || input.id || `memory-${Date.now()}`);
    return this.model.findOneAndUpdate(
      { projectId, namespace, key },
      { $set: { projectId, kind: input.kind || 'project', value: input.value ?? input.input, metadata: input.metadata || {}, importance: Number(input.importance || 0), expiresAt: input.expiresAt } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean().exec();
  }

  async recall(input: any): Promise<any[]> {
    const filter: any = { namespace: String(input.namespace || 'default') };
    if (input.projectId) filter.projectId = String(input.projectId);
    if (input.kind) filter.kind = input.kind;
    if (input.key) filter.key = String(input.key);
    const query = String(input.query || '').trim();
    const records = await this.model.find(filter).sort({ importance: -1, updatedAt: -1 }).limit(Number(input.limit || 20)).lean().exec();
    if (!query) return records;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return records
      .map((record: any) => ({ record, score: terms.reduce((score, term) => score + (JSON.stringify(record).toLowerCase().includes(term) ? 1 : 0), 0) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => ({ ...item.record, relevance: item.score / terms.length }));
  }

  async forget(input: any): Promise<any> {
    const filter: any = { namespace: String(input.namespace || 'default') };
    if (input.projectId) filter.projectId = String(input.projectId);
    if (input.key) filter.key = String(input.key);
    const result = await this.model.deleteMany(filter).exec();
    return { deletedCount: result.deletedCount };
  }
}

