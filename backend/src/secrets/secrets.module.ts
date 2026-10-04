import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectVaultKey, ProjectVaultKeySchema } from './schemas/project-vault-key.schema';
import { Secret, SecretSchema } from './schemas/secret.schema';
import { SecretsController } from './secrets.controller';
import { SecretsService } from './secrets.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Secret.name, schema: SecretSchema },
      { name: ProjectVaultKey.name, schema: ProjectVaultKeySchema },
    ]),
  ],
  controllers: [SecretsController],
  providers: [SecretsService],
  exports: [SecretsService],
})
export class SecretsModule {}
