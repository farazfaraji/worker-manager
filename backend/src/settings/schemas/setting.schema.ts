import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SettingDocument = Setting & Document;

@Schema({ timestamps: true, collection: 'setting' })
export class Setting {
  @Prop({ type: String, default: null, index: true })
  projectId?: string;

  @Prop({ type: String, trim: true })
  flowHelperModel?: string;

  @Prop({ type: String, trim: true })
  typeGeneratorModel?: string;

  @Prop({ type: Boolean })
  typeGeneratorStrictMode?: boolean;

  @Prop({ type: Number })
  autoSaveInterval?: number;

  @Prop({ type: Boolean })
  enableSnapToGrid?: boolean;

  @Prop({ type: Boolean })
  autoPanOnRun?: boolean;

  @Prop({ type: String, trim: true })
  logVerbosity?: string;

  @Prop({ type: Number })
  nodeTimeout?: number;

  @Prop({ type: String, trim: true })
  telegramBotToken?: string;

  @Prop({ type: String, enum: ['polling', 'webhook'] })
  telegramUpdateMode?: string;

  @Prop({ type: Number })
  telegramPollIntervalSeconds?: number;

  @Prop({ type: String })
  telegramWebhookUrl?: string;

  @Prop({ type: Object, default: () => ({}) })
  customSettings?: Record<string, any>;
}

export const SettingSchema = SchemaFactory.createForClass(Setting);
