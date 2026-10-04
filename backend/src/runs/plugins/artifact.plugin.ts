import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  ToolPlugin,
  ToolExecutionContext,
  OutputSynthesisContext,
  NodeOutputDefinition,
} from './tool-plugin.interface';
import { ArtifactService } from '../../blocks/artifact.service';
import { ArtifactRelationService } from '../../blocks/artifact-relation.service';

function httpStatus(err: any): number | undefined {
  if (typeof err?.getStatus === 'function') return err.getStatus();
  return typeof err?.status === 'number' ? err.status : undefined;
}

function failure(err: any) {
  const status = httpStatus(err);
  const branch = status === 404 ? 'onNotFound' : status === 409 ? 'onConflict' : 'onFailed';
  const outcome = status === 404 ? 'not_found' : status === 409 ? 'conflict' : 'failed';
  return {
    branch,
    status: outcome,
    error: err?.message || String(err),
    existing: false,
    changed: false,
  };
}

function present(doc: any, extra: Record<string, any> = {}) {
  return {
    branch: extra.changed === false ? 'onUnchanged' : 'onSuccess',
    status: 'completed',
    artifact: doc,
    artifactId: doc?.artifactId || '',
    logicalId: doc?.logicalId || '',
    rootArtifactId: doc?.rootArtifactId || '',
    projectId: doc?.projectId || '',
    isLatest: doc?.isLatest ?? true,
    contentHash: doc?.contentHash || '',
    schemaVersion: doc?.schemaVersion || 1,
    title: doc?.title || '',
    type: doc?.type || '',
    category: doc?.category || '',
    tags: doc?.tags || [],
    format: doc?.format || 'markdown',
    language: doc?.language || '',
    content: doc?.content ?? null,
    version: doc?.version || 0,
    author: doc?.author || '',
    changeSummary: doc?.changeSummary || '',
    changed: doc?.changed ?? true,
    created: doc?.created ?? true,
    ...(doc?.metadata ? { metadata: doc.metadata } : {}),
    ...extra,
  };
}

@Injectable()
export class ArtifactPlugin implements ToolPlugin {
  readonly toolType = 'artifact';
  private readonly logger = new Logger(ArtifactPlugin.name);

