import { BadRequestException, Injectable, Logger, Inject, Optional, forwardRef } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { VariableResolverService, RuntimeNode } from './variable-resolver.service';
import { BrowserRunnerService } from './browser-runner.service';
import { AgentRunnerService } from './agent-runner.service';
import { JsonParser } from '../../functions/json-parser';
import { Increment } from '../../functions/increment';
import { Decrement } from '../../functions/decrement';
import { BlockRuntimeService } from '../../blocks/block-runtime.service';
import { WebserverService } from '../../webserver/webserver.service';

@Injectable()
export class NodeExecutorService {
  private readonly logger = new Logger(NodeExecutorService.name);

  constructor(
    private readonly variableResolver: VariableResolverService,
    private readonly browserRunner: BrowserRunnerService,
    private readonly agentRunner: AgentRunnerService,
    private readonly blockRuntime: BlockRuntimeService,
    @Optional()
    @Inject(forwardRef(() => WebserverService))
    private readonly webserverService?: WebserverService,
  ) {}

  async executeNode(
    node: RuntimeNode,
    nodeInput: any,
    context: Record<string, any>,
    initialInput: any,
    runId: string,
  ): Promise<any> {
    const data = node.data || {};
    const config = data.config || {};
    const type = String(data.definitionType || node.type || '').toLowerCase();
    const name = String(data.definitionName || data.name || '').toLowerCase();

    // 1. TRIGGER
    if (type === 'trigger') {
      this.logger.log(`   ⚡ [Trigger Execution] Emitting initial flow input payload`);
      if (initialInput && typeof initialInput === 'object' && (initialInput.topic || initialInput.entityName || initialInput.eventId || initialInput.id?.startsWith('evt_'))) {
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

    // 1b. ROUTE
    if (type === 'route') {
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

    // 1c. WEBSERVER
    if (type === 'webserver') {
      this.logger.log(`   🚀 [Webserver Node] Evaluating webserver node`);
      return {
        server: {
          port: Number(config.port) || 3000,
          host: config.host || '0.0.0.0',
          status: 'configured',
        },
      };
    }

    // 1d. HTTP-RESPONSE
    if (type === 'http-response' || type === 'httpresponse') {
      this.logger.log(`   📤 [HTTP Response Execution] Formatting and dispatching response`);
      const statusCode = Number(this.variableResolver.resolveValue(config.statusCode, context) || 200);
      const rawBody = config.responseBody !== undefined 
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

    // 2. INCREMENT VARIABLE
    if (
      type === 'increment' ||
      type === 'increment-variable' ||
      data.definitionId === 'increment-variable' ||
      data.definitionId === 'increment' ||
      name.includes('increment')
    ) {
      const targetVal = this.variableResolver.resolveValue(config.variable, context);
      const amountVal = config.amount !== undefined ? this.variableResolver.resolveValue(config.amount, context) : 1;
      this.logger.log(`   ➕ [Increment Variable] Resolved Target: ${JSON.stringify(targetVal)} | Amount: ${JSON.stringify(amountVal)}`);
      const incrementFn = new Increment();
      const result = incrementFn.execute({ value: targetVal, amount: amountVal });
      if (typeof config.variable === 'string' && this.variableResolver.looksLikeReference(config.variable.trim())) {
        this.variableResolver.assignReference(config.variable.trim(), result.value, context);
      }
      return result;
    }

    // 3. DECREMENT VARIABLE
    if (
      type === 'decrement' ||
      type === 'decrement-variable' ||
      data.definitionId === 'decrement-variable' ||
      data.definitionId === 'decrement' ||
      name.includes('decrement')
    ) {
      const targetVal = this.variableResolver.resolveValue(config.variable, context);
      const amountVal = config.amount !== undefined ? this.variableResolver.resolveValue(config.amount, context) : 1;
      this.logger.log(`   ➖ [Decrement Variable] Resolved Target: ${JSON.stringify(targetVal)} | Amount: ${JSON.stringify(amountVal)}`);
      const decrementFn = new Decrement();
      const result = decrementFn.execute({ value: targetVal, amount: amountVal });
      if (typeof config.variable === 'string' && this.variableResolver.looksLikeReference(config.variable.trim())) {
        this.variableResolver.assignReference(config.variable.trim(), result.value, context);
      }
      return result;
    }

    // 4. VARIABLE / SET-VARIABLE
    if (type === 'variable' || type === 'set-variable') {
      const key = config.key || 'value';
      const resolvedVal = this.variableResolver.resolveValue(config.value, context);
      this.logger.log(`   📌 [Variable Node] Storing key: "${key}" = ${JSON.stringify(resolvedVal)}`);
      return {
        [key]: resolvedVal,
        value: { [key]: resolvedVal },
      };
    }

    // 5. AGENT RUNTIME
    if (type === 'agent') {
      return this.agentRunner.executeAgentNode(node, nodeInput, context);
    }

    if (['action', 'memory', 'retrieval', 'artifact', 'embedding', 'router', 'human-gate', 'humangate', 'orchestrator', 'delegator', 'loop', 'aggregate', 'execution', 'notification'].includes(type)) {
      const genericInput = type === 'human-gate' || type === 'humangate'
        ? { ...config, ...nodeInput, ...(context.__resumeDecision || {}) }
        : { ...config, ...nodeInput };
      return this.blockRuntime.execute(type, { input: genericInput, context, config: genericInput, runId }, node);
    }

    // 6. FUNCTION / JSON-PARSER
    if (type === 'function' && (name.includes('json') || data.definitionId === 'json-parser' || data.nodeName === 'jsonparser')) {
      let source = config.input !== undefined ? nodeInput.input || nodeInput : nodeInput;
      if (config.sourceType === 'url' && config.targetUrl) {
        const targetUrl = String(this.variableResolver.resolveValue(config.targetUrl, context));
        this.logger.log(`   🌐 [JSON Parser] Fetching remote URL: ${targetUrl}`);
        const response = await fetch(targetUrl);
        if (!response.ok) throw new Error(`JSON source URL returned HTTP ${response.status} ${response.statusText}`);
        source = await response.text();
      } else if (config.sourceType === 'path' && config.filePath) {
        const filePath = String(config.filePath);
        this.logger.log(`   📂 [JSON Parser] Reading file from disk: ${filePath}`);
        source = await readFile(filePath, 'utf8');
      }
      this.logger.log(`   🔍 [JSON Parser] Parsing JSON payload (${typeof source === 'string' ? source.length + ' chars' : typeof source})...`);
      return new JsonParser().execute(source);
    }

    // 7. SCRIPT
    if (type === 'script') {
      if (!config.code) {
        this.logger.error(`   ❌ [Script Execution] Script node "${data.name || node.id}" has no code specified`);
        throw new Error('Script node has no code');
      }
      this.logger.log(`   📜 [Script Execution] Executing custom JavaScript code...`);
      const targetInput = nodeInput.input !== undefined ? nodeInput.input : nodeInput;

      // Inject flow variables so scripts can access upstream nodes directly by name (e.g. setvariable, jsonparser, script, etc.)
      const contextKeys = Object.keys(context || {}).filter(
        (k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'input' && k !== 'context',
      );
      const contextValues = contextKeys.map((k) => context[k]);

      const script = new Function('input', 'context', ...contextKeys, String(config.code));
      return await script(targetInput, context, ...contextValues);
    }

    // 8. TRANSFORM
    if (type === 'transform') {
      if (!config.mapping) {
        this.logger.error(`   ❌ [Transform Execution] Transform node has no mapping definition`);
        throw new Error('Transform node has no mapping');
      }
      this.logger.log(`   🔄 [Transform Execution] Applying mapping: ${config.mapping}`);
      const targetInput = nodeInput.input !== undefined ? nodeInput.input : nodeInput;

      const contextKeys = Object.keys(context || {}).filter(
        (k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'input' && k !== 'context',
      );
      const contextValues = contextKeys.map((k) => context[k]);

      const transform = new Function('input', 'context', ...contextKeys, `return (${config.mapping});`);
      return await transform(targetInput, context, ...contextValues);
    }

    // 9. CONDITION / LOGIC
    if (type === 'condition') {
      let condResult: boolean;
      const isCustomExpression = config.mode === 'expression' || (!config.mode && config.expression);
      if (isCustomExpression && config.expression) {
        const expr = String(config.expression);
        this.logger.log(`   🔀 [Condition Execution] Evaluating expression: "${expr}"`);
        const contextKeys = Object.keys(context || {}).filter(
          (k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'input' && k !== 'context',
        );
        const contextValues = contextKeys.map((k) => context[k]);

        const evaluator = new Function('input', 'context', ...contextKeys, expr);
        condResult = Boolean(await evaluator(nodeInput, context, ...contextValues));
      } else {
        const left = this.unwrapConditionValue(this.variableResolver.resolveValue(config.leftValue, context));
        const right = this.unwrapConditionValue(this.variableResolver.resolveValue(config.rightValue, context));
        const operator = String(config.operator || 'equals');
        this.logger.log(`   🔀 [Condition Execution] Comparing ${JSON.stringify(left)} ${operator} ${JSON.stringify(right)}`);
        condResult = this.compareConditionValues(left, right, operator);
      }
      this.logger.log(`   🔀 [Condition Result]: ${condResult}`);
      return { result: condResult, conditionMet: condResult };
    }

    // 10. VALIDATOR
    if (type === 'validator') {
      this.logger.log(`   🛡️ [Validator Execution] Validating input payload...`);
      const valid = nodeInput !== undefined && nodeInput !== null;
      return { valid, input: nodeInput };
    }

    // 11. BROWSER APP + ACTIONS
    if (type === 'app' || type === 'browser' || type === 'brower') {
      return this.browserRunner.executeBrowserNode(node, nodeInput, context, runId);
    }

    if (type === 'subgraph') {
      throw new BadRequestException('Subgraph nodes must be executed through GraphRunnerService');
    }

    this.logger.error(`   ❌ Unsupported node type: "${type}"`);
    throw new Error(`Unsupported node type: ${type || 'unknown'}`);
  }

  private unwrapConditionValue(value: any): any {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const values = Object.values(value);
      if (values.length === 1 && (typeof values[0] !== 'object' || values[0] === null)) return values[0];
    }
    return value;
  }

  private compareConditionValues(left: any, right: any, operator: string): boolean {
    switch (operator) {
      case 'notEquals': return left !== right;
      case 'contains':
        return Array.isArray(left) ? left.includes(right) : String(left ?? '').includes(String(right ?? ''));
      case 'greaterThan': return Number(left) > Number(right);
      case 'lessThan': return Number(left) < Number(right);
      case 'isEmpty': return left === undefined || left === null || left === '' || (Array.isArray(left) && left.length === 0);
      case 'equals':
      default: return left === right || String(left) === String(right);
    }
  }
}
