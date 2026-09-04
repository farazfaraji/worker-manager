import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEngineService, matchesTopicPattern } from '../events/event-engine.service';
import { AppEvent } from '../events/event.types';
import { Graph, GraphDocument } from './schemas/graph.schema';
import { GraphRunnerService } from '../runs/graph-runner.service';

@Injectable()
export class GraphEventDispatcherService implements OnModuleInit {
  private readonly logger = new Logger(GraphEventDispatcherService.name);

  constructor(
    private readonly eventEngine: EventEngineService,
    @InjectModel(Graph.name) private readonly graphModel: Model<GraphDocument>,
    private readonly graphRunner: GraphRunnerService,
  ) {}

  onModuleInit() {
    this.logger.log('🔗 Registering GraphEventDispatcher with EventEngineService...');
    this.eventEngine.registerDispatcher(async (event: AppEvent) => {
      return this.handleEvent(event);
    });
  }

  async handleEvent(event: AppEvent): Promise<string[]> {
    try {
      const graphs = await this.graphModel.find().lean().exec();
      const dispatchedRunIds: string[] = [];

      for (const graph of graphs) {
        const nodes = graph.nodes || [];
        const matchingTriggerNodes = nodes.filter((node: any) => {
          const type = String(node.data?.definitionType || node.type || '').toLowerCase();
          if (type !== 'trigger') return false;
          const config = node.data?.config || {};
          if (config.triggerType !== 'event') return false;

          const pattern = config.eventTopic || 'artifact.*';
          if (!matchesTopicPattern(pattern, event.topic)) return false;

          if (config.eventProjectId && String(config.eventProjectId).trim()) {
            if (String(config.eventProjectId).trim() !== String(event.projectId || '').trim()) {
              return false;
            }
          }

          if (config.eventEntityId && String(config.eventEntityId).trim()) {
            const entityPattern = String(config.eventEntityId).trim();
            if (entityPattern.includes('*') || entityPattern.includes('?')) {
              const regexStr = '^' + entityPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
              if (!new RegExp(regexStr, 'i').test(event.entityId)) return false;
            } else if (entityPattern !== event.entityId) {
              return false;
            }
          }

          return true;
        });

        if (matchingTriggerNodes.length > 0) {
          const idempotencyKey = `${event.id}${graph._id}`;
          const depth = Number(event.propagationDepth ?? event.source?.propagationDepth ?? 0);
          const visitedIds = [
            ...(event.visitedArtifactLogicalIds || event.source?.visitedArtifactLogicalIds || []),
          ];

          // Preserve complete event metadata without dropping
          const triggerPayload = {
            id: event.id,
            eventId: event.id,
            topic: event.topic,
            entityName: event.entityName,
            entityId: event.entityId,
            eventType: event.eventType,
            timestamp: event.timestamp,
            projectId: event.projectId,
            source: event.source,
            data: event.data,
            sourceOrigin: event.source?.origin || 'system',
            sourceRunId: event.source?.runId,
            sourceEventId: event.id,
            rootRunId: event.rootRunId || event.source?.rootRunId,
            propagationRunId: event.propagationRunId || event.source?.propagationRunId,
            propagationDepth: depth,
            visitedArtifactLogicalIds: visitedIds,
          };

          this.logger.log(
            `⚡ [EVENT DISPATCH] Triggering Graph "${graph.name}" (${graph._id}) for event: ${event.topic} (Entity: ${event.entityId}, IdempotencyKey: ${idempotencyKey})`,
          );

          try {
            const run = await this.graphRunner.runGraph(String(graph._id), triggerPayload, {
              startNodeId: matchingTriggerNodes[0].id,
              idempotencyKey,
              sourceEventId: event.id,
              sourceEventTopic: event.topic,
              propagationDepth: depth,
              visitedArtifactLogicalIds: visitedIds,
              rootRunId: event.rootRunId || event.source?.rootRunId,
              propagationRunId: event.propagationRunId || event.source?.propagationRunId,
            });
            if (run?.runId) dispatchedRunIds.push(run.runId);
          } catch (err: any) {
            this.logger.error(
              `Failed to trigger graph "${graph.name}" (${graph._id}) for event ${event.topic}: ${err.message || err}`,
            );
          }
        }
      }

      return dispatchedRunIds;
    } catch (err: any) {
      this.logger.error(`Error in GraphEventDispatcherService.handleEvent: ${err.message || err}`);
      return [];
    }
  }
}
