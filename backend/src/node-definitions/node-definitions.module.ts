import { Module } from '@nestjs/common';
import { NodeDefinitionsController } from './node-definitions.controller';
import { NodeDefinitionsService } from './node-definitions.service';

@Module({
  controllers: [NodeDefinitionsController],
  providers: [NodeDefinitionsService],
  exports: [NodeDefinitionsService],
})
export class NodeDefinitionsModule {}
