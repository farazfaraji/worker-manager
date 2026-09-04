import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EmbeddingModelDocument = EmbeddingModel & Document;

@Schema({ timestamps: true, collection: 'embedding_models' })
export class EmbeddingModel {
  @Prop({ required: true, trim: true }) label: string;
  @Prop({ required: true, trim: true, index: true }) modelId: string;
  @Prop({ required: true, trim: true }) provider: string;
  @Prop({ required: true, trim: true }) endpoint: string;
  @Prop({ type: Number }) dimensions?: number;
  @Prop({ type: Number }) maxInputTokens?: number;
  @Prop({ type: Boolean, default: false, index: true }) isDefault: boolean;
  @Prop({ type: String, default: '' }) description: string;
}

export const EmbeddingModelSchema = SchemaFactory.createForClass(EmbeddingModel);
EmbeddingModelSchema.index({ modelId: 1, provider: 1 }, { unique: true });

