import { Controller, Get, Post, Param, Query, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { WebserverService } from './webserver.service';

@Controller('webservers')
export class WebserverController {
  private readonly logger = new Logger(WebserverController.name);

  constructor(private readonly webserverService: WebserverService) {}

  @Get(':graphId/status')
  getStatus(@Param('graphId') graphId: string, @Query('nodeId') nodeId?: string) {
    return this.webserverService.getServerStatus(graphId, nodeId);
  }

  @Post(':graphId/start')
  @HttpCode(HttpStatus.OK)
  start(
    @Param('graphId') graphId: string,
    @Body() body?: { nodeId?: string },
    @Query('nodeId') queryNodeId?: string,
  ) {
    const targetNodeId = body?.nodeId || queryNodeId;
    this.logger.log(`📥 POST /api/webservers/${graphId}/start (node: ${targetNodeId || 'all'}) requested`);
    return this.webserverService.startServer(graphId, targetNodeId);
  }

  @Post(':graphId/stop')
  @HttpCode(HttpStatus.OK)
  stop(
    @Param('graphId') graphId: string,
    @Body() body?: { nodeId?: string },
    @Query('nodeId') queryNodeId?: string,
  ) {
    const targetNodeId = body?.nodeId || queryNodeId;
    this.logger.log(`📥 POST /api/webservers/${graphId}/stop (node: ${targetNodeId || 'all'}) requested`);
    return this.webserverService.stopServer(graphId, targetNodeId);
  }
}
