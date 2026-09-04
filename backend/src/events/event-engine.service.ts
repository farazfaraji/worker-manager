import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { EventRecord, EventRecordDocument } from './schemas/event.schema';
import { AppEvent, CreateAppEventInput } from './event.types';

export type EventDispatcher = (event: AppEvent) => Promise<string[] | void>;

export function matchesTopicPattern(pattern: string, topic: string): boolean {
  if (!pattern || !topic) return false;
  const p = pattern.trim().toLowerCase();
  const t = topic.trim().toLowerCase();

  if (p === '*' || p === '*.*' || p === t) return true;

  // Wildcard conversion (e.g., "artifact.*" -> "^artifact\.[^.]+$" or similar)
  const regexString = '^' + p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\*/g, '.*')
    .replace(/\\\?/g, '.') + '$';

  const regex = new RegExp(regexString, 'i');
  return regex.test(t);
}

@Injectable()
export class EventEngineService {
  private readonly logger = new Logger(EventEngineService.name);
  private readonly emitter = new EventEmitter();
  private readonly dispatchers: EventDispatcher[] = [];

  constructor(
    @InjectModel(EventRecord.name)
    private readonly eventModel: Model<EventRecordDocument>,
  ) {
    // Increase max listeners for multiple dynamic flow subscriptions
    this.emitter.setMaxListeners(100);
  }

  /**
   * Register a system dispatcher (e.g., GraphRunner reactive trigger engine)
   */
  registerDispatcher(dispatcher: EventDispatcher): () => void {
    this.dispatchers.push(dispatcher);
    return () => {
      const idx = this.dispatchers.indexOf(dispatcher);
      if (idx !== -1) this.dispatchers.splice(idx, 1);
    };
  }

  /**
   * Publish a typed domain event into the engine
   */
  async publish<T = any>(input: CreateAppEventInput<T>): Promise<AppEvent<T>> {
    const id = `evt_${randomUUID()}`;
    const timestamp = new Date().toISOString();

    const fullEvent: AppEvent<T> = {
      id,
      topic: input.topic,
      entityName: input.entityName,
      entityId: input.entityId,
      eventType: input.eventType,
      timestamp,
      projectId: input.projectId,
      source: {
        origin: input.source?.origin || 'system',
        runId: input.source?.runId,
        nodeId: input.source?.nodeId,
        userId: input.source?.userId,
        sourceEventId: input.sourceEventId || input.source?.sourceEventId,
        rootRunId: input.rootRunId || input.source?.rootRunId,
        propagationRunId: input.propagationRunId || input.source?.propagationRunId,
        propagationDepth: input.propagationDepth ?? input.source?.propagationDepth ?? 0,
        visitedArtifactLogicalIds: input.visitedArtifactLogicalIds || input.source?.visitedArtifactLogicalIds || [],
        metadata: input.source?.metadata || {},
      },
      data: input.data,
      sourceEventId: input.sourceEventId || input.source?.sourceEventId,
      rootRunId: input.rootRunId || input.source?.rootRunId,
      propagationRunId: input.propagationRunId || input.source?.propagationRunId,
      propagationDepth: input.propagationDepth ?? input.source?.propagationDepth ?? 0,
      visitedArtifactLogicalIds: input.visitedArtifactLogicalIds || input.source?.visitedArtifactLogicalIds || [],
    };

    this.logger.log(`⚡ [EVENT PUBLISHED] ${fullEvent.topic} | Entity: ${fullEvent.entityName}#${fullEvent.entityId} (ID: ${fullEvent.id})`);

    // 1. Persist to MongoDB Event Store
    let record: EventRecordDocument;
    try {
      record = await this.eventModel.create({
        eventId: fullEvent.id,
        topic: fullEvent.topic,
        entityName: fullEvent.entityName,
        entityId: fullEvent.entityId,
        eventType: fullEvent.eventType,
        timestamp: fullEvent.timestamp,
        projectId: fullEvent.projectId,
        source: fullEvent.source,
        data: fullEvent.data,
        dispatchedRuns: [],
      });
    } catch (err: any) {
      this.logger.error(`Failed to persist event ${fullEvent.id}: ${err.message || err}`);
    }

    // 2. Emit in-memory for subscribers
    try {
      this.emitter.emit(fullEvent.topic, fullEvent);
      this.emitter.emit('*', fullEvent);
    } catch (err: any) {
      this.logger.error(`Error emitting event on in-memory bus: ${err.message || err}`);
    }

    // 3. Invoke registered flow dispatchers asynchronously
    if (this.dispatchers.length > 0) {
      Promise.allSettled(
        this.dispatchers.map(async (dispatcher) => {
          try {
            const runIds = await dispatcher(fullEvent);
            if (Array.isArray(runIds) && runIds.length > 0 && record) {
              await this.eventModel.updateOne(
                { eventId: fullEvent.id },
                { $addToSet: { dispatchedRuns: { $each: runIds } } },
              );
            }
          } catch (dispErr: any) {
            this.logger.error(`Error in event dispatcher for ${fullEvent.topic}: ${dispErr.message || dispErr}`);
          }
        }),
      ).catch(() => {});
    }

    return fullEvent;
  }

  /**
   * In-memory subscriber for a topic or pattern
   */
  subscribe<T = any>(pattern: string, listener: (event: AppEvent<T>) => any): () => void {
    const handler = (event: AppEvent<T>) => {
      if (matchesTopicPattern(pattern, event.topic)) {
        listener(event);
      }
    };

    if (pattern === '*' || pattern.includes('*')) {
      this.emitter.on('*', handler);
      return () => {
        this.emitter.off('*', handler);
      };
    } else {
      this.emitter.on(pattern, handler);
      return () => {
        this.emitter.off(pattern, handler);
      };
    }
  }

  /**
   * List recent events with filtering
   */
  async list(query: any = {}): Promise<any[]> {
    const filter: any = {};
    if (query.topic) {
      filter.topic = matchesTopicPattern(query.topic, query.topic) && !query.topic.includes('*')
        ? query.topic
        : { $regex: new RegExp(query.topic.replace(/\*/g, '.*'), 'i') };
    }
    if (query.entityName) filter.entityName = String(query.entityName).trim();
    if (query.entityId) filter.entityId = String(query.entityId).trim();
    if (query.eventType) filter.eventType = String(query.eventType).trim();
    if (query.projectId) filter.projectId = String(query.projectId).trim();

    const limit = Math.min(Number(query.limit || 50), 200);
    return this.eventModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean().exec();
  }

  /**
   * Get single event by eventId
   */
  async get(id: string): Promise<any> {
    const cleanId = String(id || '').trim();
    const item = await this.eventModel.findOne({
      $or: [{ eventId: cleanId }, { _id: cleanId.match(/^[0-9a-fA-F]{24}$/) ? cleanId : undefined }].filter(Boolean) as any,
    }).lean().exec();

    if (!item) throw new NotFoundException(`Event "${id}" not found`);
    return item;
  }
}
