import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventRecord, EventRecordSchema } from './schemas/event.schema';
import { EventEngineService } from './event-engine.service';
import { EventsController } from './events.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EventRecord.name, schema: EventRecordSchema },
    ]),
  ],
  controllers: [EventsController],
  providers: [EventEngineService],
  exports: [EventEngineService],
})
export class EventsModule {}
