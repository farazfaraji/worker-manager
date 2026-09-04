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
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('keyword') keyword?: string,
    @Query('artifactId') artifactId?: string,
    @Query('logicalId') logicalId?: string,
    @Query('latestOnly') latestOnly?: string | boolean,
    @Query('limit') limit?: number,
  ) {
    const isLatestOnly = latestOnly === true || latestOnly === 'true';
    const items = await this.artifactService.list({
      projectId,
      type,
      status,
      search,
      keyword,
      artifactId,
      logicalId,
      latestOnly: isLatestOnly,
      limit: limit || 100,
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
    const doc = await this.artifactService.get(id, body?.projectId, true);
    const sourceLogicalId = doc.logicalId || doc.artifactId;

    // Check if typed relation payload (targetLogicalId and relationType provided)
    if (body?.targetLogicalId && (body?.relationType || body?.type)) {
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

    // Backward-compatible path: linkedArtifactIds / relations array
    const legacyRelations = body?.linkedArtifactIds || body?.relations || body;
    return this.artifactService.addRelation(id, legacyRelations, body?.source);
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
  async get(@Param('id') id: string, @Query('projectId') projectId?: string) {
    return this.artifactService.get(id, projectId, false);
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
    return this.artifactService.approve(id, body?.metadata || body || {});
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string) {
    return this.artifactService.archive(id);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    const success = await this.artifactService.delete(id);
    return { success, artifactId: id };
  }
}
