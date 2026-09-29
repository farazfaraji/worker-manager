import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { VariableResolverService, RuntimeNode } from '../services/variable-resolver.service';
import { JsonParser } from '../../functions/json-parser';

@Injectable()
export class JsonParserPlugin implements ToolPlugin {
  readonly toolType = ['json-parser', 'jsonparser'];
  private readonly logger = new Logger(JsonParserPlugin.name);

  constructor(private readonly variableResolver: VariableResolverService) {}

  matches(type: string, node?: RuntimeNode): boolean {
    const data = node?.data || {};
    const name = String(data.definitionName || data.name || '').toLowerCase();
    return (
      type === 'json-parser' ||
      type === 'jsonparser' ||
      (type === 'function' &&
        (name.includes('json') || data.definitionId === 'json-parser' || data.nodeName === 'jsonparser'))
    );
  }

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context } = ctx;
    const config = node?.data?.config || {};

    let source = config.input !== undefined ? nodeInput?.input || nodeInput : nodeInput;
    if (config.sourceType === 'url' && config.targetUrl) {
      const targetUrl = String(this.variableResolver.resolveValue(config.targetUrl, context));
      this.logger.log(`   🌐 [JSON Parser] Fetching remote URL: ${targetUrl}`);
      const response = await fetch(targetUrl);
      if (!response.ok) {
        throw new Error(`JSON source URL returned HTTP ${response.status} ${response.statusText}`);
      }
      source = await response.text();
    } else if (config.sourceType === 'path' && config.filePath) {
      const filePath = String(config.filePath);
      this.logger.log(`   📂 [JSON Parser] Reading file from disk: ${filePath}`);
      source = await readFile(filePath, 'utf8');
    }

    this.logger.log(
      `   🔍 [JSON Parser] Parsing JSON payload (${typeof source === 'string' ? source.length + ' chars' : typeof source})...`,
    );
    return new JsonParser().execute(source);
  }
}
