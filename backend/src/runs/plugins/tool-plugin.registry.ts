import { Injectable, Logger } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { RuntimeNode } from '../services/variable-resolver.service';

import { TriggerPlugin, RoutePlugin } from './trigger.plugin';
import { WebserverPlugin } from './webserver.plugin';
import { HttpResponsePlugin } from './http-response.plugin';
import { IncrementVariablePlugin } from './increment-variable.plugin';
import { DecrementVariablePlugin } from './decrement-variable.plugin';
import { SetVariablePlugin } from './set-variable.plugin';
import { AgentPlugin } from './agent.plugin';
import { RepoInspectPlugin } from './repo-inspect.plugin';
import { ResearchReviewPlugin } from './research-review.plugin';
import { ScriptPlugin } from './script.plugin';
import { TransformPlugin } from './transform.plugin';
import { ConditionPlugin } from './condition.plugin';
import { ValidatorPlugin } from './validator.plugin';
import { BrowserPlugin } from './browser.plugin';
import { WebSearchPlugin } from './web-search.plugin';
import { JsonParserPlugin } from './json-parser.plugin';
import { OutputPlugin } from './output.plugin';
import { SubgraphPlugin } from './subgraph.plugin';
import { ArtifactPlugin } from './artifact.plugin';
import { HumanGatePlugin } from './human-gate.plugin';
import { ActionPlugin } from './action.plugin';
import { MemoryPlugin } from './memory.plugin';
import { RetrievalPlugin } from './retrieval.plugin';
import { EmbeddingPlugin } from './embedding.plugin';
import { RouterPlugin } from './router.plugin';
import { TelegramPlugin } from './telegram.plugin';
import { OrchestratorPlugin } from './orchestrator.plugin';
import { LoopPlugin } from './loop.plugin';
import { ForeachPlugin } from './foreach.plugin';
import { AggregatePlugin } from './aggregate.plugin';
import { ExecutionPlugin } from './execution.plugin';
import { NotificationPlugin } from './notification.plugin';

@Injectable()
export class ToolPluginRegistry {
  private readonly logger = new Logger(ToolPluginRegistry.name);
  private readonly plugins = new Map<string, ToolPlugin>();
  private readonly allPlugins: ToolPlugin[] = [];

  constructor(
    private readonly triggerPlugin: TriggerPlugin,
    private readonly routePlugin: RoutePlugin,
    private readonly webserverPlugin: WebserverPlugin,
    private readonly httpResponsePlugin: HttpResponsePlugin,
    private readonly incrementVariablePlugin: IncrementVariablePlugin,
    private readonly decrementVariablePlugin: DecrementVariablePlugin,
    private readonly setVariablePlugin: SetVariablePlugin,
    private readonly agentPlugin: AgentPlugin,
    private readonly repoInspectPlugin: RepoInspectPlugin,
    private readonly researchReviewPlugin: ResearchReviewPlugin,
    private readonly scriptPlugin: ScriptPlugin,
    private readonly transformPlugin: TransformPlugin,
    private readonly conditionPlugin: ConditionPlugin,
    private readonly validatorPlugin: ValidatorPlugin,
    private readonly browserPlugin: BrowserPlugin,
    private readonly webSearchPlugin: WebSearchPlugin,
    private readonly jsonParserPlugin: JsonParserPlugin,
    private readonly outputPlugin: OutputPlugin,
    private readonly subgraphPlugin: SubgraphPlugin,
    private readonly artifactPlugin: ArtifactPlugin,
    private readonly humanGatePlugin: HumanGatePlugin,
    private readonly actionPlugin: ActionPlugin,
    private readonly memoryPlugin: MemoryPlugin,
    private readonly retrievalPlugin: RetrievalPlugin,
    private readonly embeddingPlugin: EmbeddingPlugin,
    private readonly routerPlugin: RouterPlugin,
    private readonly telegramPlugin: TelegramPlugin,
    private readonly orchestratorPlugin: OrchestratorPlugin,
    private readonly loopPlugin: LoopPlugin,
    private readonly foreachPlugin: ForeachPlugin,
    private readonly aggregatePlugin: AggregatePlugin,
    private readonly executionPlugin: ExecutionPlugin,
    private readonly notificationPlugin: NotificationPlugin,
  ) {
    this.registerAll([
      this.triggerPlugin,
      this.routePlugin,
      this.webserverPlugin,
      this.httpResponsePlugin,
      this.incrementVariablePlugin,
      this.decrementVariablePlugin,
      this.setVariablePlugin,
      this.agentPlugin,
      this.repoInspectPlugin,
      this.researchReviewPlugin,
      this.scriptPlugin,
      this.transformPlugin,
      this.conditionPlugin,
      this.validatorPlugin,
      this.browserPlugin,
      this.webSearchPlugin,
      this.jsonParserPlugin,
      this.outputPlugin,
      this.subgraphPlugin,
      this.artifactPlugin,
      this.humanGatePlugin,
      this.actionPlugin,
      this.memoryPlugin,
      this.retrievalPlugin,
      this.embeddingPlugin,
      this.routerPlugin,
      this.telegramPlugin,
      this.orchestratorPlugin,
      this.loopPlugin,
      this.foreachPlugin,
      this.aggregatePlugin,
      this.executionPlugin,
      this.notificationPlugin,
    ]);
  }

  register(plugin: ToolPlugin): void {
    if (!plugin) return;
    this.allPlugins.push(plugin);
    if ('setRegistry' in plugin && typeof (plugin as any).setRegistry === 'function') {
      (plugin as any).setRegistry(this);
    }
    const types = Array.isArray(plugin.toolType) ? plugin.toolType : [plugin.toolType];
    for (const t of types) {
      this.plugins.set(t.toLowerCase(), plugin);
    }
  }

  registerAll(plugins: ToolPlugin[]): void {
    for (const p of plugins) {
      this.register(p);
    }
  }

  get(type: string, node?: RuntimeNode): ToolPlugin | undefined {
    const normalized = String(type || '').toLowerCase();
    const direct = this.plugins.get(normalized);
    if (direct) return direct;

    // Fallback: check custom matches function on all registered plugins
    for (const plugin of this.allPlugins) {
      if (plugin.matches && plugin.matches(normalized, node)) {
        return plugin;
      }
    }

    return undefined;
  }

  has(type: string, node?: RuntimeNode): boolean {
    return !!this.get(type, node);
  }

  getAll(): ToolPlugin[] {
    return [...this.allPlugins];
  }

  getToolsForAgent(toolTypes: string[]): ToolPlugin[] {
    return (toolTypes || [])
      .map((t) => this.get(t))
      .filter((p): p is ToolPlugin => Boolean(p));
  }
}
