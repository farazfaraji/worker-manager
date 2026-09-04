import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Run, RunDocument } from '../schemas/run.schema';
import { ResumePayload } from '../run.types';
import { hashToken } from './redaction.util';
import { RunLeaseService } from './run-lease.service';
import { RunCheckpointService } from './run-checkpoint.service';
import { RunStorageService } from './run-storage.service';
import { RunGraphDelegate } from './subgraph-runner.service';

export interface ResumeDelegates {
  runGraph: RunGraphDelegate;
  findGraph: (graphId: string) => Promise<any>;
}

export interface CancelDelegates {
  closeRuntimeApps: (context: any) => Promise<void>;
}

@Injectable()
export class RunRecoveryService {
  private readonly logger = new Logger(RunRecoveryService.name);

  constructor(
    @InjectModel(Run.name) private readonly runModel: Model<RunDocument>,
    private readonly leaseService: RunLeaseService,
    private readonly checkpointService: RunCheckpointService,
    private readonly storageService: RunStorageService,
  ) {}

  async resumeRun(
    runId: string,
    resumePayload: ResumePayload = {},
    delegates: ResumeDelegates,
  ): Promise<any> {
    const run = await this.runModel.findOne({ runId }).exec();
    if (!run) throw new NotFoundException(`Run ${runId} not found`);

    if (run.status !== 'waiting') {
      throw new BadRequestException(`Run is not in waiting state (current status: ${run.status})`);
    }

    // 1. Token validation
    const submittedToken = resumePayload.token || resumePayload.resumeToken;
    if (!submittedToken && !run.waitingChildRunId) {
      throw new BadRequestException('Resume token is required');
    }

    if (run.resumeTokenHash) {
      if (!submittedToken) {
        throw new BadRequestException('Resume token is required');
      }
      const hashedInput = hashToken(submittedToken);
      if (hashedInput !== run.resumeTokenHash) {
        throw new BadRequestException('Invalid or expired resume token');
      }
    }

    // 2. Atomic single-use invalidation & Lease acquisition
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60000);
    const workerId = this.leaseService.workerId;
    const updateResult = await this.runModel.findOneAndUpdate(
      {
        runId,
        status: 'waiting',
        ...(run.resumeTokenHash ? { resumeTokenHash: run.resumeTokenHash } : {}),
      },
      {
        $unset: { resumeTokenHash: 1 },
        $set: {
          status: 'running',
          leaseOwner: workerId,
          leaseExpiresAt: expiresAt,
          heartbeatAt: now,
        },
      },
      { new: true },
    ).exec();

    if (!updateResult) {
      throw new BadRequestException('Resume rejected: token has already been consumed or run is not waiting');
    }

    this.leaseService.startHeartbeat(runId, workerId);

    // 3. Load latest checkpoint for durable recovery
    const latestCheckpoint = await this.checkpointService.getLatestCheckpoint(runId);

    const restoredContext = latestCheckpoint?.context || { input: run.input };
    const restoredQueue = latestCheckpoint?.queue || [];
    const priorRecords = latestCheckpoint?.nodeRecords || run.nodes || [];
    let checkpointSequence = latestCheckpoint?.sequence || run.checkpointSequence || 1;

    this.logger.log(`🔄 [RESUMING RUN] Run ID: ${runId} from Checkpoint Seq: ${checkpointSequence}`);

    // If waiting on child run: delegate resume to child
    if (run.waitingChildRunId) {
      const childRunId = run.waitingChildRunId;
      this.logger.log(`   🔗 Resuming waiting child run: ${childRunId}`);
      const childResult = await this.resumeRun(childRunId, resumePayload, delegates);

      // Record child completion in parent
      const waitingNode = priorRecords.find((r: any) => r.nodeId === run.waitingNodeId || r.childRunId === childRunId);
      if (waitingNode) {
        waitingNode.status = 'completed';
        waitingNode.output = childResult.output;
        waitingNode.finishedAt = new Date();
        restoredContext[waitingNode.nodeName] = childResult.output;
      }

      const parentGraph = await delegates.findGraph(String(run.graphId));
      const nextTargets: string[] = [];
      if (parentGraph?.edges) {
        for (const edge of parentGraph.edges) {
          if (edge.source === waitingNode?.nodeId || edge.source === run.waitingNodeId) {
            nextTargets.push(edge.target);
          }
        }
      }

      run.waitingChildRunId = undefined;
      run.waitingNodeId = undefined;
      run.waitingDescriptor = undefined;
      await run.save();

      // Continue parent graph with remaining queue
      return delegates.runGraph(String(run.graphId), run.input, {
        existingRunId: run.runId,
        parentRunId: run.parentRunId,
        rootRunId: run.rootRunId,
        context: restoredContext,
        priorRecords,
        executionQueue: [...restoredQueue, ...nextTargets],
        checkpointSequence: checkpointSequence + 1,
      });
    }

    // Direct waiting node (e.g. human gate)
    const waitingNodeId = run.waitingNodeId || latestCheckpoint?.waitingNodeId;
    if (!waitingNodeId) {
      await this.leaseService.releaseLease(runId, workerId);
      throw new NotFoundException('No waiting node specified on run');
    }

    // Inject submitted response into context
    restoredContext.__resumeDecision = resumePayload;
    run.waitingNodeId = undefined;
    run.waitingDescriptor = undefined;
    await run.save();

    // Re-execute waiting node and continue
    return delegates.runGraph(String(run.graphId), run.input, {
      existingRunId: runId,
      startNodeId: waitingNodeId,
      parentRunId: run.parentRunId,
      rootRunId: run.rootRunId,
      context: restoredContext,
      priorRecords: priorRecords.filter((r: any) => r.nodeId !== waitingNodeId),
      executionQueue: [waitingNodeId, ...restoredQueue],
      checkpointSequence: checkpointSequence + 1,
    });
  }

  async cancelRun(
    runId: string,
    delegates: CancelDelegates,
  ): Promise<any> {
    const run = await this.runModel.findOne({ runId }).exec();
    if (!run) throw new NotFoundException(`Run ${runId} not found`);

    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      return this.storageService.publicRun(run);
    }

    if (!['queued', 'running', 'waiting'].includes(run.status)) {
      throw new BadRequestException(`Cannot cancel run with status: ${run.status}`);
    }

    this.logger.log(`🛑 [RUN CANCELLED] Requesting cancellation for RunID: ${runId}`);
    run.cancelRequestedAt = new Date();

    // Cascade cancel to waiting child if present
    if (run.waitingChildRunId) {
      try {
        await this.cancelRun(run.waitingChildRunId, delegates);
      } catch (err: any) {
        this.logger.warn(`Could not cancel child run ${run.waitingChildRunId}: ${err.message}`);
      }
    }

    // Cleanup browser runtime resources
    try {
      await delegates.closeRuntimeApps({ apps: {} });
    } catch {}

    run.status = 'cancelled';
    run.finishedAt = new Date();
    await run.save();

    // Persist cancellation checkpoint
    const latestSeq = (run.checkpointSequence || 0) + 1;
    run.checkpointSequence = latestSeq;
    await run.save();

    await this.checkpointService.persistCheckpoint({
      runId,
      sequence: latestSeq,
      status: 'cancelled',
      queue: [],
      context: {},
      completedNodeIds: run.nodes?.filter((n: any) => n.status === 'completed').map((n: any) => n.nodeId) || [],
      nodeRecords: run.nodes || [],
    });

    await this.leaseService.releaseLease(runId);
    return this.storageService.publicRun(run);
  }
}
