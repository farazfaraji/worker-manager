import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type ArtifactDocument = Artifact & Document;

@Schema({ timestamps: true })
export class Artifact {
  @Prop({ required: true, unique: true, index: true }) artifactId: string;
  @Prop({ index: true }) logicalId: string;
  @Prop({ index: true }) rootArtifactId: string;
  @Prop({ required: true, default: true, index: true }) isLatest: boolean;
  @Prop({ index: true }) contentHash: string;
  @Prop({ required: true, default: 1 }) schemaVersion: number;

  @Prop({ required: true, default: 'default', index: true }) projectId: string;
  @Prop({ required: true, index: true }) type: string;
  @Prop({ required: true, default: 'general', index: true }) category: string;
  @Prop({ type: [String], default: [], index: true }) tags: string[];
  @Prop({ default: 'markdown', index: true }) format?: string;
  @Prop() language?: string;
  @Prop({ required: true }) title: string;
  @Prop({ type: MongooseSchema.Types.Mixed, required: true }) content: any;
  @Prop({ required: true, default: 'draft', index: true }) status: string;
  @Prop({ required: true, default: 1 }) version: number;
  @Prop({ index: true }) parentArtifactId?: string;
  @Prop() author?: string;
  @Prop() changeSummary?: string;
  @Prop() idempotencyKey?: string;

  /** Read only by the one-time migration that converts old records. New writes do not set these. */
  @Prop({ type: [String], default: [] }) keyword: string[];
  @Prop({ type: [String], default: [] }) keywords: string[];
  @Prop({ type: [String], default: [] }) linkedArtifactIds: string[];

  @Prop({ type: [String], default: [] }) sourceEventIds: string[];
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} }) metadata: Record<string, any>;
}

export const ArtifactSchema = SchemaFactory.createForClass(Artifact);

// Multi-field indexes for fast logical queries and latest-version resolution
ArtifactSchema.index({ logicalId: 1, version: -1 });
ArtifactSchema.index({ logicalId: 1, isLatest: 1 });
ArtifactSchema.index({ projectId: 1, logicalId: 1, isLatest: 1 });
ArtifactSchema.index({ projectId: 1, type: 1, isLatest: 1 });
ArtifactSchema.index({ projectId: 1, category: 1, isLatest: 1 });
ArtifactSchema.index({ projectId: 1, status: 1, isLatest: 1 });
ArtifactSchema.index(
  { projectId: 1, idempotencyKey: 1 },
  {
    unique: true,
    name: 'project_idempotency_key',
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);
