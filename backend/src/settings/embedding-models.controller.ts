import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { EmbeddingModelsService } from './embedding-models.service';

@Controller('embedding-models')
export class EmbeddingModelsController {
  constructor(private readonly service: EmbeddingModelsService) {}
  @Get() findAll() { return this.service.findAll(); }
  @Post() create(@Body() body: any) { return this.service.create(body); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.service.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }
}

