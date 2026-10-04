import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as Mustache from 'mustache';
import { LlmClientService } from './llm-client.service';
import { cleanCodeFences } from '../utils/llm-endpoint.util';
import { RevisePromptDto } from '../dto/revise-prompt.dto';

export interface PromptRevisionContext {
  modelId: string;
  provider: string;
  endpoint: string;
  apiKey: string;
  label: string;
}

export interface PromptRevisionResponse {
  revisedPrompt: string;
  model: string;
  modelId: string;
  provider: string;
}

@Injectable()
export class PromptReviserService {
  private readonly logger = new Logger(PromptReviserService.name);
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
      `Prompt reviser template "${fileName}" not found in candidate paths: ${candidatePaths.join(', ')}`,
    );
  }

  private getSystemPromptTemplate(): string {
    if (!this.systemPromptTemplate) {
      this.systemPromptTemplate = this.loadPromptTemplate('prompt-reviser.system.md');
    }
    return this.systemPromptTemplate;
  }

  private getUserPromptTemplate(): string {
    if (!this.userPromptTemplate) {
      this.userPromptTemplate = this.loadPromptTemplate('prompt-reviser.user.md');
    }
    return this.userPromptTemplate;
  }

  async revise(
    dto: RevisePromptDto,
    context: PromptRevisionContext,
  ): Promise<PromptRevisionResponse> {
    const hasInstruction = Boolean(dto.instruction && dto.instruction.trim());
    const instruction = hasInstruction ? dto.instruction!.trim() : '';
    const prompt = dto.prompt?.trim()
      ? dto.prompt.trim()
      : '(Currently empty. Please draft a complete, production-ready system prompt for a general-purpose AI agent in a workflow.)';

    // Render system and user prompts using Mustache
    const systemInstruction = Mustache.render(this.getSystemPromptTemplate(), {});
    const userContent = Mustache.render(this.getUserPromptTemplate(), {
      hasInstruction,
      instruction,
      prompt,
    });

    this.logger.log(
      `Revising prompt using model "${context.label}" (${context.modelId}) via ${context.provider}`,
    );

    const result = await this.llmClient.executeChatCompletion({
      modelId: context.modelId,
      provider: context.provider,
      endpoint: context.endpoint,
      apiKey: context.apiKey,
      systemInstruction,
      messages: [{ role: 'user', content: userContent }],
      temperature: 0.7,
      timeoutMs: 60000,
      clientLabel: 'Flow Builder - Prompt Reviser',
    });

    const revisedPrompt = cleanCodeFences(result.text);

    return {
      revisedPrompt,
      model: context.label || context.modelId,
      modelId: context.modelId,
      provider: context.provider,
    };
  }
}
