import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LLMModel, LLMModelSchema } from './schemas/llm-model.schema';
import { ModelsService } from './models.service';
import { ModelsController } from './models.controller';

import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: LLMModel.name, schema: LLMModelSchema }]),
    SettingsModule,
  ],
  controllers: [ModelsController],
  providers: [ModelsService],
  exports: [ModelsService, MongooseModule],
})
export class ModelsModule {}
