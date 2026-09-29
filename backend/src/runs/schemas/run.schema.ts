import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type RunDocument = Run & Document;

@Schema({ _id: false })
export class NodeRunRecord {
  @Prop({ required: true })
  nodeId: string;

  @Prop({ required: true })
  nodeName: string;

  @Prop({ required: true })
  nodeType: string;

  @Prop({
    required: true,
    enum: ['pending', 'running', 'waiting', 'completed', 'failed', 'skipped', 'cancelled', 'listening'],
  })
  status: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  input?: any;

  @Prop({ type: MongooseSchema.Types.Mixed })
  output?: any;

  @Prop({ type: MongooseSchema.Types.Mixed })
  error?: any;

  @Prop({ default: 1 })
  attempt?: number;

  @Prop()
  durationMs?: number;

  @Prop()
  errorCode?: string;

  @Prop()
  retryable?: boolean;

  @Prop()
  childRunId?: string;

  @Prop()
  checkpointSequence?: number;

  @Prop()
  waitingTokenId?: string;

  @Prop()
  startedAt?: Date;

  @Prop()
  finishedAt?: Date;

  @Prop({ default: false })
  cached?: boolean;
}

export const NodeRunRecordSchema = SchemaFactory.createForClass(NodeRunRecord);

@Schema({ timestamps: true })
export class Run {
  @Prop({ required: true, unique: true, index: true })
  runId: string;

  @Prop({ required: true, index: true })
  projectId: string;

  @Prop({ required: true, index: true, type: MongooseSchema.Types.ObjectId, ref: 'Graph' })
  graphId: MongooseSchema.Types.ObjectId;

  @Prop()
  parentRunId?: string;

  @Prop()
  rootRunId?: string;

  @Prop()
  idempotencyKey?: string;

  @Prop()
  sourceEventId?: string;

  @Prop()
  sourceEventTopic?: string;

  @Prop({ default: 0 })
  propagationDepth?: number;

  @Prop({ type: [String], default: [] })
  visitedArtifactLogicalIds?: string[];

  @Prop()
  rerunFromNodeId?: string;

  @Prop({ required: true })
  graphName: string;

  @Prop({
    required: true,
    enum: ['queued', 'running', 'waiting', 'completed', 'partial', 'failed', 'cancelled', 'listening'],
    default: 'running',
  })
  status: string;

  @Prop()
  currentNodeId?: string;

  @Prop()
  waitingNodeId?: string;

  @Prop()
  waitingChildRunId?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  waitingDescriptor?: any;

  @Prop()
  resumeTokenHash?: string;

  @Prop({ default: 0 })
  checkpointSequence?: number;

  @Prop({ default: 1 })
  attempt?: number;

  @Prop()
  heartbeatAt?: Date;

  @Prop()
  leaseOwner?: string;

  @Prop()
  leaseExpiresAt?: Date;

  @Prop()
  cancelRequestedAt?: Date;

  @Prop({ default: false })
  debugMode?: boolean;

  @Prop({ default: false })
  useCache?: boolean;

  @Prop({ type: MongooseSchema.Types.Mixed })
  input: any;

  @Prop({ type: MongooseSchema.Types.Mixed })
  output: any;

  @Prop({ type: [NodeRunRecordSchema], default: [] })
  nodes: NodeRunRecord[];

  @Prop({ type: MongooseSchema.Types.Mixed })
  error: any;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metrics?: Record<string, any>;

  @Prop({ default: 1 })
  stateVersion?: number;

  @Prop({ default: 0 })
  dataSizeBytes: number;

  @Prop()
  startedAt?: Date;

  @Prop()
  finishedAt?: Date;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: any;
}

export const RunSchema = SchemaFactory.createForClass(Run);

// Compound and sparse indexes
RunSchema.index({ rootRunId: 1 });
RunSchema.index({ parentRunId: 1 });
RunSchema.index({ sourceEventId: 1 });
RunSchema.index({ status: 1, heartbeatAt: 1 });
RunSchema.index(
  { graphId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);
