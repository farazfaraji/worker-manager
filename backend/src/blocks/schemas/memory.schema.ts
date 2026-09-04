import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type MemoryDocument = Memory & Document;

@Schema({ timestamps: true })
export class Memory {
  @Prop({ required: true, index: true }) projectId: string;
  @Prop({ required: true, index: true }) namespace: string;
  @Prop({ required: true, index: true }) key: string;
  @Prop({ required: true, enum: ['conversation', 'project', 'knowledge', 'decision'], default: 'project' }) kind: string;
  @Prop({ type: MongooseSchema.Types.Mixed, required: true }) value: any;
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} }) metadata: Record<string, any>;
  @Prop({ default: 0 }) importance: number;
  @Prop({ index: true }) expiresAt?: Date;
}

export const MemorySchema = SchemaFactory.createForClass(Memory);
MemorySchema.index({ projectId: 1, namespace: 1, key: 1 }, { unique: true });

