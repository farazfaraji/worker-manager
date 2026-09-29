import { Injectable, Logger } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';

@Injectable()
export class ScriptPlugin implements ToolPlugin {
  readonly toolType = 'script';
  private readonly logger = new Logger(ScriptPlugin.name);

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context } = ctx;
    const config = node?.data?.config || {};

    if (!config.code) {
      this.logger.error(`   ❌ [Script Execution] Script node "${node?.data?.name || node.id}" has no code specified`);
      throw new Error('Script node has no code');
    }
    this.logger.log(`   📜 [Script Execution] Executing custom JavaScript code...`);
    const targetInput = nodeInput?.input !== undefined ? nodeInput.input : nodeInput;

    const contextKeys = Object.keys(context || {}).filter(
      (k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'input' && k !== 'context',
    );
    const contextValues = contextKeys.map((k) => context[k]);

    const script = new Function('input', 'context', ...contextKeys, String(config.code));
    return await script(targetInput, context, ...contextValues);
  }
}
