import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { Project, ProjectDocument } from './schemas/project.schema';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Graph, GraphDocument } from '../graphs/schemas/graph.schema';
import { Run, RunDocument } from '../runs/schemas/run.schema';

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

    // Also remove associated graphs and runs for this project
    await this.graphModel.deleteMany({ projectId: id }).exec();
    await this.runModel.deleteMany({ projectId: id }).exec();

    return { success: true, message: `Project "${project.name}" and associated flows deleted` };
  }
}
