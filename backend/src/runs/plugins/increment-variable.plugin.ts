import { Injectable, Logger } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { VariableResolverService, RuntimeNode } from '../services/variable-resolver.service';
import { Increment } from '../../functions/increment';

@Injectable()
export class IncrementVariablePlugin implements ToolPlugin {
  readonly toolType = ['increment', 'increment-variable'];
  private readonly logger = new Logger(IncrementVariablePlugin.name);

  constructor(private readonly variableResolver: VariableResolverService) {}

  matches(type: string, node?: RuntimeNode): boolean {
    const data = node?.data || {};
    const name = String(data.definitionName || data.name || '').toLowerCase();
    return (
      type === 'increment' ||
      type === 'increment-variable' ||
      data.definitionId === 'increment-variable' ||
      data.definitionId === 'increment' ||
      name.includes('increment')
    );
  }

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, context } = ctx;
    const config = node?.data?.config || {};

    const targetVal = this.variableResolver.resolveValue(config.variable, context);
    const amountVal =
      config.amount !== undefined ? this.variableResolver.resolveValue(config.amount, context) : 1;
    this.logger.log(
      `   ➕ [Increment Variable] Resolved Target: ${JSON.stringify(targetVal)} | Amount: ${JSON.stringify(amountVal)}`,
    );
    const incrementFn = new Increment();
    const result = incrementFn.execute({ value: targetVal, amount: amountVal });
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
