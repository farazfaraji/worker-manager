import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ProjectVaultKeyDocument = ProjectVaultKey & Document;

/** Per-project encryption passphrase. Never returned by the HTTP API. */
@Schema({ timestamps: true, collection: 'project_vault_keys' })
export class ProjectVaultKey {
  @Prop({ required: true, unique: true, index: true }) projectId: string;
  @Prop({ required: true }) keyMaterial: string;
}

export const ProjectVaultKeySchema = SchemaFactory.createForClass(ProjectVaultKey);
