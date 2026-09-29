import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { VariableResolverService, RuntimeNode } from './variable-resolver.service';
import { BrowserRunnerService } from './browser-runner.service';
import { AgentRunnerService } from './agent-runner.service';
import { WebserverService } from '../../webserver/webserver.service';
import { WebSearchRunnerService } from './web-search-runner.service';
import { RepoInspectorService } from './repo-inspector.service';
import { ToolPluginRegistry } from '../plugins/tool-plugin.registry';

import { TriggerPlugin, RoutePlugin } from '../plugins/trigger.plugin';
import { WebserverPlugin } from '../plugins/webserver.plugin';
import { HttpResponsePlugin } from '../plugins/http-response.plugin';
import { IncrementVariablePlugin } from '../plugins/increment-variable.plugin';
import { DecrementVariablePlugin } from '../plugins/decrement-variable.plugin';
import { SetVariablePlugin } from '../plugins/set-variable.plugin';
import { AgentPlugin } from '../plugins/agent.plugin';
import { RepoInspectPlugin } from '../plugins/repo-inspect.plugin';
import { ResearchReviewPlugin } from '../plugins/research-review.plugin';
import { ScriptPlugin } from '../plugins/script.plugin';
import { TransformPlugin } from '../plugins/transform.plugin';
import { ConditionPlugin } from '../plugins/condition.plugin';
import { ValidatorPlugin } from '../plugins/validator.plugin';
import { BrowserPlugin } from '../plugins/browser.plugin';
import { WebSearchPlugin } from '../plugins/web-search.plugin';
import { JsonParserPlugin } from '../plugins/json-parser.plugin';
import { OutputPlugin } from '../plugins/output.plugin';
import { SubgraphPlugin } from '../plugins/subgraph.plugin';
import { ArtifactPlugin } from '../plugins/artifact.plugin';
import { HumanGatePlugin } from '../plugins/human-gate.plugin';
import { ActionPlugin } from '../plugins/action.plugin';
import { MemoryPlugin } from '../plugins/memory.plugin';
import { RetrievalPlugin } from '../plugins/retrieval.plugin';
import { EmbeddingPlugin } from '../plugins/embedding.plugin';
import { RouterPlugin } from '../plugins/router.plugin';
import { TelegramPlugin } from '../plugins/telegram.plugin';
import { OrchestratorPlugin } from '../plugins/orchestrator.plugin';
import { LoopPlugin } from '../plugins/loop.plugin';
import { ForeachPlugin } from '../plugins/foreach.plugin';
import { AggregatePlugin } from '../plugins/aggregate.plugin';
import { ExecutionPlugin } from '../plugins/execution.plugin';
import { NotificationPlugin } from '../plugins/notification.plugin';

@Injectable()
export class NodeExecutorService {
  private readonly logger = new Logger(NodeExecutorService.name);
  private readonly pluginRegistry: ToolPluginRegistry;

  constructor(
    @Inject(forwardRef(() => ToolPluginRegistry))
    registryOrResolver: ToolPluginRegistry | VariableResolverService,
    @Optional() browserRunner?: BrowserRunnerService,
    @Optional() agentRunner?: AgentRunnerService,
    @Optional() _blockRuntime?: any,
    @Optional() webSearchRunner?: WebSearchRunnerService,
    @Optional() @Inject(forwardRef(() => WebserverService)) webserverService?: WebserverService,
    @Optional() repoInspector?: RepoInspectorService,
  ) {
    if (registryOrResolver instanceof ToolPluginRegistry) {
      this.pluginRegistry = registryOrResolver;
    } else {
      // Legacy constructor support: build registry on the fly from passed services
      const resolver = registryOrResolver || new VariableResolverService();
      this.pluginRegistry = new ToolPluginRegistry(
        new TriggerPlugin(),
        new RoutePlugin(),
        new WebserverPlugin(),
        new HttpResponsePlugin(resolver, webserverService),
        new IncrementVariablePlugin(resolver),
        new DecrementVariablePlugin(resolver),
        new SetVariablePlugin(resolver),
        new AgentPlugin(agentRunner || ({} as any)),
        new RepoInspectPlugin(repoInspector),
        new ResearchReviewPlugin(resolver, webSearchRunner),
        new ScriptPlugin(),
        new TransformPlugin(),
        new ConditionPlugin(resolver),
        new ValidatorPlugin(),
        new BrowserPlugin(browserRunner || ({} as any)),
        new WebSearchPlugin(webSearchRunner),
        new JsonParserPlugin(resolver),
        new OutputPlugin(resolver),
        new SubgraphPlugin(),
        new ArtifactPlugin(),
        new HumanGatePlugin(),
        new ActionPlugin(browserRunner),
        new MemoryPlugin(),
        new RetrievalPlugin(),
        new EmbeddingPlugin(),
        new RouterPlugin(),
        new TelegramPlugin(),
        new OrchestratorPlugin(agentRunner),
        new LoopPlugin(),
        new ForeachPlugin(),
        new AggregatePlugin(),
        new ExecutionPlugin(),
        new NotificationPlugin(),
      );
    }
  }

  async executeNode(
    node: RuntimeNode,
    nodeInput: any,
    context: Record<string, any>,
    initialInput: any,
    runId: string,
  ): Promise<any> {
    const data = node?.data || {};
    const type = String(data.definitionType || node?.type || '').toLowerCase();

    const plugin = this.pluginRegistry.get(type, node);
    if (!plugin) {
      this.logger.error(`   ❌ Unsupported node type: "${type}"`);
      throw new Error(`Unsupported node type: ${type || 'unknown'}`);
    }

    return plugin.run({
      node,
      nodeInput,
      context,
      initialInput,
      runId,
    });
  }
}
