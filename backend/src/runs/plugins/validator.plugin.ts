import { Injectable, Logger } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';

@Injectable()
export class ValidatorPlugin implements ToolPlugin {
  readonly toolType = 'validator';
  private readonly logger = new Logger(ValidatorPlugin.name);

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { nodeInput } = ctx;
    this.logger.log(`   🛡️ [Validator Execution] Validating input payload...`);
    const valid = nodeInput !== undefined && nodeInput !== null;
    return { valid, input: nodeInput };
  }
}
