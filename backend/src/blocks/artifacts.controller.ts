import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { ArtifactService } from './artifact.service';
import { ArtifactRelationService } from './artifact-relation.service';

@Controller('artifacts')
export class ArtifactsController {
  constructor(
    private readonly artifactService: ArtifactService,
    private readonly relationService: ArtifactRelationService,
  ) {}

  @Get('types')
  async listTypes(@Query('projectId') projectId?: string) {
    return this.artifactService.getDistinctTypes(projectId);
  }

  @Get()
  async list(
    @Query('projectId') projectId?: string,
    @Query('type') type?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('tags') tags?: string,
    @Query('search') search?: string,
    @Query('query') query?: string,
    @Query('logicalId') logicalId?: string,
    @Query('latestOnly') latestOnly?: string | boolean,
    @Query('includeContent') includeContent?: string | boolean,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: 'updatedAt' | 'createdAt' | 'title' | 'version',
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
    const isLatestOnly = latestOnly === true || latestOnly === 'true';
    const items = await this.artifactService.list({
      projectId,
      type,
      category,
      status,
      tags,
      search,
      query,
      logicalId,
      latestOnly: isLatestOnly,
      includeContent: includeContent !== 'false' && includeContent !== false,
      limit: limit || 100,
      offset,
      sortBy,
      sortOrder,
    });

    return items.map((item) => ({
      ...item,
      label: `${item.title || 'Untitled'} (${item.logicalId || item.artifactId}) [v${item.version || 1}]`,
      value: item.artifactId,
    }));
  }

  @Get(':id/versions')
  async listVersions(
    @Param('id') id: string,
    @Query('projectId') projectId?: string,
  ) {
    const doc = await this.artifactService.get(id, projectId, false);
    const targetLogicalId = doc?.logicalId || id;
    return this.artifactService.listVersions(targetLogicalId, projectId);
  }

  @Get(':id/relations')
  async getRelations(
    @Param('id') id: string,
    @Query('direction') direction?: 'outgoing' | 'incoming' | 'both',
    @Query('projectId') projectId?: string,
  ) {
    const doc = await this.artifactService.get(id, projectId, false);
    const logicalId = doc?.logicalId || id;
    return this.relationService.getRelations(logicalId, { direction: direction || 'both', projectId });
  }

  @Post(':id/relations')
  async addRelation(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    if (!body?.targetLogicalId || !(body?.relationType || body?.type)) {
      throw new BadRequestException('targetLogicalId and relationType are required');
    }
    const doc = await this.artifactService.get(id, body?.projectId, true);
    const sourceLogicalId = doc.logicalId || doc.artifactId;
    const targetDoc = await this.artifactService.get(body.targetLogicalId, body.projectId, false);
    const targetLogicalId = targetDoc?.logicalId || body.targetLogicalId;
    const type = body.relationType || body.type;

    return this.relationService.addRelation({
      sourceLogicalId,
      targetLogicalId,
      type,
      projectId: body.projectId || doc.projectId,
      metadata: body.metadata,
      source: body.source,
    });
  }

  @Delete(':id/relations/:relationId')
  async removeRelation(
    @Param('id') id: string,
    @Param('relationId') relationId: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.relationService.removeRelation(relationId, projectId);
  }

  @Get(':id')
  async get(
    @Param('id') id: string,
    @Query('projectId') projectId?: string,
    @Query('version') version?: string,
  ) {
    const parsed = version && version !== 'latest' ? Number(version) : undefined;
    return this.artifactService.get(id, projectId, false, Number.isFinite(parsed) ? parsed : undefined);
  }

  @Post()
  async create(@Body() body: any) {
    return this.artifactService.create(body);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.artifactService.update(id, body);
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Body() body: any) {
    return this.artifactService.approve(id, body?.metadata || body || {}, body?.projectId, body?.expectedVersion);
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() body: any) {
    return this.artifactService.reject(id, body?.reason || '', body?.metadata || {}, body?.projectId, body?.expectedVersion);
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string, @Body() body: any) {
    return this.artifactService.archive(id, body?.projectId, body?.expectedVersion);
  }

  @Post(':id/unarchive')
  async unarchive(@Param('id') id: string, @Body() body: any) {
    return this.artifactService.unarchive(id, body?.projectId, body?.expectedVersion);
  }

  @Post(':id/restore')
  async restore(@Param('id') id: string, @Body() body: any) {
    const version = Number(body?.version ?? body?.fromVersion);
    if (!Number.isFinite(version)) throw new BadRequestException('version is required');
    return this.artifactService.restore(id, version, body || {});
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Query('projectId') projectId?: string) {
    const success = await this.artifactService.delete(id, projectId);
    return { success, logicalId: id };
  }
}
