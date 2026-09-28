import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class GenerateSchemaDto {
  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  schemaType?: string;

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsBoolean()
  strictMode?: boolean;

  @IsOptional()
  @IsString()
  projectId?: string;
}
