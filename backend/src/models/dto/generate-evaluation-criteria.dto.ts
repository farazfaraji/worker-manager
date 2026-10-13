import { IsString, IsOptional } from 'class-validator';

export class GenerateEvaluationCriteriaDto {
  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsString()
  userPrompt?: string;

  @IsOptional()
  @IsString()
  outputType?: string;

  @IsOptional()
  @IsString()
  instruction?: string;

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}
