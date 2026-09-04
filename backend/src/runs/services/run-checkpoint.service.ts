import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { RunCheckpoint, RunCheckpointDocument } from '../schemas/run-checkpoint.schema';
import { RunDocument } from '../schemas/run.schema';
import { RunState } from '../run.types';
import { calculateObjectSize, redactSecrets } from './redaction.util';

export interface PersistCheckpointParams {
  runId: string;
  sequence: number;
  status: string;
  currentNodeId?: string;
  waitingNodeId?: string;
  waitingChildRunId?: string;
  queue: string[];
  context: Record<string, any>;
  completedNodeIds: string[];
  nodeRecords: any[];
  lastNodeOutput?: any;
  waitingDescriptor?: any;
  metrics?: any;
}

@Injectable()
export class RunCheckpointService {
  constructor(
    @InjectModel(RunCheckpoint.name)
    private readonly checkpointModel: Model<RunCheckpointDocument>,
  ) {}

  async persistCheckpoint(params: PersistCheckpointParams): Promise<RunCheckpointDocument> {
    const payloadSize = calculateObjectSize(params);
    if (payloadSize > 10 * 1024 * 1024) {
      const err: any = new BadRequestException('Checkpoint payload exceeded 10 MB limit');
      err.code = 'CHECKPOINT_TOO_LARGE';
      throw err;
    }

    const checkpointId = randomUUID();
    return this.checkpointModel.create({
      checkpointId,
      runId: params.runId,
      sequence: params.sequence,
      status: params.status,
      currentNodeId: params.currentNodeId,
      waitingNodeId: params.waitingNodeId,
      waitingChildRunId: params.waitingChildRunId,
      queue: params.queue,
      context: params.context,
      completedNodeIds: params.completedNodeIds,
      nodeRecords: params.nodeRecords,
      lastNodeOutput: params.lastNodeOutput,
      waitingDescriptor: params.waitingDescriptor,
      metrics: params.metrics,
      createdAt: new Date(),
    });
  }

  async getLatestCheckpoint(runId: string): Promise<RunCheckpointDocument | null> {
    return this.checkpointModel
      .findOne({ runId })
      .sort({ sequence: -1 })
      .exec();
  }

  async deleteCheckpoints(runId: string): Promise<any> {
    return this.checkpointModel.deleteMany({ runId }).exec();
  }

  buildRunState(run: RunDocument, latestCheckpoint: RunCheckpointDocument | null): RunState {
    const state: RunState = {
      runId: run.runId,
      graphId: String(run.graphId),
      graphName: run.graphName,
      status: run.status as any,
      checkpointSequence: latestCheckpoint?.sequence ?? run.checkpointSequence ?? 0,
      currentNodeId: latestCheckpoint?.currentNodeId ?? run.currentNodeId,
      waitingNodeId: latestCheckpoint?.waitingNodeId ?? run.waitingNodeId,
      waitingChildRunId: latestCheckpoint?.waitingChildRunId ?? run.waitingChildRunId,
      waitingDescriptor: redactSecrets(latestCheckpoint?.waitingDescriptor ?? run.waitingDescriptor),
      metrics: run.metrics,
      completedNodeIds: latestCheckpoint?.completedNodeIds ?? [],
      queue: latestCheckpoint?.queue ?? [],
      context: redactSecrets(latestCheckpoint?.context ?? {}),
      lastNodeOutput: redactSecrets(latestCheckpoint?.lastNodeOutput),
      error: redactSecrets(run.error),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    };

    return state;
  }
}
