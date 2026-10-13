import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { spawn } from 'child_process';
import { realpath, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, isAbsolute, relative, resolve, sep } from 'path';
import { Model, isValidObjectId } from 'mongoose';
import { Project, ProjectDocument } from '../../projects/schemas/project.schema';

export const GITHUB_ACTIONS = [
  'pr-create', 'pr-view', 'pr-list', 'pr-diff', 'pr-checks', 'pr-comment', 'pr-review', 'pr-merge', 'pr-checkout', 'pr-close',
  'repo-clone', 'repo-view',
  'issue-create', 'issue-view', 'issue-list', 'issue-comment',
  'run-list', 'run-view',
  'api', 'custom',
] as const;

export type GithubAction = (typeof GITHUB_ACTIONS)[number];

export interface GithubCliInput {
  action?: string;
  projectId?: string;
  repo?: string;
  workingDirectory?: string;
  number?: string | number;
  runId?: string | number;
  title?: string;
  body?: string;
  base?: string;
  head?: string;
  draft?: boolean | string;
  labels?: string;
  reviewers?: string;
  assignees?: string;
  state?: string;
  search?: string;
  branch?: string;
  workflow?: string;
  limit?: number | string;
  reviewType?: string;
  mergeMethod?: string;
  autoMerge?: boolean | string;
  deleteBranch?: boolean | string;
  cloneDirectory?: string;
  cloneDepth?: number | string;
  apiEndpoint?: string;
  apiMethod?: string;
  apiBody?: unknown;
  args?: string;
  extraArgs?: string;
  timeoutMs?: number | string;
  failOnError?: boolean | string;
}

const PR_FIELDS = 'number,title,body,state,url,author,headRefName,baseRefName,isDraft,mergeable,mergeStateStatus,reviewDecision,labels,assignees,additions,deletions,changedFiles,files,commits,comments,reviews,createdAt,updatedAt,mergedAt,closedAt';
const PR_LIST_FIELDS = 'number,title,state,url,author,headRefName,baseRefName,isDraft,labels,reviewDecision,createdAt,updatedAt';
const ISSUE_FIELDS = 'number,title,body,state,url,author,labels,assignees,comments,createdAt,updatedAt,closedAt';
const ISSUE_LIST_FIELDS = 'number,title,state,url,author,labels,assignees,createdAt,updatedAt';
const REPO_FIELDS = 'name,nameWithOwner,description,url,sshUrl,defaultBranchRef,visibility,isPrivate,isFork,isArchived,stargazerCount,forkCount,primaryLanguage,updatedAt';
const RUN_LIST_FIELDS = 'databaseId,name,displayTitle,workflowName,status,conclusion,headBranch,headSha,event,url,createdAt,updatedAt';
const RUN_FIELDS = `${RUN_LIST_FIELDS},jobs`;
const CHECK_FIELDS = 'name,state,bucket,workflow,description,link,startedAt,completedAt';

/** Actions that need a real local checkout rather than a scratch directory. */
const LOCAL_ACTIONS = new Set<string>(['repo-clone', 'pr-checkout']);
const MAX_OUTPUT_BYTES = 2_000_000;

@Injectable()
export class GithubCliService {
  private readonly logger = new Logger(GithubCliService.name);

  constructor(@InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>) {}

