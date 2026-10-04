import { Injectable, Logger } from '@nestjs/common';
import {
  ToolPlugin,
  ToolExecutionContext,
  OutputSynthesisContext,
  NodeOutputDefinition,
} from './tool-plugin.interface';

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

  synthesizeOutputs(ctx: OutputSynthesisContext): NodeOutputDefinition[] {
    let routes = ctx.config.routes;
    if (routes === undefined || routes === null || routes === '') {
      const routesInput = ctx.def?.inputs?.find((inp) => inp.name === 'routes');
      if (routesInput?.defaultValue) {
        routes = routesInput.defaultValue;
      }
    }

    if (typeof routes === 'string') {
      try {
        routes = JSON.parse(routes);
      } catch {
        routes = [];
      }
    }

    if (Array.isArray(routes) && routes.length > 0) {
      const dynamicRoutes: NodeOutputDefinition[] = [];
      const seen = new Set<string>();

      for (const r of routes) {
        const routeName = String(r?.name || r?.id || '').trim();
        if (routeName && !seen.has(routeName.toLowerCase())) {
          seen.add(routeName.toLowerCase());
          dynamicRoutes.push({
            name: routeName,
            label: routeName,
            type: 'branch',
          });
        }
      }

      const defaultRouteName = String(ctx.config.defaultRoute || '').trim();
      if (defaultRouteName && !seen.has(defaultRouteName.toLowerCase())) {
        seen.add(defaultRouteName.toLowerCase());
        dynamicRoutes.push({
          name: defaultRouteName,
          label: defaultRouteName,
          type: 'branch',
        });
      } else if (!seen.has('default')) {
        dynamicRoutes.push({
          name: 'default',
          label: 'default',
          type: 'branch',
        });
      }

      return dynamicRoutes;
    }

    return [
      { name: 'default', label: 'default', type: 'branch' },
      { name: 'result', label: 'Route Result', type: 'object' },
    ];
  }
}
