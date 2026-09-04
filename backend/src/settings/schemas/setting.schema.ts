import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SettingDocument = Setting & Document;

@Schema({ timestamps: true, collection: 'setting' })
export class Setting {
  @Prop({ type: String, default: 'gpt-4o', trim: true })
  typeGeneratorModel: string;

  @Prop({ type: Boolean, default: true })
  typeGeneratorStrictMode: boolean;

  @Prop({ type: Number, default: 30 })
  autoSaveInterval: number;

  @Prop({ type: Boolean, default: true })
  enableSnapToGrid: boolean;

  @Prop({ type: Boolean, default: true })
  autoPanOnRun: boolean;

  @Prop({ type: String, default: 'standard', trim: true })
  logVerbosity: string;

  @Prop({ type: Number, default: 60 })
  nodeTimeout: number;

  @Prop({ type: Object, default: () => ({}) })
  customSettings?: Record<string, any>;
}

export const SettingSchema = SchemaFactory.createForClass(Setting);
