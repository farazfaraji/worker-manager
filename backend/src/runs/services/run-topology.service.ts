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
    completedNodeIds?: Set<string>,
    allNodes?: RuntimeNode[],
    allEdges?: any[],
  ): string[] {
    const nodeType = String(node.data?.definitionType || node.type || '').toLowerCase();
    const nodeConfig = node.data?.config || {};
    const nextTargets = new Set<string>();

    if (nodeType === 'research-review') {
      const branch = lastNodeOutput?.status === 'incomplete_needs_human_review'
        ? 'incomplete_needs_human_review' : lastNodeOutput?.decision;
      for (const edge of nodeEdges) {
        if (String(edge.sourceHandle || '').toLowerCase() === branch) nextTargets.add(edge.target);
      }
    } else if (nodeType === 'human-gate' || nodeType === 'humangate') {
      const branch = lastNodeOutput?.result?.approved ?? lastNodeOutput?.approved
        ? 'approved'
        : 'rejected';
      for (const edge of nodeEdges) {
        if (String(edge.sourceHandle || '').toLowerCase() === branch) nextTargets.add(edge.target);
      }
    } else if (nodeType === 'condition') {
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
    } else if (nodeType === 'foreach') {
      const mode = String(nodeConfig?.mode || 'canvas').toLowerCase();
      if (mode !== 'subgraph') {
        let matchedDoneEdge = false;
        for (const edge of nodeEdges) {
          const handle = String(edge.sourceHandle || '').toLowerCase().trim();
          if (handle === 'done') {
            nextTargets.add(edge.target);
            matchedDoneEdge = true;
          }
        }
        if (!matchedDoneEdge) {
          for (const edge of nodeEdges) {
            const handle = String(edge.sourceHandle || '').toLowerCase().trim();
            if (handle !== 'item') {
              nextTargets.add(edge.target);
            }
          }
        }
      } else {
        for (const edge of nodeEdges) {
          nextTargets.add(edge.target);
        }
      }
    } else if (nodeType === 'artifact') {
      const branch = String(lastNodeOutput?.branch || 'onsuccess').toLowerCase().trim();
      let matched = false;
      for (const edge of nodeEdges) {
        const handle = String(edge.sourceHandle || '').toLowerCase().trim();
        if (handle === branch) {
          nextTargets.add(edge.target);
          matched = true;
        }
      }
      if (!matched && nodeEdges.length === 1 && !String(nodeEdges[0].sourceHandle || '').trim()) {
        nextTargets.add(nodeEdges[0].target);
      }
    } else if (nodeType === 'orchestrator' || nodeType === 'delegator') {
      const jobNodes = (allNodes && allEdges)
        ? this.getOrchestratedJobNodeIds(node.id, allNodes, allEdges)
        : new Set<string>();
      const jobsFinished = jobNodes.size === 0 || (completedNodeIds ? [...jobNodes].every((id) => completedNodeIds.has(id)) : false);

      for (const edge of nodeEdges) {
        const handle = String(edge.sourceHandle || '').toLowerCase().trim();
        const isDoneHandle = handle === 'done' || handle === 'result';
        if (isDoneHandle) {
          if (jobsFinished) {
            nextTargets.add(edge.target);
          }
        } else {
          nextTargets.add(edge.target);
        }
      }
    } else {
      for (const edge of nodeEdges) {
        nextTargets.add(edge.target);
      }
    }

    return Array.from(nextTargets);
  }

  /** Identify all downstream node IDs that belong to the parallel jobs spawned by an orchestrator node. */
  getOrchestratedJobNodeIds(
    orchNodeId: string,
    nodes: RuntimeNode[],
    edges: any[],
  ): Set<string> {
    const jobNodes = new Set<string>();
    const doneTargetIds = new Set<string>();

    for (const edge of edges) {
      if (edge.source === orchNodeId) {
        const handle = String(edge.sourceHandle || '').toLowerCase().trim();
        if (handle === 'done' || handle === 'result') {
          doneTargetIds.add(edge.target);
        }
      }
    }

    const queue: string[] = [];
    for (const edge of edges) {
      if (edge.source === orchNodeId) {
        const handle = String(edge.sourceHandle || '').toLowerCase().trim();
        if (handle !== 'done' && handle !== 'result' && !doneTargetIds.has(edge.target)) {
          queue.push(edge.target);
          jobNodes.add(edge.target);
        }
      }
    }

    const visited = new Set<string>(jobNodes);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of edges) {
        if (edge.source === current) {
          if (!doneTargetIds.has(edge.target) && !visited.has(edge.target) && edge.target !== orchNodeId) {
            visited.add(edge.target);
            jobNodes.add(edge.target);
            queue.push(edge.target);
          }
        }
      }
    }

    return jobNodes;
  }

  /** Schedule a node only after every incoming branch has finished or been skipped. */
  readyNodes(
    nodes: RuntimeNode[],
    edges: any[],
    startNodeIds: string[],
    completedNodeIds: Set<string>,
    outputs: Record<string, any>,
    queuedNodeIds: Set<string>,
  ): string[] {
    const incoming = new Map<string, any[]>();
    const outgoing = new Map<string, any[]>();
    for (const node of nodes) {
      incoming.set(node.id, []);
      outgoing.set(node.id, []);
    }
    for (const edge of edges) {
      if (!incoming.has(edge.target) || !outgoing.has(edge.source)) continue;
      incoming.get(edge.target)!.push(edge);
      outgoing.get(edge.source)!.push(edge);
    }
    const starts = new Set(startNodeIds);
    const settled = new Set<string>();
    const active = new Set<string>();
    const ready: string[] = [];
    for (const node of this.topologicalOrder(nodes, edges)) {
      const parents = incoming.get(node.id) || [];
      if (starts.has(node.id)) {
        active.add(node.id);
      } else if (!parents.length) {
        settled.add(node.id);
      } else {
        const allParentsSettled = parents.every((edge) => {
          const parent = nodes.find((candidate) => candidate.id === edge.source);
          const parentType = String(parent?.data?.definitionType || parent?.type || '').toLowerCase();
          const handle = String(edge.sourceHandle || '').toLowerCase().trim();

          // For an orchestrator 'done' or 'result' edge, the parent is only considered settled
          // for this target node if all orchestrated jobs of that orchestrator have completed!
          if (parentType === 'orchestrator' || parentType === 'delegator') {
            if (handle === 'done' || handle === 'result') {
              const jobNodes = this.getOrchestratedJobNodeIds(edge.source, nodes, edges);
              const jobsFinished = jobNodes.size === 0 || [...jobNodes].every((id) => completedNodeIds.has(id));
              return completedNodeIds.has(edge.source) && jobsFinished;
            }
          }

          return settled.has(edge.source);
        });

        if (allParentsSettled) {
          const reached = parents.some((edge) => {
            if (!completedNodeIds.has(edge.source)) return false;
            const parent = nodes.find((candidate) => candidate.id === edge.source);
            if (!parent) return false;
            return this.resolveNextTargets(
              parent,
              outputs[edge.source],
              outgoing.get(edge.source) || [],
              completedNodeIds,
              nodes,
              edges,
            ).includes(node.id);
          });
          if (reached) active.add(node.id);
          else settled.add(node.id);
        }
      }
      if (completedNodeIds.has(node.id)) settled.add(node.id);
      else if (active.has(node.id) && !queuedNodeIds.has(node.id)) ready.push(node.id);
    }
    return ready;
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
