import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { Project, ProjectSchema } from './schemas/project.schema';
import { Graph, GraphSchema } from '../graphs/schemas/graph.schema';
import { Run, RunSchema } from '../runs/schemas/run.schema';
import { RunCheckpoint, RunCheckpointSchema } from '../runs/schemas/run-checkpoint.schema';
import { NodeCache, NodeCacheSchema } from '../runs/schemas/node-cache.schema';
import { Setting, SettingSchema } from '../settings/schemas/setting.schema';
import { Artifact, ArtifactSchema } from '../blocks/schemas/artifact.schema';
import { ArtifactRelation, ArtifactRelationSchema } from '../blocks/schemas/artifact-relation.schema';
import { Memory, MemorySchema } from '../blocks/schemas/memory.schema';
import { Trace, TraceSchema } from '../blocks/schemas/trace.schema';
import { VectorRecord, VectorRecordSchema } from '../blocks/schemas/vector-record.schema';
import { EventRecord, EventRecordSchema } from '../events/schemas/event.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: Graph.name, schema: GraphSchema },
      { name: Run.name, schema: RunSchema },
      { name: RunCheckpoint.name, schema: RunCheckpointSchema },
      { name: NodeCache.name, schema: NodeCacheSchema },
      { name: Setting.name, schema: SettingSchema },
      { name: Artifact.name, schema: ArtifactSchema },
      { name: ArtifactRelation.name, schema: ArtifactRelationSchema },
      { name: Memory.name, schema: MemorySchema },
      { name: Trace.name, schema: TraceSchema },
      { name: VectorRecord.name, schema: VectorRecordSchema },
      { name: EventRecord.name, schema: EventRecordSchema },
    ]),
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
