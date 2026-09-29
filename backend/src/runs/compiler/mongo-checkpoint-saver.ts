import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { MemorySaver } from '@langchain/langgraph';
import { RunnableConfig } from '@langchain/core/runnables';
import { Model } from 'mongoose';
import { RunCheckpoint, RunCheckpointDocument } from '../schemas/run-checkpoint.schema';

@Injectable()
export class MongoCheckpointSaver extends MemorySaver {
  private readonly logger = new Logger(MongoCheckpointSaver.name);

  constructor(
    @Optional() @InjectModel(RunCheckpoint.name) private readonly checkpointModel?: Model<RunCheckpointDocument>,
  ) {
    super();
  }

  async put(
    config: RunnableConfig,
    checkpoint: any,
    metadata: any,
  ): Promise<RunnableConfig> {
    // 1. In-memory update via MemorySaver
    const resultConfig = await super.put(config, checkpoint, metadata);

    // 2. Asynchronously persist to MongoDB if model is available
    const threadId = config.configurable?.thread_id;
    const checkpointId = checkpoint?.id || resultConfig.configurable?.checkpoint_id;

    if (this.checkpointModel && threadId && checkpointId) {
      try {
        const channelValues = checkpoint.channel_values || {};
        const context = channelValues.context || {};

        await this.checkpointModel.findOneAndUpdate(
          { runId: threadId, checkpointId },
          {
            $set: {
              runId: threadId,
              checkpointId,
              sequence: Date.now(),
              status: metadata?.status || 'running',
              context,
              lastNodeOutput: { checkpoint, metadata },
              metadata,
            },
          },
          { upsert: true, new: true },
        ).exec();
      } catch (err: any) {
        this.logger.warn(`Failed to save checkpoint to MongoDB for thread ${threadId}: ${err.message}`);
      }
    }

    return resultConfig;
  }

  async deleteThread(threadId: string): Promise<void> {
    await super.deleteThread(threadId);

    if (this.checkpointModel) {
      try {
        await this.checkpointModel.deleteMany({ runId: threadId }).exec();
      } catch (err: any) {
        this.logger.warn(`Failed to delete thread ${threadId} from MongoDB: ${err.message}`);
      }
    }
  }
}
