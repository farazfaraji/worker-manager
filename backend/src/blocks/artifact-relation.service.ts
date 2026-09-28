import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  ArtifactRelation,
  ArtifactRelationDocument,
} from './schemas/artifact-relation.schema';
import {
  ArtifactRelationType,
  RELATION_INVERSE_MAP,
} from './artifact.types';
import { EventEngineService } from '../events/event-engine.service';
import {
  ArtifactRelationAddedEventData,
  ArtifactRelationRemovedEventData,
} from '../events/event.types';

@Injectable()
export class ArtifactRelationService {
  private readonly logger = new Logger(ArtifactRelationService.name);

  constructor(
    @InjectModel(ArtifactRelation.name)
    private readonly relationModel: Model<ArtifactRelationDocument>,
    private readonly eventEngine: EventEngineService,
  ) {}

  /**
   * Add a typed bidirectional relation between two logical artifacts.
   * Creates both the forward and inverse relation records atomically in a transaction.
   */
  async addRelation(input: {
    sourceLogicalId: string;
    targetLogicalId: string;
    type: ArtifactRelationType;
    projectId?: string;
    metadata?: Record<string, any>;
    source?: any;
  }): Promise<{
    forward: ArtifactRelation;
    reverse: ArtifactRelation;
  }> {
    const sourceLogicalId = String(input.sourceLogicalId || '').trim();
    const targetLogicalId = String(input.targetLogicalId || '').trim();
    const projectId = String(input.projectId || '').trim();
    const type = input.type;

    if (!sourceLogicalId || !targetLogicalId) {
      throw new BadRequestException('sourceLogicalId and targetLogicalId are required');
    }

    // 1. Reject self-relations
    if (sourceLogicalId === targetLogicalId) {
      throw new BadRequestException(
        `Self-relations are rejected: source and target logical IDs cannot be identical (${sourceLogicalId})`,
      );
    }

    // 2. Validate relation type and derive inverse
    const inverseType = RELATION_INVERSE_MAP[type];
    if (!inverseType) {
      throw new BadRequestException(
        `Unsupported relation type "${type}". Allowed types: ${Object.keys(RELATION_INVERSE_MAP).join(', ')}`,
      );
    }

    // 3. Check for existing forward relation
    const existing = await this.relationModel
      .findOne({
        projectId,
        sourceLogicalId,
        targetLogicalId,
        type,
      })
      .lean()
      .exec();

    if (existing) {
      // Find corresponding reverse relation
      const reverseExisting = await this.relationModel
        .findOne({
          projectId,
          sourceLogicalId: targetLogicalId,
          targetLogicalId: sourceLogicalId,
          type: inverseType,
        })
        .lean()
        .exec();

      return {
        forward: this.public(existing),
        reverse: reverseExisting ? this.public(reverseExisting) : (existing as any),
      };
    }

    const forwardRelationId = `rel_${randomUUID()}`;
    const reverseRelationId = `rel_${randomUUID()}`;
    const metadata = input.metadata || {};

    // 4. Create both directional records in a MongoDB transaction
    const session = await this.relationModel.db.startSession();
    let forwardCreated: any;
    let reverseCreated: any;

    try {
      session.startTransaction({ maxCommitTimeMS: 5000 });

      [forwardCreated] = await this.relationModel.create(
        [
          {
            relationId: forwardRelationId,
            projectId,
            sourceLogicalId,
            targetLogicalId,
            type,
            inverseType,
            status: 'active',
            metadata,
          },
        ],
        { session },
      );

      [reverseCreated] = await this.relationModel.create(
        [
          {
            relationId: reverseRelationId,
            projectId,
            sourceLogicalId: targetLogicalId,
            targetLogicalId: sourceLogicalId,
            type: inverseType,
            inverseType: type,
            status: 'active',
            metadata,
          },
        ],
        { session },
      );

      await session.commitTransaction();
    } catch (err: any) {
      await session.abortTransaction();
      if (err.code === 11000) {
        throw new ConflictException(
          `Relation between "${sourceLogicalId}" and "${targetLogicalId}" of type "${type}" already exists`,
        );
      }
      throw new Error(`Failed to create bidirectional relation in transaction: ${err.message || err}`);
    } finally {
      await session.endSession();
    }

    const forwardPublic = this.public(forwardCreated);
    const reversePublic = this.public(reverseCreated);

    // 5. Emit relation added event
    await this.eventEngine.publish<ArtifactRelationAddedEventData>({
      topic: 'artifact.relation.added',
      entityName: 'artifact_relation',
      entityId: forwardRelationId,
      eventType: 'relation.add',
      projectId: projectId || undefined,
      source: {
        origin: input.source?.origin || (input.source?.runId ? 'flow' : 'api'),
        runId: input.source?.runId,
        nodeId: input.source?.nodeId,
      },
      data: {
        relationId: forwardRelationId,
        projectId: projectId || undefined,
        sourceLogicalId,
        targetLogicalId,
        relationType: type,
        inverseType,
        metadata,
      },
    });

    return {
      forward: forwardPublic,
      reverse: reversePublic,
    };
  }

