import { Node, Edge } from '@xyflow/react';
import { FlowNodeData, VariableItem, ToolOutput } from './types';

/**
 * Cleans and normalizes Zod / TypeScript types into canonical schema types.
 */
function normalizeTypeDefinition(typeVal: string): any {
  let cleaned = typeVal.trim();

  // Strip trailing comments
  if (cleaned.includes('//')) {
    cleaned = cleaned.split('//')[0].trim();
  }
  cleaned = cleaned.replace(/[,;]$/, '').trim();

  // Handle nested z.object({ ... }) or object literal
  if (cleaned.includes('z.object') || (cleaned.startsWith('{') && cleaned.endsWith('}'))) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const inner = cleaned.slice(firstBrace, lastBrace + 1);
      return parseSchema(inner);
    }
  }

  // Handle Zod primitives & chaining (.optional(), .nullable(), .describe(), etc.)
  if (/^z\.array\b/.test(cleaned)) return 'array';
  if (/^z\.string\b/.test(cleaned)) return 'string';
  if (/^z\.number\b/.test(cleaned)) return 'number';
  if (/^z\.boolean\b/.test(cleaned)) return 'boolean';
  if (/^z\.record\b/.test(cleaned)) return 'object';
  if (/^z\.enum\b/.test(cleaned)) return 'string';
  if (/^z\.any\b/.test(cleaned)) return 'any';

  return cleaned;
}

/**
 * Parses simple typescript or Zod object schemas like "z.object({ summary: z.string() })"
 * to extract top-level field names for variable autocomplete.
 */
export function extractSchemaKeys(typeString?: string): string[] {
  if (!typeString || typeof typeString !== 'string') return [];
  
  const keys: string[] = [];
  try {
    let content = typeString.trim();
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      content = content.slice(firstBrace + 1, lastBrace);
    }

    const lines = splitTopLevel(content);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
      
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        let key = trimmed.slice(0, colonIdx).trim();
        key = key.replace(/[\?'"]/g, '').trim();
        if (key && !keys.includes(key) && /^[a-zA-Z0-9_$]+$/.test(key)) {
          keys.push(key);
        }
      }
    }
  } catch {
    // Ignore parsing errors on custom user expressions
  }
  return keys;
}

/**
 * Splits a type string by delimiters (, ; \n) only at the top level (outside braces, brackets, and generics).
 */
