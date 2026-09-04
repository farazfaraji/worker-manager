import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Run, RunDocument } from '../schemas/run.schema';
import { sanitizeRunForPublic } from './redaction.util';
import { RunCheckpointService } from './run-checkpoint.service';
import { RunGraphDelegate } from './subgraph-runner.service';

@Injectable()
export class RunStorageService {
  constructor(
    @InjectModel(Run.name) private readonly runModel: Model<RunDocument>,
    private readonly runCheckpointService: RunCheckpointService,
  ) {}

  async getRun(runId: string): Promise<any> {
    const run = await this.runModel.findOne({ runId }).exec();
    if (!run) throw new NotFoundException('Run not found');
    return this.publicRun(run);
  }

  async listRuns(projectId?: string, graphId?: string, limit = 200): Promise<any[]> {
    const filter: Record<string, any> = {};
    if (projectId) filter.projectId = projectId;
    if (graphId) filter.graphId = graphId;
    const runs = await this.runModel.find(filter).sort({ createdAt: -1 }).limit(limit).exec();
    return runs.map((run) => this.publicRun(run));
  }

  async deleteRun(runId: string): Promise<{ success: boolean; runId: string }> {
    const result = await this.runModel.deleteOne({ runId }).exec();
    if (!result.deletedCount) throw new NotFoundException('Run not found');
    await this.runCheckpointService.deleteCheckpoints(runId);
    return { success: true, runId };
  }

  async rerunRun(
    runId: string,
    nodeId: string,
    runGraph: RunGraphDelegate,
  ): Promise<any> {
    if (!nodeId) throw new BadRequestException('nodeId is required');
    const source = await this.runModel.findOne({ runId }).exec();
    if (!source) throw new NotFoundException('Run not found');
    const sourceNode = source.nodes.find((node) => node.nodeId === nodeId);
    if (!sourceNode) throw new NotFoundException('Node execution record not found in run');

    const context: Record<string, any> = {};
    for (const node of source.nodes) {
      if (node.nodeId === nodeId) break;
      if (node.status === 'completed' && node.output !== undefined) context[node.nodeName] = node.output;
    }

    return runGraph(String(source.graphId), sourceNode.input ?? source.input ?? {}, {
      startNodeId: nodeId,
      parentRunId: source.runId,
      rootRunId: source.rootRunId || source.runId,
      rerunFromNodeId: nodeId,
      context,
    });
  }

  publicRun(run: RunDocument | any, extra: Record<string, any> = {}) {
    const sanitized = sanitizeRunForPublic(run);
    return {
      runId: sanitized.runId,
      graphId: sanitized.graphId,
      graphName: sanitized.graphName,
      parentRunId: sanitized.parentRunId,
      rootRunId: sanitized.rootRunId || sanitized.parentRunId || sanitized.runId,
      rerunFromNodeId: sanitized.rerunFromNodeId,
      status: sanitized.status,
      currentNodeId: sanitized.currentNodeId,
      waitingNodeId: sanitized.waitingNodeId,
      waitingChildRunId: sanitized.waitingChildRunId,
      waitingDescriptor: sanitized.waitingDescriptor,
      checkpointSequence: sanitized.checkpointSequence || 0,
      input: sanitized.input,
      output: sanitized.output,
      nodes: sanitized.nodes,
      error: sanitized.error,
      metrics: sanitized.metrics,
      dataSizeBytes: sanitized.dataSizeBytes || this.calculateDataSize(sanitized),
      createdAt: sanitized.createdAt,
      updatedAt: sanitized.updatedAt,
      ...extra,
    };
  }

  calculateDataSize(run: Partial<Run>): number {
    try {
      return Buffer.byteLength(
        JSON.stringify({
          input: run.input,
          output: run.output,
          nodes: run.nodes,
          error: run.error,
        }),
      );
    } catch {
      return 0;
    }
  }
}