  async execute(input: GithubCliInput): Promise<Record<string, any>> {
    const action = String(input.action || 'pr-view').trim().toLowerCase() as GithubAction;
    if (!GITHUB_ACTIONS.includes(action)) {
      throw new BadRequestException(`GitHub CLI action "${action}" is not supported`);
    }
    const failOnError = !this.isFalse(input.failOnError);
    const startedAt = Date.now();
    let command = '';
    let workingDirectory = '';

    try {
      const { cwd, allowedRoots } = await this.resolveWorkingDirectory(input, action);
      workingDirectory = cwd;
      const { args, stdin, clonePath } = await this.buildArgs(action, input, cwd, allowedRoots);
      command = ['gh', ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
      const timeoutMs = Math.min(900000, Math.max(1000, Number(input.timeoutMs || 120000)));
      this.logger.log(`   🐙 [GitHub CLI] ${action} in ${cwd}: ${this.redact(command).slice(0, 300)}`);

      const { stdout, stderr, exitCode } = await this.runGh(args, cwd, timeoutMs, stdin);
      const output = this.redact(stdout).trim();
      const errorText = this.redact(stderr).trim();
      if (exitCode !== 0) {
        throw new GithubCommandError(errorText || output || `gh exited with code ${exitCode}`, exitCode, output, errorText);
      }

      const data = this.parseJson(output);
      const url = (typeof data?.url === 'string' && data.url) || this.extractUrl(output) || this.extractUrl(errorText);
      const number = (typeof data?.number === 'number' ? data.number : undefined) ?? this.extractNumber(url);
      return {
        success: true,
        action,
        command: this.redact(command),
        workingDirectory,
        exitCode,
        stdout: output.slice(0, 200000),
        stderr: errorText.slice(0, 20000),
        data,
        result: data ?? output.slice(0, 200000),
        url: url || null,
        number: number ?? null,
        ...(clonePath ? { clonedPath: clonePath } : {}),
        error: null,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`   🐙 [GitHub CLI] ${action} failed: ${message.slice(0, 500)}`);
      if (failOnError) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException(`GitHub CLI ${action} failed: ${message.slice(0, 2000)}`);
      }
      const commandError = error instanceof GithubCommandError ? error : null;
      return {
        success: false,
        action,
        command: this.redact(command),
        workingDirectory,
        exitCode: commandError?.exitCode ?? null,
        stdout: commandError?.stdout.slice(0, 200000) ?? '',
        stderr: commandError?.stderr.slice(0, 20000) ?? '',
        data: null,
        result: null,
        url: null,
        number: null,
        error: message.slice(0, 2000),
        durationMs: Date.now() - startedAt,
      };
    }
  }

