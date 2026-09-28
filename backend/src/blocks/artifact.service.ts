import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomUUID } from 'crypto';
import { Artifact, ArtifactDocument } from './schemas/artifact.schema';
import { EventEngineService } from '../events/event-engine.service';
import {
  ArtifactCreateEventData,
  ArtifactUpdateEventData,
  ArtifactDeleteEventData,
  ArtifactApproveEventData,
  ArtifactArchiveEventData,
} from '../events/event.types';
import { ArtifactRelationService } from './artifact-relation.service';
import { ArtifactIndexingService } from './artifact-indexing.service';
import { VectorStoreService } from './vector-store.service';
import {
  ArtifactCreateInput,
  ArtifactListQuery,
  ArtifactUpdateInput,
  ArtifactVersion,
} from './artifact.types';

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexPattern = '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(regexPattern, 'i');
}

export function parseKeywords(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item).trim()).filter(Boolean);
        }
      } catch {}
    }
    return trimmed
      .split(/[\r\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function parseLinkedArtifactIds(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) =>
        typeof item === 'object' && item !== null
          ? item.artifactId || item.id || item.value || item.targetLogicalId || String(item)
          : String(item).trim(),
      )
      .filter(Boolean);
  }
  if (typeof raw === 'object' && raw !== null && raw.value !== undefined) {
    return parseLinkedArtifactIds(raw.value);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parseLinkedArtifactIds(parsed);
        }
      } catch {}
    }
    return trimmed
      .split(/[\r\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function parseMetadata(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...raw };
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch {}
    }
    if (trimmed) {
      return { commitHash: trimmed };
    }
  }
  return {};
}

export function canonicalizeJson(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalizeJson).join(',')}]`;
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJson(obj[key])}`);
  return `{${pairs.join(',')}}`;
}

export function computeContentHash(format: string, content: any): string {
  let normalizedStr = '';
  if (format === 'json' || (typeof content === 'object' && content !== null)) {
    normalizedStr = canonicalizeJson(content);
  } else {
    normalizedStr = String(content ?? '').replace(/\r\n/g, '\n');
  }
  return createHash('sha256').update(`${format}:${normalizedStr}`).digest('hex');
}

export function shallowEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
  }
  return true;
}

@Injectable()
export class ArtifactService {
  private readonly logger = new Logger(ArtifactService.name);

  constructor(
    @InjectModel(Artifact.name) private readonly model: Model<ArtifactDocument>,
    private readonly eventEngine: EventEngineService,
    @Optional() private readonly relationService?: ArtifactRelationService,
    @Optional() private readonly indexingService?: ArtifactIndexingService,
    @Optional() private readonly vectorStore?: VectorStoreService,
  ) {}

