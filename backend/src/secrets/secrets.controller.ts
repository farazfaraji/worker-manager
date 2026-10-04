import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { SetEncryptionKeyDto } from './dto/set-encryption-key.dto';
import { UpsertSecretDto } from './dto/upsert-secret.dto';
import { SecretsService } from './secrets.service';

@Controller('projects/:projectId/secrets')
export class SecretsController {
  constructor(private readonly secretsService: SecretsService) {}

  @Get('encryption-key')
  encryptionKeyStatus(@Param('projectId') projectId: string) {
    return this.secretsService.encryptionKeyStatus(projectId);
  }

  @Put('encryption-key')
  setEncryptionKey(@Param('projectId') projectId: string, @Body() body: SetEncryptionKeyDto) {
    return this.secretsService.setEncryptionKey(projectId, body.key);
  }

  @Get()
  list(@Param('projectId') projectId: string) {
    return this.secretsService.list(projectId);
  }

  @Put(':name')
  upsert(
    @Param('projectId') projectId: string,
    @Param('name') name: string,
    @Body() body: UpsertSecretDto,
  ) {
    return this.secretsService.set(projectId, name, body.value, body.description);
  }

  @Delete(':name')
  remove(@Param('projectId') projectId: string, @Param('name') name: string) {
    return this.secretsService.delete(projectId, name);
  }
}
