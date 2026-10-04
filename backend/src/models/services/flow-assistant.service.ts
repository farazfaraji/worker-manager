import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as Mustache from 'mustache';
import { LlmClientService, ChatMessage } from './llm-client.service';
import { extractJsonPayload, salvageReplyText } from '../utils/llm-endpoint.util';
import { FlowAssistantChatDto, FlowAssistantResponse } from '../dto/flow-assistant.dto';
import { NodeDefinitionsService, NodeDefinition } from '../../node-definitions/node-definitions.service';
import {
  computeDirective,
  DefinitionPorts,
  validateAssistantResponse,
} from './flow-assistant-validator';

export interface FlowAssistantContext {
  modelId: string;
  provider: string;
  endpoint: string;
  apiKey: string;
  label: string;
}

const FALLBACK_CATALOG = `Available block kinds include: trigger, agent, condition, web-search, telegram, transform, set-variable, foreach, loop, human-gate, http-response, output, repo-inspect, script.`;

@Injectable()
export class FlowAssistantService {
  private readonly logger = new Logger(FlowAssistantService.name);
  private systemPromptTemplate?: string;
  private userPromptTemplate?: string;

  constructor(
    private readonly llmClient: LlmClientService,
    private readonly nodeDefinitionsService?: NodeDefinitionsService,
  ) {}

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
      `Flow assistant prompt template "${fileName}" not found in candidate paths: ${candidatePaths.join(', ')}`,
    );
  }

  private getSystemPromptTemplate(): string {
    if (!this.systemPromptTemplate) {
      this.systemPromptTemplate = this.loadPromptTemplate('flow-assistant.system.md');
    }
    return this.systemPromptTemplate;
  }

  private getUserPromptTemplate(): string {
    if (!this.userPromptTemplate) {
      this.userPromptTemplate = this.loadPromptTemplate('flow-assistant.user.md');
    }
    return this.userPromptTemplate;
  }

  async execute(
    dto: FlowAssistantChatDto,
    context: FlowAssistantContext,
  ): Promise<FlowAssistantResponse> {
    const definitions = await this.loadDefinitions();
    const availableToolsSummary = this.catalogSummary(definitions);
    const definitionPorts: DefinitionPorts[] = definitions.map((definition) => ({
      kind: definition.type,
      outputs: (definition.outputs || []).map((output) => output.name),
    }));

    const systemInstruction = Mustache.render(this.getSystemPromptTemplate(), {
      availableToolsSummary,
    });

    const currentGraph: { blocks: any[]; connections: any[] } = {
      blocks: Array.isArray(dto.currentGraph?.blocks) ? dto.currentGraph.blocks : [],
      connections: Array.isArray(dto.currentGraph?.connections) ? dto.currentGraph.connections : [],
    };

    const focusIds = new Set((dto.focusBlockIds || []).map((id) => String(id)));
    const selectedBlocks = currentGraph.blocks
      .filter((block) => focusIds.has(String(block.id)))
      .map((block) => ({
        id: block.id,
        kind: block.kind,
        name: block.name || block.label || block.id,
      }));

    const answers =
      dto.answers && typeof dto.answers === 'object' && Object.keys(dto.answers).length > 0
        ? dto.answers
        : null;
    const directive = computeDirective({
      confirmed: dto.confirmed,
      confirmedOutline: dto.confirmedOutline,
      skipClarification: dto.skipClarification,
      history: dto.history,
    });

    const userMessageContent = Mustache.render(this.getUserPromptTemplate(), {
      currentGraphJson: JSON.stringify(currentGraph, null, 2),
      message: dto.message,
      selectedBlocksJson: selectedBlocks.length ? JSON.stringify(selectedBlocks, null, 2) : '',
      answersJson: answers ? JSON.stringify(answers, null, 2) : '',
      confirmedOutlineJson: dto.confirmedOutline ? JSON.stringify(dto.confirmedOutline, null, 2) : '',
      directive: directive || '',
    });

    const conversationHistory: ChatMessage[] = (dto.history || []).map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    }));

    const messages: ChatMessage[] = [
      ...conversationHistory,
      { role: 'user', content: userMessageContent },
    ];

    this.logger.log(
      `Executing flow assistant using model "${context.label}" (${context.modelId}) via ${context.provider}`,
    );

    const result = await this.llmClient.executeChatCompletion({
      modelId: context.modelId,
      provider: context.provider,
      endpoint: context.endpoint,
      apiKey: context.apiKey,
      systemInstruction,
      messages,
      temperature: 0.2,
      timeoutMs: 90000,
      clientLabel: 'Flow Builder - Flow Assistant',
    });

    const meta = {
      modelUsed: context.label || context.modelId,
      provider: context.provider,
    };

    const parsed = extractJsonPayload<any>(result.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const salvaged = salvageReplyText(result.text);
      this.logger.warn(
        `Could not parse JSON response from flow assistant: ${result.text.slice(0, 200)}...`,
      );
      return {
        mode: 'answer',
        reply:
          salvaged ||
          (result.text.trim().startsWith('{')
            ? 'I could not read that response. Please ask again.'
            : result.text || 'I was unable to structure the response properly. Please try asking again.'),
        references: [],
        ...meta,
      };
    }

    return {
      ...validateAssistantResponse(parsed, {
        currentGraph,
        definitions: definitionPorts,
        confirmed: !!dto.confirmed,
      }),
      ...meta,
    };
  }

  private async loadDefinitions(): Promise<NodeDefinition[]> {
    if (!this.nodeDefinitionsService) return [];
    try {
      return await this.nodeDefinitionsService.getAllDefinitions();
    } catch (error: any) {
      this.logger.warn(`Could not load tool definitions catalog: ${error.message}`);
      return [];
    }
  }

  private catalogSummary(definitions: NodeDefinition[]): string {
    if (definitions.length === 0) return FALLBACK_CATALOG;
    const compactCatalog = definitions.map((definition) => ({
      kind: definition.type,
      name: definition.name,
      description: definition.description,
      outputs: definition.outputs?.map((output) => output.name) || ['done'],
      inputs: definition.inputs?.map((input) => input.name) || [],
    }));
    return JSON.stringify(compactCatalog, null, 2);
  }
}
