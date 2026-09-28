import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import {
  TelegramMessage,
  TelegramMessageSchema,
} from './schemas/telegram-message.schema';
import { Graph, GraphSchema } from '../graphs/schemas/graph.schema';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { GraphsModule } from '../graphs/graphs.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TelegramMessage.name, schema: TelegramMessageSchema },
      { name: Graph.name, schema: GraphSchema },
    ]),
    ConfigModule,
    SettingsModule,
    forwardRef(() => GraphsModule),
  ],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
