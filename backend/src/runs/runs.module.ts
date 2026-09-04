import { Module } from '@nestjs/common';
import { GraphsModule } from '../graphs/graphs.module';
import { RunsController } from './runs.controller';

@Module({
  imports: [GraphsModule],
  controllers: [RunsController],
})
export class RunsModule {}
