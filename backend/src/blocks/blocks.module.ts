import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Artifact, ArtifactSchema } from './schemas/artifact.schema';
import { ArtifactRelation, ArtifactRelationSchema } from './schemas/artifact-relation.schema';
import { Memory, MemorySchema } from './schemas/memory.schema';
import { Trace, TraceSchema } from './schemas/trace.schema';
import { VectorRecord, VectorRecordSchema } from './schemas/vector-record.schema';
import { ArtifactService } from './artifact.service';
import { ArtifactRelationService } from './artifact-relation.service';
import { ArtifactIndexingService } from './artifact-indexing.service';
import { MemoryService } from './memory.service';
import { TraceService } from './trace.service';
import { BlockRuntimeService } from './block-runtime.service';
import { AgentToolRegistryService } from '../runs/services/agent-tool-registry.service';
import { AgentRunnerService } from '../runs/services/agent-runner.service';
import { VariableResolverService } from '../runs/services/variable-resolver.service';
import { BrowserRunnerService } from '../runs/services/browser-runner.service';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { ModelsModule } from '../models/models.module';
import { SettingsModule } from '../settings/settings.module';
import { EventsModule } from '../events/events.module';

import { ArtifactsController } from './artifacts.controller';
import { FileStorageService } from './file-storage.service';
import { DatabaseConnectorService } from './database-connector.service';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Artifact.name, schema: ArtifactSchema },
      { name: ArtifactRelation.name, schema: ArtifactRelationSchema },
      { name: Memory.name, schema: MemorySchema },
      { name: Trace.name, schema: TraceSchema },
      { name: VectorRecord.name, schema: VectorRecordSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
    ModelsModule,
    SettingsModule,
    EventsModule,
  ],
  controllers: [ArtifactsController],
  providers: [
    ArtifactService,
    ArtifactRelationService,
    ArtifactIndexingService,
    MemoryService,
    TraceService,
    EmbeddingService,
    VectorStoreService,
    BlockRuntimeService,
    FileStorageService,
    DatabaseConnectorService,
    AgentToolRegistryService,
    AgentRunnerService,
    VariableResolverService,
    BrowserRunnerService,
  ],
  exports: [
    ArtifactService,
    ArtifactRelationService,
    ArtifactIndexingService,
    MemoryService,
    TraceService,
    EmbeddingService,
    VectorStoreService,
    BlockRuntimeService,
    FileStorageService,
    DatabaseConnectorService,
    AgentToolRegistryService,
  ],
})
export class BlocksModule {}
