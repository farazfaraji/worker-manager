import { IsString, IsOptional, IsArray, IsObject } from 'class-validator';

export interface FlowChatMessageDto {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class FlowAssistantChatDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsArray()
  history?: FlowChatMessageDto[];

  @IsOptional()
  @IsObject()
  currentGraph?: {
    blocks?: any[];
    connections?: any[];
  };
}

export interface FlowAssistantResponse {
  reply: string;
  flowChanges?: string[];
  graph?: {
    blocks: any[];
    connections: any[];
  };
  modelUsed: string;
  provider: string;
}
