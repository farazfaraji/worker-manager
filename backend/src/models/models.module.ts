import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LLMModel, LLMModelSchema } from './schemas/llm-model.schema';
import { ModelsService } from './models.service';
import { ModelsController } from './models.controller';
import { LlmClientService } from './services/llm-client.service';
import { PromptReviserService } from './services/prompt-reviser.service';
import { SchemaGeneratorService } from './services/schema-generator.service';
import { FlowAssistantService } from './services/flow-assistant.service';

import { SettingsModule } from '../settings/settings.module';
import { NodeDefinitionsModule } from '../node-definitions/node-definitions.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: LLMModel.name, schema: LLMModelSchema }]),
    SettingsModule,
    NodeDefinitionsModule,
  ],
  controllers: [ModelsController],
  providers: [
    ModelsService,
    LlmClientService,
    PromptReviserService,
    SchemaGeneratorService,
    FlowAssistantService,
  ],
  exports: [
    ModelsService,
    LlmClientService,
    PromptReviserService,
    SchemaGeneratorService,
    FlowAssistantService,
    MongooseModule,
  ],
})
export class ModelsModule {}
