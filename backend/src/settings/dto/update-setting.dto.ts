import { IsOptional, IsString, IsBoolean, IsNumber, IsObject } from 'class-validator';

export class UpdateSettingDto {
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
  @IsObject()
  customSettings?: Record<string, any>;
}
