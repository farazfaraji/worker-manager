import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { GraphRunnerService } from './graph-runner.service';

@Controller('runs')
export class RunsController {
  constructor(private readonly graphRunnerService: GraphRunnerService) {}

  @Get(':runId/state')
  getRunState(@Param('runId') runId: string) {
    return this.graphRunnerService.getRunState(runId);
  }

  @Get(':runId')
  getRun(@Param('runId') runId: string) {
    return this.graphRunnerService.getRun(runId);
  }

  @Get()
  listRuns(@Query('projectId') projectId?: string, @Query('graphId') graphId?: string) {
    return this.graphRunnerService.listRuns(projectId, graphId);
  }

  @Delete(':runId')
  deleteRun(@Param('runId') runId: string) {
    return this.graphRunnerService.deleteRun(runId);
  }

  @Post(':runId/cancel')
  cancel(@Param('runId') runId: string) {
    return this.graphRunnerService.cancelRun(runId);
  }

  @Post(':runId/rerun')
  rerun(@Param('runId') runId: string, @Body() body: { nodeId: string }) {
    return this.graphRunnerService.rerunRun(runId, body?.nodeId);
  }

  @Post(':runId/resume')
  resume(@Param('runId') runId: string, @Body() body: any) {
    return this.graphRunnerService.resumeRun(runId, body || {});
  }
}