  private async buildArgs(
    action: GithubAction,
    input: GithubCliInput,
    cwd: string,
    allowedRoots: string[],
  ): Promise<{ args: string[]; stdin?: string; clonePath?: string }> {
    const repo = this.str(input.repo);
    const ref = this.str(input.number);
    const repoFlag = repo ? ['--repo', this.assertRepo(repo)] : [];
    const refArg = ref ? [ref] : [];
    const limit = String(Math.min(200, Math.max(1, Number(input.limit || 30))));
    const extra = action === 'custom' ? [] : this.splitArgs(this.str(input.extraArgs));
    const csv = (value: unknown, flag: string) =>
      this.str(value).split(',').map((item) => item.trim()).filter(Boolean).flatMap((item) => [flag, item]);
    const requireText = (value: unknown, label: string) => {
      const text = this.str(value);
      if (!text) throw new BadRequestException(`GitHub CLI ${action} requires ${label}`);
      return text;
    };

    switch (action) {
      case 'pr-create': {
        const args = ['pr', 'create', ...repoFlag, '--title', requireText(input.title, 'a title'), '--body', this.str(input.body)];
        if (this.str(input.base)) args.push('--base', this.str(input.base));
        if (this.str(input.head)) args.push('--head', this.str(input.head));
        if (this.isTrue(input.draft)) args.push('--draft');
        args.push(...csv(input.labels, '--label'), ...csv(input.reviewers, '--reviewer'), ...csv(input.assignees, '--assignee'));
        return { args: [...args, ...extra] };
      }
      case 'pr-view':
        return { args: ['pr', 'view', ...refArg, ...repoFlag, '--json', PR_FIELDS, ...extra] };
      case 'pr-list': {
        const args = ['pr', 'list', ...repoFlag, '--state', this.oneOf(input.state, ['open', 'closed', 'merged', 'all'], 'open'), '--limit', limit, '--json', PR_LIST_FIELDS];
        if (this.str(input.base)) args.push('--base', this.str(input.base));
        if (this.str(input.head)) args.push('--head', this.str(input.head));
        if (this.str(input.search)) args.push('--search', this.str(input.search));
        args.push(...csv(input.labels, '--label'));
        if (this.str(input.assignees)) args.push('--assignee', this.str(input.assignees).split(',')[0].trim());
        return { args: [...args, ...extra] };
      }
      case 'pr-diff':
        return { args: ['pr', 'diff', ...refArg, ...repoFlag, '--color', 'never', ...extra] };
      case 'pr-checks':
        return { args: ['pr', 'checks', ...refArg, ...repoFlag, '--json', CHECK_FIELDS, ...extra] };
      case 'pr-comment':
        return { args: ['pr', 'comment', ...refArg, ...repoFlag, '--body', requireText(input.body, 'a comment body'), ...extra] };
      case 'pr-review': {
        const type = this.oneOf(input.reviewType, ['comment', 'approve', 'request-changes'], 'comment');
        const body = this.str(input.body);
        if (type !== 'approve' && !body) throw new BadRequestException(`GitHub CLI pr-review (${type}) requires a body`);
        return { args: ['pr', 'review', ...refArg, ...repoFlag, `--${type}`, ...(body ? ['--body', body] : []), ...extra] };
      }
      case 'pr-merge': {
        const method = this.oneOf(input.mergeMethod, ['squash', 'merge', 'rebase'], 'squash');
        const args = ['pr', 'merge', ...refArg, ...repoFlag, `--${method}`];
        if (this.isTrue(input.autoMerge)) args.push('--auto');
        if (this.isTrue(input.deleteBranch)) args.push('--delete-branch');
        return { args: [...args, ...extra] };
      }
      case 'pr-checkout':
        if (!ref) throw new BadRequestException('GitHub CLI pr-checkout requires a PR number, URL or branch');
        return { args: ['pr', 'checkout', ref, ...repoFlag, ...extra] };
      case 'pr-close': {
        const args = ['pr', 'close', ...refArg, ...repoFlag];
        if (this.str(input.body)) args.push('--comment', this.str(input.body));
        if (this.isTrue(input.deleteBranch)) args.push('--delete-branch');
        return { args: [...args, ...extra] };
      }
      case 'repo-clone': {
        const source = this.assertRepo(requireText(input.repo, 'a repository'));
        const defaultName = basename(source.replace(/\.git$/, '').replace(/\/+$/, ''));
        const target = resolve(cwd, this.str(input.cloneDirectory) || defaultName);
        if (!allowedRoots.some((root) => this.isWithin(root, target))) {
          throw new BadRequestException('Clone directory is outside the allowed repository roots');
        }
        const depth = Number(input.cloneDepth);
        const gitFlags = Number.isFinite(depth) && depth > 0 ? ['--', '--depth', String(Math.floor(depth))] : [];
        return { args: ['repo', 'clone', source, target, ...gitFlags], clonePath: target };
      }
      case 'repo-view':
        return { args: ['repo', 'view', ...(repo ? [this.assertRepo(repo)] : []), '--json', REPO_FIELDS, ...extra] };
      case 'issue-create': {
        const args = ['issue', 'create', ...repoFlag, '--title', requireText(input.title, 'a title'), '--body', this.str(input.body)];
        args.push(...csv(input.labels, '--label'), ...csv(input.assignees, '--assignee'));
        return { args: [...args, ...extra] };
      }
      case 'issue-view':
        return { args: ['issue', 'view', requireText(input.number, 'an issue number'), ...repoFlag, '--json', ISSUE_FIELDS, ...extra] };
      case 'issue-list': {
        const args = ['issue', 'list', ...repoFlag, '--state', this.oneOf(input.state, ['open', 'closed', 'all'], 'open'), '--limit', limit, '--json', ISSUE_LIST_FIELDS];
        if (this.str(input.search)) args.push('--search', this.str(input.search));
        args.push(...csv(input.labels, '--label'));
        if (this.str(input.assignees)) args.push('--assignee', this.str(input.assignees).split(',')[0].trim());
        return { args: [...args, ...extra] };
      }
      case 'issue-comment':
        return { args: ['issue', 'comment', requireText(input.number, 'an issue number'), ...repoFlag, '--body', requireText(input.body, 'a comment body'), ...extra] };
      case 'run-list': {
        const args = ['run', 'list', ...repoFlag, '--limit', limit, '--json', RUN_LIST_FIELDS];
        if (this.str(input.branch)) args.push('--branch', this.str(input.branch));
        if (this.str(input.workflow)) args.push('--workflow', this.str(input.workflow));
        return { args: [...args, ...extra] };
      }
      case 'run-view':
        return { args: ['run', 'view', requireText(input.runId, 'a workflow run ID'), ...repoFlag, '--json', RUN_FIELDS, ...extra] };
      case 'api': {
        const endpoint = requireText(input.apiEndpoint, 'an API endpoint').replace(/^\/+/, '');
        if (/^https?:\/\//i.test(endpoint)) throw new BadRequestException('GitHub CLI api endpoint must be a relative REST path');
        const method = this.oneOf(String(input.apiMethod || 'GET').toUpperCase(), ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], 'GET');
        const args = ['api', endpoint, '--method', method];
        const body = input.apiBody;
        const hasBody = body !== undefined && body !== null && body !== '';
        let stdin: string | undefined;
        if (hasBody) {
          stdin = typeof body === 'string' ? body : JSON.stringify(body);
          try { JSON.parse(stdin); } catch { throw new BadRequestException('GitHub CLI api request body must be valid JSON'); }
          args.push('--input', '-');
        }
        return { args: [...args, ...extra], stdin };
      }
      case 'custom': {
        const args = this.splitArgs(requireText(input.args, 'gh arguments'));
        if (args[0] === 'gh') args.shift();
        this.assertSafeCustomArgs(args);
        return { args };
      }
    }
  }

