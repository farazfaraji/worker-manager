import { Injectable, Logger } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';

@Injectable()
export class WebserverPlugin implements ToolPlugin {
  readonly toolType = 'webserver';
  private readonly logger = new Logger(WebserverPlugin.name);

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node } = ctx;
    const config = node?.data?.config || {};

    this.logger.log(`   🚀 [Webserver Node] Evaluating webserver node`);
    return {
      server: {
        port: Number(config.port) || 3000,
        host: config.host || '0.0.0.0',
        status: 'configured',
      },
    };
  }
}
