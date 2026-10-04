import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SecretsService } from '../../secrets/secrets.service';
import { registerResolvedSecret } from './redaction.util';

export type RuntimeNode = any;

@Injectable()
export class VariableResolverService {
  constructor(@Optional() private readonly secretsService?: SecretsService) {}

  /**
   * Load every {{secrets.NAME}} referenced by a value into the in-memory vault cache.
   * Values stay out of run context so checkpoints do not persist them.
   */
  async warmSecrets(value: any, context: Record<string, any>): Promise<void> {
    if (!this.secretsService) return;
    const projectId = String(context?.projectId || '');
    if (!projectId) return;
    const names = new Set<string>();
    this.collectSecretNames(value, names, 0);
    for (const name of names) {
      const resolved = await this.secretsService.resolve(projectId, name);
      if (resolved !== undefined) registerResolvedSecret(String(context.runId || ''), resolved);
    }
  }

  resolveNodeInput(node: RuntimeNode, context: Record<string, any>, initialInput: any): any {
    const config = node.data?.config || {};
    const resolved = this.resolveValue(config, context);
    if (node.data?.definitionType === 'loop' && config.mode === 'research') {
      // These fields describe paths inside the child output, not references to
      // the current graph's context.
      for (const key of ['completionPath', 'gapPath']) {
        if (typeof config[key] === 'string') resolved[key] = config[key];
      }
    }
    if (Object.keys(resolved || {}).length > 0) return resolved;
    return initialInput;
  }

