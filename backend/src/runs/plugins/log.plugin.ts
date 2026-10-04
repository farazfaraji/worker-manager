import { Injectable, Logger, Optional } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { VariableResolverService } from '../services/variable-resolver.service';
import { redactSecrets } from '../services/redaction.util';

@Injectable()
export class LogPlugin implements ToolPlugin {
  readonly toolType = 'log';
  private readonly logger = new Logger(LogPlugin.name);

  constructor(@Optional() private readonly variableResolver?: VariableResolverService) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context, runId } = ctx;
    const config = node?.data?.config || {};
    const payload = { ...config, ...(nodeInput && typeof nodeInput === 'object' ? nodeInput : {}) };
    const op = String(payload.operation || 'log').toLowerCase();

    if (op === 'inspect') return this.inspect(payload, context, runId);
    if (op === 'assert') return this.assert(payload, nodeInput, context, runId);
    if (op === 'metric') return this.metric(payload, context, runId);
    if (op === 'timer') return this.timer(payload, context, runId);
    return this.log(payload, runId);
  }

  getValidHandles(): Set<string> {
    return new Set(['result', 'true', 'false']);
  }

  getProducedPaths(nodeName: string): Set<string> {
    return new Set([`${nodeName}.result`, `${nodeName}.result.message`, `${nodeName}.result.elapsedMs`]);
  }

  private log(payload: any, runId: string) {
    const level = String(payload.level || 'info').toLowerCase();
    const message = String(payload.message ?? '');
    const data = payload.data === undefined ? undefined : redactSecrets(payload.data);
    const safeMessage = String(redactSecrets(message) ?? '');
    const entry = {
      level,
      message: safeMessage,
      data,
      timestamp: new Date().toISOString(),
      runId,
    };
    const line = `[run ${runId}] ${safeMessage}`;
    if (level === 'error') this.logger.error(line);
    else if (level === 'warn' || level === 'warning') this.logger.warn(line);
    else if (level === 'debug') this.logger.debug(line);
    else this.logger.log(line);
    return { status: 'completed', result: entry };
  }

  private inspect(payload: any, context: Record<string, any>, runId: string) {
    const paths = this.pathList(payload.paths);
    const snapshot: Record<string, any> = {};
    for (const ref of paths) {
      const value = this.variableResolver
        ? this.variableResolver.resolveValue(ref, context)
        : this.readPath(context, ref);
      snapshot[ref] = redactSecrets(value);
    }
    return {
      status: 'completed',
      result: {
        level: 'debug',
        message: `inspected ${paths.length} path(s)`,
        data: snapshot,
        timestamp: new Date().toISOString(),
        runId,
      },
    };
  }

  private async assert(payload: any, nodeInput: any, context: Record<string, any>, runId: string) {
    const passed = await this.evaluate(payload, nodeInput, context);
    const message = String(payload.message || (passed ? 'Assertion passed' : 'Assertion failed'));
    const onFail = String(payload.onFail || 'fail').toLowerCase();
    const result = {
      level: passed ? 'info' : 'error',
      message: String(redactSecrets(message) ?? ''),
      passed,
      timestamp: new Date().toISOString(),
      runId,
    };
    if (!passed && onFail !== 'route') {
      const err: any = new Error(result.message);
      err.code = 'ASSERTION_FAILED';
      throw err;
    }
    if (!passed) this.logger.warn(`[run ${runId}] ${result.message}`);
    return { status: 'completed', conditionMet: passed, result };
  }

  private metric(payload: any, context: Record<string, any>, runId: string) {
    const entry = {
      name: String(payload.name || payload.metric || 'metric'),
      value: Number(payload.value ?? payload.metricValue ?? 0),
      tags: redactSecrets(payload.tags || {}),
      timestamp: new Date().toISOString(),
      runId,
    };
    if (!Array.isArray(context.__customMetrics)) context.__customMetrics = [];
    context.__customMetrics.push(entry);
    return {
      status: 'completed',
      result: { level: 'info', message: entry.name, data: entry, timestamp: entry.timestamp, runId },
    };
  }

  private timer(payload: any, context: Record<string, any>, runId: string) {
    const label = String(payload.label || 'default');
    const phase = String(payload.phase || payload.action || 'start').toLowerCase();
    if (!context.__timers || typeof context.__timers !== 'object') context.__timers = {};
    const now = Date.now();
    if (phase === 'stop') {
      const started = context.__timers[label];
      const elapsedMs = typeof started === 'number' ? now - started : null;
      delete context.__timers[label];
      return {
        status: 'completed',
        result: {
          level: 'info',
          message: label,
          elapsedMs,
          timestamp: new Date().toISOString(),
          runId,
        },
      };
    }
    context.__timers[label] = now;
    return {
      status: 'completed',
      result: { level: 'info', message: label, startedAt: now, timestamp: new Date().toISOString(), runId },
    };
  }

  private pathList(raw: any): string[] {
    if (Array.isArray(raw)) return raw.map((item) => String(item).trim()).filter(Boolean);
    return String(raw || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private readPath(context: Record<string, any>, ref: string): any {
    const parts = String(ref || '').split('.').filter(Boolean);
    let current: any = context;
    for (const part of parts) {
      if (current == null) return undefined;
      current = current[part];
    }
    return current;
  }

  private async evaluate(config: any, nodeInput: any, context: Record<string, any>): Promise<boolean> {
    const isExpression = config.mode === 'expression' || (!config.mode && config.expression);
    if (isExpression && config.expression) {
      const expr = String(config.expression);
      const body = /\breturn\b/.test(expr) ? expr : `return (${expr});`;
      const contextKeys = Object.keys(context || {}).filter(
        (key) => /^[A-Za-z_$][\w$]*$/.test(key) && key !== 'input' && key !== 'context',
      );
      const contextValues = contextKeys.map((key) => context[key]);
      const evaluator = new Function('input', 'context', ...contextKeys, body);
      return Boolean(await evaluator(nodeInput, context, ...contextValues));
    }
    const left = this.unwrap(this.variableResolver ? this.variableResolver.resolveValue(config.leftValue, context) : config.leftValue);
    const right = this.unwrap(this.variableResolver ? this.variableResolver.resolveValue(config.rightValue, context) : config.rightValue);
    const operator = String(config.operator || 'equals');
    switch (operator) {
      case 'notEquals':
        return left !== right && String(left) !== String(right);
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

  private unwrap(value: any): any {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const values = Object.values(value);
      if (values.length === 1 && (typeof values[0] !== 'object' || values[0] === null)) return values[0];
    }
    return value;
  }
}
