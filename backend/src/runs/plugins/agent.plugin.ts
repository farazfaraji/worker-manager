import { Injectable, Logger, Optional } from '@nestjs/common';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { tool } from '@langchain/core/tools';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { AgentRunnerService } from '../services/agent-runner.service';
import { VariableResolverService } from '../services/variable-resolver.service';
import { LangchainChatAdapter } from '../compiler/langchain-chat.adapter';

@Injectable()
export class AgentPlugin implements ToolPlugin {
  readonly toolType = 'agent';
  private readonly logger = new Logger(AgentPlugin.name);
  private registryRef?: any;

  constructor(
    private readonly agentRunner: AgentRunnerService,
    @Optional() private readonly variableResolver?: VariableResolverService,
  ) {}

  setRegistry(registry: any): void {
    this.registryRef = registry;
  }

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context, runId } = ctx;
    const config = node?.data?.config || {};

    // Check if LangGraph ReAct agent mode is enabled
    if (config.useLangGraphAgent) {
      return this.runLangGraphAgent(ctx);
    }

    // Default: use existing proven agent runner
    return this.agentRunner.executeAgentNode(node, nodeInput, context, runId);
  }

  private async runLangGraphAgent(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context, runId } = ctx;
    const config = node?.data?.config || {};
    this.logger.log(`🤖 [AgentPlugin] Running ReAct agent via LangGraph for node "${node.id}"`);

    // 1. Resolve sub-tools
    const allowedToolNames = Array.isArray(config.tools) ? config.tools : [];
    const agentTools = [];

    if (this.registryRef) {
      for (const toolType of allowedToolNames) {
        const plugin = this.registryRef.get(toolType);
        if (plugin) {
          agentTools.push(
            tool(
              async (input: any) => {
                const subNode = {
                  id: `agent-tool-${toolType}-${Date.now()}`,
                  type: toolType,
                  data: { config: input, definitionType: toolType },
                };
                return plugin.run({
                  node: subNode,
                  nodeInput: input,
                  context,
                  initialInput: input,
                  runId,
                });
              },
              {
                name: String(toolType).replace(/[^a-zA-Z0-9_-]/g, '_'),
                description: `Tool for ${toolType}`,
              },
            ),
          );
        }
      }
    }

    // 2. Build prompts
    const prompt = this.variableResolver
      ? this.variableResolver.resolveTemplate(config.prompt || config.userPrompt || '', context)
      : config.prompt || '';
    const systemPrompt = this.variableResolver
      ? this.variableResolver.resolveTemplate(config.systemPrompt || '', context)
      : config.systemPrompt || '';

    // 3. Build LLM adapter
    const llm = new LangchainChatAdapter({
      modelName: config.model || 'gpt-4o',
      generateFn: async (messages) => {
        const lastUser = [...messages].reverse().find((m) => m._getType() === 'human' || (m as any).role === 'user');
        const content = lastUser?.content || prompt;
        return `ReAct output for: ${content}`;
      },
    });

    const agent = createReactAgent({
      llm,
      tools: agentTools,
      messageModifier: systemPrompt || undefined,
    });

    const agentResult = await agent.invoke({
      messages: [{ role: 'user', content: prompt || 'Execute agent task' }],
    });

    const lastMsg = agentResult.messages[agentResult.messages.length - 1];
    const textOutput = typeof lastMsg?.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg?.content);

    return {
      result: textOutput,
      text: textOutput,
      messages: agentResult.messages,
    };
  }
}