  /**
   * Create a new logical artifact (version 1)
   */
  async create(input: ArtifactCreateInput | any): Promise<ArtifactVersion> {
    const projectId = input.projectId || input.namespace || 'default';
    const parent = input.parentArtifactId ? await this.get(input.parentArtifactId, projectId, false) : null;
    let content = input.content !== undefined ? input.content : (input.value !== undefined ? input.value : input.input);
    if (content === undefined || content === null) {
      content = '';
    }
    if (input.format === 'json' && typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch {
        // preserve original string if not valid JSON
      }
    }

    const format = input.format || (typeof content === 'object' && content !== null ? 'json' : 'markdown');
    const type = input.type || 'document';

    // 1. Artifact ID determination
    let rawId = input.artifactId ? String(input.artifactId).trim() : '';
    if (!rawId || rawId === '{{uuid}}') {
      const prefix = input.idPrefix ? String(input.idPrefix).trim() : '';
      rawId = `${prefix}${randomUUID()}`;
    } else if (rawId.includes('{{uuid}}') || rawId.includes('{{UUID}}') || rawId.includes('{{$uuid}}')) {
      rawId = rawId.replace(/{{\s*\$?uuid\s*}}/gi, () => randomUUID());
    }
    const artifactId = rawId;

    // 2. Logical ID determination
    let logicalId = input.logicalId ? String(input.logicalId).trim() : '';
    if (logicalId) {
      // Reject if logicalId already exists
      const existingLogical = await this.model.findOne({ logicalId }).lean().exec();
      if (existingLogical) {
        throw new ConflictException(
          `Artifact with logicalId "${logicalId}" already exists. Creating a new artifact with an existing logicalId is rejected; use update to create a new version.`,
        );
      }
    } else if (input.artifactId && !input.artifactId.includes('{{uuid}}')) {
      logicalId = artifactId;
    } else {
      logicalId = `${type}-${randomUUID()}`;
    }

    // 3. First version rootArtifactId must equal its own artifactId
    const rootArtifactId = parent?.rootArtifactId || artifactId;
    const version = Number(input.version || (parent ? (parent.version || 1) + 1 : 1));
    const schemaVersion = Number(input.schemaVersion || 1);
    const contentHash = computeContentHash(format, content);

    const keywords = parseKeywords(input.keywords !== undefined ? input.keywords : input.keyword);
    const linkedArtifactIds = parseLinkedArtifactIds(
      input.linkedArtifactIds !== undefined
        ? input.linkedArtifactIds
        : (input.relations !== undefined ? input.relations : input.linkedArtifactId),
    );

    // Provenance & source metadata
    const metadata = parseMetadata(input.metadata);
    if (input.runId && !metadata.sourceRunId) metadata.sourceRunId = input.runId;
    if (input.nodeId && !metadata.sourceNodeId) metadata.sourceNodeId = input.nodeId;

    const sourceEventIds = Array.from(
      new Set([...(Array.isArray(input.sourceEventIds) ? input.sourceEventIds : []), ...(Array.isArray(metadata.sourceEventIds) ? metadata.sourceEventIds : [])]),
    );

    const artifact = await this.model.create({
      artifactId,
      logicalId,
      rootArtifactId,
      projectId,
      type,
      format,
      title: input.title || 'Untitled artifact',
      content,
      keyword: keywords,
      keywords,
      status: input.status || 'draft',
      version,
      isLatest: true,
      contentHash,
      schemaVersion,
      parentArtifactId: input.parentArtifactId,
      linkedArtifactIds,
      sourceEventIds,
      metadata,
    });

    const result = this.public(artifact);

    // Index artifact vectors
    if (this.indexingService) {
      void this.indexingService.indexArtifact(result);
    }

    // Emit typed artifact.create event
    await this.eventEngine.publish<ArtifactCreateEventData>({
      topic: 'artifact.create',
      entityName: 'artifact',
      entityId: result.artifactId,
      eventType: 'create',
      projectId: result.projectId,
      source: {
        origin: input.source?.origin || (input.runId ? 'flow' : 'api'),
        runId: input.runId,
        nodeId: input.nodeId,
      },
      data: {
        artifactId: result.artifactId,
        logicalId: result.logicalId,
        rootArtifactId: result.rootArtifactId,
        isLatest: result.isLatest,
        contentHash: result.contentHash,
        schemaVersion: result.schemaVersion,
        title: result.title,
        type: result.type,
        format: result.format,
        version: result.version,
        content: result.content,
        keywords: result.keywords || result.keyword || [],
        status: result.status,
        projectId: result.projectId,
        parentArtifactId: result.parentArtifactId,
        metadata: result.metadata,
      },
    });

    return result;
  }

