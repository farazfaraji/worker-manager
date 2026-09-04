import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { NodeRunRecord, NodeRunRecordSchema } from './run.schema';

export type RunCheckpointDocument = RunCheckpoint & Document;

@Schema({ timestamps: true, collection: 'run_checkpoints' })
export class RunCheckpoint {
  @Prop({ required: true, index: true })
  checkpointId: string;

  @Prop({ required: true, index: true })
  runId: string;

  @Prop({ required: true })
  sequence: number;

  @Prop({
    required: true,
    enum: ['queued', 'running', 'waiting', 'completed', 'partial', 'failed', 'cancelled'],
  })
  status: string;

  @Prop()
  currentNodeId?: string;

  @Prop()
  waitingNodeId?: string;

  @Prop()
  waitingChildRunId?: string;

  @Prop({ type: [String], default: [] })
  queue: string[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  context: Record<string, any>;

  @Prop({ type: [String], default: [] })
  completedNodeIds: string[];

  @Prop({ type: [NodeRunRecordSchema], default: [] })
  nodeRecords: NodeRunRecord[];

  @Prop({ type: MongooseSchema.Types.Mixed })
  lastNodeOutput?: any;

  @Prop({ type: MongooseSchema.Types.Mixed })
  waitingDescriptor?: any;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metrics?: any;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const RunCheckpointSchema = SchemaFactory.createForClass(RunCheckpoint);

// Compound indexes
RunCheckpointSchema.index({ runId: 1, sequence: 1 }, { unique: true });
RunCheckpointSchema.index({ runId: 1, sequence: -1 });
