import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
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
  EventAction,
} from '../events/event.types';
import { ArtifactRelationService } from './artifact-relation.service';
import { ArtifactIndexingService } from './artifact-indexing.service';
import { VectorStoreService } from './vector-store.service';
import {
  ArtifactCreateInput,
  ArtifactListQuery,
  ArtifactStatus,
  ArtifactUpdateInput,
  ArtifactVersion,
} from './artifact.types';

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexPattern = '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(regexPattern, 'i');
}

export function slugValue(raw: any, fallback = ''): string {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return fallback;
  const slug = value.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || fallback;
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

export function lineDiff(before: string, after: string): string {
  const a = String(before ?? '').split('\n');
  const b = String(after ?? '').split('\n');
  const lines: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) lines.push(`- ${a[i]}`);
    if (b[i] !== undefined) lines.push(`+ ${b[i]}`);
  }
  return lines.join('\n');
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
export class ArtifactService implements OnModuleInit {
  private readonly logger = new Logger(ArtifactService.name);

  constructor(
    @InjectModel(Artifact.name) private readonly model: Model<ArtifactDocument>,
    private readonly eventEngine: EventEngineService,
    @Optional() private readonly relationService?: ArtifactRelationService,
    @Optional() private readonly indexingService?: ArtifactIndexingService,
    @Optional() private readonly vectorStore?: VectorStoreService,
  ) {}

  async onModuleInit() {
    await this.model.collection.dropIndex('projectId_1_idempotencyKey_1').catch(() => undefined);
    await this.model.syncIndexes().catch((err) => {
      this.logger.warn(`Artifact index sync skipped: ${err?.message || err}`);
    });
  }

