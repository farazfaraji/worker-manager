import { Module } from '@nestjs/common';
import { GraphsModule } from '../graphs/graphs.module';
import { RunsController } from './runs.controller';
import { CachesController } from './caches.controller';

@Module({
  imports: [GraphsModule],
  controllers: [RunsController, CachesController],
})
export class RunsModule {}
