import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const JIRA_ACTIONS = [
  'issue-list',
  'issue-view',
  'issue-create',
  'issue-edit',
  'issue-move',
  'issue-assign',
  'issue-comment',
  'issue-link',
  'sprint-list',
  'epic-list',
  'me',
  'custom',
] as const;

export type JiraAction = (typeof JIRA_ACTIONS)[number];

export interface JiraCliInput {
  action?: string;
  project?: string;
  issueKey?: string;
  query?: string;
  jql?: string;
  status?: string | string[];
  issueType?: string;
  summary?: string;
  body?: string;
  assignee?: string;
  priority?: string;
  labels?: string | string[];
  components?: string | string[];
  parent?: string;
  state?: string;
  comment?: string;
  resolution?: string;
  inwardKey?: string;
  outwardKey?: string;
  linkType?: string;
  sprintScope?: string;
  sprintId?: string | number;
  sprintState?: string;
  epicKey?: string;
  limit?: number | string;
  commentsCount?: number | string;
  args?: any;
  extraArgs?: any;
  configFile?: string;
  timeoutMs?: number | string;
}

const ISSUE_KEY_PATTERN = /\b[A-Z][A-Z0-9_]+-\d+\b/;

@Injectable()
export class JiraCliService {
  private readonly logger = new Logger(JiraCliService.name);

