import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { Run, RunDocument } from '../schemas/run.schema';

@Injectable()
export class RunLeaseService implements OnModuleDestroy {
  private readonly logger = new Logger(RunLeaseService.name);
  readonly workerId = `worker_${process.pid}_${randomUUID().slice(0, 8)}`;
  private readonly heartbeatTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectModel(Run.name) private readonly runModel: Model<RunDocument>,
  ) {}

  onModuleDestroy() {
    this.clearAllTimers();
  }

  clearAllTimers() {
    for (const [runId, timer] of this.heartbeatTimers.entries()) {
      clearInterval(timer);
      this.heartbeatTimers.delete(runId);
    }
  }

  async acquireLease(runId: string, ownerId: string = this.workerId): Promise<boolean> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + 60000); // 60s lease
    const res = await this.runModel.updateOne(
      {
        runId,
        $or: [
          { leaseExpiresAt: { $exists: false } },
          { leaseExpiresAt: null },
          { leaseExpiresAt: { $lt: now } },
          { leaseOwner: ownerId },
        ],
      },
      {
        $set: {
          leaseOwner: ownerId,
          leaseExpiresAt,
          heartbeatAt: now,
        },
      },
    ).exec();

    const acquired = res.modifiedCount > 0 || res.matchedCount > 0;
    if (acquired) {
      this.startHeartbeat(runId, ownerId);
    }
    return acquired;
  }

  startHeartbeat(runId: string, ownerId: string = this.workerId) {
    this.stopHeartbeat(runId);
    const interval = setInterval(async () => {
      try {
        const now = new Date();
        const leaseExpiresAt = new Date(now.getTime() + 60000);
        await this.runModel.updateOne(
          { runId, leaseOwner: ownerId },
          { $set: { heartbeatAt: now, leaseExpiresAt } },
        ).exec();
      } catch {
        // Ignored
      }
    }, 15000); // 15s heartbeat
    this.heartbeatTimers.set(runId, interval);
  }

  stopHeartbeat(runId: string) {
    const timer = this.heartbeatTimers.get(runId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(runId);
    }
  }

  async releaseLease(runId: string, ownerId?: string) {
    this.stopHeartbeat(runId);
    const filter: any = { runId };
    if (ownerId) filter.leaseOwner = ownerId;
    await this.runModel.updateOne(filter, {
      $unset: { leaseOwner: 1, leaseExpiresAt: 1 },
    }).exec();
  }
}
