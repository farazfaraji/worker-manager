import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as Mustache from 'mustache';
import { LlmClientService } from './llm-client.service';
import { cleanCodeFences } from '../utils/llm-endpoint.util';
import { GenerateSchemaDto } from '../dto/generate-schema.dto';

export interface SchemaGeneratorContext {
  modelId: string;
  provider: string;
  endpoint: string;
  apiKey: string;
  label: string;
  strictMode: boolean;
}

export interface SchemaGeneratorResponse {
  schema: string;
  model: string;
  modelId: string;
  provider: string;
}

@Injectable()
export class SchemaGeneratorService {
  private readonly logger = new Logger(SchemaGeneratorService.name);
  private systemPromptTemplate?: string;
  private userPromptTemplate?: string;

  constructor(private readonly llmClient: LlmClientService) {}

  /**
   * Resolves and loads a prompt template from candidate paths across dev and build environments.
   */
  private loadPromptTemplate(fileName: string): string {
    const candidatePaths = [
      path.resolve(__dirname, '..', 'prompts', fileName),
      path.resolve(__dirname, '..', '..', '..', 'models', 'prompts', fileName),
      path.resolve(process.cwd(), 'src', 'models', 'prompts', fileName),
      path.resolve(process.cwd(), 'backend', 'src', 'models', 'prompts', fileName),
      path.resolve(process.cwd(), 'dist', 'models', 'prompts', fileName),
      path.resolve(process.cwd(), 'backend', 'dist', 'models', 'prompts', fileName),
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, 'utf-8');
      }
    }

    throw new Error(
      `Schema generator template "${fileName}" not found in candidate paths: ${candidatePaths.join(', ')}`,
    );
  }

  private getSystemPromptTemplate(): string {
    if (!this.systemPromptTemplate) {
      this.systemPromptTemplate = this.loadPromptTemplate('schema-generator.system.md');
    }
    return this.systemPromptTemplate;
  }

  private getUserPromptTemplate(): string {
    if (!this.userPromptTemplate) {
      this.userPromptTemplate = this.loadPromptTemplate('schema-generator.user.md');
    }
    return this.userPromptTemplate;
  }

  async generate(
    dto: GenerateSchemaDto,
    context: SchemaGeneratorContext,
  ): Promise<SchemaGeneratorResponse> {
    const schemaType = dto.schemaType || 'zod';
    const targetSchemaLabel =
      schemaType === 'zod' ? 'Zod Schema (z.object({ ... }))' : 'TypeScript Structure';
    const strictModeLabel = context.strictMode ? 'Enabled (use .strict())' : 'Disabled';

    const systemInstruction = Mustache.render(this.getSystemPromptTemplate(), {});
    const userContent = Mustache.render(this.getUserPromptTemplate(), {
      description: dto.description.trim(),
      targetSchemaLabel,
      strictModeLabel,
    });

    this.logger.log(
      `Synthesizing schema using model "${context.label}" (${context.modelId}) via ${context.provider}`,
    );

    const result = await this.llmClient.executeChatCompletion({
      modelId: context.modelId,
      provider: context.provider,
      endpoint: context.endpoint,
      apiKey: context.apiKey,
      systemInstruction,
      messages: [{ role: 'user', content: userContent }],
      temperature: 0.2,
      timeoutMs: 60000,
      clientLabel: 'Flow Builder - Schema Generator',
    });

    let cleanedSchema = cleanCodeFences(result.text).trim();

    // Remove any trailing semicolons or prefix const declarations if generated
    if (cleanedSchema.startsWith('const ') || cleanedSchema.startsWith('export const ')) {
      const eqIdx = cleanedSchema.indexOf('=');
      if (eqIdx !== -1) {
        cleanedSchema = cleanedSchema.slice(eqIdx + 1).trim();
      }
    }
    if (cleanedSchema.endsWith(';')) {
      cleanedSchema = cleanedSchema.slice(0, -1).trim();
    }

    return {
      schema: cleanedSchema,
      model: context.label || context.modelId,
      modelId: context.modelId,
      provider: context.provider,
    };
  }
}
