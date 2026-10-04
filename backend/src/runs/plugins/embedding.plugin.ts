import { Injectable, Logger, Optional } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { ArtifactService } from '../../blocks/artifact.service';
import { EmbeddingService } from '../../blocks/embedding.service';
import { VectorStoreService } from '../../blocks/vector-store.service';

@Injectable()
export class EmbeddingPlugin implements ToolPlugin {
  readonly toolType = 'embedding';
  private readonly logger = new Logger(EmbeddingPlugin.name);

  constructor(
    @Optional() private readonly artifacts?: ArtifactService,
    @Optional() private readonly embeddings?: EmbeddingService,
    @Optional() private readonly vectors?: VectorStoreService,
  ) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput } = ctx;
    const config: any = node?.data?.config || {};
    const payload: any = nodeInput && typeof nodeInput === 'object' ? nodeInput : {};

    const artifactId = String(payload.artifactId || config.artifactId || '').trim();
    let logicalId = String(payload.logicalId || config.logicalId || '').trim();
    const projectId = String(payload.projectId || config.projectId || '').trim();
    const namespace = String(payload.namespace || config.namespace || 'default').trim();
    const includeRawVectors = Boolean(payload.includeRawVectors ?? config.includeRawVectors ?? false);

    let rawInput: any;

    if (Array.isArray(nodeInput)) {
      rawInput = nodeInput;
    } else if (typeof nodeInput === 'string' || typeof nodeInput === 'number') {
      rawInput = nodeInput;
    } else if (nodeInput && typeof nodeInput === 'object') {
      rawInput =
        nodeInput.text !== undefined
          ? nodeInput.text
          : nodeInput.texts !== undefined
          ? nodeInput.texts
          : nodeInput.input;
    }

    if (rawInput === undefined) {
      rawInput =
        config.text !== undefined
          ? config.text
          : config.texts !== undefined
          ? config.texts
          : config.input;
    }

    let texts: string[] = [];
    if (Array.isArray(rawInput)) {
      texts = rawInput.map((t) => (typeof t === 'string' ? t : JSON.stringify(t)));
    } else if (typeof rawInput === 'string') {
      const trimmed = rawInput.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            texts = parsed.map((t) => (typeof t === 'string' ? t : JSON.stringify(t)));
          } else {
            texts = [trimmed];
          }
        } catch {
          texts = [trimmed];
        }
      } else {
        texts = [trimmed];
      }
    } else if (rawInput !== undefined && rawInput !== null) {
      texts = [String(rawInput)];
    }

    // If no text provided, attempt to fetch from linked artifact
    let artifactDoc: any = null;
    if (artifactId && this.artifacts) {
      try {
        artifactDoc = await this.artifacts.get(artifactId, projectId || undefined, false);
        if (artifactDoc) {
          if (!logicalId) logicalId = artifactDoc.logicalId || '';
          if (texts.length === 0 && artifactDoc.content) {
            const contentStr =
              typeof artifactDoc.content === 'object'
                ? JSON.stringify(artifactDoc.content, null, 2)
                : String(artifactDoc.content);
            texts = [contentStr];
          }
        }
      } catch (err: any) {
        this.logger.warn(`Could not load artifact ${artifactId} for embedding: ${err.message}`);
      }
    }

    const embeddings = this.embeddings ? await this.embeddings.embedMany(texts, config) : [];
    const singleVector = embeddings.length === 1 ? embeddings[0] : undefined;
    const hasArtifactLink = Boolean(artifactId || logicalId);

    // If linked to an artifact, store vectors out-of-band in MongoDB VectorStore
    if (hasArtifactLink && this.vectors) {
      const version = Number(artifactDoc?.version || payload.version || config.version || 1);
      const artifactType = String(
        artifactDoc?.type || payload.artifactType || config.artifactType || 'document',
      );
      const isLatest =
        config.isLatest !== undefined ? Boolean(config.isLatest) : (artifactDoc?.isLatest ?? true);

      for (let i = 0; i < texts.length; i++) {
        const chunkId = `c${i}`;
        await this.vectors.upsert({
          namespace,
          sourceType: 'artifact',
          sourceId: artifactId || logicalId,
          logicalId: logicalId || undefined,
          artifactId: artifactId || undefined,
          artifactType,
          version,
          chunkId,
          text: texts[i],
          embedding: embeddings[i],
          isLatest,
          projectId: projectId || artifactDoc?.projectId || 'default',
          metadata: {
            title: artifactDoc?.title || payload.title || config.title,
            ...(artifactDoc?.metadata || {}),
            ...(config.metadata || {}),
            ...(payload.metadata || {}),
          },
        });
      }
    }

    // Keep state lean: when linked to an artifact, suppress raw vector arrays unless includeRawVectors is true
    const shouldIncludeVectors = hasArtifactLink ? includeRawVectors : true;

    return {
      status: 'completed',
      ...(artifactId ? { artifactId } : {}),
      ...(logicalId ? { logicalId } : {}),
      indexedChunks: texts.length,
      dimensions: embeddings[0]?.length || 0,
      stored: hasArtifactLink,
      result: {
        model: config.embeddingModel || config.model || process.env.EMBEDDING_MODEL || 'default',
        dimensions: embeddings[0]?.length || 0,
        indexedChunks: texts.length,
        stored: hasArtifactLink,
        ...(artifactId ? { artifactId } : {}),
        ...(logicalId ? { logicalId } : {}),
        ...(shouldIncludeVectors
          ? { embeddings, ...(singleVector ? { embedding: singleVector } : {}) }
          : {}),
      },
      ...(shouldIncludeVectors
        ? { embeddings, ...(singleVector ? { embedding: singleVector } : {}) }
        : {}),
    };
  }

  getValidHandles(_config?: any, _outputs?: any[], _nodeData?: any, _nodeName?: string): Set<string> {
    return new Set(['done', 'failed', 'onfailed', 'result', 'results']);
  }

  getProducedPaths(nodeName: string, _config?: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>();
    const embedKeys = ['embeddings', 'dimensions', 'model', 'count', 'artifactId', 'logicalId', 'result'];
    for (const k of embedKeys) {
      paths.add(`${nodeName}.${k}`);
    }
    return paths;
  }
}