function splitTopLevel(str: string): string[] {
  const chunks: string[] = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '{' || ch === '[' || ch === '(' || ch === '<') {
      depth++;
      current += ch;
    } else if (ch === '}' || ch === ']' || ch === ')' || ch === '>') {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if ((ch === ',' || ch === ';' || ch === '\n') && depth === 0) {
      if (current.trim()) {
        chunks.push(current.trim());
      }
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * Parses simple typescript or Zod object schemas like "z.object({ summary: z.string() })"
 * or "{ type: string, name: string }" or JSON into structured key-type schema objects.
 */
export function parseSchema(raw: any): any {
  if (!raw) return undefined;
  if (typeof raw === 'object' && raw !== null) return raw;
  if (typeof raw !== 'string') return undefined;

  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // 1. Try parsing JSON directly
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
  } catch {
    // Continue with TypeScript / Zod parsing
  }

  // 2. Parse TypeScript interface / Zod z.object / object literal notation
  try {
    let content = trimmed;
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      content = content.slice(firstBrace + 1, lastBrace);
    }

    const result: Record<string, any> = {};
    const lines = splitTopLevel(content);

    for (const line of lines) {
      const lineTrimmed = line.trim();
      if (!lineTrimmed || lineTrimmed.startsWith('//') || lineTrimmed.startsWith('/*')) {
        continue;
      }

      const colonIdx = lineTrimmed.indexOf(':');
      if (colonIdx > 0) {
        let key = lineTrimmed.slice(0, colonIdx).trim();
        let typeVal = lineTrimmed.slice(colonIdx + 1).trim();

        // Clean key (remove optional ? and quotes)
        key = key.replace(/[\?'"]/g, '').trim();

        if (key && typeVal) {
          result[key] = normalizeTypeDefinition(typeVal);
        }
      }
    }

    if (Object.keys(result).length > 0) {
      return result;
    }
  } catch {
    // If parsing fails, ignore
  }

  return undefined;
}

export function extractNodeOutputs(nodeData: any): ToolOutput[] {
  let outputsDef = nodeData.outputs || [];
  const config = nodeData.config || {};
  const defType = String(nodeData.definitionType || '').toLowerCase();

  // If outputs has legacy 'result' on a browser node, replace with direct outputs
  if (
    (defType === 'app' || defType === 'browser' || defType === 'brower') &&
    (outputsDef.length === 0 || outputsDef.some((o: any) => o.name === 'result'))
  ) {
    outputsDef = [
      { name: 'path', label: 'Screenshot / File Path', type: 'string' },
      { name: 'screenshot', label: 'Screenshot Image', type: 'image' },
      { name: 'url', label: 'Current URL', type: 'string' },
      { name: 'title', label: 'Page Title', type: 'string' },
      { name: 'text', label: 'Extracted Text', type: 'string' },
      { name: 'html', label: 'Page / Element HTML', type: 'string' },
      { name: 'css', label: 'Extracted CSS', type: 'string' },
      { name: 'standaloneHtml', label: 'Standalone Inlined HTML', type: 'string' },
      { name: 'actions', label: 'Actions', type: 'array' },
    ];
  }

  // If node is a router, dynamically generate branch output handles from routes config
  if (defType === 'router') {
    let routes = config.routes;
    if (typeof routes === 'string') {
      try {
        routes = JSON.parse(routes);
      } catch {
        routes = [];
      }
    }
    if (Array.isArray(routes) && routes.length > 0) {
      const dynamicRoutes: any[] = [];
      const seen = new Set<string>();

      for (const r of routes) {
        const routeName = String(r?.name || r?.id || '').trim();
        if (routeName && !seen.has(routeName.toLowerCase())) {
          seen.add(routeName.toLowerCase());
          dynamicRoutes.push({
            name: routeName,
            label: routeName,
            type: 'branch',
          });
        }
      }

      const defaultRouteName = String(config.defaultRoute || '').trim();
      if (defaultRouteName && !seen.has(defaultRouteName.toLowerCase())) {
        seen.add(defaultRouteName.toLowerCase());
        dynamicRoutes.push({
          name: defaultRouteName,
          label: defaultRouteName,
          type: 'branch',
        });
      } else if (!seen.has('default')) {
        dynamicRoutes.push({
          name: 'default',
          label: 'default',
          type: 'branch',
        });
      }

      outputsDef = dynamicRoutes;
    } else {
      outputsDef = [
        { name: 'default', label: 'default', type: 'branch' },
        { name: 'result', label: 'Route Result', type: 'object' },
      ];
    }
  }

  // If outputs has items with dependsOn, filter by matching config
  if (config && outputsDef.some((o: any) => o.dependsOn)) {
    outputsDef = outputsDef.filter((out: any) => {
      if (!out.dependsOn) return true;
      const targetVal = config[out.dependsOn.field];
      if (Array.isArray(out.dependsOn.in)) {
        return out.dependsOn.in.some((item: any) => String(item).toLowerCase() === String(targetVal ?? '').toLowerCase());
      }
      if (out.dependsOn.equals !== undefined) {
        return String(targetVal ?? '').toLowerCase() === String(out.dependsOn.equals).toLowerCase();
      }
      if (out.dependsOn.notEquals !== undefined) {
        return String(targetVal ?? '').toLowerCase() !== String(out.dependsOn.notEquals).toLowerCase();
      }
      return true;
    });
  }

  return outputsDef.map((out: any) => {
    const outItem: any = {
      name: out.name,
      label: out.label || out.name,
      type: out.type || 'object',
      ...(out.dependsOn ? { dependsOn: out.dependsOn } : {}),
    };

    let rawSchema: any = undefined;
    if (out.schemaFrom && config[out.schemaFrom]) {
      rawSchema = config[out.schemaFrom];
    } else if (config.querySchema && out.name === 'query') {
      rawSchema = config.querySchema;
    } else if (config.paramsSchema && out.name === 'params') {
      rawSchema = config.paramsSchema;
    } else if (config.outputType && (out.name === 'result' || out.name === 'value')) {
      rawSchema = config.outputType;
    } else if (config.inputSchema && out.name === 'input') {
      rawSchema = config.inputSchema;
    } else if (
      config.type &&
      (out.name === 'body' ||
        out.name === 'data' ||
        out.name === 'input' ||
        (out.name === 'query' && String(config.method).toUpperCase() === 'GET'))
    ) {
      rawSchema = config.type;
    } else if (config.schema && (out.name === 'value' || out.name === 'result')) {
      rawSchema = config.schema;
    } else if (config.key && (out.name === 'value' || out.name === 'result' || out.name === 'output')) {
      const keyName = String(config.key).trim();
      if (keyName) {
        rawSchema = { [keyName]: config.value !== undefined ? String(config.value) : 'string' };
      }
    } else if (out.schema) {
      rawSchema = out.schema;
    }

    if (rawSchema) {
      const parsed = parseSchema(rawSchema);
      if (parsed !== undefined) {
        outItem.schema = parsed;
      }
    }

    return outItem;
  });
}

/**
 * Extracts all upstream and available variables from the graph.
 */
export function extractAvailableVariables(
  nodes: Node<FlowNodeData>[],
  edges: Edge[] = [],
  currentEditingNodeId?: string,
): VariableItem[] {
  const variables: VariableItem[] = [];

  // Filter out the current node being edited to avoid circular self-reference
  const sourceNodes = nodes.filter((n) => n.id !== currentEditingNodeId && n.data);

  for (const node of sourceNodes) {
    const nodeName =
      node.data?.name ||
      node.data?.nodeName ||
      node.data?.label?.toLowerCase().replace(/\s+/g, '_') ||
      'node';
    let outputs = node.data?.outputs || [];

    const nodeConfig = node.data?.config || {};
    const nodeDefType = String(node.data?.definitionType || '').toLowerCase();
    const isVariableNode = nodeDefType === 'variable' || nodeDefType === 'set-variable';

    if (
      (nodeDefType === 'app' || nodeDefType === 'browser' || nodeDefType === 'brower') &&
      (outputs.length === 0 || outputs.some((o: any) => o.name === 'result'))
    ) {
      outputs = [
        { name: 'path', label: 'Screenshot / File Path', type: 'string' },
        { name: 'screenshot', label: 'Screenshot Image', type: 'image' },
        { name: 'url', label: 'Current URL', type: 'string' },
        { name: 'title', label: 'Page Title', type: 'string' },
        { name: 'text', label: 'Extracted Text', type: 'string' },
        { name: 'html', label: 'Page / Element HTML', type: 'string' },
        { name: 'css', label: 'Extracted CSS', type: 'string' },
        { name: 'standaloneHtml', label: 'Standalone Inlined HTML', type: 'string' },
        { name: 'actions', label: 'Actions', type: 'array' },
      ];
    }

    // Filter outputs by dependsOn against nodeConfig
    if (nodeConfig && outputs.some((o: any) => o.dependsOn)) {
      outputs = outputs.filter((out: any) => {
        if (!out.dependsOn) return true;
        const targetVal = nodeConfig[out.dependsOn.field];
        if (Array.isArray(out.dependsOn.in)) {
          return out.dependsOn.in.some((item: any) => String(item).toLowerCase() === String(targetVal ?? '').toLowerCase());
        }
        if (out.dependsOn.equals !== undefined) {
          return String(targetVal ?? '').toLowerCase() === String(out.dependsOn.equals).toLowerCase();
        }
        if (out.dependsOn.notEquals !== undefined) {
          return String(targetVal ?? '').toLowerCase() !== String(out.dependsOn.notEquals).toLowerCase();
        }
        return true;
      });
    }

    // For Set Variable blocks with a defined key, expose ONLY the direct key variable (e.g. setvariable.component_index)
    if (isVariableNode && nodeConfig.key && String(nodeConfig.key).trim()) {
      const keyName = String(nodeConfig.key).trim();
      variables.push({
        name: keyName,
        label: `${node.data?.label || nodeName} → ${keyName}`,
        path: `${nodeName}.${keyName}`,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: 'variable',
        type: typeof nodeConfig.value === 'string' ? 'string' : 'property',
      });
      continue;
    }

    // For Router blocks, expose route decision variables
    if (nodeDefType === 'router') {
      variables.push({
        name: 'route',
        label: `${node.data?.label || nodeName} → route`,
        path: `${nodeName}.result.route`,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: 'router',
        type: 'string',
      });
      variables.push({
        name: 'matched',
        label: `${node.data?.label || nodeName} → matched`,
        path: `${nodeName}.result.matched`,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: 'router',
        type: 'boolean',
      });
      variables.push({
        name: 'value',
        label: `${node.data?.label || nodeName} → value`,
        path: `${nodeName}.result.value`,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: 'router',
        type: 'string',
      });
    }

    // Expose the complete output of a single-output node (for example,
    // `script`) in addition to its individual output path (`script.result`).
    // This allows object payloads to be passed intact into another node.
    if (outputs.length === 1) {
      variables.push({
        name: nodeName,
        label: `${node.data?.label || nodeName} → whole output`,
        path: nodeName,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: node.data?.definitionType || 'node',
        type: outputs[0].type || 'any',
      });
    }

    for (const output of outputs) {
      // Base variable (e.g. parser.value, browser.screenshot, trigger.input)
      const basePath = `${nodeName}.${output.name}`;

      // Check if schema exists directly or schemaCode can be parsed
      const config = node.data?.config || {};
      const schemaField = output.schemaFrom || 'outputType';
      const schemaCode =
        config[schemaField] ||
        (output.name === 'query'
          ? config.querySchema || (String(config.method).toUpperCase() === 'GET' ? config.type : undefined)
          : undefined) ||
        (output.name === 'params' ? config.paramsSchema : undefined) ||
        config.outputType ||
        config.inputSchema;

      let subKeys: { name: string; type: string }[] = [];

      if (output.schema && typeof output.schema === 'object') {
        subKeys = Object.entries(output.schema).map(([k, v]) => ({
          name: k,
          type: typeof v === 'string' ? v : 'object',
        }));
      } else if (config.key && String(config.key).trim()) {
        subKeys = [
          {
            name: String(config.key).trim(),
            type: typeof config.value === 'string' ? 'string' : 'property',
          },
        ];
      } else if (schemaCode && typeof schemaCode === 'string') {
        const parsed = parseSchema(schemaCode);
        if (parsed && typeof parsed === 'object') {
          subKeys = Object.entries(parsed).map(([k, v]) => ({
            name: k,
            type: typeof v === 'string' ? v : 'property',
          }));
        } else {
          const extracted = extractSchemaKeys(schemaCode);
          subKeys = extracted.map((k) => ({ name: k, type: 'property' }));
        }
      }

      const isSingleOutput = outputs.length === 1;

      // Only expose generic output handle path if there are no specific schema subKeys or if multi-output
      if (!isSingleOutput || subKeys.length === 0) {
        variables.push({
          name: output.name,
          label: output.label || output.name,
          path: basePath,
          sourceNodeId: node.id,
          sourceNodeName: nodeName,
          sourceNodeType: node.data?.definitionType || 'node',
          type: output.type || 'any',
        });
      }

      for (const item of subKeys) {
        const varPath = isSingleOutput ? `${nodeName}.${item.name}` : `${basePath}.${item.name}`;
        const varLabel = isSingleOutput
          ? `${node.data?.label || nodeName} → ${item.name}`
          : `${output.label || output.name} → ${item.name}`;

        variables.push({
          name: isSingleOutput ? item.name : `${output.name}.${item.name}`,
          label: varLabel,
          path: varPath,
          sourceNodeId: node.id,
          sourceNodeName: nodeName,
          sourceNodeType: node.data?.definitionType || 'node',
          type: item.type || 'property',
        });
      }
    }
  }

  return variables;
}

/**
 * Generates a unique, clean nodeName for variable referencing.
 * e.g. "parser", "parser_2", "agent", "browser", "condition"
 */
export function generateUniqueNodeName(
  baseName: string,
  existingNodes: Node<FlowNodeData>[],
): string {
  const cleanBase = baseName
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  const existingNames = new Set(
    existingNodes.map((n) => n.data?.nodeName || '').filter(Boolean),
  );

  if (!existingNames.has(cleanBase)) {
    return cleanBase;
  }

  let counter = 1;
  while (existingNames.has(`${cleanBase}_${counter}`)) {
    counter++;
  }
  return `${cleanBase}_${counter}`;
}