  /**
   * Update an artifact by creating a new immutable version.
   * Handles no-op updates and MongoDB transactions.
   */
  async update(id: string, patch: ArtifactUpdateInput | any): Promise<ArtifactVersion | any> {
    const patchProjectId = patch.projectId || patch.namespace;
    const current = await this.get(id, patchProjectId, true);
    const logicalId = current.logicalId || current.artifactId;
    const rootArtifactId = current.rootArtifactId || current.artifactId;

    let nextContent = patch.content !== undefined ? patch.content : (patch.value !== undefined ? patch.value : current.content);
    if (patch.format === 'json' && typeof nextContent === 'string') {
      try {
        nextContent = JSON.parse(nextContent);
      } catch {}
    }
    const format = patch.format ?? current.format ?? (typeof nextContent === 'object' && nextContent !== null ? 'json' : 'markdown');
    const title = patch.title ?? current.title;
    const type = patch.type ?? current.type;
    const status = patch.status || current.status || 'draft';
    const schemaVersion = Number(patch.schemaVersion || current.schemaVersion || 1);

    const nextKeywords =
      patch.keyword !== undefined || patch.keywords !== undefined
        ? parseKeywords(patch.keyword !== undefined ? patch.keyword : patch.keywords)
        : (current.keywords || current.keyword || []);

    const newContentHash = computeContentHash(format, nextContent);

    // Merge metadata shallowly at top level; union sourceEventIds
    const nextMetadata = { ...(current.metadata || {}), ...parseMetadata(patch.metadata) };
    if (patch.runId && !nextMetadata.sourceRunId) nextMetadata.sourceRunId = patch.runId;
    if (patch.nodeId && !nextMetadata.sourceNodeId) nextMetadata.sourceNodeId = patch.nodeId;
    if (patch.updatedBy && !nextMetadata.updatedBy) nextMetadata.updatedBy = patch.updatedBy;

    const currentEventIds = Array.isArray(current.sourceEventIds) ? current.sourceEventIds : [];
    const patchEventIds = Array.isArray(patch.sourceEventIds) ? patch.sourceEventIds : [];
    const nextSourceEventIds = Array.from(new Set([...currentEventIds, ...patchEventIds]));

    const nextLinkedIds =
      patch.linkedArtifactIds !== undefined || patch.relations !== undefined
        ? parseLinkedArtifactIds(patch.linkedArtifactIds !== undefined ? patch.linkedArtifactIds : patch.relations)
        : (current.linkedArtifactIds || []);

    // -------------------------------------------------------------
    // No-op update detection
    // -------------------------------------------------------------
    const isContentUnchanged = newContentHash === current.contentHash;
    const isTitleUnchanged = title === current.title;
    const isTypeUnchanged = type === current.type;
    const isFormatUnchanged = format === current.format;
    const isStatusUnchanged = status === current.status;
    const isSchemaVersionUnchanged = schemaVersion === current.schemaVersion;
    const areKeywordsUnchanged = JSON.stringify(nextKeywords) === JSON.stringify(current.keywords || current.keyword || []);
    const isMetadataUnchanged = shallowEqual(current.metadata || {}, nextMetadata);

    if (
      isContentUnchanged &&
      isTitleUnchanged &&
      isTypeUnchanged &&
      isFormatUnchanged &&
      isStatusUnchanged &&
      isSchemaVersionUnchanged &&
      areKeywordsUnchanged &&
      isMetadataUnchanged
    ) {
      this.logger.log(`No-op update for artifact "${current.artifactId}" (${logicalId}): no material change detected`);
      return {
        ...this.public(current),
        changed: false,
      };
    }

    // -------------------------------------------------------------
    // Create new version in transaction
    // -------------------------------------------------------------
    const newArtifactId = patch.artifactId || randomUUID();
    const newVersionNumber = Number(current.version || 1) + 1;

    const session = await this.model.db.startSession();
    let nextCreated: any;

    try {
      session.startTransaction({ maxCommitTimeMS: 5000 });

      // 1. Mark existing versions for this logicalId as isLatest: false
      await this.model.updateMany(
        { logicalId, isLatest: true },
        { $set: { isLatest: false } },
        { session },
      );

      // 2. Insert new latest version
      [nextCreated] = await this.model.create(
        [
          {
            artifactId: newArtifactId,
            logicalId,
            rootArtifactId,
            projectId: patchProjectId ?? current.projectId,
            type,
            format,
            title,
            content: nextContent,
            keyword: nextKeywords,
            keywords: nextKeywords,
            status,
            version: newVersionNumber,
            isLatest: true,
            contentHash: newContentHash,
            schemaVersion,
            parentArtifactId: current.artifactId || id,
            metadata: nextMetadata,
            linkedArtifactIds: nextLinkedIds,
            sourceEventIds: nextSourceEventIds,
          },
        ],
        { session },
      );

      await session.commitTransaction();
    } catch (err: any) {
      await session.abortTransaction();
      throw new Error(`Failed to commit new artifact version in transaction: ${err.message || err}`);
    } finally {
      await session.endSession();
    }

    const result = {
      ...this.public(nextCreated),
      changed: true,
    };

    // Re-index vectors
    if (this.indexingService) {
      void this.indexingService.indexArtifact(result);
    }

    const diff = this.diff(current.content, nextContent);

    // Emit typed artifact.update event
    await this.eventEngine.publish<ArtifactUpdateEventData>({
      topic: 'artifact.update',
      entityName: 'artifact',
      entityId: result.artifactId,
      eventType: 'update',
      projectId: result.projectId,
      source: {
        origin: patch.source?.origin || (patch.runId ? 'flow' : 'api'),
        runId: patch.runId,
        nodeId: patch.nodeId,
      },
      data: {
        artifactId: result.artifactId,
        logicalId: result.logicalId,
        rootArtifactId: result.rootArtifactId,
        isLatest: result.isLatest,
        contentHash: result.contentHash,
        schemaVersion: result.schemaVersion,
        version: result.version,
        parentArtifactId: current.artifactId || id,
        changedKeys: diff.changedKeys || [],
        previous: {
          version: current.version,
          title: current.title,
          content: current.content,
          status: current.status,
          keywords: current.keywords || current.keyword || [],
        },
        current: {
          version: result.version,
          title: result.title,
          content: result.content,
          status: result.status,
          keywords: result.keywords || result.keyword || [],
        },
        fileChanges: {
          diff,
          changedKeys: diff.changedKeys || [],
        },
      },
    });

    return result;
  }

