import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { GraphsModule } from './graphs/graphs.module';
import { NodeDefinitionsModule } from './node-definitions/node-definitions.module';
import { RunsModule } from './runs/runs.module';
import { ModelsModule } from './models/models.module';
import { SettingsModule } from './settings/settings.module';
import { BlocksModule } from './blocks/blocks.module';
import { EventsModule } from './events/events.module';
import { ProjectsModule } from './projects/projects.module';
import { WebserverModule } from './webserver/webserver.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri:
          configService.get<string>('MONGODB_URI') ||
          'mongodb://127.0.0.1:27017/flow_builder',
      }),
      inject: [ConfigService],
    }),
    ProjectsModule,
    GraphsModule,
    NodeDefinitionsModule,
    RunsModule,
    ModelsModule,
    SettingsModule,
    BlocksModule,
    EventsModule,
    WebserverModule,
  ],
})
export class AppModule {}
