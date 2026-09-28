import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type TelegramMessageDocument = TelegramMessage & Document;

@Schema({ timestamps: true })
export class TelegramMessage {
  @Prop({ required: true, index: true })
  messageId: number;

  @Prop({ required: true, index: true })
  chatId: string;

  @Prop()
  messageThreadId?: number;

  @Prop({ required: true, index: true })
  runId: string;

  @Prop({ required: true })
  nodeId: string;

  @Prop()
  graphId?: string;

  @Prop({ required: true })
  token: string;

  @Prop()
  question?: string;

  @Prop({
    required: true,
    enum: ['waiting', 'answered', 'expired'],
    default: 'waiting',
    index: true,
  })
  status: string;

  @Prop({ default: 'polling' })
  updateMode?: string;

  @Prop({ default: 2 })
  pollIntervalSeconds?: number;

  @Prop()
  replyMessageId?: number;

  @Prop()
  replyText?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  replyFrom?: any;

  @Prop({ default: Date.now })
  sentAt: Date;

  @Prop()
  repliedAt?: Date;
}

export const TelegramMessageSchema = SchemaFactory.createForClass(TelegramMessage);

TelegramMessageSchema.index({ chatId: 1, messageId: 1 });
TelegramMessageSchema.index({ runId: 1, status: 1 });