  /**
   * Picks the directory gh runs in. Mirrors the Repository Inspector's rules:
   * the project's repositoryPath and allowedRepositoryRoots bound what a node may touch.
   */
  private async resolveWorkingDirectory(input: GithubCliInput, action: string): Promise<{ cwd: string; allowedRoots: string[] }> {
    const projectId = this.str(input.projectId);
    const project = projectId && isValidObjectId(projectId)
      ? await this.projectModel.findById(projectId).lean().exec()
      : null;
    const projectPath = this.str(project?.metadata?.repositoryPath);
    const extraRoots = Array.isArray(project?.metadata?.allowedRepositoryRoots) ? project.metadata.allowedRepositoryRoots : [];
    const configuredRoots = [...new Set([...(projectPath ? [projectPath] : []), ...extraRoots])]
      .filter((root): root is string => typeof root === 'string' && isAbsolute(root));
    const allowedRoots = (await Promise.all(configuredRoots.map((root) => realpath(root).catch(() => null))))
      .filter((root): root is string => Boolean(root));

    const override = this.str(input.workingDirectory);
    const rawPath = override || projectPath;
    if (!rawPath) {
      if (LOCAL_ACTIONS.has(action)) {
        throw new BadRequestException(`GitHub CLI ${action} requires a repositoryPath in project settings or a working directory override`);
      }
      // Remote-only actions (e.g. with --repo) can run anywhere; use a neutral scratch directory.
      return { cwd: await realpath(tmpdir()), allowedRoots };
    }
    if (!isAbsolute(rawPath)) throw new BadRequestException('GitHub CLI working directory must be an absolute path');
    const cwd = await realpath(rawPath).catch(() => {
      throw new BadRequestException('GitHub CLI working directory does not exist');
    });
    if (!(await stat(cwd)).isDirectory()) throw new BadRequestException('GitHub CLI working directory must be a directory');
    if (override && allowedRoots.length > 0 && !allowedRoots.some((root) => this.isWithin(root, cwd))) {
      throw new BadRequestException('GitHub CLI working directory is outside the project\'s allowed repository roots');
    }
    return { cwd, allowedRoots: allowedRoots.length > 0 ? allowedRoots : [cwd] };
  }

  private runGh(args: string[], cwd: string, timeoutMs: number, stdin?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      GH_CONFIG_DIR: process.env.GH_CONFIG_DIR,
      GH_HOST: process.env.GH_HOST,
      GH_ENTERPRISE_TOKEN: process.env.GH_ENTERPRISE_TOKEN,
      GH_TOKEN: process.env.GH_TOKEN,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
      GH_PROMPT_DISABLED: '1',
      GH_NO_UPDATE_NOTIFIER: '1',
      GH_PAGER: 'cat',
      GIT_TERMINAL_PROMPT: '0',
      NO_COLOR: '1',
    };
    for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
    const binary = process.env.GH_CLI_BIN || 'gh';

