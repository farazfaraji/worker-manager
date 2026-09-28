import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { EventAction, EventSource } from '../event.types';

export type EventRecordDocument = EventRecord & Document;

@Schema({ timestamps: true, collection: 'events' })
export class EventRecord {
  @Prop({ required: true, unique: true, index: true })
  eventId: string;

  @Prop({ required: true, index: true })
  topic: string;

  @Prop({ required: true, index: true })
  entityName: string;

  @Prop({ required: true, index: true })
  entityId: string;

  @Prop({ required: true, index: true, type: String })
  eventType: EventAction;

  @Prop({ required: true, index: true })
  timestamp: string;

  @Prop({ index: true })
  projectId?: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  source: EventSource;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  data: any;

  @Prop({ type: [String], default: [] })
  dispatchedRuns: string[];
}

export const EventRecordSchema = SchemaFactory.createForClass(EventRecord);
