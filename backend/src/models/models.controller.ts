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

@Controller('models')
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

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
