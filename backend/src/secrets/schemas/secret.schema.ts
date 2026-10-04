import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SecretDocument = Secret & Document;

@Schema({ timestamps: true, collection: 'secrets' })
export class Secret {
  @Prop({ required: true, index: true }) projectId: string;
  @Prop({ required: true }) name: string;
  @Prop({ required: true }) ciphertext: string;
  @Prop({ required: true }) iv: string;
  @Prop({ required: true }) authTag: string;
  @Prop({ default: '' }) description: string;
  @Prop() lastUsedAt?: Date;
}

export const SecretSchema = SchemaFactory.createForClass(Secret);
SecretSchema.index({ projectId: 1, name: 1 }, { unique: true });
