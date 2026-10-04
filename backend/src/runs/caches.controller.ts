import { Body, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { NodeCacheService } from './services/node-cache.service';

@Controller('caches')
export class CachesController {
  constructor(private readonly nodeCacheService: NodeCacheService) {}

  @Get()
  listCaches(
    @Query('graphId') graphId?: string,
    @Query('projectId') projectId?: string,
    @Query('nodeType') nodeType?: string,
    @Query('search') search?: string,
  ) {
    return this.nodeCacheService.getAllCaches({ graphId, projectId, nodeType, search });
  }

  @Get(':graphId/:nodeId')
  getCache(@Param('graphId') graphId: string, @Param('nodeId') nodeId: string) {
    return this.nodeCacheService.getCachedResult(graphId, nodeId);
  }

  @Put(':graphId/:nodeId')
  updateCache(
    @Param('graphId') graphId: string,
    @Param('nodeId') nodeId: string,
    @Body() body: { result: any; nodeName?: string; nodeType?: string; graphName?: string; projectId?: string },
  ) {
    return this.nodeCacheService.updateCachedResult(graphId, nodeId, body?.result, body);
  }

  @Delete(':graphId/:nodeId')
  deleteNodeCache(@Param('graphId') graphId: string, @Param('nodeId') nodeId: string) {
    return this.nodeCacheService.clearCache(graphId, nodeId);
  }

  @Delete()
  clearAllCaches(@Query('graphId') graphId?: string, @Query('projectId') projectId?: string) {
    return this.nodeCacheService.clearCache(graphId, undefined, projectId);
  }
}
