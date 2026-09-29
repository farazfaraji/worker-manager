import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ModelsService } from './models.service';
import { LLMModel } from './schemas/llm-model.schema';

import { RevisePromptDto } from './dto/revise-prompt.dto';
import { GenerateSchemaDto } from './dto/generate-schema.dto';
import { FlowAssistantChatDto } from './dto/flow-assistant.dto';

@Controller('models')
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Post('flow-assistant')
  @HttpCode(HttpStatus.OK)
  async flowAssistant(@Body() body: FlowAssistantChatDto) {
    return this.modelsService.executeFlowAssistant(body);
  }

  @Post('revise-prompt')
  @HttpCode(HttpStatus.OK)
  async revisePrompt(@Body() body: RevisePromptDto) {
    return this.modelsService.revisePrompt(body);
  }

  @Post('generate-schema')
  @HttpCode(HttpStatus.OK)
  async generateSchema(@Body() body: GenerateSchemaDto) {
    return this.modelsService.generateSchema(body);
  }

  @Get()
  async getAllModels() {
    return this.modelsService.findAll();
  }

  @Get(':id')
  async getModelById(@Param('id') id: string) {
    return this.modelsService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createModel(@Body() body: Partial<LLMModel>) {
    return this.modelsService.create(body);
  }

  @Put(':id')
  async updateModel(@Param('id') id: string, @Body() body: Partial<LLMModel>) {
    return this.modelsService.update(id, body);
  }

  @Delete(':id')
  async deleteModel(@Param('id') id: string) {
    return this.modelsService.remove(id);
  }
}
