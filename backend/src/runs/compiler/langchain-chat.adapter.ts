import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessage, AIMessage } from '@langchain/core/messages';
import { ChatResult } from '@langchain/core/outputs';

export interface ChatAdapterOptions {
  modelName?: string;
  temperature?: number;
  apiKey?: string;
  endpoint?: string;
  generateFn?: (messages: BaseMessage[], options?: any) => Promise<string | { content: string; toolCalls?: any[] }>;
}

/**
 * Universal LangChain ChatModel adapter allowing any model/provider to be used
 * with LangGraph createReactAgent and StateGraphs.
 */
export class LangchainChatAdapter extends BaseChatModel {
  private readonly modelName: string;
  private readonly temperature: number;
  private readonly generateFn?: (messages: BaseMessage[], options?: any) => Promise<string | { content: string; toolCalls?: any[] }>;
  public boundTools: any[] = [];

  constructor(options: ChatAdapterOptions = {}) {
    super({});
    this.modelName = options.modelName || 'gpt-4o';
    this.temperature = options.temperature !== undefined ? options.temperature : 0.7;
    this.generateFn = options.generateFn;
  }

  _llmType(): string {
    return 'custom-adapter';
  }

  bindTools(tools: any[]): this {
    const copy = new LangchainChatAdapter({
      modelName: this.modelName,
      temperature: this.temperature,
      generateFn: this.generateFn,
    });
    copy.boundTools = tools;
    return copy as this;
  }

  async _generate(messages: BaseMessage[], options?: any): Promise<ChatResult> {
    if (this.generateFn) {
      const result = await this.generateFn(messages, options);
      const text = typeof result === 'string' ? result : result.content;
      const toolCalls = typeof result === 'object' && result.toolCalls ? result.toolCalls : [];

      const aiMsg = new AIMessage({
        content: text,
        tool_calls: toolCalls.map((tc: any, idx: number) => ({
          name: tc.name || tc.function?.name,
          args: typeof tc.args === 'string' ? JSON.parse(tc.args) : (tc.args || tc.function?.arguments || {}),
          id: tc.id || `call_${idx}_${Date.now()}`,
        })),
      });

      return {
        generations: [{ text, message: aiMsg }],
      };
    }

    // Default mock response if no external generateFn provided
    const lastUserMessage = [...messages].reverse().find((m) => m._getType() === 'human' || (m as any).role === 'user');
    const content = `Response to: ${lastUserMessage?.content || 'request'}`;
    return {
      generations: [{ text: content, message: new AIMessage(content) }],
    };
  }
}
