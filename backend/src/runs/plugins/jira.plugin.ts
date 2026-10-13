import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { JiraCliService } from '../services/jira-cli.service';

@Injectable()
export class JiraPlugin implements ToolPlugin {
  readonly toolType = 'jira';

  constructor(@Optional() private readonly jiraCli?: JiraCliService) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput } = ctx;
    if (!this.jiraCli) {
      throw new BadRequestException('Jira CLI integration is unavailable');
    }
    const config = node?.data?.config || {};
    return this.jiraCli.run({ ...config, ...nodeInput });
  }

  getValidHandles(): Set<string> {
    return new Set(['done', 'onfailed', 'flow', 'result']);
  }

  getProducedPaths(nodeName: string): Set<string> {
    const paths = new Set<string>();
    const keys = [
      'ok',
      'action',
      'args',
      'exitCode',
      'stdout',
      'stderr',
      'text',
      'data',
      'issues',
      'count',
      'issueKey',
      'error',
      'status',
      'result',
    ];
    for (const k of keys) paths.add(`${nodeName}.${k}`);
    return paths;
  }
}
