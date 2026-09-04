import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ProjectDocument = Project & Document;

@Schema({ timestamps: true })
export class Project {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true, default: '' })
  description?: string;

  @Prop({ default: '#4f46e5' })
  color?: string;

  @Prop({ type: Object, default: {} })
  metadata?: Record<string, any>;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);