  /**
   * Retrieve an artifact by exact artifactId, logicalId, or wildcard pattern.
   * If logicalId matches, returns latest version (isLatest: true).
   */
  async get(id: string, projectId?: string, throwOnNotFound = true): Promise<any> {
    const rawId = String(id || '').trim();
    if (!rawId) {
      if (throwOnNotFound) throw new NotFoundException('Artifact ID cannot be empty');
      return null;
    }

    const baseFilter: any = {};
    if (projectId && String(projectId).trim()) {
      baseFilter.projectId = String(projectId).trim();
    }

    // 1. Exact artifactId check
    const exact = await this.model.findOne({ ...baseFilter, artifactId: rawId }).lean().exec();
    if (exact) return this.public(exact);

    // 2. LogicalId lookup -> returns latest version
    const latestLogical = await this.model
      .findOne({ ...baseFilter, logicalId: rawId, isLatest: true })
      .lean()
      .exec();
    if (latestLogical) return this.public(latestLogical);

    // 3. Wildcard pattern lookup
    if (rawId.includes('*') || rawId.includes('?')) {
      const pattern = wildcardToRegex(rawId);
      const wildcardItem = await this.model
        .findOne({
          ...baseFilter,
          $or: [{ artifactId: pattern }, { logicalId: pattern }],
        })
        .sort({ isLatest: -1, updatedAt: -1, version: -1 })
        .lean()
        .exec();

      if (wildcardItem) return this.public(wildcardItem);
    }

    if (throwOnNotFound) throw new NotFoundException(`Artifact "${id}" not found`);
    return null;
  }

  /**
   * Get latest version of a logical artifact
   */
  async getLatest(logicalId: string, projectId?: string): Promise<any> {
    const cleanId = String(logicalId || '').trim();
    const filter: any = {
      $or: [{ logicalId: cleanId }, { artifactId: cleanId }],
      isLatest: true,
    };
    if (projectId && String(projectId).trim()) {
      filter.projectId = String(projectId).trim();
    }
    const item = await this.model.findOne(filter).sort({ version: -1 }).lean().exec();
    if (!item) {
      // Fallback without isLatest flag if legacy unmigrated data
      const fallback = await this.model
        .findOne({
          $or: [{ logicalId: cleanId }, { artifactId: cleanId }],
          ...(projectId ? { projectId: String(projectId).trim() } : {}),
        })
        .sort({ version: -1, updatedAt: -1 })
        .lean()
        .exec();
      return fallback ? this.public(fallback) : null;
    }
    return this.public(item);
  }

  /**
   * List all versions for a given logical artifact ordered ascending by version
   */
  async listVersions(logicalId: string, projectId?: string): Promise<ArtifactVersion[]> {
    const cleanId = String(logicalId || '').trim();
    const filter: any = {
      $or: [{ logicalId: cleanId }, { rootArtifactId: cleanId }, { artifactId: cleanId }],
    };
    if (projectId && String(projectId).trim()) {
      filter.projectId = String(projectId).trim();
    }
    const items = await this.model.find(filter).sort({ version: 1 }).lean().exec();
    return items.map((item) => this.public(item));
  }

  /**
   * Get exact version by artifactId
   */
  async getByArtifactId(artifactId: string, projectId?: string): Promise<any> {
    const filter: any = { artifactId: String(artifactId).trim() };
    if (projectId && String(projectId).trim()) {
      filter.projectId = String(projectId).trim();
    }
    const item = await this.model.findOne(filter).lean().exec();
    return item ? this.public(item) : null;
  }

