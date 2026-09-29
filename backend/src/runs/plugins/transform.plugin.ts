import { Injectable, Logger } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';

@Injectable()
export class TransformPlugin implements ToolPlugin {
  readonly toolType = 'transform';
  private readonly logger = new Logger(TransformPlugin.name);

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context } = ctx;
    const config = node?.data?.config || {};

    if (!config.mapping) {
      this.logger.error(`   ❌ [Transform Execution] Transform node has no mapping definition`);
      throw new Error('Transform node has no mapping');
    }
    this.logger.log(`   🔄 [Transform Execution] Applying mapping: ${config.mapping}`);
    const targetInput = nodeInput?.input !== undefined ? nodeInput.input : nodeInput;

    const contextKeys = Object.keys(context || {}).filter(
      (k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'input' && k !== 'context',
    );
    const contextValues = contextKeys.map((k) => context[k]);

    const transform = new Function('input', 'context', ...contextKeys, `return (${config.mapping});`);
    return await transform(targetInput, context, ...contextValues);
  }
}
