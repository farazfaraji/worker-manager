import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VectorRecord, VectorRecordDocument } from './schemas/vector-record.schema';

@Injectable()
export class VectorStoreService {
  constructor(@InjectModel(VectorRecord.name) private readonly model: Model<VectorRecordDocument>) {}

  async upsert(input: any): Promise<any> {
    const namespace = String(input.namespace || 'default');
    const version = input.version || 1;
    const chunkId = input.chunkId || '0';
    const vectorId = input.vectorId || `${namespace}:${input.sourceType}:${input.sourceId}:${version}:${chunkId}`;
    const isLatest = input.isLatest !== undefined ? Boolean(input.isLatest) : true;

    return this.model.findOneAndUpdate(
      { vectorId },
      {
        $set: {
          vectorId,
          namespace,
          sourceType: input.sourceType,
          sourceId: String(input.sourceId),
          version: input.version,
          chunkId,
          text: input.text,
          embedding: input.embedding,
          logicalId: input.logicalId,
          artifactId: input.artifactId || input.sourceId,
          artifactType: input.artifactType,
          artifactStatus: input.artifactStatus,
          isLatest,
          contentHash: input.contentHash,
          projectId: input.projectId || input.metadata?.projectId || 'default',
          metadata: input.metadata || {},
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean().exec();
  }

  async search(input: any): Promise<any[]> {
    const filter: any = {};
    const ns = input.namespace && input.namespace !== 'default' && input.namespace !== 'artifact-index'
      ? input.namespace
      : undefined;

    if (ns) {
      filter.$or = filter.$or || [];
      filter.$or.push(
        { namespace: ns },
        { projectId: ns },
        { 'metadata.projectId': ns },
      );
    }

    if (input.sourceType) filter.sourceType = input.sourceType;
    if (input.logicalId) filter.logicalId = input.logicalId;
    if (input.artifactType) filter.artifactType = input.artifactType;

    if (input.projectId && !ns) {
      filter.$or = filter.$or || [];
      filter.$or.push(
        { projectId: input.projectId },
        { 'metadata.projectId': input.projectId },
      );
    }

    if (input.keywords && (Array.isArray(input.keywords) ? input.keywords.length > 0 : String(input.keywords).trim())) {
      const kwList = Array.isArray(input.keywords)
        ? input.keywords.map((k: any) => String(k).trim()).filter(Boolean)
        : String(input.keywords).split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
      if (kwList.length > 0) {
        const regexPatterns = kwList.map((kw: string) => new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        filter.$and = filter.$and || [];
        filter.$and.push({
          $or: [
            { text: { $in: regexPatterns } },
            { 'metadata.title': { $in: regexPatterns } },
            { 'metadata.keyword': { $in: regexPatterns } },
            { 'metadata.keywords': { $in: regexPatterns } },
          ],
        });
      }
    }

    if (input.status) {
      filter.$or = filter.$or || [];
      filter.$or.push(
        { artifactStatus: input.status },
        { 'metadata.status': input.status },
      );
    }

    // Default to latest-only search unless explicitly requested latestOnly: false
    const latestOnly = input.latestOnly !== false;
    if (latestOnly) {
      filter.isLatest = true;
      // Exclude archived artifacts from default latest search
      filter.artifactStatus = { $ne: 'archived' };
      filter['metadata.status'] = { $ne: 'archived' };
    }

    const candidates = await this.model.find(filter).limit(5000).lean().exec();

    // If query embedding provided, rank by cosine similarity; otherwise return candidates
    if (Array.isArray(input.embedding) && input.embedding.length > 0) {
      return candidates
        .map((record: any) => ({
          ...record,
          score: this.cosine(input.embedding, record.embedding || []),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, Number(input.limit || 10));
    }

    return candidates.slice(0, Number(input.limit || 10));
  }

  private cosine(a: number[], b: number[]): number {
    if (!a?.length || a.length !== b.length) return 0;
    let dot = 0;
    let aNorm = 0;
    let bNorm = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      aNorm += a[i] ** 2;
      bNorm += b[i] ** 2;
    }
    return aNorm && bNorm ? dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm)) : 0;
  }
}
