import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import {
  ToolPlugin,
  ToolExecutionContext,
  OutputSynthesisContext,
  NodeOutputDefinition,
} from './tool-plugin.interface';
import { AgentRunnerService } from '../services/agent-runner.service';
import { redactSecrets } from '../services/redaction.util';

@Injectable()
export class OrchestratorPlugin implements ToolPlugin {
  readonly toolType = ['orchestrator', 'delegator'];
  private readonly logger = new Logger(OrchestratorPlugin.name);

  constructor(@Optional() private readonly agentRunner?: AgentRunnerService) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context } = ctx;
    const config: any = node?.data?.config || {};
    const goal = config.goal || nodeInput?.goal || nodeInput;
    const strategy = String(config.strategy || 'parallel').toLowerCase();
    if (!['parallel', 'sequential'].includes(strategy)) {
      throw new BadRequestException('Orchestrator strategy must be parallel or sequential');
    }
    const failFast = config.failFast === true;
    const rawConcurrency = Number(config.concurrency ?? 4);
    if (!Number.isInteger(rawConcurrency) || rawConcurrency < 1) {
      throw new BadRequestException('Orchestrator concurrency must be a positive integer');
    }
    const concurrency = Math.min(8, rawConcurrency);
    const sharedInput = config.sharedInput !== undefined ? config.sharedInput : nodeInput?.sharedInput;
    const maxToolStepsPerAgent = Math.min(10, Math.max(1, Number(config.maxToolStepsPerAgent || 5)));
    const requireResearchOutput = config.requireResearchOutput === true;
    const evidenceLimit = Math.min(10000, Math.max(100, Number(config.evidenceLimit || 2000)));

    let agents = config.agents;
    if (typeof agents === 'string') {
      try {
        agents = JSON.parse(agents);
      } catch {
        if (!config.agentOutputs && !config.outputs) {
          throw new BadRequestException('Orchestrator agents must be a JSON array');
        }
      }
    }

    let agentOutputs = config.agentOutputs ?? config.outputs;
    if (typeof agentOutputs === 'string') {
      try {
        agentOutputs = JSON.parse(agentOutputs);
      } catch {}
    }

    const hasInternalAgents =
      Array.isArray(agents) &&
      agents.length > 0 &&
      agents.some((a) => a && (a.role || a.task || a.prompt || a.model || a.id || a.name));

    // If no internal agents array is declared, execute visual canvas fan-out mode
    if (!hasInternalAgents) {
      const rawOutputs =
        Array.isArray(agentOutputs) && agentOutputs.length > 0
          ? agentOutputs
          : [
              { name: 'agent_1', label: 'Agent 1', role: 'researcher' },
              { name: 'agent_2', label: 'Agent 2', role: 'analyst' },
              { name: 'agent_3', label: 'Agent 3', role: 'reviewer' },
              { name: 'agent_4', label: 'Agent 4', role: 'architect' },
            ];

      const dispatchMap: Record<string, any> = {
        status: 'completed',
        goal,
      };

      const agentRecords: any[] = [];
      for (let i = 0; i < rawOutputs.length; i++) {
        const item = rawOutputs[i];
        const key = typeof item === 'string' ? item : item?.name || item?.id || `agent_${i + 1}`;
        const role = typeof item === 'object' ? item.role || item.label || key : key;
        const task = typeof item === 'object' ? item.task || goal : goal;
        const payload = {
          goal,
          task,
          role,
          agentId: key,
          sharedInput,
        };
        dispatchMap[key] = payload;
        agentRecords.push({ id: key, role, status: 'dispatched', task });
      }

      dispatchMap.result = {
        goal,
        agentCount: rawOutputs.length,
        status: 'completed',
        strategy,
        results: agentRecords,
        sharedInput,
      };

      return dispatchMap;
    }

    if (!Array.isArray(agents) || agents.length < 1 || agents.length > 12) {
      throw new BadRequestException('Orchestrator requires 1 to 12 agents');
    }
    if (agents.some((agent) => !agent || typeof agent !== 'object' || Array.isArray(agent))) {
      throw new BadRequestException('Each delegated agent must be an object');
    }
    const ids = agents.map((agent, index) => String(agent.id || agent.name || `agent-${index + 1}`));
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Delegated agent IDs must be unique');
    }

    const executeDelegatedAgent = async (agent: any, index: number, previous: any[] = []) => {
      const id = String(agent.id || agent.name || `agent-${index + 1}`);
      const role = String(agent.role || agent.name || id);
      const task = agent.task || agent.prompt || goal;
      const allowedTools = agent.allowedTools || agent.tools;
      const enableTools =
        agent.enableTools !== undefined
          ? Boolean(agent.enableTools)
          : Array.isArray(allowedTools) && allowedTools.length > 0;

      const priorResults =
        strategy === 'sequential' && agent.includePriorResults !== false
          ? previous
              .filter((entry) => entry.status === 'completed')
              .map((entry) => {
                const res =
                  entry.result && typeof entry.result === 'object'
                    ? Object.fromEntries(
                        Object.entries(entry.result).filter(
                          ([key]) => !['toolCalls', 'toolTrace', 'reasoning'].includes(key),
                        ),
                      )
                    : entry.result;
                return { id: entry.id, role: entry.role, result: res };
              })
              .map((entry) => {
                const serialized = JSON.stringify(entry.result);
                return {
                  ...entry,
                  result:
                    serialized.length <= 4000
                      ? entry.result
                      : { truncated: true, excerpt: serialized.slice(0, 3000) },
                };
              })
          : [];
      const handoff = {
        goal,
        task,
        ...(sharedInput !== undefined ? { sharedInput } : {}),
        ...(priorResults.length ? { priorResults } : {}),
      };
      const agentNode: any = {
        id: `delegated-${id}`,
        data: {
          config: {
            ...agent,
            userPrompt: priorResults.length || sharedInput !== undefined ? handoff : task,
            systemPrompt: agent.systemPrompt || `You are an agent with role: ${role}.`,
            outputFormat: agent.outputFormat || 'json',
            outputType: agent.outputType || agent.outputSchema,
            enableTools,
            allowedTools: enableTools ? allowedTools || ['search_web', 'read_url'] : [],
            maxSteps: Math.min(
              maxToolStepsPerAgent,
              Math.max(1, Number(agent.maxSteps || agent.maxToolCalls || maxToolStepsPerAgent)),
            ),
            researchOutput:
              agent.researchOutput !== undefined ? Boolean(agent.researchOutput) : requireResearchOutput,
            evidenceLimit,
            timeoutMs: Math.min(1200000, Math.max(1000, Number(agent.timeoutMs || 60000))),
            maxTimeoutMs: 1200000,
          },
        },
      };

      if (!this.agentRunner) {
        return { id, role, status: 'failed', error: 'AgentRunnerService not available' };
      }

      try {
        const res = await this.agentRunner.executeAgentNode(agentNode, handoff, {
          ...(context || {}),
          delegation: handoff,
        });
        return {
          id,
          role,
          status: 'completed',
          result: redactSecrets(res),
          ...(res.toolCalls ? { toolCalls: redactSecrets(res.toolCalls) } : {}),
        };
      } catch (error: any) {
        return {
          id,
          role,
          status: 'failed',
          error: redactSecrets(String(error?.message || error).slice(0, 500)),
        };
      }
    };

    let results: any[] = [];
    if (strategy === 'sequential') {
      for (let i = 0; i < agents.length; i++) {
        const entry = await executeDelegatedAgent(agents[i], i, results);
        results.push(entry);
        if (failFast && entry.status === 'failed') break;
      }
    } else {
      results = new Array(agents.length);
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(concurrency, agents.length) }, async () => {
          while (next < agents.length) {
            const index = next++;
            results[index] = await executeDelegatedAgent(agents[index], index);
          }
        }),
      );
    }

    const failureCount = results.filter((entry) => entry.status === 'failed').length;
    const resSummary = {
      goal,
      results,
      agentCount: results.length,
      successCount: results.length - failureCount,
      failureCount,
      status: failureCount ? (failureCount === results.length ? 'failed' : 'partial') : 'completed',
    };
    if (failFast && failureCount) {
      throw new BadRequestException({
        code: 'ORCHESTRATOR_AGENT_FAILED',
        message: 'Delegated agent failed in fail-fast mode',
        result: resSummary,
      });
    }

    const outputMap: Record<string, any> = {
      ...resSummary,
      status: 'completed',
      goal,
      result: resSummary,
    };
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      const key = res.id || `agent_${i + 1}`;
      outputMap[key] = res.result !== undefined ? res.result : res;
    }
    return outputMap;
  }

  getValidHandles(config?: any, _outputs?: any[], nodeData?: any, _nodeName?: string): Set<string> {
    const valid = new Set<string>(['done', 'result']);
    let agentOutputs =
      config?.agentOutputs ?? config?.outputs ?? nodeData?.config?.agentOutputs ?? nodeData?.config?.outputs;
    if (typeof agentOutputs === 'string') {
      try {
        agentOutputs = JSON.parse(agentOutputs);
      } catch {}
    }
    if (Array.isArray(agentOutputs)) {
      for (const ao of agentOutputs) {
        const name = typeof ao === 'string' ? ao : ao?.name || ao?.id;
        if (name) valid.add(String(name).toLowerCase());
      }
    }
    return valid;
  }

  getProducedPaths(nodeName: string, config?: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>(['result', 'goal', 'status', 'agentCount', 'successCount', 'failureCount']);
    let agentOutputs = config?.agentOutputs ?? config?.outputs;
    if (typeof agentOutputs === 'string') {
      try {
        agentOutputs = JSON.parse(agentOutputs);
      } catch {}
    }
    if (Array.isArray(agentOutputs)) {
      for (const ao of agentOutputs) {
        const name = typeof ao === 'string' ? ao : ao?.name || ao?.id;
        if (name) paths.add(`${nodeName}.${name}`);
      }
    }
    return paths;
  }

  synthesizeOutputs(ctx: OutputSynthesisContext): NodeOutputDefinition[] {
    let agentOutputs = ctx.config.agentOutputs ?? ctx.config.outputs ?? ctx.config.agents;
    if (agentOutputs === undefined || agentOutputs === null || agentOutputs === '') {
      const agentInput = ctx.def?.inputs?.find((i) => i.name === 'agentOutputs' || i.name === 'agents');
      if (agentInput?.defaultValue) {
        agentOutputs = agentInput.defaultValue;
      }
    }

    if (typeof agentOutputs === 'string') {
      try {
        agentOutputs = JSON.parse(agentOutputs);
      } catch {
        agentOutputs = [];
      }
    }

    if (Array.isArray(agentOutputs) && agentOutputs.length > 0) {
      const dynamicOutputs: NodeOutputDefinition[] = [];
      const seen = new Set<string>();

      for (let i = 0; i < agentOutputs.length; i++) {
        const item = agentOutputs[i];
        const handleName = typeof item === 'string' ? item : item?.name || item?.id || `agent_${i + 1}`;
        const handleLabel = typeof item === 'object' ? item.label || item.name || handleName : handleName;

        if (handleName && !seen.has(handleName.toLowerCase())) {
          seen.add(handleName.toLowerCase());
          dynamicOutputs.push({
            name: handleName,
            label: handleLabel,
            type: 'branch',
          });
        }
      }

      dynamicOutputs.push({
        name: 'result',
        label: 'Last Result',
        type: 'object',
      });

      return dynamicOutputs;
    }

    return [
      { name: 'agent_1', label: 'agent_1', type: 'branch' },
      { name: 'agent_2', label: 'agent_2', type: 'branch' },
      { name: 'agent_3', label: 'agent_3', type: 'branch' },
      { name: 'agent_4', label: 'agent_4', type: 'branch' },
      { name: 'result', label: 'Last Result', type: 'object' },
    ];
  }
}
