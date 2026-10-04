import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { Graph, GraphDocument } from './schemas/graph.schema';
import { CreateGraphDto } from './dto/create-graph.dto';
import { UpdateGraphDto } from './dto/update-graph.dto';
import { NodeDefinitionsService } from '../node-definitions/node-definitions.service';
import { GraphShapeService } from './graph-shape.service';
import { ToolPluginRegistry } from '../runs/plugins/tool-plugin.registry';
import { GraphValidationService, ValidationResult } from './services/graph-validation.service';
import {
  GraphEnrichmentService,
  UpstreamVariable,
  UpstreamVariablesResponse,
} from './services/graph-enrichment.service';
import { parseSchema } from './utils/schema-parser.util';

// Re-export core types and parser for complete backward compatibility
export { parseSchema, UpstreamVariable, UpstreamVariablesResponse };

@Injectable()
export class GraphsService {
  private readonly validationService: GraphValidationService;
  private readonly enrichmentService: GraphEnrichmentService;

  constructor(
    @InjectModel(Graph.name) private readonly graphModel: Model<GraphDocument>,
    private readonly nodeDefinitionsService: NodeDefinitionsService,
    private readonly graphShapeService: GraphShapeService,
    @Optional() private readonly pluginRegistry?: ToolPluginRegistry,
    @Optional() validationService?: GraphValidationService,
    @Optional() enrichmentService?: GraphEnrichmentService,
  ) {
    this.enrichmentService =
      enrichmentService ||
      new GraphEnrichmentService(this.nodeDefinitionsService, this.pluginRegistry);
    this.validationService =
      validationService ||
      new GraphValidationService(this.graphModel, this.enrichmentService, this.pluginRegistry);
  }

  /** Converts either canonical flow input or legacy React Flow input for validation. */
  reshapeGraphInput(input: any) {
    return this.graphShapeService.reshapeForSave(input || {});
  }

  /**
   * Enriches nodes with metadata and extracted output schemas from tool definitions & node configs.
   */
  async enrichNodesWithOutputs(nodes: any[]): Promise<any[]> {
    return this.enrichmentService.enrichNodesWithOutputs(nodes);
  }

  /**
   * Retrieves all graphs for a project, projected with summarized flow metadata.
   */
  async findAll(projectId?: string) {
    const filter = projectId ? { projectId } : {};
    const graphs = await this.graphModel
      .find(filter)
      .select('name projectId createdAt updatedAt flow layout metadata')
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    return graphs.map((g) => ({
      id: g._id.toString(),
      name: g.name,
      projectId: g.projectId,
      nodeCount: (g.flow?.blocks || []).length,
      edgeCount: (g.flow?.connections || []).length,
      createdAt: (g as any).createdAt,
      updatedAt: (g as any).updatedAt,
      metadata: g.metadata,
    }));
  }

  /**
   * Retrieves a single graph document shaped and enriched for the visual canvas and compiler.
   */
  async findOne(id: string): Promise<any> {
    if (!id || (typeof id === 'string' && !isValidObjectId(id))) {
      throw new NotFoundException('Graph not found');
    }

    const graph: any = await this.graphModel.findById(id).lean().exec();
    if (!graph) {
      throw new NotFoundException('Graph not found');
    }
    return this.reshapeDocumentForEditor(graph);
  }

  /**
   * Persists a new graph after validating topology and variable references.
   */
  async create(createGraphDto: CreateGraphDto): Promise<any> {
    const shaped = this.graphShapeService.reshapeForSave({
      flow: createGraphDto.flow,
      nodes: createGraphDto.nodes,
      edges: createGraphDto.edges,
      layout: createGraphDto.layout,
      viewport: createGraphDto.viewport,
    });

    await this.validateGraphVariables(shaped.nodes, shaped.edges);

    const createdGraph = new this.graphModel({
      ...createGraphDto,
      flow: shaped.flow,
      layout: shaped.layout,
      metadata: createGraphDto.metadata || {},
    });

    const saved = await createdGraph.save();
    return this.reshapeDocumentForEditor(saved.toObject());
  }

