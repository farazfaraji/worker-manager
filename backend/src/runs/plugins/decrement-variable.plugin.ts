import { Injectable, Logger } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { VariableResolverService, RuntimeNode } from '../services/variable-resolver.service';
import { Decrement } from '../../functions/decrement';

@Injectable()
export class DecrementVariablePlugin implements ToolPlugin {
  readonly toolType = ['decrement', 'decrement-variable'];
  private readonly logger = new Logger(DecrementVariablePlugin.name);

  constructor(private readonly variableResolver: VariableResolverService) {}

  matches(type: string, node?: RuntimeNode): boolean {
    const data = node?.data || {};
    const name = String(data.definitionName || data.name || '').toLowerCase();
    return (
      type === 'decrement' ||
      type === 'decrement-variable' ||
      data.definitionId === 'decrement-variable' ||
      data.definitionId === 'decrement' ||
      name.includes('decrement')
    );
  }

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, context } = ctx;
    const config = node?.data?.config || {};

    const targetVal = this.variableResolver.resolveValue(config.variable, context);
    const amountVal =
      config.amount !== undefined ? this.variableResolver.resolveValue(config.amount, context) : 1;
    this.logger.log(
      `   ➖ [Decrement Variable] Resolved Target: ${JSON.stringify(targetVal)} | Amount: ${JSON.stringify(amountVal)}`,
    );
    const decrementFn = new Decrement();
    const result = decrementFn.execute({ value: targetVal, amount: amountVal });
    if (
      typeof config.variable === 'string' &&
      (this.variableResolver.looksLikeReference(config.variable.trim()) ||
        this.variableResolver.looksLikeWholeNodeReference(config.variable.trim(), context) ||
        config.variable.trim() in context ||
        (context.state && config.variable.trim() in context.state))
    ) {
      this.variableResolver.assignReference(config.variable.trim(), result.value, context);
    }
    return result;
  }
}
