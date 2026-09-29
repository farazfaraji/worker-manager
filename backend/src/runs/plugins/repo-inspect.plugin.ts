import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { RepoInspectorService } from '../services/repo-inspector.service';

@Injectable()
export class RepoInspectPlugin implements ToolPlugin {
  readonly toolType = 'repo-inspect';

  constructor(@Optional() private readonly repoInspector?: RepoInspectorService) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context } = ctx;
    const config = node?.data?.config || {};

    if (!this.repoInspector) {
      throw new BadRequestException('Repository Inspector is unavailable');
    }

    const resolvedProjectId =
      nodeInput?.projectId ??
      config.projectId ??
      context?.projectId ??
      context?.state?.projectId;

    return {
      result: await this.repoInspector.inspect({
        provider: nodeInput?.provider ?? config.provider,
        repositoryPath: nodeInput?.repositoryPath ?? config.repositoryPath,
        model: nodeInput?.model ?? config.model,
        timeoutMs: nodeInput?.timeoutMs ?? config.timeoutMs,
        ...nodeInput,
        prompt: nodeInput?.prompt ?? config.prompt,
        projectId: resolvedProjectId,
      }),
    };
  }
}