  /**
   * Updates an existing graph document with atomic canonical flow and layout persistence.
   */
  async update(id: string, updateGraphDto: UpdateGraphDto): Promise<any> {
    const existing = await this.findOne(id);
    const isLegacyPresentationUpdate =
      updateGraphDto.flow === undefined &&
      (updateGraphDto.nodes !== undefined || updateGraphDto.edges !== undefined);

    const shaped = this.graphShapeService.reshapeForSave({
      flow:
        updateGraphDto.flow !== undefined
          ? updateGraphDto.flow
          : isLegacyPresentationUpdate
            ? undefined
            : existing.flow,
      nodes: updateGraphDto.nodes !== undefined ? updateGraphDto.nodes : existing.nodes,
      edges: updateGraphDto.edges !== undefined ? updateGraphDto.edges : existing.edges,
      layout: updateGraphDto.layout !== undefined ? updateGraphDto.layout : existing.layout,
      viewport: updateGraphDto.viewport || existing.layout?.viewport,
    });

    await this.validateGraphVariables(shaped.nodes, shaped.edges);

    const updateData: any = { ...updateGraphDto };
    updateData.flow = shaped.flow;
    updateData.layout = shaped.layout;
    delete updateData.nodes;
    delete updateData.edges;
    delete updateData.viewport;

    const updatedGraph = await this.graphModel
      .findByIdAndUpdate(
        id,
        { $set: updateData, $unset: { nodes: '', edges: '', viewport: '' } },
        { new: true, runValidators: true },
      )
      .lean()
      .exec();

    if (!updatedGraph) {
      throw new NotFoundException('Graph not found');
    }
    return this.reshapeDocumentForEditor(updatedGraph);
  }

  /**
   * Deletes a graph document by ID.
   */
  async remove(id: string): Promise<{ success: boolean; message: string }> {
    if (!id || (typeof id === 'string' && !isValidObjectId(id))) {
      throw new NotFoundException('Graph not found');
    }
    const result = await this.graphModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException('Graph not found');
    }
    return { success: true, message: `Graph "${id}" deleted successfully` };
  }

  /**
   * Validates all variable references, edge handles, and graph topology.
   */
  async validateGraphVariables(nodes: any[], edges: any[]): Promise<ValidationResult> {
    return this.validationService.validateGraphVariables(
      nodes,
      edges,
      undefined,
      (graphId: string) => this.findOne(graphId),
    );
  }

  /**
   * Detects waiting gates inside nested / iterative child flows where pausing is unsupported.
   */
  async assertNoWaitingGatesInChildGraph(
    graphId: string,
    visited = new Set<string>(),
  ): Promise<void> {
    return this.validationService.assertNoWaitingGatesInChildGraph(
      graphId,
      visited,
      (id: string) => this.findOne(id),
    );
  }

  /**
   * Extracts all upstream available variables accessible to a specific block (node) in a graph.
   */
  async getUpstreamVariables(
    graphId: string,
    blockId: string,
  ): Promise<UpstreamVariablesResponse> {
    if (!graphId || (typeof graphId === 'string' && !isValidObjectId(graphId))) {
      throw new NotFoundException('Graph not found');
    }

    const graph = await this.findOne(graphId);
    return this.enrichmentService.computeUpstreamVariables(
      graph,
      blockId,
      (orchId, nodes, edges) =>
        this.validationService.getOrchestratedJobNodeIds(orchId, nodes, edges),
    );
  }

  /**
   * Shapes canonical persisted document into visual representation for the canvas editor.
   */
  private async reshapeDocumentForEditor(graph: any): Promise<any> {
    const shaped = this.graphShapeService.reshapeForLoad({
      flow: graph.flow,
      nodes: graph.nodes,
      edges: graph.edges,
      layout: graph.layout,
      viewport: graph.viewport,
    });
    const enrichedNodes = await this.enrichNodesWithOutputs(shaped.nodes);
    return {
      ...graph,
      flow: shaped.flow,
      layout: shaped.layout,
      viewport: shaped.layout.viewport,
      nodes: enrichedNodes,
      edges: shaped.edges,
    };
  }
}
