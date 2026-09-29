import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { ArtifactService } from './artifact.service';
import { ArtifactRelationService } from './artifact-relation.service';
import { MemoryService } from './memory.service';
import { TraceService } from './trace.service';
import { AgentRunnerService } from '../runs/services/agent-runner.service';
import { BrowserRunnerService } from '../runs/services/browser-runner.service';
import { RuntimeNode } from '../runs/services/variable-resolver.service';
import { BlockInput, BlockOutput } from './block.types';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';

import { ActionPlugin } from '../runs/plugins/action.plugin';
import { MemoryPlugin } from '../runs/plugins/memory.plugin';
import { RetrievalPlugin } from '../runs/plugins/retrieval.plugin';
import { ArtifactPlugin } from '../runs/plugins/artifact.plugin';
import { EmbeddingPlugin } from '../runs/plugins/embedding.plugin';
import { RouterPlugin } from '../runs/plugins/router.plugin';
import { HumanGatePlugin } from '../runs/plugins/human-gate.plugin';
import { TelegramPlugin } from '../runs/plugins/telegram.plugin';
import { OrchestratorPlugin } from '../runs/plugins/orchestrator.plugin';
import { LoopPlugin } from '../runs/plugins/loop.plugin';
import { AggregatePlugin } from '../runs/plugins/aggregate.plugin';
import { ExecutionPlugin } from '../runs/plugins/execution.plugin';
import { NotificationPlugin } from '../runs/plugins/notification.plugin';

/**
 * @deprecated BlockRuntimeService has been dissolved into standalone ToolPlugins.
 * This class remains as a backward-compatible adapter delegating to plugins.
 */
@Injectable()
export class BlockRuntimeService {
  private readonly logger = new Logger(BlockRuntimeService.name);

  constructor(
    @Optional() private readonly artifacts?: ArtifactService,
    @Optional() private readonly memory?: MemoryService,
    @Optional() private readonly traces?: TraceService,
    @Optional() private readonly agentRunner?: AgentRunnerService,
    @Optional() private readonly browserRunner?: BrowserRunnerService,
    @Optional() private readonly embeddings?: EmbeddingService,
    @Optional() private readonly vectors?: VectorStoreService,
    @Optional() private readonly relations?: ArtifactRelationService,
  ) { }

  async execute(type: string, input: BlockInput, node?: RuntimeNode): Promise<BlockOutput> {
    const normalized = String(type || '').toLowerCase();
    const config = input.config || {};
    const effectiveNode: RuntimeNode = node || {
      id: `node-${Date.now()}`,
      data: { config, definitionType: normalized },
    };

    const ctx = {
      node: effectiveNode,
      nodeInput: input.input,
      context: input.context || {},
      initialInput: input.input,
      runId: input.runId || `run-${Date.now()}`,
    };

    switch (normalized) {
      case 'action':
        return new ActionPlugin(this.browserRunner).run(ctx);
      case 'memory':
        return new MemoryPlugin(this.memory).run(ctx);
      case 'retrieval':
        return new RetrievalPlugin(this.embeddings, this.vectors).run(ctx);
      case 'artifact':
        return new ArtifactPlugin(this.artifacts, this.relations).run(ctx);
      case 'embedding':
        return new EmbeddingPlugin(this.artifacts, this.embeddings, this.vectors).run(ctx);
      case 'router':
        return new RouterPlugin().run(ctx);
      case 'human-gate':
      case 'humangate':
        return new HumanGatePlugin().run(ctx);
      case 'telegram':
        return new TelegramPlugin().run(ctx);
      case 'orchestrator':
      case 'delegator':
        return new OrchestratorPlugin(this.agentRunner).run(ctx);
      case 'loop':
        return new LoopPlugin().run(ctx);
      case 'aggregate':
        return new AggregatePlugin().run(ctx);
      case 'execution':
        return new ExecutionPlugin().run(ctx);
      case 'notification':
        return new NotificationPlugin().run(ctx);
      default:
        throw new BadRequestException(`Unsupported generic block: ${type}`);
    }
  }
}
