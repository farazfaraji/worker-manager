import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type TraceDocument = Trace & Document;

@Schema({ timestamps: true })
export class Trace {
  @Prop({ required: true, index: true }) projectId: string;
  @Prop({ index: true }) runId?: string;
  @Prop({ required: true, index: true }) sourceType: string;
  @Prop({ required: true, index: true }) sourceId: string;
  @Prop({ required: true, index: true }) targetType: string;
  @Prop({ required: true, index: true }) targetId: string;
  @Prop({ required: true }) relation: string;
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} }) metadata: Record<string, any>;
}

export const TraceSchema = SchemaFactory.createForClass(Trace);

