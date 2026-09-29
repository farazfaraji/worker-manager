import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';

@Injectable()
export class NotificationPlugin implements ToolPlugin {
  readonly toolType = 'notification';
  private readonly logger = new Logger(NotificationPlugin.name);

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput } = ctx;
    const config: any = node?.data?.config || {};
    const payload = nodeInput !== undefined ? nodeInput : config;
    const url = String(config.url || nodeInput?.url || '');

    if (url) {
      if (!/^https?:\/\//i.test(url)) throw new BadRequestException('notification requires a valid http(s) URL');
      const hostname = new URL(url).hostname;
      const allowedHosts = Array.isArray(config.allowedHosts) ? config.allowedHosts.map(String) : [];
      if (!allowedHosts.includes(hostname) && !config.allowAnyHost) {
        return {
          status: 'completed',
          result: { provider: 'http', action: 'notify', dryRun: true, blocked: true, reason: 'Host is not in allowedHosts', url },
        };
      }
      const response = await fetch(url, {
        method: String(config.method || 'POST').toUpperCase(),
        headers: config.headers || { 'content-type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const text = await response.text();
      let body: any = text;
      try { body = JSON.parse(text); } catch {}
      return {
        status: 'completed',
        result: { provider: 'http', action: 'notify', status: response.status, ok: response.ok, headers: Object.fromEntries(response.headers.entries()), body },
      };
    }

    return {
      status: 'completed',
      result: { delivered: false, channel: config.channel || 'internal', payload },
      delivered: false,
      channel: config.channel || 'internal',
    };
  }

  getValidHandles(_config?: any, _outputs?: any[], _nodeData?: any, _nodeName?: string): Set<string> {
    return new Set(['result', 'delivered', 'channel']);
  }

  getProducedPaths(nodeName: string, _config?: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>();
    for (const key of ['result', 'delivered', 'channel']) {
      paths.add(`${nodeName}.${key}`);
    }
    return paths;
  }
}
