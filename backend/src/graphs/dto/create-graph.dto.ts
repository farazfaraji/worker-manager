import { IsNotEmpty, IsString, IsOptional, IsArray, IsObject } from 'class-validator';

export class CreateGraphDto {
  @IsNotEmpty()
  @IsString()
  projectId: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsArray()
  nodes?: Record<string, any>[];

  @IsOptional()
  @IsArray()
  edges?: Record<string, any>[];

  @IsOptional()
  @IsObject()
  flow?: Record<string, any>;

  @IsOptional()
  @IsObject()
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };

  @IsOptional()
  @IsObject()
  layout?: Record<string, any>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
