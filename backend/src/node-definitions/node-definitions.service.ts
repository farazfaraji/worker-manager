import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface ToolInputOption {
  label: string;
  value: any;
}

export interface ToolInput {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  defaultValue?: any;
  placeholder?: string;
  options?: ToolInputOption[];
  language?: string;
  helpText?: string;
  accepts?: string[];
  dependsOn?: {
    field: string;
    equals: any;
  };
  dataSource?: {
    type: string;
    url: string;
    labelKey: string;
    valueKey: string;
  };
}

export interface ToolOutput {
  name: string;
  label: string;
  type: string;
  schemaFrom?: string;
  dependsOn?: {
    field: string;
    equals?: any;
    notEquals?: any;
  };
}

export interface ToolActionDefinition {
  type: string;
  name: string;
  description?: string;
  inputs: ToolInput[];
  outputs: ToolOutput[];
}

export interface NodeDefinition {
  id: string;
  name: string;
  type: string;
  description: string;
  category: 'Flow' | 'Agent' | 'Function' | 'App' | 'Logic' | 'Control' | 'Knowledge' | 'Artifact' | 'Execution' | 'Integration';
  inputs: ToolInput[];
  outputs: ToolOutput[];
  actionDefinitions?: ToolActionDefinition[];
}

@Injectable()
export class NodeDefinitionsService {
  private readonly logger = new Logger(NodeDefinitionsService.name);

  private getCategory(type: string): 'Flow' | 'Agent' | 'Function' | 'App' | 'Logic' | 'Control' | 'Knowledge' | 'Artifact' | 'Execution' | 'Integration' {
    switch (type.toLowerCase()) {
      case 'trigger':
      case 'subgraph':
      case 'route':
        return 'Flow';
      case 'agent':
        return 'Agent';
      case 'function':
      case 'transform':
      case 'variable':
      case 'set-variable':
      case 'increment':
      case 'decrement':
      case 'increment-variable':
      case 'decrement-variable':
      case 'script':
        return 'Function';
      case 'app':
      case 'browser':
      case 'brower':
        return 'App';
      case 'condition':
      case 'validator':
      case 'research-review':
        return 'Logic';
      case 'memory':
      case 'retrieval':
        return 'Knowledge';
      case 'artifact':
        return 'Artifact';
      case 'execution':
      case 'repo-inspect':
        return 'Execution';
      case 'action':
      case 'web-search':
      case 'websearch':
      case 'web_search':
      case 'webserver':
      case 'http-response':
      case 'httpresponse':
      case 'telegram':
        return 'Integration';
      case 'orchestrator':
      case 'delegator':
      case 'human-gate':
      case 'router':
      case 'output':
      case 'loop':
      case 'foreach':
      case 'aggregate':
      case 'notification':
        return 'Control';
      default:
        return 'Function';
    }
  }

  async getAllDefinitions(): Promise<NodeDefinition[]> {
    const searchPaths = [
      path.resolve(process.cwd(), 'src', 'tools'),
      path.resolve(__dirname, '..', 'tools'),
      path.resolve(process.cwd(), 'backend', 'src', 'tools'),
    ];

    let toolsDir = '';
    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        toolsDir = p;
        break;
      }
    }

    if (!toolsDir) {
      this.logger.warn('Tools directory not found in candidate paths');
      return [];
    }

    const files = fs.readdirSync(toolsDir).filter((f) => f.endsWith('.json'));
    const definitions: NodeDefinition[] = [];

    for (const file of files) {
      try {
        const filePath = path.join(toolsDir, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const json = JSON.parse(raw);

        const id = path.basename(file, '.json');
        definitions.push({
          id,
          name: json.name || id,
          type: json.type || 'function',
          description: json.description || '',
          category: this.getCategory(json.type || ''),
          inputs: json.inputs || [],
          outputs: json.outputs || [],
          actionDefinitions: json.actionDefinitions || [],
        });
      } catch (err) {
        this.logger.error(`Failed to parse tool definition file ${file}:`, err);
      }
    }

    return definitions;
  }

  async getAgentsList() {
    return [
      { id: 'agent-1', name: 'UI Reviewer Agent', role: 'Reviewer' },
      { id: 'agent-2', name: 'Data Extractor Agent', role: 'Extractor' },
      { id: 'agent-3', name: 'Coding Assistant Agent', role: 'Assistant' },
    ];
  }
}
