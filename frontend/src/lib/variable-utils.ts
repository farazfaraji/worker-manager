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
    if (routes === undefined || routes === null || routes === '') {
      const routesInput = (nodeData.inputs || []).find((inp: any) => inp.name === 'routes');
      if (routesInput?.defaultValue) {
        routes = routesInput.defaultValue;
      }
    }
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

  // If node is foreach, dynamically provide item, done, and result outputs based on mode
  if (defType === 'foreach') {
    const mode = String(config.mode || 'canvas').toLowerCase();
    if (mode !== 'subgraph') {
      outputsDef = [
        { name: 'item', label: 'Item (Loop)', type: 'branch' },
        { name: 'done', label: 'Done', type: 'branch' },
        { name: 'result', label: 'Foreach Result', type: 'object' },
      ];
    } else {
      outputsDef = [
        { name: 'result', label: 'Foreach Result', type: 'object' },
      ];
    }
  }

  // If node is an orchestrator, dynamically generate agent output sockets + last result socket
  if (defType === 'orchestrator' || defType === 'delegator') {
    let agentOutputs = config.agentOutputs ?? config.outputs ?? config.agents;
    if (agentOutputs === undefined || agentOutputs === null || agentOutputs === '') {
      const agentOutputsInput = (nodeData.inputs || []).find((inp: any) => inp.name === 'agentOutputs' || inp.name === 'agents');
      if (agentOutputsInput?.defaultValue) {
        agentOutputs = agentOutputsInput.defaultValue;
      }
    }
    if (typeof agentOutputs === 'string') {
      try {
        agentOutputs = JSON.parse(agentOutputs);
      } catch {
        agentOutputs = [];
      }
    }

    const dynamicAgentOutputs: any[] = [];
    const seen = new Set<string>();

    if (Array.isArray(agentOutputs) && agentOutputs.length > 0) {
      for (let i = 0; i < agentOutputs.length; i++) {
        const item = agentOutputs[i];
        const rawName = typeof item === 'string' ? item : (item?.name || item?.id || `agent_${i + 1}`);
        const name = String(rawName).trim();
        const label = typeof item === 'object' && item?.label ? item.label : (typeof item === 'object' && item?.role ? `${name} (${item.role})` : name);
        if (name && !seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          dynamicAgentOutputs.push({
            name,
            label,
            type: 'branch',
          });
        }
      }
    } else {
      // Default to 4 parallel agents
      for (let i = 1; i <= 4; i++) {
        const name = `agent_${i}`;
        seen.add(name);
        dynamicAgentOutputs.push({
          name,
          label: `agent_${i}`,
          type: 'branch',
        });
      }
    }

    // Always append the dedicated output called only when all jobs finish
    if (!seen.has('done')) {
      dynamicAgentOutputs.push({
        name: 'done',
        label: 'Done (Jobs Finish)',
        type: 'branch',
      });
    }

    outputsDef = dynamicAgentOutputs;
  }

  // If node is a Set Variable block, guarantee 'value' output handle
  const isSetVar =
    defType === 'variable' ||
    defType === 'set-variable' ||
    String(nodeData.definitionId || '').toLowerCase() === 'set-variable' ||
    String(nodeData.definitionName || '').toLowerCase().includes('set variable') ||
    String(nodeData.nodeName || '').toLowerCase().startsWith('setvariable') ||
    String(nodeData.name || '').toLowerCase().startsWith('setvariable');
  if (isSetVar && (!outputsDef || outputsDef.length === 0)) {
    outputsDef = [{ name: 'value', label: 'Assigned Value', type: 'object' }];
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
    let outputs = (node.data?.outputs && node.data.outputs.length > 0)
      ? node.data.outputs
      : (node.data?.definitionOutputs || []);

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

    // For Set Variable blocks with a defined key, expose direct key variable and state.key
    if (isVariableNode && nodeConfig.key && String(nodeConfig.key).trim()) {
      const keyName = String(nodeConfig.key).trim();
      const valType = String(nodeConfig.valueType || '').toLowerCase();
      let resolvedType: any = 'string';
      if (valType === 'number' || typeof nodeConfig.value === 'number' || typeof nodeConfig.numberValue === 'number') {
        resolvedType = 'number';
      } else if (valType === 'boolean' || typeof nodeConfig.value === 'boolean' || typeof nodeConfig.booleanValue === 'boolean') {
        resolvedType = 'boolean';
      } else if (valType === 'json' || typeof nodeConfig.value === 'object' || typeof nodeConfig.jsonValue === 'object') {
        resolvedType = 'property';
      }

      variables.push({
        name: keyName,
        label: `${node.data?.label || nodeName} → ${keyName}`,
        path: `${nodeName}.${keyName}`,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: 'variable',
        type: resolvedType,
      });

      variables.push({
        name: keyName,
        label: `state → ${keyName}`,
        path: `state.${keyName}`,
        sourceNodeId: node.id,
        sourceNodeName: 'state',
        sourceNodeType: 'variable',
        type: resolvedType,
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

    // For Foreach blocks, expose iteration item, index, total, and collection results
    if (nodeDefType === 'foreach') {
      variables.push({
        name: 'item',
        label: `${node.data?.label || nodeName} → item (current iteration item)`,
        path: `${nodeName}.item`,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: 'foreach',
        type: 'any',
      });
      variables.push({
        name: 'index',
        label: `${node.data?.label || nodeName} → index (zero-based item index)`,
        path: `${nodeName}.index`,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: 'foreach',
        type: 'number',
      });
      variables.push({
        name: 'total',
        label: `${node.data?.label || nodeName} → total (total item count)`,
        path: `${nodeName}.total`,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: 'foreach',
        type: 'number',
      });
      variables.push({
        name: 'result',
        label: `${node.data?.label || nodeName} → result (all iteration results)`,
        path: `${nodeName}.result`,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: 'foreach',
        type: 'object',
      });
      variables.push({
        name: 'items',
        label: `${node.data?.label || nodeName} → items (array of item outputs)`,
        path: `${nodeName}.result.items`,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: 'foreach',
        type: 'array',
      });
    }

    // For Output blocks, expose the configured value or custom key
    if (nodeDefType === 'output') {
      const keyName = String(nodeConfig?.name || '').trim();
      if (keyName) {
        variables.push({
          name: keyName,
          label: `${node.data?.label || nodeName} → ${keyName}`,
          path: `${nodeName}.${keyName}`,
          sourceNodeId: node.id,
          sourceNodeName: nodeName,
          sourceNodeType: 'output',
          type: 'any',
        });
      }
      variables.push({
        name: 'value',
        label: `${node.data?.label || nodeName} → value`,
        path: `${nodeName}.value`,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: 'output',
        type: 'any',
      });
    }

    // For Orchestrator blocks, expose agent output dispatch variables and aggregate result
    if (nodeDefType === 'orchestrator' || nodeDefType === 'delegator') {
      const nodeOutputs = extractNodeOutputs({
        definitionType: nodeDefType,
        outputs: node.data?.outputs || node.data?.definitionOutputs || [],
        config: nodeConfig,
        inputs: node.data?.inputs || [],
      });

      for (const out of nodeOutputs) {
        if (out.name !== 'result') {
          variables.push({
            name: out.name,
            label: `${node.data?.label || nodeName} → ${out.label || out.name}`,
            path: `${nodeName}.${out.name}`,
            sourceNodeId: node.id,
            sourceNodeName: nodeName,
            sourceNodeType: 'orchestrator',
            type: 'object',
          });
        }
      }

      variables.push({
        name: 'done',
        label: `${node.data?.label || nodeName} → done (output called when all jobs finish)`,
        path: `${nodeName}.done`,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: 'orchestrator',
        type: 'object',
      });
      variables.push({
        name: 'result',
        label: `${node.data?.label || nodeName} → result (composite orchestration output)`,
        path: `${nodeName}.result`,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: 'orchestrator',
        type: 'object',
      });
      variables.push({
        name: 'results',
        label: `${node.data?.label || nodeName} → results (array of agent outcomes)`,
        path: `${nodeName}.result.results`,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: 'orchestrator',
        type: 'array',
      });
      variables.push({
        name: 'lastResult',
        label: `${node.data?.label || nodeName} → lastResult (final consolidated outcome)`,
        path: `${nodeName}.result.lastResult`,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: 'orchestrator',
        type: 'object',
      });
      variables.push({
        name: 'goal',
        label: `${node.data?.label || nodeName} → goal`,
        path: `${nodeName}.goal`,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: 'orchestrator',
        type: 'string',
      });
    }

    // For Action blocks whose canvas outputs are event/branch-based, expose their data payload variables
    if (nodeDefType === 'artifact') {
      const artifactVars = [
        { name: 'content', label: 'Content', type: 'string' },
        { name: 'artifact', label: 'Artifact Object', type: 'object' },
        { name: 'artifactId', label: 'Artifact ID', type: 'string' },
        { name: 'logicalId', label: 'Logical ID', type: 'string' },
        { name: 'status', label: 'Status', type: 'string' },
        { name: 'version', label: 'Version', type: 'number' },
        { name: 'title', label: 'Title', type: 'string' },
        { name: 'type', label: 'Type', type: 'string' },
        { name: 'category', label: 'Category', type: 'string' },
        { name: 'tags', label: 'Tags', type: 'array' },
        { name: 'changed', label: 'Changed', type: 'boolean' },
        { name: 'branch', label: 'Branch', type: 'string' },
        { name: 'metadata', label: 'Metadata', type: 'object' },
        { name: 'artifacts', label: 'Artifacts List', type: 'array' },
        { name: 'count', label: 'Count', type: 'number' },
        { name: 'diff', label: 'Diff', type: 'object' },
      ];
      for (const v of artifactVars) {
        variables.push({
          name: v.name,
          label: `${node.data?.label || nodeName} → ${v.label}`,
          path: `${nodeName}.${v.name}`,
          sourceNodeId: node.id,
          sourceNodeName: nodeName,
          sourceNodeType: 'artifact',
          type: v.type as any,
        });
      }
    } else if (nodeDefType === 'human-gate') {
      const gateVars = [
        { name: 'feedback', label: 'Feedback', type: 'string' },
        { name: 'approved', label: 'Approved (boolean)', type: 'boolean' },
        { name: 'status', label: 'Status', type: 'string' },
        { name: 'value', label: 'Form Value', type: 'object' },
        { name: 'draft', label: 'Edited Draft', type: 'string' },
      ];
      for (const v of gateVars) {
        variables.push({
          name: v.name,
          label: `${node.data?.label || nodeName} → ${v.label}`,
          path: `${nodeName}.${v.name}`,
          sourceNodeId: node.id,
          sourceNodeName: nodeName,
          sourceNodeType: 'human-gate',
          type: v.type as any,
        });
      }
    } else if (nodeDefType === 'research-review') {
      const reviewVars = [
        { name: 'decision', label: 'Review Decision', type: 'string' },
        { name: 'feedback', label: 'Feedback Notes', type: 'string' },
        { name: 'score', label: 'Quality Score', type: 'number' },
        { name: 'quality', label: 'Quality Assessment', type: 'object' },
        { name: 'missingEvidence', label: 'Missing Evidence', type: 'array' },
        { name: 'findings', label: 'Findings', type: 'array' },
        { name: 'sourceChecks', label: 'Source Verification Checks', type: 'array' },
      ];
      for (const v of reviewVars) {
        variables.push({
          name: v.name,
          label: `${node.data?.label || nodeName} → ${v.label}`,
          path: `${nodeName}.${v.name}`,
          sourceNodeId: node.id,
          sourceNodeName: nodeName,
          sourceNodeType: 'research-review',
          type: v.type as any,
        });
      }
    } else if (nodeDefType === 'retrieval') {
      const retrievalVars = [
        { name: 'results', label: 'Retrieved Results', type: 'array' },
        { name: 'context', label: 'Context Text', type: 'string' },
        { name: 'count', label: 'Count', type: 'number' },
        { name: 'query', label: 'Query', type: 'string' },
      ];
      for (const v of retrievalVars) {
        variables.push({
          name: v.name,
          label: `${node.data?.label || nodeName} → ${v.label}`,
          path: `${nodeName}.${v.name}`,
          sourceNodeId: node.id,
          sourceNodeName: nodeName,
          sourceNodeType: 'retrieval',
          type: v.type as any,
        });
      }
    } else if (nodeDefType === 'embedding') {
      const embedVars = [
        { name: 'embeddings', label: 'Embeddings', type: 'array' },
        { name: 'dimensions', label: 'Dimensions', type: 'number' },
        { name: 'model', label: 'Embedding Model', type: 'string' },
        { name: 'artifactId', label: 'Artifact ID', type: 'string' },
      ];
      for (const v of embedVars) {
        variables.push({
          name: v.name,
          label: `${node.data?.label || nodeName} → ${v.label}`,
          path: `${nodeName}.${v.name}`,
          sourceNodeId: node.id,
          sourceNodeName: nodeName,
          sourceNodeType: 'embedding',
          type: v.type as any,
        });
      }
    } else if (nodeDefType === 'web-search') {
      const webSearchVars = [
        { name: 'results', label: 'Search Results', type: 'array' },
        { name: 'answer', label: 'Summary Answer', type: 'string' },
        { name: 'query', label: 'Search Query', type: 'string' },
        { name: 'text', label: 'Clean Text / Snippet', type: 'string' },
        { name: 'title', label: 'Top Result Title', type: 'string' },
        { name: 'url', label: 'Top Result URL', type: 'string' },
        { name: 'html', label: 'Clean HTML', type: 'string' },
        { name: 'links', label: 'Extracted Links', type: 'array' },
        { name: 'resultsCount', label: 'Results Count', type: 'number' },
        { name: 'status', label: 'HTTP Status', type: 'number' },
      ];
      for (const v of webSearchVars) {
        variables.push({
          name: v.name,
          label: `${node.data?.label || nodeName} → ${v.label}`,
          path: `${nodeName}.${v.name}`,
          sourceNodeId: node.id,
          sourceNodeName: nodeName,
          sourceNodeType: 'web-search',
          type: v.type as any,
        });
      }
    }

    // Expose the complete output of a single-output node (for example,
    // `script`) in addition to its individual output path (`script.result`).
    // This allows object payloads to be passed intact into another node.
    if (outputs.length === 1 && outputs[0].type !== 'branch') {
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
      if (output.type === 'branch') continue;
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

      // 1. Always expose the base output handle path (e.g. trigger.input, parser.value, script.result)
      // so whole object payloads can be wired or passed intact
      variables.push({
        name: output.name,
        label: output.label || output.name,
        path: basePath,
        sourceNodeId: node.id,
        sourceNodeName: nodeName,
        sourceNodeType: node.data?.definitionType || 'node',
        type: output.type || 'object',
      });

      // 2. Expose structured child variables from schema
      for (const item of subKeys) {
        // Full qualified path with output handle (e.g. trigger.input.type, trigger.input.content)
        const qualifiedPath = `${basePath}.${item.name}`;
        const qualifiedLabel = `${output.label || output.name} → ${item.name}`;

        variables.push({
          name: `${output.name}.${item.name}`,
          label: qualifiedLabel,
          path: qualifiedPath,
          sourceNodeId: node.id,
          sourceNodeName: nodeName,
          sourceNodeType: node.data?.definitionType || 'node',
          type: item.type || 'property',
        });

        // If single output (e.g. trigger, script, parser), also expose direct shortcut (e.g. trigger.type, trigger.content)
        if (isSingleOutput) {
          variables.push({
            name: item.name,
            label: `${node.data?.label || nodeName} → ${item.name}`,
            path: `${nodeName}.${item.name}`,
            sourceNodeId: node.id,
            sourceNodeName: nodeName,
            sourceNodeType: node.data?.definitionType || 'node',
            type: item.type || 'property',
          });
        }
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
