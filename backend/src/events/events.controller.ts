import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { EventEngineService } from './event-engine.service';
import { CreateAppEventInput } from './event.types';

@Controller('events')
export class EventsController {
  constructor(private readonly eventEngine: EventEngineService) {}

  @Get()
  list(@Query() query: any) {
    return this.eventEngine.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.eventEngine.get(id);
  }

  @Post('publish')
  publish(@Body() body: CreateAppEventInput) {
    return this.eventEngine.publish(body);
  }
}
