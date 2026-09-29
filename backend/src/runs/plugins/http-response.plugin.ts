import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { VariableResolverService } from '../services/variable-resolver.service';
import { WebserverService } from '../../webserver/webserver.service';

@Injectable()
export class HttpResponsePlugin implements ToolPlugin {
  readonly toolType = ['http-response', 'httpresponse'];
  private readonly logger = new Logger(HttpResponsePlugin.name);

  constructor(
    private readonly variableResolver: VariableResolverService,
    @Optional()
    @Inject(forwardRef(() => WebserverService))
    private readonly webserverService?: WebserverService,
  ) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context } = ctx;
    const config = node?.data?.config || {};

    this.logger.log(`   📤 [HTTP Response Execution] Formatting and dispatching response`);
    const statusCode = Number(this.variableResolver.resolveValue(config.statusCode, context) || 200);
    const rawBody =
      config.responseBody !== undefined
        ? this.variableResolver.resolveValue(config.responseBody, context)
        : nodeInput;
    const headers = config.headers ? this.variableResolver.resolveValue(config.headers, context) : {};

    const requestId = context.__webserverRequestId;
    if (requestId && this.webserverService) {
      this.webserverService.resolvePendingResponse(requestId, {
        statusCode,
        body: rawBody,
        headers: typeof headers === 'object' && headers !== null ? headers : {},
      });
    }

    return {
      sent: true,
      statusCode,
      response: rawBody,
      headers,
    };
  }
}