  /**
   * Create a new logical artifact (version 1). The physical artifactId is always server-generated.
   */
  async create(input: ArtifactCreateInput | any): Promise<ArtifactVersion> {
    const projectId = String(input.projectId || input.namespace || 'default').trim() || 'default';
    const idempotencyKey = String(input.idempotencyKey || '').trim();
    if (idempotencyKey) {
      const existingByKey = await this.model.findOne({ projectId, idempotencyKey }).lean().exec();
      if (existingByKey) {
        return { ...this.public(existingByKey), created: false, changed: false };
      }
    }

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
    const type = slugValue(input.type, 'document');
    const category = slugValue(input.category, 'general');
    const tags = parseKeywords(input.tags);
    const language = input.language ? String(input.language).trim() : undefined;

    let logicalId = input.logicalId ? String(input.logicalId).trim() : '';
    if (logicalId) {
      const existingLogical = await this.model.findOne({ projectId, logicalId, isLatest: true }).lean().exec();
      if (existingLogical) {
        const ifExists = String(input.ifExists || 'error').toLowerCase();
        if (ifExists === 'return') {
          return { ...this.public(existingLogical), created: false, changed: false };
        }
        if (ifExists === 'update') {
          return this.update(logicalId, { ...input, projectId });
        }
        throw new ConflictException(
          `Artifact with logicalId "${logicalId}" already exists in project "${projectId}". Use update to create a new version, or set ifExists to "return" or "update".`,
        );
      }
    } else {
      logicalId = `${type}-${randomUUID()}`;
    }

    const artifactId = randomUUID();
    const schemaVersion = Number(input.schemaVersion || 1);
    const contentHash = computeContentHash(format, content);
    const metadata = parseMetadata(input.metadata);
    if (input.runId && !metadata.sourceRunId) metadata.sourceRunId = input.runId;
    if (input.nodeId && !metadata.sourceNodeId) metadata.sourceNodeId = input.nodeId;

    const sourceEventIds = Array.from(
      new Set([...(Array.isArray(input.sourceEventIds) ? input.sourceEventIds : []), ...(Array.isArray(metadata.sourceEventIds) ? metadata.sourceEventIds : [])]),
    );

    const artifact = await this.model.create({
      artifactId,
      logicalId,
      rootArtifactId: artifactId,
      projectId,
      type,
      category,
      tags,
      format,
      language,
      title: input.title || 'Untitled artifact',
      content,
      status: 'draft',
      version: 1,
      isLatest: true,
      contentHash,
      schemaVersion,
      author: input.author ? String(input.author).trim() : undefined,
      changeSummary: input.changeSummary ? String(input.changeSummary).trim() : undefined,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      sourceEventIds,
      metadata,
    });

    const result = { ...this.public(artifact), created: true, changed: true };

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
        category: result.category,
        tags: result.tags || [],
        format: result.format,
        version: result.version,
        content: result.content,
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
    const requestedVersion = patch.version !== undefined && patch.version !== '' && String(patch.version).toLowerCase() !== 'latest'
      ? Number(patch.version)
      : undefined;
    const current = await this.get(id, patchProjectId, true, Number.isFinite(requestedVersion) ? requestedVersion : undefined);
    this.assertExpectedVersion(current, patch.expectedVersion);
    const idempotencyKey = String(patch.idempotencyKey || '').trim();
    if (idempotencyKey) {
      const existingByKey = await this.model.findOne({
        projectId: patchProjectId || current.projectId,
        idempotencyKey,
      }).lean().exec();
      if (existingByKey) {
        return { ...this.public(existingByKey), created: false, changed: false };
      }
    }
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
    const type = patch.type !== undefined ? slugValue(patch.type, current.type) : current.type;
    const category = patch.category !== undefined ? slugValue(patch.category, 'general') : (current.category || 'general');
    const language = patch.language !== undefined ? (String(patch.language).trim() || undefined) : current.language;
    const schemaVersion = Number(patch.schemaVersion || current.schemaVersion || 1);
    const nextTags = patch.tags !== undefined ? parseKeywords(patch.tags) : (current.tags || []);
    const author = patch.author !== undefined ? String(patch.author).trim() : current.author;
    const changeSummary = patch.changeSummary !== undefined ? String(patch.changeSummary).trim() : '';

    const newContentHash = computeContentHash(format, nextContent);

    // Merge metadata shallowly at top level; union sourceEventIds
    const nextMetadata = { ...(current.metadata || {}), ...parseMetadata(patch.metadata) };
    if (patch.runId && !nextMetadata.sourceRunId) nextMetadata.sourceRunId = patch.runId;
    if (patch.nodeId && !nextMetadata.sourceNodeId) nextMetadata.sourceNodeId = patch.nodeId;
    if (patch.updatedBy && !nextMetadata.updatedBy) nextMetadata.updatedBy = patch.updatedBy;

    const currentEventIds = Array.isArray(current.sourceEventIds) ? current.sourceEventIds : [];
    const patchEventIds = Array.isArray(patch.sourceEventIds) ? patch.sourceEventIds : [];
    const nextSourceEventIds = Array.from(new Set([...currentEventIds, ...patchEventIds]));

    const isContentUnchanged = newContentHash === current.contentHash;
    const isTitleUnchanged = title === current.title;
    const isTypeUnchanged = type === current.type;
    const isCategoryUnchanged = category === (current.category || 'general');
    const isFormatUnchanged = format === current.format;
    const isLanguageUnchanged = (language || '') === (current.language || '');
    const isSchemaVersionUnchanged = schemaVersion === current.schemaVersion;
    const areTagsUnchanged = JSON.stringify(nextTags) === JSON.stringify(current.tags || []);
    const isMetadataUnchanged = shallowEqual(current.metadata || {}, nextMetadata);

    if (
      isContentUnchanged &&
      isTitleUnchanged &&
      isTypeUnchanged &&
      isCategoryUnchanged &&
      isFormatUnchanged &&
      isLanguageUnchanged &&
      isSchemaVersionUnchanged &&
      areTagsUnchanged &&
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
    const newArtifactId = randomUUID();
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
            category,
            tags: nextTags,
            format,
            language,
            title,
            content: nextContent,
            status: 'draft',
            version: newVersionNumber,
            isLatest: true,
            contentHash: newContentHash,
            schemaVersion,
            parentArtifactId: current.artifactId || id,
            author,
            changeSummary: changeSummary || undefined,
            ...(idempotencyKey ? { idempotencyKey } : {}),
            metadata: nextMetadata,
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
        changeSummary: result.changeSummary,
        previous: {
          version: current.version,
          title: current.title,
          content: current.content,
          status: current.status,
          category: current.category,
          tags: current.tags || [],
        },
        current: {
          version: result.version,
          title: result.title,
          content: result.content,
          status: result.status,
          category: result.category,
          tags: result.tags || [],
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
  async get(id: string, projectId?: string, throwOnNotFound = true, version?: number | 'latest'): Promise<any> {
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

    // 2. LogicalId + explicit version
    const versionNumber = version !== undefined && version !== 'latest' ? Number(version) : undefined;
    if (versionNumber !== undefined && Number.isFinite(versionNumber)) {
      const exactVersion = await this.model
        .findOne({ ...baseFilter, logicalId: rawId, version: versionNumber })
        .lean()
        .exec();
      if (exactVersion) return this.public(exactVersion);
      if (throwOnNotFound) throw new NotFoundException(`Artifact "${id}" version ${versionNumber} not found`);
      return null;
    }

    // 3. LogicalId lookup -> returns latest version
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
    const clauses: any[] = [];
    const listProjectId = query.projectId || query.namespace;
    if (listProjectId) clauses.push({ projectId: listProjectId });
    const targetType = query.filterType || query.type;
    if (targetType) clauses.push({ type: slugValue(targetType) });
    const targetCategory = query.filterCategory || query.category;
    if (targetCategory) clauses.push({ category: slugValue(targetCategory) });
    const targetStatus = query.filterStatus || query.status;
    if (targetStatus) clauses.push({ status: String(targetStatus).trim() });

    if (query.latestOnly === true || query.latestOnly === 'true') {
      clauses.push({ isLatest: true });
    }

    if (query.logicalId) {
      clauses.push({ logicalId: String(query.logicalId).trim() });
    }

    const tagList = parseKeywords(query.filterTags !== undefined ? query.filterTags : query.tags);
    if (tagList.length > 0) {
      clauses.push({ tags: { $in: tagList } });
    }

    const searchStr = String(query.query || query.search || '').trim();
    if (searchStr) {
      const searchRegex = searchStr.includes('*') || searchStr.includes('?')
        ? wildcardToRegex(searchStr)
        : new RegExp(searchStr.replace(/[.+^${}()|[\]\\]/g, '\\$&'), 'i');
      clauses.push({
        $or: [
          { title: searchRegex },
          { logicalId: searchRegex },
          { category: searchRegex },
          { tags: searchRegex },
        ],
      });
    }

    if (query.createdAfter) {
      const createdAfter = new Date(query.createdAfter);
      if (!Number.isNaN(createdAfter.getTime())) clauses.push({ createdAt: { $gte: createdAfter } });
    }
    if (query.updatedAfter) {
      const updatedAfter = new Date(query.updatedAfter);
      if (!Number.isNaN(updatedAfter.getTime())) clauses.push({ updatedAt: { $gte: updatedAfter } });
    }

    const filter = clauses.length > 0 ? { $and: clauses } : {};
    const sortField = ['updatedAt', 'createdAt', 'title', 'version'].includes(query.sortBy) ? query.sortBy : 'updatedAt';
    const sortDir = String(query.sortOrder || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const offset = Math.max(Number(query.offset || 0), 0);
    const includeContent = query.includeContent !== false && query.includeContent !== 'false';

    const items = await this.model
      .find(filter)
      .sort({ [sortField]: sortDir, version: -1 })
      .skip(offset)
      .limit(limit)
      .lean()
      .exec();

    return items.map((item) => {
      const pub = this.public(item);
      if (!includeContent) delete pub.content;
      return pub;
    });
  }

  /**
   * Approve an artifact version (or latest version of logical artifact)
   */
  async approve(id: string, metadata: any = {}, projectId?: string, expectedVersion?: number): Promise<any> {
    const current = await this.get(id, projectId || metadata?.projectId, true);
    this.assertExpectedVersion(current, expectedVersion ?? metadata?.expectedVersion);
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
  async reject(id: string, reason = '', metadata: any = {}, projectId?: string, expectedVersion?: number): Promise<any> {
    const current = await this.get(id, projectId || metadata?.projectId, true);
    this.assertExpectedVersion(current, expectedVersion ?? metadata?.expectedVersion);
    const nextMetadata = { ...(current.metadata || {}), ...parseMetadata(metadata) };
    if (reason) nextMetadata.rejectionReason = reason;
    return this.setStatus(current, 'rejected', nextMetadata, 'artifact.reject', 'reject');
  }

  async unarchive(id: string, projectId?: string, expectedVersion?: number): Promise<any> {
    const current = await this.get(id, projectId, true);
    this.assertExpectedVersion(current, expectedVersion);
    return this.setStatus(current, 'draft', current.metadata || {}, 'artifact.unarchive', 'unarchive');
  }

  async restore(logicalId: string, version: number, patch: any = {}): Promise<any> {
    const projectId = patch.projectId || patch.namespace;
    const source = await this.get(logicalId, projectId, true, Number(version));
    return this.update(source.logicalId, {
      ...patch,
      projectId: projectId || source.projectId,
      content: source.content,
      title: patch.title ?? source.title,
      type: patch.type ?? source.type,
      category: patch.category ?? source.category,
      tags: patch.tags ?? source.tags,
      format: patch.format ?? source.format,
      language: patch.language ?? source.language,
      changeSummary: patch.changeSummary || `Restored from version ${source.version}`,
    });
  }

  async archive(id: string, projectId?: string, expectedVersion?: number): Promise<any> {
    const current = await this.get(id, projectId, true);
    this.assertExpectedVersion(current, expectedVersion);
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
  async delete(id: string, projectId?: string): Promise<boolean> {
    const rawId = String(id || '').trim();
    const target = await this.get(id, projectId, false);
    const filter: any = target?.logicalId
      ? { logicalId: target.logicalId, ...(target.projectId ? { projectId: target.projectId } : {}) }
      : { artifactId: rawId };
    const res = await this.model.deleteMany(filter).exec();

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

  async diffVersions(logicalId: string, fromVersion: number, toVersion: number, projectId?: string, diffFormat = 'summary'): Promise<any> {
    const previous = await this.get(logicalId, projectId, true, Number(fromVersion));
    const next = await this.get(logicalId, projectId, true, Number(toVersion));
    const base = this.diff(previous.content, next.content);
    const beforeText = typeof previous.content === 'string' ? previous.content : JSON.stringify(previous.content, null, 2);
    const afterText = typeof next.content === 'string' ? next.content : JSON.stringify(next.content, null, 2);
    const format = String(diffFormat || 'summary').toLowerCase();
    if (format === 'unified') {
      return { ...base, diff: lineDiff(beforeText, afterText), fromVersion: previous.version, toVersion: next.version };
    }
    if (format === 'json' || format === 'json-patch') {
      return { ...base, fromVersion: previous.version, toVersion: next.version };
    }
    return {
      changed: base.changed,
      fromVersion: previous.version,
      toVersion: next.version,
      changedKeys: base.changedKeys || [],
      summary: base.changed ? `Version ${previous.version} differs from version ${next.version}` : 'Versions are identical',
    };
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

  private assertExpectedVersion(current: any, expected: any) {
    if (expected === undefined || expected === null || expected === '') return;
    const n = Number(expected);
    if (!Number.isFinite(n) || n !== Number(current.version)) {
      throw new ConflictException(
        `expectedVersion ${expected} does not match current version ${current.version} of "${current.logicalId}"`,
      );
    }
  }

  private async setStatus(current: any, status: ArtifactStatus, metadata: Record<string, any>, topic: string, eventType: EventAction) {
    const item = await this.model
      .findOneAndUpdate(
        { artifactId: current.artifactId },
        { $set: { status, metadata } },
        { new: true },
      )
      .lean()
      .exec();
    if (!item) throw new NotFoundException(`Artifact "${current.logicalId}" not found`);
    const result = this.public(item);
    if (this.indexingService) {
      void this.indexingService.indexArtifact(result);
    }
    await this.eventEngine.publish({
      topic,
      entityName: 'artifact',
      entityId: result.artifactId,
      eventType,
      projectId: result.projectId,
      source: { origin: 'api' },
      data: {
        artifactId: result.artifactId,
        logicalId: result.logicalId,
        version: result.version,
        status,
        metadata: result.metadata,
      },
    });
    return result;
  }

  private public(item: any) {
    const value = item.toObject ? item.toObject() : { ...item };
    delete value._id;
    delete value.__v;
    return value;
  }
}
