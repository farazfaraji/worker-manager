import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Trace, TraceDocument } from './schemas/trace.schema';

@Injectable()
export class TraceService {
  constructor(@InjectModel(Trace.name) private readonly model: Model<TraceDocument>) {}

  async link(input: any): Promise<any> {
    return this.model.create({ projectId: String(input.projectId || 'default'), runId: input.runId, sourceType: input.sourceType, sourceId: String(input.sourceId), targetType: input.targetType, targetId: String(input.targetId), relation: input.relation || 'related_to', metadata: input.metadata || {} });
  }

  async list(input: any): Promise<any[]> {
    return this.model.find({ ...(input.projectId ? { projectId: String(input.projectId) } : {}), ...(input.runId ? { runId: input.runId } : {}), ...(input.sourceId ? { sourceId: String(input.sourceId) } : {}), ...(input.targetId ? { targetId: String(input.targetId) } : {}) }).sort({ createdAt: -1 }).limit(Number(input.limit || 100)).lean().exec();
  }
}

