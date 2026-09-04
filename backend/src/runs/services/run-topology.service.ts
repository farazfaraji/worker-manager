import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RuntimeNode } from './variable-resolver.service';

export interface GraphAdjacency {
  nodeById: Map<string, RuntimeNode>;
  outgoing: Map<string, any[]>;
  incoming: Map<string, number>;
}

@Injectable()
export class RunTopologyService {
  private readonly logger = new Logger(RunTopologyService.name);

  buildAdjacency(nodes: RuntimeNode[], edges: any[]): GraphAdjacency {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const outgoing = new Map<string, any[]>();
    const incoming = new Map<string, number>();

    for (const node of nodes) {
      outgoing.set(node.id, []);
      incoming.set(node.id, 0);
    }
    for (const edge of edges) {
      if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
      outgoing.get(edge.source)!.push(edge);
      incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    }

    return { nodeById, outgoing, incoming };
  }

  determineStartNodes(
    nodes: RuntimeNode[],
    incoming: Map<string, number>,
    nodeById: Map<string, RuntimeNode>,
    requestedStartNodeId?: string,
  ): string[] {
    const requestedStartNode = requestedStartNodeId ? nodeById.get(requestedStartNodeId) : undefined;
    if (requestedStartNode) {
      return [requestedStartNode.id];
    }

    const hasWebserver = nodes.some((node) => {
      const type = String(node.data?.definitionType || node.type || '').toLowerCase();
      return type === 'webserver' || node.data?.definitionId === 'webserver';
    });

    const roots = nodes.filter((node) => {
      const type = String(node.data?.definitionType || node.type || '').toLowerCase();
      const defId = String(node.data?.definitionId || '').toLowerCase();
      // If the graph contains a webserver, route nodes are NOT automatic batch roots;
      // they must only be triggered via Webserver incoming HTTP requests (with requestedStartNodeId).
      if (hasWebserver && (type === 'route' || defId === 'route')) {
        return false;
      }
      return type === 'trigger' || (!hasWebserver && type === 'route');
    });

    const defaultStartNodes = roots.length
      ? roots
      : nodes.filter((node) => {
          const type = String(node.data?.definitionType || node.type || '').toLowerCase();
          const defId = String(node.data?.definitionId || '').toLowerCase();
          return (
            type !== 'webserver' &&
            type !== 'route' &&
            defId !== 'webserver' &&
            defId !== 'route' &&
            (incoming.get(node.id) || 0) === 0
          );
        });

    return defaultStartNodes.map((node) => node.id);
  }

  resolveNextTargets(
    node: RuntimeNode,
    lastNodeOutput: any,
    nodeEdges: any[],
  ): string[] {
    const nodeType = String(node.data?.definitionType || node.type || '').toLowerCase();
    const nodeConfig = node.data?.config || {};
    const nextTargets = new Set<string>();

    if (nodeType === 'condition') {
      const branch = lastNodeOutput?.conditionMet ? 'true' : 'false';
      for (const edge of nodeEdges) {
        if (String(edge.sourceHandle || '').toLowerCase() === branch) {
          nextTargets.add(edge.target);
        }
      }
    } else if (nodeType === 'router') {
      const chosenRoute = String(
        lastNodeOutput?.result?.route ?? lastNodeOutput?.route ?? '',
      ).toLowerCase().trim();
      const defaultRouteName = String(nodeConfig?.defaultRoute || 'default').toLowerCase().trim();

      let matchedAnyEdge = false;
      for (const edge of nodeEdges) {
        const handle = String(edge.sourceHandle || '').toLowerCase().trim();
        if (handle && handle === chosenRoute) {
          nextTargets.add(edge.target);
          matchedAnyEdge = true;
        }
      }
      if (!matchedAnyEdge) {
        for (const edge of nodeEdges) {
          const handle = String(edge.sourceHandle || '').toLowerCase().trim();
          if (handle === 'default' || (defaultRouteName && handle === defaultRouteName)) {
            nextTargets.add(edge.target);
            matchedAnyEdge = true;
          }
        }
      }
      if (!matchedAnyEdge && nodeEdges.length === 1) {
        nextTargets.add(nodeEdges[0].target);
      }
    } else {
      for (const edge of nodeEdges) {
        nextTargets.add(edge.target);
      }
    }

    return Array.from(nextTargets);
  }

  topologicalOrder(nodes: RuntimeNode[], edges: any[]): RuntimeNode[] {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const incoming = new Map<string, Set<string>>();
    const outgoing = new Map<string, Set<string>>();

    for (const node of nodes) {
      incoming.set(node.id, new Set());
      outgoing.set(node.id, new Set());
    }
    for (const edge of edges) {
      if (byId.has(edge.source) && byId.has(edge.target)) {
        incoming.get(edge.target)!.add(edge.source);
        outgoing.get(edge.source)!.add(edge.target);
      }
    }

    const roots = nodes.filter((node) => (incoming.get(node.id)?.size || 0) === 0);
    const queue = [...roots];
    const result: RuntimeNode[] = [];
    const emitted = new Set<string>();

    while (queue.length) {
      const node = queue.shift()!;
      if (emitted.has(node.id)) continue;
      const dependencies = incoming.get(node.id) || new Set<string>();
      if ([...dependencies].some((id) => !emitted.has(id))) {
        queue.push(node);
        continue;
      }
      emitted.add(node.id);
      result.push(node);
      for (const targetId of outgoing.get(node.id) || []) {
        queue.push(byId.get(targetId)!);
      }
    }

    if (result.length !== nodes.length) {
      this.logger.error(`❌ Cycle or disconnected executable node detected in graph`);
      throw new BadRequestException('Graph contains a cycle or disconnected executable node');
    }
    return result;
  }

  buildRunOutput(nodes: RuntimeNode[], context: Record<string, any>, completed: Set<string>): any {
    const last = [...nodes].reverse().find((node) => completed.has(node.id));
    if (!last) return context;
    const name = last.data?.name || last.data?.nodeName || last.id;
    return { [name]: context[name] };
  }
}
