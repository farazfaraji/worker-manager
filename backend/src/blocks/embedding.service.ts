import { BadRequestException, Injectable } from '@nestjs/common';
import { EmbeddingModelsService } from '../settings/embedding-models.service';

@Injectable()
export class EmbeddingService {
  constructor(private readonly models: EmbeddingModelsService) {}

  async embed(text: string, config: any = {}): Promise<number[]> {
    return (await this.embedMany([text], config))[0];
  }

  async embedMany(texts: string[], config: any = {}): Promise<number[][]> {
    const values = texts.map((text) => String(text || '').trim()).filter(Boolean);
    if (!values.length) throw new BadRequestException('Embedding requires non-empty text');
    const configuredModel = await this.models.findByIdOrModelId(String(config.embeddingModel || config.model || process.env.EMBEDDING_MODEL || ''));
    const endpoint = String(config.endpoint || configuredModel?.endpoint || process.env.EMBEDDING_ENDPOINT || '').trim();
    const model = String(configuredModel?.modelId || config.model || process.env.EMBEDDING_MODEL || '');
    const apiKey = String(process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || '');
    if (!endpoint) throw new BadRequestException('Set EMBEDDING_ENDPOINT before using the Embedding block');
    const isLocal = /localhost|127\.0\.0\.1/.test(endpoint);
    if (!isLocal && process.env.EMBEDDING_ALLOW_EXTERNAL !== 'true') throw new BadRequestException('External embedding is disabled by server policy');
    let cleanEndpoint = endpoint.trim().replace(/\/+$/, '');
    if (cleanEndpoint.endsWith('/embedding')) cleanEndpoint = cleanEndpoint.slice(0, -10);
    const url = cleanEndpoint.endsWith('/embeddings') ? cleanEndpoint : `${cleanEndpoint}/embeddings`;
    const timeoutMs = Number(process.env.EMBEDDING_TIMEOUT_MS || config.timeout || 5000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, input: values }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      if (err.name === 'TimeoutError' || err.code === 23) {
        throw new Error(`Embedding request timed out after ${timeoutMs}ms connecting to ${url}`);
      }
      throw err;
    }
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Embedding API error (${response.status}): ${payload.error?.message || response.statusText}`);
    const vectors = (payload.data || []).sort((a: any, b: any) => Number(a.index) - Number(b.index)).map((item: any) => item.embedding.map(Number));
    if (vectors.length !== values.length) throw new Error('Embedding provider returned an incomplete response');
    return vectors;
  }
}
