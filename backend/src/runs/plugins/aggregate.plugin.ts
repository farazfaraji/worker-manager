import { Injectable, Logger } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';

export interface AggregateResult {
  items: any[];
  errors: Array<{ index: number; childRunId?: string; error: any }>;
  count: number;
  successCount: number;
  failureCount: number;
  allSucceeded: boolean;
  truncated: boolean;
}

@Injectable()
export class AggregatePlugin implements ToolPlugin {
  readonly toolType = 'aggregate';
  private readonly logger = new Logger(AggregatePlugin.name);

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput } = ctx;
    const config: any = node?.data?.config || {};
    const inputSource: any = nodeInput !== undefined ? nodeInput : config;

    let rawItems: any = undefined;
    if (Array.isArray(inputSource)) {
      rawItems = inputSource;
    } else if (inputSource && typeof inputSource === 'object') {
      if (Array.isArray(inputSource.items)) {
        rawItems = inputSource.items;
      } else if (inputSource.result && Array.isArray(inputSource.result.items)) {
        rawItems = inputSource.result.items;
      } else if (inputSource.items && typeof inputSource.items === 'object' && Array.isArray(inputSource.items.items)) {
        rawItems = inputSource.items.items;
      } else if (Array.isArray(config.items)) {
        rawItems = config.items;
      } else if (config.items && typeof config.items === 'object' && Array.isArray(config.items.items)) {
        rawItems = config.items.items;
      }
    } else if (typeof inputSource === 'string') {
      const trimmed = inputSource.trim();
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            rawItems = parsed;
          } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
            rawItems = parsed.items;
          }
        } catch {}
      }
    }

    if (!Array.isArray(rawItems)) {
      const failedResult: AggregateResult = {
        items: [],
        errors: [{ index: -1, error: 'Invalid input: expected an array or an object containing an items array' }],
        count: 0,
        successCount: 0,
        failureCount: 0,
        allSucceeded: false,
        truncated: false,
      };
      return {
        status: 'failed',
        result: failedResult,
        error: 'Invalid input: expected an array or an object containing an items array',
        ...failedResult,
      };
    }

    const includeSuccessful = config.includeSuccessful !== undefined
      ? Boolean(config.includeSuccessful)
      : (inputSource?.includeSuccessful !== undefined ? Boolean(inputSource.includeSuccessful) : true);
    const includeFailed = config.includeFailed !== undefined
      ? Boolean(config.includeFailed)
      : (inputSource?.includeFailed !== undefined ? Boolean(inputSource.includeFailed) : true);

    let truncated = false;
    if (inputSource && typeof inputSource === 'object') {
      if (typeof inputSource.truncated === 'boolean') {
        truncated = inputSource.truncated;
      } else if (inputSource.result && typeof inputSource.result.truncated === 'boolean') {
        truncated = inputSource.result.truncated;
      } else if (inputSource.items && typeof inputSource.items.truncated === 'boolean') {
        truncated = inputSource.items.truncated;
      }
    }

    const filteredItems: any[] = [];
    const errors: Array<{ index: number; childRunId?: string; error: any }> = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < rawItems.length; i++) {
      const it = rawItems[i];
      const isFailed = Boolean(
        it &&
        typeof it === 'object' &&
        (it.status === 'failed' || (it.error !== undefined && it.error !== null && it.error !== false))
      ) || (it instanceof Error);

      if (isFailed) {
        failureCount++;
        const itemError = (it && typeof it === 'object' && it.error !== undefined)
          ? it.error
          : (it instanceof Error ? it.message : 'Item execution failed');
        const errObj: { index: number; childRunId?: string; error: any } = {
          index: (it && typeof it === 'object' && typeof it.index === 'number') ? it.index : i,
          error: itemError,
        };
        if (it && typeof it === 'object' && it.childRunId) {
          errObj.childRunId = it.childRunId;
        }
        errors.push(errObj);

        if (includeFailed) {
          filteredItems.push(it);
        }
      } else {
        successCount++;
        if (includeSuccessful) {
          filteredItems.push(it);
        }
      }
    }

    const result: AggregateResult = {
      items: filteredItems,
      errors,
      count: filteredItems.length,
      successCount,
      failureCount,
      allSucceeded: failureCount === 0,
      truncated,
    };

    return {
      status: 'completed',
      result,
      ...result,
    };
  }

  getValidHandles(_config?: any, _outputs?: any[], _nodeData?: any, _nodeName?: string): Set<string> {
    return new Set(['items', 'errors', 'count', 'successCount', 'failureCount', 'allSucceeded', 'truncated', 'result']);
  }

  getProducedPaths(nodeName: string, _config?: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>();
    for (const key of ['items', 'errors', 'count', 'successCount', 'failureCount', 'allSucceeded', 'truncated', 'result']) {
      paths.add(`${nodeName}.${key}`);
    }
    return paths;
  }
}
