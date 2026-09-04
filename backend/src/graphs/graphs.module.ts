import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GraphsController } from './graphs.controller';
import { GraphsService } from './graphs.service';
import { Graph, GraphSchema } from './schemas/graph.schema';

import { NodeDefinitionsModule } from '../node-definitions/node-definitions.module';
import { ModelsModule } from '../models/models.module';
import { GraphRunnerService } from '../runs/graph-runner.service';
import { Run, RunSchema } from '../runs/schemas/run.schema';
import { RunCheckpoint, RunCheckpointSchema } from '../runs/schemas/run-checkpoint.schema';
import { VariableResolverService } from '../runs/services/variable-resolver.service';
import { BrowserRunnerService } from '../runs/services/browser-runner.service';
import { AgentRunnerService } from '../runs/services/agent-runner.service';
import { NodeExecutorService } from '../runs/services/node-executor.service';
import { BlocksModule } from '../blocks/blocks.module';
import { EventsModule } from '../events/events.module';
import { GraphEventDispatcherService } from './graph-event-dispatcher.service';
import { GraphShapeService } from './graph-shape.service';

import { RunLeaseService } from '../runs/services/run-lease.service';
import { RunCheckpointService } from '../runs/services/run-checkpoint.service';
import { RunTopologyService } from '../runs/services/run-topology.service';
import { SubgraphRunnerService } from '../runs/services/subgraph-runner.service';
import { RunRecoveryService } from '../runs/services/run-recovery.service';
import { RunStorageService } from '../runs/services/run-storage.service';
import { WebserverModule } from '../webserver/webserver.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Graph.name, schema: GraphSchema },
      { name: Run.name, schema: RunSchema },
      { name: RunCheckpoint.name, schema: RunCheckpointSchema },
    ]),
    NodeDefinitionsModule,
    ModelsModule,
    BlocksModule,
    EventsModule,
    forwardRef(() => WebserverModule),
  ],
  controllers: [GraphsController],
  providers: [
    GraphsService,
    GraphShapeService,
    GraphRunnerService,
    RunLeaseService,
    RunCheckpointService,
    RunTopologyService,
    SubgraphRunnerService,
    RunRecoveryService,
    RunStorageService,
    VariableResolverService,
    BrowserRunnerService,
    AgentRunnerService,
    NodeExecutorService,
    GraphEventDispatcherService,
  ],
  exports: [
    GraphsService,
    GraphRunnerService,
    RunLeaseService,
    RunCheckpointService,
    RunTopologyService,
    SubgraphRunnerService,
    RunRecoveryService,
    RunStorageService,
    VariableResolverService,
    BrowserRunnerService,
    AgentRunnerService,
    NodeExecutorService,
    GraphEventDispatcherService,
  ],
})
export class GraphsModule {}
