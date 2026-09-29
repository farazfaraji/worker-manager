import { BadRequestException, Injectable } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';

@Injectable()
export class SubgraphPlugin implements ToolPlugin {
  readonly toolType = 'subgraph';

  async run(_ctx: ToolExecutionContext): Promise<any> {
    throw new BadRequestException('Subgraph nodes must be executed through GraphRunnerService');
  }
}
