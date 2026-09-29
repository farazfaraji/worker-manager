import { Injectable, Logger } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';

@Injectable()
export class TriggerPlugin implements ToolPlugin {
  readonly toolType = 'trigger';
  private readonly logger = new Logger(TriggerPlugin.name);

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, initialInput } = ctx;
    const config = node?.data?.config || {};

    this.logger.log(`   ⚡ [Trigger Execution] Emitting initial flow input payload`);

    // Human-Input trigger: expose user's answer only under the configured key
    if (config.triggerType === 'human-input') {
      const inputKey = String(config.inputKey || 'userInput');
      const raw = initialInput || {};
      const answer =
        typeof raw === 'string'
          ? raw
          : (raw[inputKey] ?? raw['userInput'] ?? raw['input'] ?? '');
      this.logger.log(`   ✍️ [Human-Input Trigger] key="${inputKey}", answer length=${String(answer).length}`);
      return { [inputKey]: answer };
    }

    if (
      initialInput &&
      typeof initialInput === 'object' &&
      (initialInput.topic || initialInput.entityName || initialInput.eventId || initialInput.id?.startsWith('evt_'))
    ) {
      return {
        event: initialInput,
        data: initialInput.data !== undefined ? initialInput.data : initialInput,
        entityId: initialInput.entityId || '',
        topic: initialInput.topic || '',
        input: initialInput.data !== undefined ? initialInput.data : initialInput,
        ...initialInput,
      };
    }

    return initialInput;
  }
}

@Injectable()
export class RoutePlugin implements ToolPlugin {
  readonly toolType = 'route';
  private readonly logger = new Logger(RoutePlugin.name);

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { initialInput } = ctx;
    this.logger.log(`   🌐 [Route Execution] Handling incoming HTTP request`);
    const payload = initialInput || {};
    const body = payload.body !== undefined ? payload.body : payload;
    const query = payload.query || {};
    const params = payload.params || {};

    return {
      body,
      params,
      query,
      headers: payload.headers || {},
      ...(typeof query === 'object' && query !== null ? query : {}),
      ...(typeof params === 'object' && params !== null ? params : {}),
      ...(typeof body === 'object' && body !== null ? body : {}),
    };
  }
}