  /**
   * Remove a relation and its corresponding inverse record in a transaction.
   */
  async removeRelation(
    relationId: string,
    projectId?: string,
    source?: any,
  ): Promise<{ success: boolean; removedCount: number }> {
    const cleanId = String(relationId || '').trim();
    const filter: any = { relationId: cleanId };
    if (projectId && String(projectId).trim()) {
      filter.projectId = String(projectId).trim();
    }

    const forward = await this.relationModel.findOne(filter).lean().exec();
    if (!forward) {
      throw new NotFoundException(`Relation "${relationId}" not found`);
    }

    const session = await this.relationModel.db.startSession();
    let deletedCount = 0;

    try {
      session.startTransaction({ maxCommitTimeMS: 5000 });

      // Delete forward
      const fRes = await this.relationModel
        .deleteOne({ relationId: forward.relationId }, { session })
        .exec();

      // Delete reverse
      const rRes = await this.relationModel
        .deleteOne(
          {
            projectId: forward.projectId,
            sourceLogicalId: forward.targetLogicalId,
            targetLogicalId: forward.sourceLogicalId,
            type: forward.inverseType,
          },
          { session },
        )
        .exec();

      await session.commitTransaction();
      deletedCount = (fRes.deletedCount || 0) + (rRes.deletedCount || 0);
    } catch (err: any) {
      await session.abortTransaction();
      throw new Error(`Failed to remove relation in transaction: ${err.message || err}`);
    } finally {
      await session.endSession();
    }

    // Emit relation removed event
    await this.eventEngine.publish<ArtifactRelationRemovedEventData>({
      topic: 'artifact.relation.removed',
      entityName: 'artifact_relation',
      entityId: cleanId,
      eventType: 'relation.remove',
      projectId: forward.projectId || undefined,
      source: {
        origin: source?.origin || (source?.runId ? 'flow' : 'api'),
        runId: source?.runId,
        nodeId: source?.nodeId,
      },
      data: {
        relationId: cleanId,
        projectId: forward.projectId || undefined,
        sourceLogicalId: forward.sourceLogicalId,
        targetLogicalId: forward.targetLogicalId,
        relationType: forward.type,
        inverseType: forward.inverseType,
        metadata: forward.metadata,
      },
    });

    return { success: true, removedCount: deletedCount };
  }

  /**
   * Fetch relations for a given logical artifact.
   * Supports 'outgoing' (source is logicalId), 'incoming' (target is logicalId), or 'both' (default).
   */
  async getRelations(
    logicalId: string,
    options: {
      direction?: 'outgoing' | 'incoming' | 'both';
      projectId?: string;
    } = {},
  ): Promise<ArtifactRelation[]> {
    const cleanId = String(logicalId || '').trim();
    const direction = options.direction || 'both';
    const filter: any = {};

    if (options.projectId && String(options.projectId).trim()) {
      filter.projectId = String(options.projectId).trim();
    }

    if (direction === 'outgoing') {
      filter.sourceLogicalId = cleanId;
    } else if (direction === 'incoming') {
      filter.targetLogicalId = cleanId;
    } else {
      filter.$or = [{ sourceLogicalId: cleanId }, { targetLogicalId: cleanId }];
    }

    const items = await this.relationModel.find(filter).sort({ createdAt: -1 }).lean().exec();
    return items.map((item) => this.public(item));
  }

  private public(item: any): ArtifactRelation {
    const value = item.toObject ? item.toObject() : { ...item };
    delete value._id;
    delete value.__v;
    return value as ArtifactRelation;
  }
}