  async run(input: JiraCliInput): Promise<Record<string, any>> {
    const action = String(input.action || 'issue-list').toLowerCase() as JiraAction;
    const args = this.buildArgs(action, input);
    const binary = process.env.JIRA_CLI_PATH || 'jira';
    const timeout = Number(input.timeoutMs) > 0 ? Number(input.timeoutMs) : 60000;
    this.logger.log(`   🎫 [Jira] ${action}: jira ${args[0]} ${args[1] || ''}`.trimEnd());

    try {
      const { stdout, stderr } = await execFileAsync(binary, args, {
        timeout,
        maxBuffer: 10_000_000,
        // Keep jira-cli non-interactive and uncolored so output is parseable.
        env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', JIRA_PAGER: 'cat', PAGER: 'cat' },
      });
      return this.normalize(action, args, true, 0, String(stdout), String(stderr));
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return this.normalize(action, args, false, null, '', `jira-cli binary "${binary}" not found. Install jira-cli or set JIRA_CLI_PATH.`);
      }
      const exitCode = typeof error?.code === 'number' ? error.code : null;
      const stderr = String(error?.stderr || '') || (error?.killed ? `jira-cli timed out after ${timeout}ms` : String(error?.message || ''));
      return this.normalize(action, args, false, exitCode, String(error?.stdout || ''), stderr);
    }
  }

  buildArgs(action: JiraAction, input: JiraCliInput): string[] {
    const str = (value: any) => (value === undefined || value === null ? '' : String(value).trim());
    const list = (value: any): string[] =>
      (Array.isArray(value) ? value : str(value).split(','))
        .map((item) => str(item))
        .filter(Boolean);
    const require = (value: any, field: string) => {
      const v = str(value);
      if (!v) throw new BadRequestException(`Jira action "${action}" requires ${field}`);
      return v;
    };
    const flag = (args: string[], name: string, value: any) => {
      const v = str(value);
      if (v) args.push(name, v);
    };
    const multiFlag = (args: string[], name: string, value: any) => {
      for (const v of list(value)) args.push(name, v);
    };
    const paginate = (args: string[]) => {
      const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
      args.push('--paginate', `0:${limit}`);
    };

    let args: string[];
    switch (action) {
      case 'issue-list':
        args = ['issue', 'list'];
        if (str(input.query)) args.push(str(input.query));
        flag(args, '--jql', input.jql);
        multiFlag(args, '--status', input.status);
        flag(args, '--type', input.issueType);
        flag(args, '--assignee', input.assignee);
        flag(args, '--priority', input.priority);
        multiFlag(args, '--label', input.labels);
        flag(args, '--parent', input.parent);
        paginate(args);
        args.push('--raw');
        break;
      case 'issue-view':
        args = ['issue', 'view', require(input.issueKey, 'issueKey'), '--raw'];
        flag(args, '--comments', input.commentsCount);
        break;
      case 'issue-create':
        args = ['issue', 'create', '--no-input', '--raw'];
        args.push('--type', require(input.issueType, 'issueType'));
        args.push('--summary', require(input.summary, 'summary'));
        flag(args, '--body', input.body);
        flag(args, '--assignee', input.assignee);
        flag(args, '--priority', input.priority);
        flag(args, '--parent', input.parent);
        multiFlag(args, '--label', input.labels);
        multiFlag(args, '--component', input.components);
        break;
      case 'issue-edit':
        args = ['issue', 'edit', require(input.issueKey, 'issueKey'), '--no-input'];
        flag(args, '--summary', input.summary);
        flag(args, '--body', input.body);
        flag(args, '--assignee', input.assignee);
        flag(args, '--priority', input.priority);
        flag(args, '--parent', input.parent);
        multiFlag(args, '--label', input.labels);
        multiFlag(args, '--component', input.components);
        break;
      case 'issue-move':
        args = ['issue', 'move', require(input.issueKey, 'issueKey'), require(input.state, 'state')];
        flag(args, '--comment', input.comment);
        flag(args, '--assignee', input.assignee);
        flag(args, '--resolution', input.resolution);
        break;
      case 'issue-assign':
        args = ['issue', 'assign', require(input.issueKey, 'issueKey'), require(input.assignee, 'assignee')];
        break;
      case 'issue-comment':
        args = ['issue', 'comment', 'add', require(input.issueKey, 'issueKey'), require(input.body, 'body'), '--no-input'];
        break;
      case 'issue-link':
        args = ['issue', 'link', require(input.inwardKey, 'inwardKey'), require(input.outwardKey, 'outwardKey'), require(input.linkType, 'linkType')];
        break;
      case 'sprint-list': {
        const scope = str(input.sprintScope) || 'current';
        args = ['sprint', 'list'];
        if (scope === 'sprints') {
          args.push('--table', '--plain');
          flag(args, '--state', input.sprintState);
        } else {
          if (scope === 'id') args.push(require(input.sprintId, 'sprintId'));
          else if (['current', 'prev', 'next'].includes(scope)) args.push(`--${scope}`);
          flag(args, '--jql', input.jql);
          paginate(args);
          args.push('--raw');
        }
        break;
      }
      case 'epic-list':
        args = ['epic', 'list'];
        if (str(input.epicKey)) args.push(str(input.epicKey));
        else args.push('--table');
        flag(args, '--jql', input.jql);
        multiFlag(args, '--status', input.status);
        flag(args, '--assignee', input.assignee);
        flag(args, '--priority', input.priority);
        multiFlag(args, '--label', input.labels);
        paginate(args);
        args.push(str(input.epicKey) ? '--raw' : '--plain');
        break;
      case 'me':
        args = ['me'];
        break;
      case 'custom': {
        const raw = typeof input.args === 'string' ? this.parseJsonArray(input.args, 'args') : input.args;
        if (!Array.isArray(raw) || raw.length === 0) throw new BadRequestException('Jira custom action requires a non-empty args array');
        args = raw.map((item) => String(item));
        if (args[0] === 'jira') args = args.slice(1);
        break;
      }
      default:
        throw new BadRequestException(`Unsupported Jira action "${action}". Supported: ${JIRA_ACTIONS.join(', ')}`);
    }

    if (action !== 'custom') {
      const extra = typeof input.extraArgs === 'string' ? this.parseJsonArray(input.extraArgs, 'extraArgs') : input.extraArgs;
      if (Array.isArray(extra)) args.push(...extra.map((item) => String(item)));
      if (action !== 'me') flag(args, '--project', input.project);
    }
    flag(args, '--config', input.configFile);
    return args;
  }

  private parseJsonArray(value: string, field: string): any[] | undefined {
    if (!value.trim()) return undefined;
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      return parsed;
    } catch {
      throw new BadRequestException(`Jira ${field} must be a JSON array of strings`);
    }
  }

  private normalize(action: string, args: string[], ok: boolean, exitCode: number | null, stdout: string, stderr: string) {
    let data: any = null;
    const trimmed = stdout.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { data = JSON.parse(trimmed); } catch {}
    }
    const issues = Array.isArray(data) ? data : Array.isArray(data?.issues) ? data.issues : undefined;
    const issueKey = (data && !Array.isArray(data) && data.key) || stdout.match(ISSUE_KEY_PATTERN)?.[0] || '';
    const result = {
      ok,
      action,
      args,
      exitCode,
      stdout,
      stderr,
      text: trimmed,
      data,
      issues: issues || [],
      count: issues ? issues.length : undefined,
      issueKey,
      error: ok ? undefined : stderr.trim() || `jira-cli exited with code ${exitCode}`,
    };
    return { ...result, status: ok ? 'completed' : 'failed', result };
  }
}
