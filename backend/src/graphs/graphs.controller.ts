import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { GraphsService } from './graphs.service';
import { CreateGraphDto } from './dto/create-graph.dto';
import { UpdateGraphDto } from './dto/update-graph.dto';
import { GraphRunnerService } from '../runs/graph-runner.service';
import { NodeCacheService } from '../runs/services/node-cache.service';

@Controller('graphs')
export class GraphsController {
  private readonly logger = new Logger(GraphsController.name);

  constructor(
    private readonly graphsService: GraphsService,
    private readonly graphRunnerService: GraphRunnerService,
    private readonly nodeCacheService: NodeCacheService,
  ) {}


  @Get()
  findAll(@Query('projectId') projectId?: string) {
    return this.graphsService.findAll(projectId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.graphsService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createGraphDto: CreateGraphDto) {
    return this.graphsService.create(createGraphDto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateGraphDto: UpdateGraphDto) {
    return this.graphsService.update(id, updateGraphDto);
  }

  @Get(':id/variables/:blockId')
  getUpstreamVariables(
    @Param('id') graphId: string,
    @Param('blockId') blockId: string,
  ) {
    return this.graphsService.getUpstreamVariables(graphId, blockId);
  }

  @Get(':id/blocks/:blockId/variables')
  getUpstreamVariablesByBlock(
    @Param('id') graphId: string,
    @Param('blockId') blockId: string,
  ) {
    return this.graphsService.getUpstreamVariables(graphId, blockId);
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  validate(@Body() graphData: CreateGraphDto) {
    const shaped = this.graphsService.reshapeGraphInput(graphData);
    return this.graphsService.validateGraphVariables(
      shaped.nodes,
      shaped.edges,
    );
  }

  @Post(':id/run')
  @HttpCode(HttpStatus.OK)
  run(@Param('id') id: string, @Body() body?: { input?: any; debugMode?: boolean; useCache?: boolean }) {
    const useCache = body?.useCache !== false;
    this.logger.log(`📥 POST /api/graphs/${id}/run requested${body?.debugMode ? ' [DEBUG MODE]' : ''}${useCache ? ' [USE CACHE]' : ' [NO CACHE]'}`);
    return this.graphRunnerService.runGraph(
      id,
      body?.input !== undefined ? body.input : {},
      { debugMode: body?.debugMode || false, useCache },
    );
  }

  @Get(':id/cache')
  getGraphCache(@Param('id') id: string) {
    return this.nodeCacheService.getGraphCaches(id);
  }

  @Delete(':id/cache')
  clearGraphCache(@Param('id') id: string) {
    return this.nodeCacheService.clearCache(id);
  }

  @Delete(':id/cache/:nodeId')
  clearNodeCache(@Param('id') id: string, @Param('nodeId') nodeId: string) {
    return this.nodeCacheService.clearCache(id, nodeId);
  }

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  async validateById(@Param('id') id: string, @Body() body?: UpdateGraphDto) {
    this.logger.log(`📥 POST /api/graphs/${id}/validate requested`);
    const existing = await this.graphsService.findOne(id);
    const shaped = this.graphsService.reshapeGraphInput({
      flow: body?.flow !== undefined ? body.flow : undefined,
      nodes: body?.nodes !== undefined ? body.nodes : existing.nodes || [],
      edges: body?.edges !== undefined ? body.edges : existing.edges || [],
      layout: body?.layout !== undefined ? body.layout : existing.layout,
      viewport: body?.viewport,
    });
    return this.graphsService.validateGraphVariables(shaped.nodes, shaped.edges);
  }


  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.graphsService.remove(id);
  }
}