    return new Promise((resolvePromise, reject) => {
      const child = spawn(binary, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);
      child.stdout.on('data', (chunk) => { if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk; });
      child.stderr.on('data', (chunk) => { if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk; });
      child.on('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(error.code === 'ENOENT'
          ? new BadRequestException('GitHub CLI (gh) is not installed or not on PATH. Set GH_CLI_BIN to its location.')
          : error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new GithubCommandError(`gh timed out after ${timeoutMs}ms`, code ?? -1, this.redact(stdout), this.redact(stderr)));
          return;
        }
        resolvePromise({ stdout, stderr, exitCode: code ?? -1 });
      });
      child.stdin.end(stdin ?? '');
    });
  }

  private assertSafeCustomArgs(args: string[]): void {
    if (args.length === 0) throw new BadRequestException('GitHub CLI custom command requires arguments');
    const [group, sub] = args;
    if (group === 'auth' && (sub !== 'status' || args.some((arg) => arg === '--show-token' || arg === '-t'))) {
      throw new BadRequestException('GitHub CLI custom command may not run gh auth subcommands other than "auth status"');
    }
    if (group === 'extension' || group === 'ext' || group === 'alias') {
      throw new BadRequestException(`GitHub CLI custom command may not run "gh ${group}"`);
    }
  }

  private assertRepo(repo: string): string {
    const value = repo.trim();
    const isSlug = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+){1,2}$/.test(value);
    const isUrl = /^(https:\/\/|git@)[^\s]+$/i.test(value);
    if (!isSlug && !isUrl) throw new BadRequestException(`GitHub CLI repository "${value}" must be OWNER/REPO or a GitHub URL`);
    return value;
  }

  /** Splits an argument string like a POSIX shell would, without evaluating anything. */
  private splitArgs(text: string): string[] {
    const args: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let hasToken = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === quote) quote = null;
        else if (ch === '\\' && quote === '"' && i + 1 < text.length) current += text[++i];
        else current += ch;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        hasToken = true;
      } else if (ch === '\\' && i + 1 < text.length) {
        current += text[++i];
        hasToken = true;
      } else if (/\s/.test(ch)) {
        if (hasToken) args.push(current);
        current = '';
        hasToken = false;
      } else {
        current += ch;
        hasToken = true;
      }
    }
    if (quote) throw new BadRequestException('GitHub CLI arguments contain an unterminated quote');
    if (hasToken) args.push(current);
    return args;
  }

  private parseJson(text: string): any {
    if (!text || !/^[[{]/.test(text)) return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  private extractUrl(text: string): string | undefined {
    return text.match(/https:\/\/[^\s]+\/(?:pull|issues)\/\d+/)?.[0];
  }

  private extractNumber(url?: string | null): number | undefined {
    const match = url?.match(/\/(?:pull|issues)\/(\d+)/);
    return match ? Number(match[1]) : undefined;
  }

  private redact(text: string): string {
    return String(text || '')
      .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED]')
      .replace(/(https:\/\/)[^\s/@]+@/g, '$1[REDACTED]@');
  }

  private isWithin(root: string, candidate: string): boolean {
    const path = relative(root, candidate);
    return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
  }

  private oneOf(value: unknown, allowed: string[], fallback: string): string {
    const text = this.str(value).toLowerCase();
    const match = allowed.find((item) => item.toLowerCase() === text);
    return match ?? fallback;
  }

  private str(value: unknown): string {
    if (value === undefined || value === null) return '';
    return String(value).trim();
  }

  private isTrue(value: unknown): boolean {
    return value === true || value === 'true';
  }

  private isFalse(value: unknown): boolean {
    return value === false || value === 'false';
  }
}

class GithubCommandError extends Error {
  constructor(message: string, readonly exitCode: number, readonly stdout: string, readonly stderr: string) {
    super(message);
  }
}
