import { Injectable, Logger } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { VariableResolverService } from '../services/variable-resolver.service';

@Injectable()
export class ConditionPlugin implements ToolPlugin {
  readonly toolType = 'condition';
  private readonly logger = new Logger(ConditionPlugin.name);

  constructor(private readonly variableResolver: VariableResolverService) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context } = ctx;
    const config = node?.data?.config || {};

    let condResult: boolean;
    const isCustomExpression = config.mode === 'expression' || (!config.mode && config.expression);
    if (isCustomExpression && config.expression) {
      const expr = String(config.expression);
      this.logger.log(`   🔀 [Condition Execution] Evaluating expression: "${expr}"`);
      const contextKeys = Object.keys(context || {}).filter(
        (k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'input' && k !== 'context',
      );
      const contextValues = contextKeys.map((k) => context[k]);

      const evaluator = new Function('input', 'context', ...contextKeys, expr);
      condResult = Boolean(await evaluator(nodeInput, context, ...contextValues));
    } else {
      const left = this.unwrapConditionValue(this.variableResolver.resolveValue(config.leftValue, context));
      const right = this.unwrapConditionValue(this.variableResolver.resolveValue(config.rightValue, context));
      const operator = String(config.operator || 'equals');
      this.logger.log(`   🔀 [Condition Execution] Comparing ${JSON.stringify(left)} ${operator} ${JSON.stringify(right)}`);
      condResult = this.compareConditionValues(left, right, operator);
    }
    this.logger.log(`   🔀 [Condition Result]: ${condResult}`);
    return { result: condResult, conditionMet: condResult };
  }

  private unwrapConditionValue(value: any): any {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const values = Object.values(value);
      if (values.length === 1 && (typeof values[0] !== 'object' || values[0] === null)) return values[0];
    }
    return value;
  }

  private compareConditionValues(left: any, right: any, operator: string): boolean {
    switch (operator) {
      case 'notEquals':
        return left !== right;
      case 'contains':
        return Array.isArray(left) ? left.includes(right) : String(left ?? '').includes(String(right ?? ''));
      case 'greaterThan':
        return Number(left) > Number(right);
      case 'lessThan':
        return Number(left) < Number(right);
      case 'isEmpty':
        return left === undefined || left === null || left === '' || (Array.isArray(left) && left.length === 0);
      case 'equals':
      default:
        return left === right || String(left) === String(right);
    }
  }
}
