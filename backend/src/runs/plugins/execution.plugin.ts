import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';

const execFileAsync = promisify(execFile);

@Injectable()
export class ExecutionPlugin implements ToolPlugin {
  readonly toolType = 'execution';
  private readonly logger = new Logger(ExecutionPlugin.name);

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput } = ctx;
    const config: any = node?.data?.config || {};
    const command = String(config.command || nodeInput?.command || '');
    const args = Array.isArray(config.args)
      ? config.args.map(String)
      : Array.isArray(nodeInput?.args)
      ? nodeInput.args.map(String)
      : [];

    if (!command) throw new BadRequestException('execution requires command');
    const allowedCommands = Array.isArray(config.allowedCommands) ? config.allowedCommands.map(String) : [];
    if (!allowedCommands.includes(command) && !config.allowAnyCommand) {
      return {
        status: 'completed',
        result: { command, args, dryRun: true, blocked: true, reason: 'Command is not in allowedCommands' },
        command,
        args,
        dryRun: true,
        blocked: true,
      };
    }
    try {
      const result: any = await execFileAsync(command, args, {
        cwd: config.cwd,
        timeout: Number(config.timeoutMs || 1200000),
        maxBuffer: Number(config.maxBuffer || 5_000_000),
        env: config.env ? { ...process.env, ...config.env } : process.env,
      });
      return {
        status: 'completed',
        result: { command, args, exitCode: 0, stdout: result.stdout, stderr: result.stderr },
        command,
        args,
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error: any) {
      return {
        status: 'failed',
        result: { command, args, exitCode: error.code, stdout: error.stdout, stderr: error.stderr },
        error: error.message,
        command,
        args,
        exitCode: error.code,
        stdout: error.stdout,
        stderr: error.stderr,
      };
    }
  }

  getValidHandles(_config?: any, _outputs?: any[], _nodeData?: any, _nodeName?: string): Set<string> {
    return new Set(['command', 'args', 'exitCode', 'stdout', 'stderr', 'result', 'error']);
  }

  getProducedPaths(nodeName: string, _config?: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>();
    for (const key of ['command', 'args', 'exitCode', 'stdout', 'stderr', 'result', 'error']) {
      paths.add(`${nodeName}.${key}`);
    }
    return paths;
  }
}
