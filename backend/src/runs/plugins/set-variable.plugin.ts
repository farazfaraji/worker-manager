import { Injectable, Logger } from '@nestjs/common';
import {
  ToolPlugin,
  ToolExecutionContext,
  OutputSynthesisContext,
  NodeOutputDefinition,
  UpstreamVariable,
} from './tool-plugin.interface';
import { VariableResolverService } from '../services/variable-resolver.service';

@Injectable()
export class SetVariablePlugin implements ToolPlugin {
  readonly toolType = ['variable', 'set-variable'];
  private readonly logger = new Logger(SetVariablePlugin.name);

  constructor(private readonly variableResolver: VariableResolverService) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, context } = ctx;
    const config = node?.data?.config || {};

    const rawKey = config.key !== undefined && config.key !== null ? String(config.key).trim() : 'value';
    const key = this.variableResolver.resolveTemplate(rawKey, context);
    const operation = String(config.operation || 'set').toLowerCase();

    context.state = context.state || {};

    if (operation === 'delete') {
      delete context.state[key];
      delete context[key];
      this.logger.log(`   🗑️ [Set Variable] Deleted variable key: "${key}" from state`);
      return {
        [key]: null,
        key,
        value: null,
        deleted: true,
      };
    }

    const valueType = String(config.valueType || 'string').toLowerCase();
    let resolvedVal: any;

    if (valueType === 'number') {
      const rawNum = config.numberValue !== undefined ? config.numberValue : config.value;
      const resolvedNum = this.variableResolver.resolveValue(rawNum, context);
      const parsed = Number(resolvedNum);
      resolvedVal = isNaN(parsed) ? resolvedNum : parsed;
    } else if (valueType === 'boolean') {
      const rawBool = config.booleanValue !== undefined ? config.booleanValue : config.value;
      resolvedVal = rawBool === true || rawBool === 'true' || rawBool === 1 || rawBool === '1';
    } else if (valueType === 'json') {
      const rawJson = config.jsonValue !== undefined ? config.jsonValue : config.value;
      if (typeof rawJson === 'string') {
        const templated = this.variableResolver.resolveTemplate(rawJson, context);
        try {
          resolvedVal = JSON.parse(templated);
        } catch (jsonErr: any) {
          this.logger.warn(
            `   ⚠️ [Set Variable] JSON parse failed for key "${key}": ${jsonErr.message}. Storing as resolved string.`,
          );
          resolvedVal = templated;
        }
      } else {
        resolvedVal = this.variableResolver.resolveValue(rawJson, context);
      }
    } else if (valueType === 'variable') {
      const rawVar =
        config.variableValue !== undefined ? config.variableValue : config.variable || config.value;
      resolvedVal = this.variableResolver.resolveValue(rawVar, context);
    } else {
      // Default: string
      const rawStr = config.stringValue !== undefined ? config.stringValue : config.value;
      resolvedVal = this.variableResolver.resolveValue(rawStr, context);
    }

    // Handle operations: set, merge, append
    const existing = context.state[key] !== undefined ? context.state[key] : context[key];
    let finalVal = resolvedVal;

    if (operation === 'merge') {
      const baseObj =
        typeof existing === 'object' && existing !== null && !Array.isArray(existing) ? existing : {};
      const newObj =
        typeof resolvedVal === 'object' && resolvedVal !== null && !Array.isArray(resolvedVal)
          ? resolvedVal
          : { value: resolvedVal };
      finalVal = { ...baseObj, ...newObj };
    } else if (operation === 'append') {
      const baseArr = Array.isArray(existing)
        ? existing
        : existing !== undefined && existing !== null
          ? [existing]
          : [];
      finalVal = [...baseArr, resolvedVal];
    }

    // Persist in state and context
    context.state[key] = finalVal;
    context[key] = finalVal;

    if (key.includes('.')) {
      this.variableResolver.assignReference(key, finalVal, context);
    }

    this.logger.log(
      `   📌 [Set Variable] Key: "${key}" (${valueType}, ${operation}) = ${JSON.stringify(finalVal)}`,
    );
    return {
      [key]: finalVal,
      key,
      value: finalVal,
    };
  }

  getValidHandles(config: any, _outputs: any[], _nodeData?: any, _nodeName?: string): Set<string> {
    const valid = new Set<string>();
    valid.add('value');
    if (config?.key) {
      valid.add(String(config.key).trim().toLowerCase());
    }
    return valid;
  }

  getProducedPaths(nodeName: string, config: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>();
    if (config?.key) {
      const keyName = String(config.key).trim();
      if (keyName) {
        paths.add(`${nodeName}.${keyName}`);
        paths.add(`state.${keyName}`);
        paths.add(keyName);
      }
    }
    return paths;
  }

  synthesizeOutputs(ctx: OutputSynthesisContext): NodeOutputDefinition[] {
    const existing = ctx.data?.definitionOutputs?.length
      ? ctx.data.definitionOutputs
      : ctx.def?.outputs?.length
        ? ctx.def.outputs
        : ctx.data?.outputs || [];

    if (existing && existing.length > 0) return existing;
    return [{ name: 'value', label: 'Assigned Value', type: 'object' }];
  }

  getUpstreamVariables(
    nodeId: string,
    nodeName: string,
    config: any,
    _outputs: NodeOutputDefinition[],
    _node?: any,
  ): UpstreamVariable[] {
    if (config?.key) {
      const keyName = String(config.key).trim();
      if (keyName) {
        const valType = String(config.valueType || '').toLowerCase();
        let resolvedType = 'string';
        if (
          valType === 'number' ||
          typeof config.value === 'number' ||
          typeof config.numberValue === 'number'
        ) {
          resolvedType = 'number';
        } else if (
          valType === 'boolean' ||
          typeof config.value === 'boolean' ||
          typeof config.booleanValue === 'boolean'
        ) {
          resolvedType = 'boolean';
        } else if (
          valType === 'json' ||
          typeof config.value === 'object' ||
          typeof config.jsonValue === 'object'
        ) {
          resolvedType = 'object';
        }

        return [
          {
            nodeId,
            nodeName,
            outputName: keyName,
            path: `${nodeName}.${keyName}`,
            type: resolvedType,
            schema: undefined,
          },
          {
            nodeId,
            nodeName: 'state',
            outputName: keyName,
            path: `state.${keyName}`,
            type: resolvedType,
            schema: undefined,
          },
        ];
      }
    }
    return [];
  }
}
