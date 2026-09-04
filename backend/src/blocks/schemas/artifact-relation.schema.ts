import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type ArtifactRelationDocument = ArtifactRelation & Document;

@Schema({ timestamps: true, collection: 'artifact_relations' })
export class ArtifactRelation {
  @Prop({ required: true, unique: true, index: true })
  relationId: string;

  @Prop({ default: '', index: true })
  projectId: string;

  @Prop({ required: true, index: true })
  sourceLogicalId: string;

  @Prop({ required: true, index: true })
  targetLogicalId: string;

  @Prop({ required: true, index: true })
  type: string;

  @Prop({ required: true, index: true })
  inverseType: string;

  @Prop({ default: 'active', index: true })
  status: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata: Record<string, any>;
}

export const ArtifactRelationSchema = SchemaFactory.createForClass(ArtifactRelation);

// Multi-field indexes for high performance relation lookups & duplicate prevention
ArtifactRelationSchema.index({ projectId: 1, sourceLogicalId: 1 });
ArtifactRelationSchema.index({ projectId: 1, targetLogicalId: 1 });
ArtifactRelationSchema.index(
  { projectId: 1, sourceLogicalId: 1, targetLogicalId: 1, type: 1 },
  { unique: true },
);