  resolveValue(value: any, context: Record<string, any>): any {
    if (Array.isArray(value)) return value.map((item) => this.resolveValue(item, context));
    if (value && typeof value === 'object') {
      if (value.mode === 'variable') {
        const ref = String(value.value || '').trim();
        if (ref.includes('||')) {
          const parts = ref.split('||').map((p) => p.trim());
          for (const part of parts) {
            if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
              return part.slice(1, -1);
            }
            if (/^-?\d+(\.\d+)?$/.test(part)) {
              return Number(part);
            }
            if (part === 'true') return true;
            if (part === 'false') return false;
            if (part === 'null') return null;
            const val = this.resolveReference(part, context);
            if (val !== undefined && val !== null && val !== '') {
              return val;
            }
          }
          return undefined;
        }
        return this.resolveReference(ref, context);
      }
      if (value.mode === 'literal') return this.resolveValue(value.value, context);
      const result: Record<string, any> = {};
      for (const [key, item] of Object.entries(value)) result[key] = this.resolveValue(item, context);
      return result;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (this.looksLikeReference(trimmed) || this.looksLikeWholeNodeReference(trimmed, context)) {
        return this.resolveReference(trimmed, context);
      }
      return this.resolveTemplate(value, context);
    }
    return value;
  }

  resolveTemplate(value: string, context: Record<string, any>): string {
    if (!value.includes('{{')) return value;

    return value.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, reference: string) => {
      const trimmed = reference.trim();
      const lower = trimmed.toLowerCase();
      if (lower === 'uuid' || lower === '$uuid') {
        return randomUUID();
      }
      if (lower === 'timestamp' || lower === '$timestamp') {
        return Date.now().toString();
      }

      // Support fallback chain: e.g. "a.query.q || a.query.content || ''" or "a.query.limit || 5"
      if (trimmed.includes('||')) {
        const parts = trimmed.split('||').map((p) => p.trim());
        for (const part of parts) {
          if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
            return part.slice(1, -1);
          }
          if (/^-?\d+(\.\d+)?$/.test(part)) {
            return part;
          }
          if (part === 'true' || part === 'false' || part === 'null') {
            return part;
          }
          const val = this.resolveReference(part, context);
          if (val !== undefined && val !== null && val !== '') {
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val);
          }
        }
        return '';
      }

      const resolved = this.resolveReference(trimmed, context);
      if (resolved === null) {
        return '';
      }
      if (resolved === undefined) {
        if (
          trimmed.includes('.query') ||
          trimmed.includes('.params') ||
          trimmed.includes('.headers') ||
          trimmed.endsWith('?')
        ) {
          return '';
        }
        throw new BadRequestException(`Unable to resolve template variable: ${trimmed}`);
      }
      if (typeof resolved === 'object') return JSON.stringify(resolved);
      return String(resolved);
    });
  }

  looksLikeReference(value: string): boolean {
    return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(value.trim());
  }

  looksLikeWholeNodeReference(value: string, context: Record<string, any>): boolean {
    return (
      /^(?!input$|apps$)[A-Za-z_$][\w$]*$/.test(value.trim()) &&
      Object.prototype.hasOwnProperty.call(context, value.trim())
    );
  }

  resolveReference(reference: string, context: Record<string, any>): any {
    const rawParts = String(reference || '').split('.');
    const root = rawParts.shift()!;
    if (root === 'secrets') return this.readSecret(rawParts, context);
    let current = context[root];
    if (current === undefined || current === null) return undefined;

    // 1. Direct path lookup (e.g. jsonparser.entries, script.amount, setvariable.component_index, brower.result.path)
    let directVal = current;
    for (const part of rawParts) {
      if (directVal === undefined || directVal === null) {
        directVal = undefined;
        break;
      }
      directVal = directVal[part];
    }
    if (directVal !== undefined) return directVal;

    // 2. Bypass intermediate output handle name (e.g. script.result.amount -> script.amount, jsonparser.value.entries -> jsonparser.entries, brower.result.path -> brower.path)
    if (rawParts.length >= 2) {
      let bypassVal = current;
      for (const part of rawParts.slice(1)) {
        if (bypassVal === undefined || bypassVal === null) {
          bypassVal = undefined;
          break;
        }
        bypassVal = bypassVal[part];
      }
      if (bypassVal !== undefined) return bypassVal;
    }

    // 3. Fallback to search within actions array if current node has actions (e.g. brower.result.path or brower.path)
    const targetKey = rawParts[rawParts.length - 1];
    const actionsList = Array.isArray(current.actions)
      ? current.actions
      : Array.isArray(current.result?.actions)
      ? current.result.actions
      : null;
    if (actionsList) {
      for (let i = actionsList.length - 1; i >= 0; i--) {
        const actionItem = actionsList[i];
        if (actionItem) {
          if (actionItem[targetKey] !== undefined) return actionItem[targetKey];
          if ((targetKey === 'screenshot' || targetKey === 'path') && actionItem.action === 'screenshot') {
            return actionItem.path || actionItem.screenshot;
          }
        }
      }
    }

    // 4. Fallback to leaf property on root object or nested result object
    if (typeof current === 'object') {
      if (current[targetKey] !== undefined) return current[targetKey];
      if (current.result && typeof current.result === 'object' && current.result[targetKey] !== undefined) {
        return current.result[targetKey];
      }
      if (targetKey === 'screenshot' && (current.path || current.result?.path)) {
        return current.path || current.result?.path;
      }
      if (targetKey === 'path' && (current.screenshot || current.result?.screenshot)) {
        return current.screenshot || current.result?.screenshot;
      }
    }

    return undefined;
  }

  assignReference(reference: string, value: any, context: Record<string, any>): void {
    const parts = reference.split('.');
    const root = parts.shift();
    if (!root) return;

    if (!parts.length) {
      context[root] = value;
      if (context.state && typeof context.state === 'object') {
        context.state[root] = value;
      }
      return;
    }

    if (!context[root] || typeof context[root] !== 'object') {
      context[root] = {};
    }

    let current = context[root];
    for (const part of parts.slice(0, -1)) {
      if (!current[part] || typeof current[part] !== 'object') current[part] = {};
      current = current[part];
    }
    const finalKey = parts[parts.length - 1];
    current[finalKey] = value;

    // Synchronize aliases for Set Variable blocks (e.g. setvariable.key <-> setvariable.value.key)
    if (parts.length === 1 && context[root].value && typeof context[root].value === 'object') {
      context[root].value[finalKey] = value;
    } else if (parts.length === 2 && parts[0] === 'value' && typeof context[root] === 'object') {
      context[root][finalKey] = value;
    }

    // Synchronize state alias: state.counter <-> context.counter
    if (root === 'state' && parts.length === 1) {
      context[finalKey] = value;
    } else if (root !== 'state' && context.state && typeof context.state === 'object' && parts.length === 1) {
      context.state[finalKey] = value;
    }
  }

  normalizeOutput(node: RuntimeNode, rawOutput: any): any {
    const outputs = node.data?.outputs || [];
    if (!outputs.length) return rawOutput;

    const outputNames = outputs.map((output: any) => output.name).filter(Boolean);
    // Safeguard: Never leak raw float vector arrays into graph execution state
    if (rawOutput && typeof rawOutput === 'object') {
      if (Array.isArray(rawOutput.embedding) && rawOutput.embedding.length > 32) {
        delete rawOutput.embedding;
      }
      if (Array.isArray(rawOutput.embeddings) && rawOutput.embeddings.length > 0 && Array.isArray(rawOutput.embeddings[0])) {
        delete rawOutput.embeddings;
      }
      if (rawOutput.result && typeof rawOutput.result === 'object') {
        if (Array.isArray(rawOutput.result.embedding) && rawOutput.result.embedding.length > 32) {
          delete rawOutput.result.embedding;
        }
        if (Array.isArray(rawOutput.result.embeddings) && rawOutput.result.embeddings.length > 0 && Array.isArray(rawOutput.result.embeddings[0])) {
          delete rawOutput.result.embeddings;
        }
      }
    }

    if (
      rawOutput &&
      typeof rawOutput === 'object' &&
      !Array.isArray(rawOutput) &&
      outputNames.some((name: string) => Object.prototype.hasOwnProperty.call(rawOutput, name))
    ) {
      return rawOutput;
    }

    if (outputNames.length === 1) {
      if (rawOutput && typeof rawOutput === 'object' && !Array.isArray(rawOutput)) {
        return { ...rawOutput, [outputNames[0]]: rawOutput };
      }
      return { [outputNames[0]]: rawOutput };
    }

    return rawOutput;
  }

  private readSecret(parts: string[], context: Record<string, any>): string | undefined {
    const name = parts[0];
    if (!name || !this.secretsService || parts.length > 1) return undefined;
    const projectId = String(context?.projectId || '');
    const value = this.secretsService.peek(projectId, name);
    if (value === undefined) return undefined;
    registerResolvedSecret(String(context?.runId || ''), value);
    return value;
  }

  private collectSecretNames(value: any, names: Set<string>, depth: number): void {
    if (depth > 20 || value == null) return;
    if (typeof value === 'string') {
      const found = value.match(new RegExp('secrets\\.([A-Z][A-Z0-9_]*)', 'g')) || [];
      for (const item of found) names.add(item.slice('secrets.'.length));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) this.collectSecretNames(item, names, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const item of Object.values(value)) this.collectSecretNames(item, names, depth + 1);
    }
  }
}
