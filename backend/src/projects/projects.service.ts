import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { Project, ProjectDocument } from './schemas/project.schema';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Graph, GraphDocument } from '../graphs/schemas/graph.schema';
import { Run, RunDocument } from '../runs/schemas/run.schema';
import { RunCheckpoint, RunCheckpointDocument } from '../runs/schemas/run-checkpoint.schema';
import { NodeCache, NodeCacheDocument } from '../runs/schemas/node-cache.schema';
import { Setting, SettingDocument } from '../settings/schemas/setting.schema';
import { Artifact, ArtifactDocument } from '../blocks/schemas/artifact.schema';
import { ArtifactRelation, ArtifactRelationDocument } from '../blocks/schemas/artifact-relation.schema';
import { Memory, MemoryDocument } from '../blocks/schemas/memory.schema';
import { Trace, TraceDocument } from '../blocks/schemas/trace.schema';
import { VectorRecord, VectorRecordDocument } from '../blocks/schemas/vector-record.schema';
import { EventRecord, EventRecordDocument } from '../events/schemas/event.schema';

@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(Graph.name)
    private readonly graphModel: Model<GraphDocument>,
    @InjectModel(Run.name)
    private readonly runModel: Model<RunDocument>,
    @InjectModel(RunCheckpoint.name)
    private readonly runCheckpointModel: Model<RunCheckpointDocument>,
    @InjectModel(NodeCache.name)
    private readonly nodeCacheModel: Model<NodeCacheDocument>,
    @InjectModel(Setting.name)
    private readonly settingModel: Model<SettingDocument>,
    @InjectModel(Artifact.name)
    private readonly artifactModel: Model<ArtifactDocument>,
    @InjectModel(ArtifactRelation.name)
    private readonly artifactRelationModel: Model<ArtifactRelationDocument>,
    @InjectModel(Memory.name)
    private readonly memoryModel: Model<MemoryDocument>,
    @InjectModel(Trace.name)
    private readonly traceModel: Model<TraceDocument>,
    @InjectModel(VectorRecord.name)
    private readonly vectorRecordModel: Model<VectorRecordDocument>,
    @InjectModel(EventRecord.name)
    private readonly eventRecordModel: Model<EventRecordDocument>,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultProject();
  }

  /**
   * Ensures at least one default project exists.
   * If any graphs or runs lack a projectId, associates them with the default project.
   */
  async ensureDefaultProject(): Promise<ProjectDocument> {
    let defaultProject = await this.projectModel.findOne().exec();
    if (!defaultProject) {
      this.logger.log('Creating initial Default Project...');
      defaultProject = await this.projectModel.create({
        name: 'Default Project',
        description: 'Default project workspace for flows and agents',
        color: '#4f46e5',
        metadata: { isDefault: true },
      });
      this.logger.log(`Created Default Project with ID: ${defaultProject._id}`);
    }

    const defaultProjectId = defaultProject._id.toString();

    // Migrate any graphs missing projectId
    const graphsWithoutProject = await this.graphModel.countDocuments({
      $or: [{ projectId: { $exists: false } }, { projectId: null }, { projectId: '' }],
    });
    if (graphsWithoutProject > 0) {
      this.logger.log(`Migrating ${graphsWithoutProject} orphan graph(s) to Default Project...`);
      await this.graphModel.updateMany(
        { $or: [{ projectId: { $exists: false } }, { projectId: null }, { projectId: '' }] },
        { $set: { projectId: defaultProjectId } },
      );
    }

    // Migrate any runs missing projectId
    const runsWithoutProject = await this.runModel.countDocuments({
      $or: [{ projectId: { $exists: false } }, { projectId: null }, { projectId: '' }],
    });
    if (runsWithoutProject > 0) {
      this.logger.log(`Migrating ${runsWithoutProject} orphan run(s) to Default Project...`);
      await this.runModel.updateMany(
        { $or: [{ projectId: { $exists: false } }, { projectId: null }, { projectId: '' }] },
        { $set: { projectId: defaultProjectId } },
      );
    }

    return defaultProject;
  }

  async findAll() {
    const projects = await this.projectModel.find().sort({ createdAt: 1 }).exec();

    // Fetch counts for all projects
    const graphCounts = await this.graphModel.aggregate([
      { $group: { _id: '$projectId', count: { $sum: 1 } } },
    ]);
    const runCounts = await this.runModel.aggregate([
      { $group: { _id: '$projectId', count: { $sum: 1 } } },
    ]);

    const graphCountMap = new Map<string, number>();
    graphCounts.forEach((c: any) => {
      if (c._id) graphCountMap.set(String(c._id), c.count);
    });

    const runCountMap = new Map<string, number>();
    runCounts.forEach((c: any) => {
      if (c._id) runCountMap.set(String(c._id), c.count);
    });

    return projects.map((p) => {
      const pid = p._id.toString();
      return {
        _id: pid,
        name: p.name,
        description: p.description || '',
        color: p.color || '#4f46e5',
        metadata: p.metadata || {},
        createdAt: (p as any).createdAt,
        updatedAt: (p as any).updatedAt,
        graphCount: graphCountMap.get(pid) || 0,
        runCount: runCountMap.get(pid) || 0,
      };
    });
  }

  async findOne(id: string): Promise<ProjectDocument> {
    if (!id || (typeof id === 'string' && !isValidObjectId(id))) {
      throw new NotFoundException(`Project not found: ${id}`);
    }
    const project = await this.projectModel.findById(id).exec();
    if (!project) {
      throw new NotFoundException(`Project not found: ${id}`);
    }
    return project;
  }

  async create(createProjectDto: CreateProjectDto): Promise<ProjectDocument> {
    if (!createProjectDto.name?.trim()) {
      throw new BadRequestException('Project name is required');
    }
    const created = new this.projectModel({
      ...createProjectDto,
      name: createProjectDto.name.trim(),
      color: createProjectDto.color || '#4f46e5',
      metadata: createProjectDto.metadata || {},
    });
    return created.save();
  }

  async update(id: string, updateProjectDto: UpdateProjectDto): Promise<ProjectDocument> {
    if (!id || (typeof id === 'string' && !isValidObjectId(id))) {
      throw new NotFoundException(`Project not found: ${id}`);
    }
    const project = await this.projectModel
      .findByIdAndUpdate(
        id,
        { $set: updateProjectDto },
        { new: true, runValidators: true },
      )
      .exec();
    if (!project) {
      throw new NotFoundException(`Project not found: ${id}`);
    }
    return project;
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    if (!id || (typeof id === 'string' && !isValidObjectId(id))) {
      throw new NotFoundException(`Project not found: ${id}`);
    }

    // Ensure we don't delete if it's the only project
    const totalProjects = await this.projectModel.countDocuments();
    if (totalProjects <= 1) {
      throw new BadRequestException('Cannot delete the only remaining project');
    }

    const project = await this.projectModel.findByIdAndDelete(id).exec();
    if (!project) {
      throw new NotFoundException(`Project not found: ${id}`);
    }

    // Also remove all associated resources for this project
    const runs = await this.runModel.find({ projectId: id }).select('runId').lean().exec();
    const runIds = runs.map((r) => r.runId);
    if (runIds.length > 0) {
      await this.runCheckpointModel.deleteMany({ runId: { $in: runIds } }).exec();
    }
    await this.graphModel.deleteMany({ projectId: id }).exec();
    await this.runModel.deleteMany({ projectId: id }).exec();
    await this.nodeCacheModel.deleteMany({ projectId: id }).exec();
    await this.settingModel.deleteMany({ projectId: id }).exec();
    await this.artifactModel.deleteMany({ projectId: id }).exec();
    await this.artifactRelationModel.deleteMany({ projectId: id }).exec();
    await this.memoryModel.deleteMany({ projectId: id }).exec();
    await this.traceModel.deleteMany({ projectId: id }).exec();
    await this.vectorRecordModel.deleteMany({ projectId: id }).exec();
    await this.eventRecordModel.deleteMany({ projectId: id }).exec();

    return { success: true, message: `Project "${project.name}" and associated flows deleted` };
  }

  async duplicate(id: string, customName?: string) {
    const sourceProject = await this.findOne(id);
    const sourceProjectId = sourceProject._id.toString();

    // Determine target name
    let newName = customName?.trim();
    if (!newName) {
      const baseName = `${sourceProject.name} (Copy)`;
      newName = baseName;
      let counter = 2;
      while (await this.projectModel.exists({ name: newName })) {
        newName = `${baseName} ${counter}`;
        counter++;
      }
    }

    // 1. Create duplicate project
    const newProject = await this.projectModel.create({
      name: newName,
      description: sourceProject.description || '',
      color: sourceProject.color || '#4f46e5',
      metadata: sourceProject.metadata ? JSON.parse(JSON.stringify(sourceProject.metadata)) : {},
    });
    const newProjectId = newProject._id.toString();

    // 2. Duplicate Settings if any exist for source project
    const sourceSetting = await this.settingModel.findOne({ projectId: sourceProjectId }).lean().exec();
    if (sourceSetting) {
      const settingObj: any = { ...sourceSetting };
      delete settingObj._id;
      delete settingObj.createdAt;
      delete settingObj.updatedAt;
      settingObj.projectId = newProjectId;
      await this.settingModel.create(settingObj);
    }

    // Helper to format duplicate titles for artifacts
    const copyTitle = (title?: string): string => {
      if (!title) return 'Untitled (Copy)';
      const trimmed = title.trim();
      const match = trimmed.match(/^(.*?)(?: \(Copy(?: (\d+))?\))?$/);
      if (!match || (!match[2] && !trimmed.endsWith(' (Copy)'))) {
        return `${trimmed} (Copy)`;
      }
      const base = match[1];
      const count = match[2] ? parseInt(match[2], 10) + 1 : 2;
      return `${base} (Copy ${count})`;
    };

    // Pre-build ID maps across all entities before inserting
    // 3. Artifact & Logical ID maps
    const sourceArtifacts = await this.artifactModel.find({ projectId: sourceProjectId }).lean().exec();
    const artifactIdMap = new Map<string, string>();
    for (const a of sourceArtifacts) {
      artifactIdMap.set(a.artifactId, `art_${randomUUID()}`);
    }

    const logicalIdMap = new Map<string, string>();
    const distinctLogicalIds = Array.from(new Set(sourceArtifacts.map((a) => a.logicalId).filter(Boolean)));
    for (const oldLogId of distinctLogicalIds) {
      let newLogId = `${oldLogId}-copy`;
      let counter = 2;
      while (await this.artifactModel.exists({ logicalId: newLogId })) {
        newLogId = `${oldLogId}-copy-${counter}`;
        counter++;
      }
      logicalIdMap.set(oldLogId, newLogId);
    }

    // 4. Graph ID maps
    const sourceGraphs = await this.graphModel.find({ projectId: sourceProjectId }).lean().exec();
    const graphIdMap = new Map<string, Types.ObjectId>();
    for (const g of sourceGraphs) {
      graphIdMap.set(g._id.toString(), new Types.ObjectId());
    }

    // 5. Run ID maps
    const sourceRuns = await this.runModel.find({ projectId: sourceProjectId }).lean().exec();
    const runIdMap = new Map<string, string>();
    for (const r of sourceRuns) {
      runIdMap.set(r.runId, `run_${randomUUID()}`);
    }

    // 6. Event ID maps
    const sourceEvents = await this.eventRecordModel.find({ projectId: sourceProjectId }).lean().exec();
    const eventIdMap = new Map<string, string>();
    for (const e of sourceEvents) {
      eventIdMap.set(e.eventId, `evt_${randomUUID()}`);
    }

    // Insert Duplicated Graphs (Flows)
    if (sourceGraphs.length > 0) {
      const duplicatedGraphs = sourceGraphs.map((g) => {
        const newGraphId = graphIdMap.get(g._id.toString())!;
        let flowStr = JSON.stringify(g.flow || { version: 1, blocks: [], connections: [] });
        flowStr = flowStr.replaceAll(sourceProjectId, newProjectId);
        for (const [oldGId, newGId] of graphIdMap.entries()) {
          flowStr = flowStr.replaceAll(oldGId, newGId.toString());
        }
        for (const [oldLogId, newLogId] of logicalIdMap.entries()) {
          flowStr = flowStr.replaceAll(oldLogId, newLogId);
        }
        for (const [oldArtId, newArtId] of artifactIdMap.entries()) {
          flowStr = flowStr.replaceAll(oldArtId, newArtId);
        }
        const newFlow = JSON.parse(flowStr);

        const layoutStr = JSON.stringify(g.layout || { version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: {}, edges: {} });
        const newLayout = JSON.parse(layoutStr);

        const metadataStr = JSON.stringify(g.metadata || {});
        const newMetadata = JSON.parse(metadataStr);

        return {
          _id: newGraphId,
          projectId: newProjectId,
          name: g.name,
          flow: newFlow,
          layout: newLayout,
          metadata: newMetadata,
        };
      });

      await this.graphModel.insertMany(duplicatedGraphs);
    }

    // Insert Duplicated Runs & Checkpoints
    if (sourceRuns.length > 0) {
      const duplicatedRuns = sourceRuns.map((r) => {
        const newRunId = runIdMap.get(r.runId)!;
        const runObj: any = { ...r };
        delete runObj._id;
        delete runObj.createdAt;
        delete runObj.updatedAt;

        runObj.runId = newRunId;
        runObj.projectId = newProjectId;

        const oldGraphIdStr = r.graphId ? r.graphId.toString() : '';
        if (oldGraphIdStr && graphIdMap.has(oldGraphIdStr)) {
          runObj.graphId = graphIdMap.get(oldGraphIdStr);
        }

        if (runObj.parentRunId && runIdMap.has(runObj.parentRunId)) {
          runObj.parentRunId = runIdMap.get(runObj.parentRunId);
        }
        if (runObj.rootRunId && runIdMap.has(runObj.rootRunId)) {
          runObj.rootRunId = runIdMap.get(runObj.rootRunId);
        }

        if (Array.isArray(runObj.visitedArtifactLogicalIds)) {
          runObj.visitedArtifactLogicalIds = runObj.visitedArtifactLogicalIds.map(
            (id: string) => logicalIdMap.get(id) || id,
          );
        }

        if (runObj.context) {
          let ctxStr = JSON.stringify(runObj.context);
          ctxStr = ctxStr.replaceAll(sourceProjectId, newProjectId);
          for (const [oldLogId, newLogId] of logicalIdMap.entries()) {
            ctxStr = ctxStr.replaceAll(oldLogId, newLogId);
          }
          for (const [oldArtId, newArtId] of artifactIdMap.entries()) {
            ctxStr = ctxStr.replaceAll(oldArtId, newArtId);
          }
          runObj.context = JSON.parse(ctxStr);
        }

        return runObj;
      });

      await this.runModel.insertMany(duplicatedRuns);

      // Duplicate Checkpoints for the runs
      const oldRunIds = Array.from(runIdMap.keys());
      if (oldRunIds.length > 0) {
        const sourceCheckpoints = await this.runCheckpointModel
          .find({ runId: { $in: oldRunIds } })
          .lean()
          .exec();
        if (sourceCheckpoints.length > 0) {
          const duplicatedCheckpoints = sourceCheckpoints.map((cp) => {
            const cpObj: any = { ...cp };
            delete cpObj._id;
            delete cpObj.createdAt;
            delete cpObj.updatedAt;
            cpObj.checkpointId = randomUUID();
            cpObj.runId = runIdMap.get(cp.runId) || cp.runId;
            if (cpObj.context) {
              let ctxStr = JSON.stringify(cpObj.context);
              ctxStr = ctxStr.replaceAll(sourceProjectId, newProjectId);
              for (const [oldLogId, newLogId] of logicalIdMap.entries()) {
                ctxStr = ctxStr.replaceAll(oldLogId, newLogId);
              }
              for (const [oldArtId, newArtId] of artifactIdMap.entries()) {
                ctxStr = ctxStr.replaceAll(oldArtId, newArtId);
              }
              cpObj.context = JSON.parse(ctxStr);
            }
            return cpObj;
          });
          await this.runCheckpointModel.insertMany(duplicatedCheckpoints);
        }
      }
    }

    // Insert Duplicated Node Caches
    const sourceCaches = await this.nodeCacheModel.find({ projectId: sourceProjectId }).lean().exec();
    if (sourceCaches.length > 0) {
      const duplicatedCaches = sourceCaches.map((c) => {
        const cacheObj: any = { ...c };
        delete cacheObj._id;
        delete cacheObj.createdAt;
        delete cacheObj.updatedAt;
        cacheObj.projectId = newProjectId;
        if (cacheObj.graphId && graphIdMap.has(cacheObj.graphId)) {
          cacheObj.graphId = graphIdMap.get(cacheObj.graphId)!.toString();
        }

        // Map any IDs stored within cache input or result
        if (cacheObj.result) {
          let resStr = JSON.stringify(cacheObj.result);
          resStr = resStr.replaceAll(sourceProjectId, newProjectId);
          for (const [oldLogId, newLogId] of logicalIdMap.entries()) {
            resStr = resStr.replaceAll(oldLogId, newLogId);
          }
          for (const [oldArtId, newArtId] of artifactIdMap.entries()) {
            resStr = resStr.replaceAll(oldArtId, newArtId);
          }
          cacheObj.result = JSON.parse(resStr);
        }
        if (cacheObj.input) {
          let inStr = JSON.stringify(cacheObj.input);
          inStr = inStr.replaceAll(sourceProjectId, newProjectId);
          for (const [oldLogId, newLogId] of logicalIdMap.entries()) {
            inStr = inStr.replaceAll(oldLogId, newLogId);
          }
          for (const [oldArtId, newArtId] of artifactIdMap.entries()) {
            inStr = inStr.replaceAll(oldArtId, newArtId);
          }
          cacheObj.input = JSON.parse(inStr);
        }

        return cacheObj;
      });
      await this.nodeCacheModel.insertMany(duplicatedCaches);
    }

    // Insert Duplicated Artifacts & Relations with proper names and unique IDs
    if (sourceArtifacts.length > 0) {
      const duplicatedArtifacts = sourceArtifacts.map((a) => {
        const artObj: any = { ...a };
        delete artObj._id;
        delete artObj.createdAt;
        delete artObj.updatedAt;

        const newArtifactId = artifactIdMap.get(a.artifactId)!;
        const newLogicalId = a.logicalId
          ? (logicalIdMap.get(a.logicalId) || `${a.type || 'document'}-${randomUUID()}`)
          : `${a.type || 'document'}-${randomUUID()}`;

        artObj.artifactId = newArtifactId;
        artObj.logicalId = newLogicalId;
        artObj.projectId = newProjectId;
        artObj.title = copyTitle(a.title);

        if (artObj.rootArtifactId && artifactIdMap.has(artObj.rootArtifactId)) {
          artObj.rootArtifactId = artifactIdMap.get(artObj.rootArtifactId)!;
        } else {
          artObj.rootArtifactId = newArtifactId;
        }

        if (artObj.parentArtifactId && artifactIdMap.has(artObj.parentArtifactId)) {
          artObj.parentArtifactId = artifactIdMap.get(artObj.parentArtifactId);
        }

        if (Array.isArray(artObj.linkedArtifactIds)) {
          artObj.linkedArtifactIds = artObj.linkedArtifactIds.map(
            (id: string) => artifactIdMap.get(id) || logicalIdMap.get(id) || id,
          );
        }

        if (Array.isArray(artObj.sourceEventIds)) {
          artObj.sourceEventIds = artObj.sourceEventIds.map(
            (eId: string) => eventIdMap.get(eId) || eId,
          );
        }

        if (artObj.metadata) {
          const meta = { ...artObj.metadata };
          if (meta.name) meta.name = copyTitle(meta.name);
          if (meta.logicalId && logicalIdMap.has(meta.logicalId)) {
            meta.logicalId = logicalIdMap.get(meta.logicalId);
          }
          if (meta.sourceRunId && runIdMap.has(meta.sourceRunId)) {
            meta.sourceRunId = runIdMap.get(meta.sourceRunId);
          }
          artObj.metadata = meta;
        }

        return artObj;
      });

      await this.artifactModel.insertMany(duplicatedArtifacts);
    }

    const sourceRelations = await this.artifactRelationModel.find({ projectId: sourceProjectId }).lean().exec();
    if (sourceRelations.length > 0) {
      const duplicatedRelations = sourceRelations.map((r) => {
        const relObj: any = { ...r };
        delete relObj._id;
        delete relObj.createdAt;
        delete relObj.updatedAt;
        relObj.relationId = `rel_${randomUUID()}`;
        relObj.projectId = newProjectId;
        relObj.sourceLogicalId = logicalIdMap.get(r.sourceLogicalId) || r.sourceLogicalId;
        relObj.targetLogicalId = logicalIdMap.get(r.targetLogicalId) || r.targetLogicalId;
        return relObj;
      });
      await this.artifactRelationModel.insertMany(duplicatedRelations);
    }

    // Insert Duplicated Memories
    const sourceMemories = await this.memoryModel.find({ projectId: sourceProjectId }).lean().exec();
    if (sourceMemories.length > 0) {
      const duplicatedMemories = sourceMemories.map((m) => {
        const memObj: any = { ...m };
        delete memObj._id;
        delete memObj.createdAt;
        delete memObj.updatedAt;
        memObj.projectId = newProjectId;
        return memObj;
      });
      await this.memoryModel.insertMany(duplicatedMemories);
    }

    // Insert Duplicated Vector Records
    const sourceVectors = await this.vectorRecordModel.find({ projectId: sourceProjectId }).lean().exec();
    if (sourceVectors.length > 0) {
      const duplicatedVectors = sourceVectors.map((v) => {
        const vecObj: any = { ...v };
        delete vecObj._id;
        delete vecObj.createdAt;
        delete vecObj.updatedAt;
        vecObj.vectorId = `vec_${randomUUID()}`;
        vecObj.projectId = newProjectId;
        if (vecObj.artifactId && artifactIdMap.has(vecObj.artifactId)) {
          vecObj.artifactId = artifactIdMap.get(vecObj.artifactId);
        }
        if (vecObj.logicalId && logicalIdMap.has(vecObj.logicalId)) {
          vecObj.logicalId = logicalIdMap.get(vecObj.logicalId);
        }
        return vecObj;
      });
      await this.vectorRecordModel.insertMany(duplicatedVectors);
    }

    // Insert Duplicated Traces
    const sourceTraces = await this.traceModel.find({ projectId: sourceProjectId }).lean().exec();
    if (sourceTraces.length > 0) {
      const duplicatedTraces = sourceTraces.map((t) => {
        const traceObj: any = { ...t };
        delete traceObj._id;
        delete traceObj.createdAt;
        delete traceObj.updatedAt;
        traceObj.projectId = newProjectId;
        if (traceObj.runId && runIdMap.has(traceObj.runId)) {
          traceObj.runId = runIdMap.get(traceObj.runId);
        }
        if (traceObj.sourceId && (artifactIdMap.has(traceObj.sourceId) || runIdMap.has(traceObj.sourceId))) {
          traceObj.sourceId = artifactIdMap.get(traceObj.sourceId) || runIdMap.get(traceObj.sourceId);
        }
        if (traceObj.targetId && (artifactIdMap.has(traceObj.targetId) || runIdMap.has(traceObj.targetId))) {
          traceObj.targetId = artifactIdMap.get(traceObj.targetId) || runIdMap.get(traceObj.targetId);
        }
        return traceObj;
      });
      await this.traceModel.insertMany(duplicatedTraces);
    }

    // Insert Duplicated Events
    if (sourceEvents.length > 0) {
      const duplicatedEvents = sourceEvents.map((e) => {
        const evObj: any = { ...e };
        delete evObj._id;
        delete evObj.createdAt;
        delete evObj.updatedAt;
        evObj.eventId = eventIdMap.get(e.eventId) || `evt_${randomUUID()}`;
        evObj.projectId = newProjectId;
        if (Array.isArray(evObj.dispatchedRuns)) {
          evObj.dispatchedRuns = evObj.dispatchedRuns.map(
            (rId: string) => runIdMap.get(rId) || rId,
          );
        }
        return evObj;
      });
      await this.eventRecordModel.insertMany(duplicatedEvents);
    }

    return {
      _id: newProjectId,
      name: newProject.name,
      description: newProject.description || '',
      color: newProject.color || '#4f46e5',
      metadata: newProject.metadata || {},
      createdAt: (newProject as any).createdAt,
      updatedAt: (newProject as any).updatedAt,
      graphCount: sourceGraphs.length,
      runCount: sourceRuns.length,
    };
  }
}
