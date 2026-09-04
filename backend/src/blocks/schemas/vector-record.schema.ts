import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type VectorRecordDocument = VectorRecord & Document;

@Schema({ timestamps: true })
export class VectorRecord {
  @Prop({ required: true, unique: true, index: true }) vectorId: string;
  @Prop({ required: true, index: true }) namespace: string;
  @Prop({ required: true, index: true }) sourceType: string;
  @Prop({ required: true, index: true }) sourceId: string;
  @Prop({ index: true }) version?: number;
  @Prop({ required: true }) chunkId: string;
  @Prop({ required: true }) text: string;
  @Prop({ type: [Number], required: true }) embedding: number[];

  // Artifact Vector Extensions
  @Prop({ index: true }) logicalId?: string;
  @Prop({ index: true }) artifactId?: string;
  @Prop({ index: true }) artifactType?: string;
  @Prop({ index: true }) artifactStatus?: string;
  @Prop({ index: true, default: true }) isLatest?: boolean;
  @Prop() contentHash?: string;
  @Prop({ required: true, index: true }) projectId: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} }) metadata: Record<string, any>;
}

export const VectorRecordSchema = SchemaFactory.createForClass(VectorRecord);
VectorRecordSchema.index({ namespace: 1, sourceType: 1, sourceId: 1 });
VectorRecordSchema.index({ namespace: 1, logicalId: 1, isLatest: 1 });
VectorRecordSchema.index({ namespace: 1, artifactType: 1, isLatest: 1 });
VectorRecordSchema.index({ projectId: 1, isLatest: 1 });
