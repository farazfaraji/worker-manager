import { Controller, Get } from '@nestjs/common';
import { NodeDefinitionsService } from './node-definitions.service';

@Controller()
export class NodeDefinitionsController {
  constructor(private readonly service: NodeDefinitionsService) {}

  @Get('node-definitions')
  getAllDefinitions() {
    return this.service.getAllDefinitions();
  }

  @Get('tools')
  getAllTools() {
    return this.service.getAllDefinitions();
  }

  @Get('agents')
  getAgents() {
    return this.service.getAgentsList();
  }
}
