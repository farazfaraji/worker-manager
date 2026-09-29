import { Injectable } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { VariableResolverService } from '../services/variable-resolver.service';

@Injectable()
export class OutputPlugin implements ToolPlugin {
  readonly toolType = 'output';

  constructor(private readonly variableResolver: VariableResolverService) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context } = ctx;
    const config = node?.data?.config || {};

    const val = nodeInput?.value !== undefined ? nodeInput.value : config.value;
    const keyName = String(nodeInput?.name || config.name || '').trim();
    const outputVal = this.variableResolver.resolveValue(val, context);
    if (keyName) {
      return { [keyName]: outputVal, value: outputVal, result: outputVal };
    }
    return { value: outputVal, result: outputVal };
  }
}