  constructor(
    @Optional() private readonly artifacts?: ArtifactService,
    @Optional() private readonly relations?: ArtifactRelationService,
  ) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, runId } = ctx;
    const config = node?.data?.config || {};
    const op = String(config.operation || nodeInput?.operation || 'create').toLowerCase();
    const payload: any = {
      ...(nodeInput && typeof nodeInput === 'object' ? nodeInput : {}),
      ...config,
    };
    if (!payload.projectId && ctx.initialInput?.projectId) {
      payload.projectId = ctx.initialInput.projectId;
    }
    payload.runId = payload.runId || runId;
    payload.nodeId = payload.nodeId || node?.id;

    if (!this.artifacts) {
      this.logger.warn('ArtifactService is not available');
      return { branch: 'onFailed', status: 'failed', error: 'ArtifactService not available' };
    }

    try {
      if (op === 'list') {
        const items = await this.artifacts.list(payload);
        const firstItem = Array.isArray(items) && items.length > 0 ? items[0] : null;
        return {
          branch: 'onSuccess',
          status: 'completed',
          artifacts: items,
          count: Array.isArray(items) ? items.length : 0,
          artifact: firstItem,
          artifactId: firstItem?.artifactId || '',
          logicalId: firstItem?.logicalId || '',
          category: firstItem?.category || '',
          tags: firstItem?.tags || [],
        };
      }

      if (op === 'diff') {
        const logicalId = String(payload.logicalId || '');
        const fromVersion = Number(payload.fromVersion);
        const toVersion = Number(payload.toVersion);
        const diffResult = await this.artifacts.diffVersions(
          logicalId,
          fromVersion,
          toVersion,
          payload.projectId,
          payload.diffFormat,
        );
        return {
          branch: 'onSuccess',
          status: 'completed',
          logicalId,
          ...diffResult,
        };
      }

      if (op === 'get') {
        const id = String(payload.logicalId || '');
        const version = payload.version && String(payload.version).toLowerCase() !== 'latest'
          ? Number(payload.version)
          : undefined;
        const doc = id ? await this.artifacts.get(id, payload.projectId, false, version) : null;
        if (!doc) {
          return { branch: 'onNotFound', status: 'not_found', existing: false, logicalId: id, artifact: null };
        }
        return present(doc, { existing: true });
      }

      if (op === 'listversions' || op === 'list-versions') {
        const id = String(payload.logicalId || '');
        const versions = id ? await this.artifacts.listVersions(id, payload.projectId) : [];
        const latest = versions.length > 0 ? versions[versions.length - 1] : null;
        return {
          branch: 'onSuccess',
          status: 'completed',
          versions,
          count: versions.length,
          artifact: latest,
          artifactId: latest?.artifactId || '',
          logicalId: latest?.logicalId || id,
        };
      }

      if (op === 'getrelations' || op === 'get-relations') {
        const id = String(payload.logicalId || '');
        const direction = payload.relationDirection || payload.direction || 'both';
        const rels = this.relations
          ? await this.relations.getRelations(id, { direction, projectId: payload.projectId })
          : [];
        return { branch: 'onSuccess', status: 'completed', relations: rels, count: rels.length, logicalId: id };
      }

      if (op === 'removerelation' || op === 'remove-relation') {
        const relationId = String(payload.relationId || '');
        const res = this.relations
          ? await this.relations.removeRelation(relationId, payload.projectId, {
              origin: 'flow',
              runId,
              nodeId: node?.id,
            })
          : { success: false, removedCount: 0 };
        return { branch: 'onSuccess', status: 'completed', success: res.success, removedCount: res.removedCount, relationId };
      }

      if (op === 'addrelation' || op === 'add-relation') {
        const id = String(payload.logicalId || '');
        if (!this.relations) {
          return { branch: 'onFailed', status: 'failed', error: 'Relation service not available' };
        }
        const doc = await this.artifacts.get(id, payload.projectId, true);
        const result = await this.relations.addRelation({
          sourceLogicalId: doc.logicalId,
          targetLogicalId: payload.targetLogicalId,
          type: payload.relationType,
          projectId: payload.projectId || doc.projectId,
          metadata: payload.relationMetadata || payload.metadata,
          source: { origin: 'flow', runId, nodeId: node?.id },
        });
        return {
          branch: 'onSuccess',
          status: 'completed',
          forward: result.forward,
          reverse: result.reverse,
          relationId: result.forward.relationId,
          relations: [result.forward, result.reverse],
          logicalId: doc.logicalId,
        };
      }

      if (op === 'approve') {
        const doc = await this.artifacts.approve(
          String(payload.logicalId || ''),
          payload.metadata,
          payload.projectId,
          payload.expectedVersion,
        );
        return present(doc);
      }

      if (op === 'reject') {
        const doc = await this.artifacts.reject(
          String(payload.logicalId || ''),
          payload.reason,
          payload.metadata,
          payload.projectId,
          payload.expectedVersion,
        );
        return present(doc);
      }

      if (op === 'archive') {
        const doc = await this.artifacts.archive(String(payload.logicalId || ''), payload.projectId, payload.expectedVersion);
        return present(doc);
      }

      if (op === 'unarchive') {
        const doc = await this.artifacts.unarchive(String(payload.logicalId || ''), payload.projectId, payload.expectedVersion);
        return present(doc);
      }

      if (op === 'restore') {
        const doc = await this.artifacts.restore(String(payload.logicalId || ''), Number(payload.version), payload);
        return present(doc);
      }

      if (op === 'delete') {
        const logicalId = String(payload.logicalId || '');
        const success = await this.artifacts.delete(logicalId, payload.projectId);
        if (!success) return { branch: 'onNotFound', status: 'not_found', logicalId, success: false };
        return { branch: 'onSuccess', status: 'completed', logicalId, success: true };
      }

      if (op === 'update' || op === 'patch') {
        const doc = await this.artifacts.update(String(payload.logicalId || ''), payload);
        return present(doc, { changed: doc?.changed ?? true });
      }

      const doc = await this.artifacts.create(payload);
      return present(doc, { created: doc?.created ?? true, changed: doc?.changed ?? true });
    } catch (err: any) {
      this.logger.warn(`Artifact ${op} failed: ${err?.message || err}`);
      return failure(err);
    }
  }

  getValidHandles(_config?: any, _outputs?: any[], _nodeData?: any, _nodeName?: string): Set<string> {
    return new Set(['onsuccess', 'onunchanged', 'onnotfound', 'onconflict', 'onfailed']);
  }

  getProducedPaths(nodeName: string, _config?: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>();
    const artifactKeys = [
      'content',
      'artifact',
      'artifactId',
      'logicalId',
      'status',
      'version',
      'metadata',
      'title',
      'type',
      'category',
      'tags',
      'count',
      'artifacts',
      'relations',
      'changed',
      'branch',
      'diff',
    ];
    for (const k of artifactKeys) {
      paths.add(`${nodeName}.${k}`);
    }
    return paths;
  }

  synthesizeOutputs(ctx: OutputSynthesisContext): NodeOutputDefinition[] {
    const existing = ctx.data?.definitionOutputs || ctx.def?.outputs || ctx.data?.outputs || [];
    const hasLegacyResult = existing.some((o: NodeOutputDefinition) => o.name === 'result') || existing.length === 0;
    const hasConditionalOutputs = ctx.def?.outputs?.some((o) => o.dependsOn);
    if ((hasLegacyResult || hasConditionalOutputs) && ctx.def?.outputs?.length) {
      return ctx.def.outputs;
    }
    return existing;
  }
}
