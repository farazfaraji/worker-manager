import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VectorRecord, VectorRecordDocument } from './schemas/vector-record.schema';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { ArtifactVersion } from './artifact.types';

export function chunkTextWords(text: string, maxWords = 400, overlap = 50): string[] {
  if (!text || !text.trim()) return [];
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return [words.join(' ')];

  const chunks: string[] = [];
  let startIndex = 0;
  while (startIndex < words.length) {
    const chunkWords = words.slice(startIndex, startIndex + maxWords);
    chunks.push(chunkWords.join(' '));
    if (startIndex + maxWords >= words.length) break;
    startIndex += Math.max(1, maxWords - overlap);
  }
  return chunks;
}

@Injectable()
export class ArtifactIndexingService {
  private readonly logger = new Logger(ArtifactIndexingService.name);

  constructor(
    @InjectModel(VectorRecord.name)
    private readonly vectorModel: Model<VectorRecordDocument>,
    private readonly vectorStore: VectorStoreService,
    @Optional() private readonly embeddings?: EmbeddingService,
  ) {}

  /**
   * Synchronously or asynchronously indexes an artifact version into vector store.
   * Marks previous vectors for this logicalId as isLatest: false.
   * Deterministic chunk IDs: `${logicalId}:v${version}:c${index}`.
   */
  async indexArtifact(
    artifact: ArtifactVersion | any,
    options: { namespace?: string; embeddingConfig?: any } = {},
  ): Promise<{ indexedChunks: number; isLatest: boolean }> {
    try {
      const logicalId = String(artifact.logicalId || artifact.artifactId || '').trim();
      const version = Number(artifact.version || 1);
      const isArchived = artifact.status === 'archived';
      const namespace = options.namespace || 'artifact-index';
      const projectId = artifact.projectId || '';

      // 1. Mark existing vectors for this logicalId as isLatest: false
      if (logicalId) {
        await this.vectorModel.updateMany(
          { logicalId },
          { $set: { isLatest: false } },
        ).exec();
      }

      // Convert content to text for indexing
      let rawText = '';
      if (typeof artifact.content === 'object' && artifact.content !== null) {
        try {
          rawText = JSON.stringify(artifact.content, null, 2);
        } catch {
          rawText = String(artifact.content);
        }
      } else {
        rawText = String(artifact.content || '');
      }

      // Prepend title and keywords to the searchable corpus
      const title = artifact.title ? `Title: ${artifact.title}\n\n` : '';
      const tagList = Array.isArray(artifact.tags) ? artifact.tags : [];
      const categoryPrefix = artifact.category ? `Category: ${artifact.category}\n` : '';
      const kwPrefix = tagList.length > 0 ? `Tags: ${tagList.join(', ')}\n\n` : '';
      const fullPrefix = `${categoryPrefix}${kwPrefix}`;
      const fullText = `${title}${fullPrefix}${rawText}`.trim();

      if (!fullText) {
        return { indexedChunks: 0, isLatest: !isArchived };
      }

      // 2. Fixed Chunking: max 400 words, 50 words overlap
      const chunks = chunkTextWords(fullText, 400, 50);

      // 3. Obtain embeddings (or zero-vector fallback if embeddings not configured)
      let embeddingsList: number[][] = [];
      if (this.embeddings) {
        try {
          embeddingsList = await this.embeddings.embedMany(chunks, options.embeddingConfig || {});
        } catch (embedErr: any) {
          this.logger.warn(`Could not compute embeddings for artifact ${artifact.artifactId}: ${embedErr.message}`);
        }
      }

      const isLatest = !isArchived;

      // 4. Upsert deterministic chunks
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = `c${i}`;
        const vectorId = `${namespace}:artifact:${logicalId}:v${version}:${chunkId}`;
        const embedding = embeddingsList[i] || [];

        await this.vectorModel.findOneAndUpdate(
          { vectorId },
          {
            $set: {
              vectorId,
              namespace,
              sourceType: 'artifact',
              sourceId: artifact.artifactId,
              logicalId,
              artifactId: artifact.artifactId,
              artifactType: artifact.type,
              artifactStatus: artifact.status,
              version,
              chunkId,
              text: chunks[i],
              embedding,
              isLatest,
              contentHash: artifact.contentHash || '',
              projectId,
              metadata: {
                title: artifact.title,
                type: artifact.type,
                category: artifact.category,
                tags: artifact.tags || [],
                format: artifact.format,
                status: artifact.status,
                version,
                logicalId,
                artifactId: artifact.artifactId,
                projectId,
                isLatest,
                contentHash: artifact.contentHash,
                ...(artifact.metadata || {}),
              },
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        ).exec();
      }

      return { indexedChunks: chunks.length, isLatest };
    } catch (err: any) {
      this.logger.error(`Error indexing artifact ${artifact?.artifactId}: ${err.message || err}`);
      // Do not re-throw to protect artifact save operations
      return { indexedChunks: 0, isLatest: false };
    }
  }
}
