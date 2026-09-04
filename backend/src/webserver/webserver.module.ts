import { Module, forwardRef } from '@nestjs/common';
import { WebserverService } from './webserver.service';
import { WebserverController } from './webserver.controller';
import { GraphsModule } from '../graphs/graphs.module';

@Module({
  imports: [forwardRef(() => GraphsModule)],
  controllers: [WebserverController],
  providers: [WebserverService],
  exports: [WebserverService],
})
export class WebserverModule {}
