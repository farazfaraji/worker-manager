import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { BrowserRunnerService } from '../services/browser-runner.service';

@Injectable()
export class ActionPlugin implements ToolPlugin {
  readonly toolType = 'action';
  private readonly logger = new Logger(ActionPlugin.name);

  constructor(@Optional() private readonly browserRunner?: BrowserRunnerService) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context, runId } = ctx;
    const config: any = node?.data?.config || {};
    const provider = String(config.provider || config.integration || 'http').toLowerCase();
    const action = String(config.action || config.operation || 'request').toLowerCase();

    if (provider === 'browser') {
      if (!this.browserRunner) {
        return { status: 'failed', error: 'BrowserRunnerService is not available' };
      }
      const browserNode: any = {
        id: `action-${runId || Date.now()}`,
        data: {
          appId: config.appId || 'browser-action',
          name: config.appId || 'browser-action',
          config,
        },
      };
      const result = await this.browserRunner.executeBrowserNode(
        browserNode,
        config,
        context || {},
        runId || `action-${Date.now()}`,
      );
      return { status: 'completed', result: { provider, action, ...result } };
    }

    if (provider === 'http' || provider === 'web') {
      const url = String(config.url || nodeInput?.url || '');
      if (!/^https?:\/\//i.test(url)) {
        throw new BadRequestException('action.http requires a valid http(s) URL');
      }
      const hostname = new URL(url).hostname;
      const allowedHosts = Array.isArray(config.allowedHosts) ? config.allowedHosts.map(String) : [];
      if (!allowedHosts.includes(hostname) && !config.allowAnyHost) {
        return {
          status: 'completed',
          result: { provider, action, dryRun: true, blocked: true, reason: 'Host is not in allowedHosts', url },
        };
      }
      const response = await fetch(url, {
        method: String(config.method || 'GET').toUpperCase(),
        headers: config.headers || {},
        body: config.body === undefined ? undefined : JSON.stringify(config.body),
      });
      const text = await response.text();
      let body: any = text;
      try {
        body = JSON.parse(text);
      } catch {}
      return {
        status: 'completed',
        result: { provider, action, status: response.status, ok: response.ok, headers: Object.fromEntries(response.headers.entries()), body },
      };
    }

    return {
      status: 'completed',
      result: { provider, action, parameters: config.parameters || nodeInput, delegated: true },
    };
  }

  getValidHandles(_config?: any, _outputs?: any[], _nodeData?: any, _nodeName?: string): Set<string> {
    return new Set(['result', 'status', 'ok', 'body']);
  }

  getProducedPaths(nodeName: string, _config?: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>();
    for (const key of ['result', 'status', 'ok', 'body']) {
      paths.add(`${nodeName}.${key}`);
    }
    return paths;
  }
}
