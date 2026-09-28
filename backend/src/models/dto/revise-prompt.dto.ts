import { IsString, IsOptional } from 'class-validator';

export class RevisePromptDto {
  @IsString()
  prompt: string;

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
