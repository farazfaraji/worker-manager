import { IsOptional, IsString, IsBoolean, IsNumber, IsObject } from 'class-validator';

export class UpdateSettingDto {
  @IsOptional()
  @IsString()
  flowHelperModel?: string;

  @IsOptional()
  @IsString()
  typeGeneratorModel?: string;

  @IsOptional()
  @IsBoolean()
  typeGeneratorStrictMode?: boolean;

  @IsOptional()
  @IsNumber()
  autoSaveInterval?: number;

  @IsOptional()
  @IsBoolean()
  enableSnapToGrid?: boolean;

  @IsOptional()
  @IsBoolean()
  autoPanOnRun?: boolean;

  @IsOptional()
  @IsString()
  logVerbosity?: string;

  @IsOptional()
  @IsNumber()
  nodeTimeout?: number;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  telegramBotToken?: string;

  @IsOptional()
  @IsString()
  telegramUpdateMode?: string;

  @IsOptional()
  @IsNumber()
  telegramPollIntervalSeconds?: number;

  @IsOptional()
  @IsString()
  telegramWebhookUrl?: string;

  @IsOptional()
  @IsObject()
  customSettings?: Record<string, any>;
}
