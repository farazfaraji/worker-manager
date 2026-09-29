import { Injectable, Logger } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';

@Injectable()
export class RouterPlugin implements ToolPlugin {
  readonly toolType = 'router';
  private readonly logger = new Logger(RouterPlugin.name);

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput } = ctx;
    const config: any = node?.data?.config || {};
    let value = nodeInput?.value ?? nodeInput;
    if (value && typeof value === 'object' && value.value !== undefined) {
      value = value.value;
    }
    let routes = config.routes;
    if (typeof routes === 'string') {
      try {
        routes = JSON.parse(routes);
      } catch {
        routes = [];
      }
    }
    routes = Array.isArray(routes) ? routes : [];

    const valueStr = String(value ?? '').trim().toLowerCase();
    const selected =
      routes.find((route: any) => {
        if (route.when === value) return true;
        if (typeof route.when === 'string' && route.when.trim().toLowerCase() === valueStr) return true;
        if (Array.isArray(route.when)) {
          return route.when.some(
            (w: any) => w === value || String(w ?? '').trim().toLowerCase() === valueStr,
          );
        }
        return false;
      }) || routes.find((route: any) => route.default);

    const isMatched = Boolean(selected && !selected.default);
    const chosenRoute = selected?.name || selected?.id || config.defaultRoute || 'default';

    return {
      status: 'completed',
      result: {
        route: chosenRoute,
        matched: isMatched,
        value,
      },
      route: chosenRoute,
      matched: isMatched,
      value,
    };
  }

  getValidHandles(config?: any, _outputs?: any[], _nodeData?: any, _nodeName?: string): Set<string> {
    const handles = new Set<string>(['route', 'matched', 'value', 'default', 'result']);
    let routes = config?.routes;
    if (typeof routes === 'string') {
      try {
        routes = JSON.parse(routes);
      } catch {}
    }
    if (Array.isArray(routes)) {
      for (const r of routes) {
        if (r.id) handles.add(String(r.id).toLowerCase());
        if (r.name) handles.add(String(r.name).toLowerCase());
      }
    }
    return handles;
  }

  getProducedPaths(nodeName: string, config?: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>();
    for (const key of ['route', 'matched', 'value', 'result']) {
      paths.add(`${nodeName}.${key}`);
    }
    let routes = config?.routes;
    if (typeof routes === 'string') {
      try {
        routes = JSON.parse(routes);
      } catch {}
    }
    if (Array.isArray(routes)) {
      for (const r of routes) {
        if (r.id) paths.add(`${nodeName}.${r.id}`);
        if (r.name) paths.add(`${nodeName}.${r.name}`);
      }
    }
    return paths;
  }
}
