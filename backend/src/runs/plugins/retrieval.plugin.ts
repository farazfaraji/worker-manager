import { Injectable, Logger, Optional } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { EmbeddingService } from '../../blocks/embedding.service';
import { VectorStoreService } from '../../blocks/vector-store.service';

@Injectable()
export class RetrievalPlugin implements ToolPlugin {
  readonly toolType = 'retrieval';
  private readonly logger = new Logger(RetrievalPlugin.name);

  constructor(
    @Optional() private readonly embeddings?: EmbeddingService,
    @Optional() private readonly vectors?: VectorStoreService,
  ) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput } = ctx;
    const config: any = node?.data?.config || {};
    const payload: any = nodeInput && typeof nodeInput === 'object' ? nodeInput : { query: nodeInput };
    const operation = String(config.operation || payload.operation || 'search').toLowerCase();

    if (operation === 'index' || operation === 'upsert') {
      const documents = Array.isArray(payload.documents) ? payload.documents : [payload];
      const records = [];
      for (const document of documents) {
        const text = String(document.text || document.content || '').trim();
        if (!text) continue;
        const embedding = Array.isArray(document.embedding)
          ? document.embedding
          : (this.embeddings ? await this.embeddings.embed(text, config) : []);
        const upserted: any = this.vectors
          ? await this.vectors.upsert({
              namespace: config.namespace || payload.namespace,
              sourceType: document.sourceType || config.sourceType || 'document',
              sourceId: document.sourceId || document.artifactId || config.sourceId || `document-${Date.now()}`,
              version: document.version,
              chunkId: document.chunkId,
              text,
              embedding,
              metadata: {
                ...(document.metadata || {}),
                projectId: document.projectId || config.projectId,
                status: document.status || config.status,
              },
            })
          : null;
        const { embedding: _emb, ...cleanRec } = upserted || {};
        records.push(cleanRec);
      }
      return { status: 'completed', result: { operation: 'index', indexedCount: records.length, records } };
    }

    let query = String(payload.query || config.query || '').trim();
    if ((query.startsWith("'") && query.endsWith("'")) || (query.startsWith('"') && query.endsWith('"'))) {
      query = query.slice(1, -1).trim();
    }
    const rawEmbedding = payload.embedding !== undefined ? payload.embedding : config.embedding;
    let embedding: number[] = [];
    if (Array.isArray(rawEmbedding) && rawEmbedding.length > 0) {
      embedding = rawEmbedding;
    } else if (query && this.embeddings) {
      try {
        embedding = await this.embeddings.embed(query, config);
      } catch (err: any) {
        this.logger.warn(`Failed to generate query embedding: ${err.message}. Falling back to keyword search.`);
        embedding = [];
      }
    }
    let keywords =
      payload.keywords !== undefined
        ? payload.keywords
        : config.keywords !== undefined
        ? config.keywords
        : payload.keyword || config.keyword;
    if (typeof keywords === 'string') {
      const trimmedKw = keywords.trim();
      if ((trimmedKw.startsWith("'") && trimmedKw.endsWith("'")) || (trimmedKw.startsWith('"') && trimmedKw.endsWith('"'))) {
        keywords = trimmedKw.slice(1, -1).trim();
      }
    }
    if ((!embedding || embedding.length === 0) && !keywords && query) {
      keywords = query;
    }
    const rawResults = this.vectors
      ? await this.vectors.search({
          embedding,
          namespace: config.namespace || payload.namespace || 'artifact-index',
          sourceType: config.sourceType || payload.sourceType,
          projectId: config.projectId || payload.projectId,
          status: config.status || payload.status,
          keywords,
          limit: Number(payload.limit ?? config.limit ?? 5) || 5,
          latestOnly: config.latestOnly !== undefined ? config.latestOnly : payload.latestOnly,
          logicalId: config.logicalId || payload.logicalId,
          artifactType: config.artifactType || payload.artifactType,
        })
      : [];

    // Ensure raw vector float arrays are never added to graph state on retrieval / get
    const results = (rawResults || []).map((r: any) => {
      const { embedding: _emb, ...clean } = r;
      return clean;
    });

    const formattedContext = results
      .map((r: any, idx: number) => {
        const title = r.metadata?.title || r.logicalId || r.artifactId || `Source #${idx + 1}`;
        const score = typeof r.score === 'number' ? ` (Similarity: ${(r.score * 100).toFixed(1)}%)` : '';
        const idInfo = r.logicalId ? `Logical ID: ${r.logicalId}\n` : r.artifactId ? `Artifact ID: ${r.artifactId}\n` : '';
        return `### ${title}${score}\n${idInfo}${r.text || ''}`;
      })
      .join('\n\n---\n\n');

    return {
      status: 'completed',
      context: formattedContext,
      results,
      count: results.length,
      result: {
        operation: 'search',
        query,
        context: formattedContext,
        results,
        count: results.length,
        embeddingDimension: embedding.length,
      },
    };
  }

  getValidHandles(_config?: any, _outputs?: any[], _nodeData?: any, _nodeName?: string): Set<string> {
    return new Set(['done', 'failed', 'onfailed', 'result', 'results']);
  }

  getProducedPaths(nodeName: string, _config?: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>();
    const retrievalKeys = ['results', 'count', 'query', 'context', 'result'];
    for (const k of retrievalKeys) {
      paths.add(`${nodeName}.${k}`);
    }
    return paths;
  }
}
