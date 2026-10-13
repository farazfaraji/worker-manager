import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { GithubCliService } from '../services/github-cli.service';

@Injectable()
export class GithubPlugin implements ToolPlugin {
  readonly toolType = 'github';

  constructor(@Optional() private readonly githubCli?: GithubCliService) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context } = ctx;
    if (!this.githubCli) {
      throw new BadRequestException('GitHub CLI integration is unavailable');
    }
    const config = node?.data?.config || {};
    return this.githubCli.execute({
      ...config,
      ...nodeInput,
      projectId:
        nodeInput?.projectId ??
        config.projectId ??
        context?.projectId ??
        context?.state?.projectId,
    });
  }

  getValidHandles(): Set<string> {
    return new Set(['done', 'onfailed', 'flow']);
  }

  getProducedPaths(nodeName: string): Set<string> {
    const paths = new Set<string>();
    const keys = [
      'success',
      'action',
      'command',
      'workingDirectory',
      'exitCode',
      'stdout',
      'stderr',
      'data',
      'result',
      'url',
      'number',
      'clonedPath',
      'error',
      'durationMs',
    ];
    for (const k of keys) paths.add(`${nodeName}.${k}`);
    return paths;
  }
}
