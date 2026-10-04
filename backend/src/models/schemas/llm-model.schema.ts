import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LLMModelDocument = LLMModel & Document;

@Schema({ _id: false })
export class ModelCapabilities {
  @Prop({ type: Boolean, default: true })
  supportsVision: boolean;

  @Prop({ type: Boolean, default: false })
  supportsAudio: boolean;

  @Prop({ type: Boolean, default: true })
  supportsDocuments: boolean;

  @Prop({ type: Boolean, default: true })
  supportsJson: boolean;
}

export const ModelCapabilitiesSchema = SchemaFactory.createForClass(ModelCapabilities);

@Schema({ timestamps: true })
export class LLMModel {
  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ required: true, trim: true })
  modelId: string;

  @Prop({
    required: true,
    enum: ['openai', 'anthropic', 'gemini', 'ollama', 'lmstudio', 'custom', 'openrouter'],
    default: 'openai',
  })
  provider: string;

  @Prop({ default: 'https://api.openai.com/v1', trim: true })
  endpoint: string;

  @Prop({ default: '', trim: true })
  apiKey: string;

  @Prop({ type: ModelCapabilitiesSchema, default: () => ({}) })
  capabilities: ModelCapabilities;

  @Prop({ type: Number, default: 0.7 })
  defaultTemperature: number;

  @Prop({ type: Boolean, default: false })
  isDefault: boolean;

  @Prop({ default: 'default', enum: ['default', 'none', 'low', 'medium', 'high'] })
  reasoningEffort?: string;

  @Prop({ default: 'hidden', enum: ['hidden', 'parsed', 'raw'] })
  reasoningFormat?: string;

  @Prop({ default: '' })
  description?: string;
}

export const LLMModelSchema = SchemaFactory.createForClass(LLMModel);

LLMModelSchema.index({ modelId: 1, provider: 1 }, { unique: true });
LLMModelSchema.index({ isDefault: 1 });
