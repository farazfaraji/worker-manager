import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type NodeCacheDocument = NodeCache & Document;

@Schema({ timestamps: true, collection: 'node_caches' })
export class NodeCache {
  @Prop({ required: true, index: true })
  graphId: string;

  @Prop({ required: true, index: true })
  nodeId: string;

  @Prop()
  nodeName?: string;

  @Prop()
  graphName?: string;

  @Prop({ index: true })
  projectId?: string;

  @Prop()
  nodeType?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  result: any;

  @Prop({ type: MongooseSchema.Types.Mixed })
  input?: any;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const NodeCacheSchema = SchemaFactory.createForClass(NodeCache);

// Ensure single cache entry per node in a graph
NodeCacheSchema.index({ graphId: 1, nodeId: 1 }, { unique: true });
