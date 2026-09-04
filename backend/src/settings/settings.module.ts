import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Setting, SettingSchema } from './schemas/setting.schema';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { EmbeddingModel, EmbeddingModelSchema } from './schemas/embedding-model.schema';
import { EmbeddingModelsService } from './embedding-models.service';
import { EmbeddingModelsController } from './embedding-models.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Setting.name, schema: SettingSchema }, { name: EmbeddingModel.name, schema: EmbeddingModelSchema }]),
  ],
  controllers: [SettingsController, EmbeddingModelsController],
  providers: [SettingsService, EmbeddingModelsService],
  exports: [SettingsService, EmbeddingModelsService],
})
export class SettingsModule {}