  /**
   * List artifacts with optional latestOnly filter
   */
  async list(query: ArtifactListQuery | any = {}): Promise<any[]> {
    const filter: any = {};
    const listProjectId = query.projectId || query.namespace;
    if (listProjectId) filter.projectId = listProjectId;
    const targetType = query.filterType || query.type;
    if (targetType) filter.type = targetType;
    const targetStatus = query.filterStatus || query.status;
    if (targetStatus) filter.status = targetStatus;

    if (query.latestOnly === true || query.latestOnly === 'true') {
      filter.isLatest = true;
    }

    if (query.logicalId) {
      filter.logicalId = String(query.logicalId).trim();
    }

    const rawArtifactId = (query.filterArtifactId || query.artifactId) ? String(query.filterArtifactId || query.artifactId).trim() : '';
    if (rawArtifactId && rawArtifactId !== '{{uuid}}') {
      if (rawArtifactId.includes('*') || rawArtifactId.includes('?')) {
        filter.$or = filter.$or || [];
        const rx = wildcardToRegex(rawArtifactId);
        filter.$or.push({ artifactId: rx }, { logicalId: rx });
      } else {
        filter.$or = filter.$or || [];
        filter.$or.push({ artifactId: rawArtifactId }, { logicalId: rawArtifactId });
      }
    }

    if (query.keyword) {
      const kw = String(query.keyword).trim();
      const kwRegex = new RegExp(kw.replace(/[.+^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = filter.$or || [];
      filter.$or.push({ keywords: kwRegex }, { keyword: kwRegex });
    }

    if (query.search) {
      const searchStr = String(query.search).trim();
      if (searchStr) {
        let searchRegex: RegExp;
        if (searchStr.includes('*') || searchStr.includes('?')) {
          searchRegex = wildcardToRegex(searchStr);
        } else {
          searchRegex = new RegExp(searchStr.replace(/[.+^${}()|[\]\\]/g, '\\$&'), 'i');
        }
        filter.$or = [
          ...(filter.$or || []),
          { title: searchRegex },
          { artifactId: searchRegex },
          { logicalId: searchRegex },
          { keywords: searchRegex },
          { keyword: searchRegex },
        ];
      }
    }

    const items = await this.model
      .find(filter)
      .sort({ updatedAt: -1, version: -1 })
      .limit(Number(query.limit || 50))
      .lean()
      .exec();

    return items.map((i) => this.public(i));
  }

  /**
   * Approve an artifact version (or latest version of logical artifact)
   */
  async approve(id: string, metadata: any = {}): Promise<any> {
    const current = await this.get(id, undefined, true);
    const approvedMetadata = { ...(current.metadata || {}), ...parseMetadata(metadata) };
    const item = await this.model
      .findOneAndUpdate(
        { artifactId: current.artifactId },
        { $set: { status: 'approved', metadata: approvedMetadata } },
        { new: true },
      )
      .lean()
      .exec();

    if (!item) throw new NotFoundException(`Artifact "${id}" not found`);
    const result = this.public(item);

    if (this.indexingService) {
      void this.indexingService.indexArtifact(result);
    }

    await this.eventEngine.publish<ArtifactApproveEventData>({
      topic: 'artifact.approve',
      entityName: 'artifact',
      entityId: result.artifactId,
      eventType: 'approve',
      projectId: result.projectId,
      source: { origin: metadata?.runId ? 'flow' : 'api', runId: metadata?.runId },
      data: {
        artifactId: result.artifactId,
        version: result.version,
        status: 'approved',
        metadata: result.metadata,
      },
    });

    return result;
  }

  /**
   * Archive an artifact version (or latest version of logical artifact)
   */
  async archive(id: string): Promise<any> {
    const current = await this.get(id, undefined, true);
    const item = await this.model
      .findOneAndUpdate(
        { artifactId: current.artifactId },
        { $set: { status: 'archived' } },
        { new: true },
      )
      .lean()
      .exec();

    if (!item) throw new NotFoundException(`Artifact "${id}" not found`);
    const result = this.public(item);

    if (this.indexingService) {
      void this.indexingService.indexArtifact(result);
    }

    await this.eventEngine.publish<ArtifactArchiveEventData>({
      topic: 'artifact.archive',
      entityName: 'artifact',
      entityId: result.artifactId,
      eventType: 'archive',
      projectId: result.projectId,
      source: { origin: 'api' },
      data: {
        artifactId: result.artifactId,
        version: result.version,
        status: 'archived',
      },
    });

    return result;
  }

  /**
   * Delete an artifact version or entire logical artifact
   */
  async delete(id: string): Promise<boolean> {
    const rawId = String(id || '').trim();
    const target = await this.get(id, undefined, false);
    const res = await this.model
      .deleteOne({
        $or: [{ artifactId: rawId }, { _id: rawId.match(/^[0-9a-fA-F]{24}$/) ? rawId : undefined }].filter(Boolean) as any,
      })
      .exec();

    if (res.deletedCount > 0) {
      if (this.vectorStore) {
        try {
          await this.vectorStore.deleteBySourceId(target?.artifactId || rawId);
          if (target?.logicalId && target.logicalId !== (target?.artifactId || rawId)) {
            await this.vectorStore.deleteBySourceId(target.logicalId);
          }
        } catch (err: any) {
          this.logger.warn(`Failed to clean vector records for deleted artifact ${rawId}: ${err.message}`);
        }
      }
      await this.eventEngine.publish<ArtifactDeleteEventData>({
        topic: 'artifact.delete',
        entityName: 'artifact',
        entityId: target?.artifactId || rawId,
        eventType: 'delete',
        projectId: target?.projectId,
        source: { origin: 'api' },
        data: {
          artifactId: target?.artifactId || rawId,
          deletedAt: new Date().toISOString(),
        },
      });
      return true;
    }
    return false;
  }

  /**
   * Legacy relation support & bridge to typed relations.
   * Does NOT mutate artifact content or bump artifact version.
   */
  async addRelation(id: string, newRelations: any, source?: any): Promise<any> {
    const current = await this.get(id);
    const toAdd = parseLinkedArtifactIds(newRelations);
    const existing = Array.isArray(current.linkedArtifactIds) ? current.linkedArtifactIds : [];
    const merged = Array.from(new Set([...existing, ...toAdd]));

    // 1. If relationService is available, resolve each target and create typed 'relates-to' relation
    if (this.relationService && current.logicalId) {
      for (const targetId of toAdd) {
        const targetDoc = await this.get(targetId, current.projectId, false);
        if (targetDoc && targetDoc.logicalId && targetDoc.logicalId !== current.logicalId) {
          try {
            await this.relationService.addRelation({
              sourceLogicalId: current.logicalId,
              targetLogicalId: targetDoc.logicalId,
              type: 'relates-to',
              projectId: current.projectId,
              source,
            });
          } catch (relErr: any) {
            this.logger.warn(`Could not bridge typed relation: ${relErr.message}`);
          }
        }
      }
    }

    // 2. Preserve linkedArtifactIds on the record for backwards compatibility
    const item = await this.model
      .findOneAndUpdate(
        { artifactId: current.artifactId },
        { $set: { linkedArtifactIds: merged } },
        { new: true },
      )
      .lean()
      .exec();

    if (!item) throw new NotFoundException(`Artifact "${id}" not found`);
    return this.public(item);
  }

  diff(previous: any, next: any): any {
    const before = previous?.content ?? previous;
    const after = next?.content ?? next;
    if (JSON.stringify(before) === JSON.stringify(after)) {
      return { changed: false, additions: [], removals: [], changedKeys: [] };
    }
    if (typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
      const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
      const changedKeys = [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
      return { changed: true, changedKeys, before, after };
    }
    return { changed: true, before, after };
  }

  async getDistinctTypes(projectId?: string): Promise<{ label: string; value: string }[]> {
    const filter: any = {};
    if (projectId) {
      filter.projectId = projectId;
    }
    const dbTypes: string[] = await this.model.distinct('type', filter).exec();

    // Default canonical types to always provide if db is empty or has a subset
    const canonicalMap: Record<string, string> = {
      'prd': 'Product Requirements Document (PRD)',
      'tech-spec': 'Technical Specification',
      'task': 'Task / Plan',
      'high-level': 'High-Level Concept',
      'decision': 'Human Review Decision',
      'change': 'Change Request',
      'document': 'General Document',
      'code': 'Code / Patch',
    };

    const merged = Array.from(new Set([...Object.keys(canonicalMap), ...dbTypes.map(String).map((s) => s.trim()).filter(Boolean)]));

    const options = merged.map((t) => ({
      label: canonicalMap[t] || t.charAt(0).toUpperCase() + t.slice(1).replace(/[-_]/g, ' '),
      value: t,
    }));

    return [
      { label: 'All Artifact Types', value: '' },
      ...options,
    ];
  }

  private public(item: any) {
    const value = item.toObject ? item.toObject() : { ...item };
    delete value._id;
    delete value.__v;
    return value;
  }
}
