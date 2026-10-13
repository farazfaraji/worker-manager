import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Subscription providers: instead of calling an HTTP API with a token, the prompt is sent through the
 * vendor's official CLI in headless mode. The CLI uses the login already saved on this machine
 * (`codex login`, `claude` /login, `cursor-agent login`, `agy`), so no credentials are stored here.
 */
export const CLI_PROVIDER_IDS = ['codex', 'claude-code', 'cursor', 'antigravity'] as const;
export type CliProviderId = (typeof CLI_PROVIDER_IDS)[number];

export const isCliProvider = (provider?: string | null): provider is CliProviderId =>
  CLI_PROVIDER_IDS.includes(String(provider || '').toLowerCase() as CliProviderId);

export interface CliCompletionRequest {
  provider: CliProviderId;
  /** Passed to the CLI exactly as entered in Settings -> Models. */
  modelId: string;
  system?: string;
  prompt: string;
  /** low | medium | high | ... ('default' / empty = the CLI's own default). */
  reasoningEffort?: string;
  /** Optional absolute path to the CLI binary (default: looked up on PATH). */
  cliPath?: string;
  signal?: AbortSignal;
}

export interface CliUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  reasoningTokens: number;
}

export interface CliCompletionResult {
  text: string;
  usage?: CliUsage;
  binary: string;
  durationMs: number;
}

interface CliInvocation {
  args: string[];
  stdin?: string;
}

interface CliAdapter {
  label: string;
  defaultBinary: string;
  loginHint: string;
  build(req: CliCompletionRequest, workDir: string, outputFile: string): CliInvocation;
  parse(stdout: string, outputFileContent: string): { text: string; usage?: CliUsage };
}

// API keys in the backend environment would make the CLIs bill the API instead of the subscription.
const STRIPPED_ENV_VARS = [
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CURSOR_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'CLAUDECODE',
];

const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const AUTH_ERROR_PATTERN = /not (logged|signed) in|log ?in|authenticat|unauthori[sz]ed|credentials|401/i;

const emptyUsage = (): CliUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  reasoningTokens: 0,
});

/** For CLIs without a system-prompt flag the instructions are sent as a delimited preamble. */
const combinePrompt = (system: string | undefined, prompt: string) =>
  system?.trim() ? `<system_instructions>\n${system.trim()}\n</system_instructions>\n\n${prompt}` : prompt;

const normalizeEffort = (effort?: string): string | undefined => {
  const e = String(effort || '').trim().toLowerCase();
  if (!e || e === 'default' || e === 'model_default') return undefined;
  return /^[a-z]+$/.test(e) ? e : undefined;
};

const tryParseJson = (text: string): any => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const ADAPTERS: Record<CliProviderId, CliAdapter> = {
  // codex exec: https://developers.openai.com/codex/noninteractive
  codex: {
    label: 'Codex',
    defaultBinary: 'codex',
    loginHint: 'Run `codex login` in a terminal (as the same user that runs the backend).',
    build(req, workDir, outputFile) {
      const raw = normalizeEffort(req.reasoningEffort);
      const effort = raw === 'max' ? 'xhigh' : raw;
      return {
        args: [
          'exec',
          '--json',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '-C',
          workDir,
          '--output-last-message',
          outputFile,
          ...(req.modelId ? ['-m', req.modelId] : []),
          ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []),
          '-',
        ],
        stdin: combinePrompt(req.system, req.prompt),
      };
    },
    parse(stdout, outputFileContent) {
      const usage = emptyUsage();
      let lastMessage = '';
      for (const line of stdout.split('\n')) {
        const event = tryParseJson(line.trim());
        if (!event || typeof event !== 'object') continue;
        if (event.type === 'error' || event.type === 'turn.failed') {
          throw new Error(event.message || event.error?.message || 'Codex reported an error');
        }
        if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
          lastMessage = event.item.text || lastMessage;
        }
        if (event.type === 'turn.completed' && event.usage) {
          usage.inputTokens += Number(event.usage.input_tokens) || 0;
          usage.cachedInputTokens += Number(event.usage.cached_input_tokens) || 0;
          usage.outputTokens += Number(event.usage.output_tokens) || 0;
          usage.reasoningTokens += Number(event.usage.reasoning_output_tokens) || 0;
        }
      }
      return { text: outputFileContent.trim() || lastMessage, usage };
    },
  },

  // claude -p: https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-headless
  'claude-code': {
    label: 'Claude Code',
    defaultBinary: 'claude',
    loginHint: 'Run `claude` in a terminal and complete /login (as the same user that runs the backend).',
    build(req) {
      const raw = normalizeEffort(req.reasoningEffort);
      const effort = raw === 'none' || raw === 'minimal' ? 'low' : raw;
      return {
        args: [
          '-p',
          '--output-format',
          'json',
          '--no-session-persistence',
          '--strict-mcp-config',
          ...(req.modelId ? ['--model', req.modelId] : []),
          ...(req.system?.trim() ? ['--system-prompt', req.system] : []),
          ...(effort ? ['--effort', effort] : []),
          '--tools',
          '',
        ],
        stdin: req.prompt,
      };
    },
    parse(stdout) {
      const json = tryParseJson(stdout.trim());
      if (!json || typeof json !== 'object') return { text: stdout.trim() };
      if (json.is_error) throw new Error(String(json.result || json.subtype || 'Claude Code reported an error'));
      const u = json.usage || {};
      const cacheRead = Number(u.cache_read_input_tokens) || 0;
      const cacheWrite = Number(u.cache_creation_input_tokens) || 0;
      return {
        text: typeof json.result === 'string' ? json.result : JSON.stringify(json.result ?? ''),
        usage: {
          inputTokens: (Number(u.input_tokens) || 0) + cacheRead + cacheWrite,
          outputTokens: Number(u.output_tokens) || 0,
          cachedInputTokens: cacheRead,
          cacheWriteInputTokens: cacheWrite,
          reasoningTokens: 0,
        },
      };
    },
  },

  // cursor-agent -p (read-only "ask" mode)
  cursor: {
    label: 'Cursor',
    defaultBinary: 'cursor-agent',
    loginHint: 'Run `cursor-agent login` in a terminal (as the same user that runs the backend).',
    build(req, workDir) {
      const raw = normalizeEffort(req.reasoningEffort);
      const effort = raw === 'none' || raw === 'minimal' ? 'low' : raw;
      // Parameterized models take overrides in brackets, e.g. 'gpt-5[effort=high]'. Respect a user-written one.
      const model = req.modelId && effort && !req.modelId.includes('[') ? `${req.modelId}[effort=${effort}]` : req.modelId;
      return {
        args: [
          '-p',
          '--output-format',
          'json',
          '--mode',
          'ask',
          '--trust',
          '--workspace',
          workDir,
          ...(model ? ['--model', model] : []),
          '--',
          combinePrompt(req.system, req.prompt),
        ],
      };
    },
    parse(stdout) {
      const json = tryParseJson(stdout.trim());
      if (!json || typeof json !== 'object') return { text: stdout.trim() };
      if (json.is_error) throw new Error(String(json.result || json.subtype || 'Cursor reported an error'));
      const u = json.usage || {};
      return {
        text: typeof json.result === 'string' ? json.result : JSON.stringify(json.result ?? ''),
        usage: {
          ...emptyUsage(),
          inputTokens: Number(u.inputTokens ?? u.input_tokens) || 0,
          outputTokens: Number(u.outputTokens ?? u.output_tokens) || 0,
          cachedInputTokens: Number(u.cacheReadTokens ?? u.cache_read_input_tokens) || 0,
        },
      };
    },
  },

  // agy -p: https://antigravity.google/docs/cli/headless/ (experimental; no effort flag)
  antigravity: {
    label: 'Antigravity',
    defaultBinary: 'agy',
    loginHint: 'Run `agy` once in a terminal to sign in (as the same user that runs the backend).',
    build(req) {
      return { args: ['--output-format', 'json', '-p', combinePrompt(req.system, req.prompt)] };
    },
    parse(stdout) {
      const trimmed = stdout.trim();
      const json = tryParseJson(trimmed);
      if (!json || typeof json !== 'object') return { text: trimmed };
      if (json.is_error || json.error) {
        throw new Error(String(json.error?.message || json.error || json.result || 'Antigravity reported an error'));
      }
      const text = [json.result, json.response, json.text, json.output, json.content, json.message].find(
        (v) => typeof v === 'string',
      );
      return { text: text ?? trimmed };
    },
  },
};

@Injectable()
export class CliLlmService {
  private readonly logger = new Logger(CliLlmService.name);

  getProviderLabel(provider: CliProviderId): string {
    return ADAPTERS[provider].label;
  }

  async complete(req: CliCompletionRequest): Promise<CliCompletionResult> {
    const adapter = ADAPTERS[req.provider];
    if (!adapter) throw new Error(`Unknown CLI provider "${req.provider}"`);
    const binary = this.resolveBinary(req.cliPath, adapter.defaultBinary);

    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-cli-'));
    const outputFile = path.join(workDir, 'last-message.txt');
    const started = Date.now();
    try {
      const invocation = adapter.build(req, workDir, outputFile);
      this.logger.log(`   🖥️ [${adapter.label} CLI] ${binary} (model: ${req.modelId || 'CLI default'})`);
      const { stdout, stderr, code } = await this.spawnCli(binary, invocation, workDir, req.signal, adapter);
      const outputFileContent = await fs.readFile(outputFile, 'utf8').catch(() => '');

      if (code !== 0) {
        throw this.cliError(adapter, `exited with code ${code}`, stderr || stdout);
      }
      let parsed: { text: string; usage?: CliUsage };
      try {
        parsed = adapter.parse(stdout, outputFileContent);
      } catch (err: any) {
        throw this.cliError(adapter, err.message, stderr);
      }
      if (!parsed.text.trim()) {
        throw this.cliError(
          adapter,
          'returned an empty response',
          stderr || (req.provider === 'antigravity' ? 'Antigravity headless mode is known to drop output when piped.' : ''),
        );
      }
      return { text: parsed.text, usage: parsed.usage, binary, durationMs: Date.now() - started };
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private resolveBinary(cliPath: string | undefined, fallback: string): string {
    const custom = String(cliPath || '').trim();
    if (!custom) return fallback;
    return custom.startsWith('~') ? path.join(os.homedir(), custom.slice(1)) : custom;
  }

  /** PATH of a backend started from an IDE/launcher often lacks the user's CLI install dirs. */
  private buildEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of STRIPPED_ENV_VARS) delete env[name];
    const home = os.homedir();
    const extraDirs = [
      path.join(home, '.local', 'bin'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.bun', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ];
    const current = (env.PATH || '').split(path.delimiter).filter(Boolean);
    env.PATH = [...current, ...extraDirs.filter((d) => !current.includes(d))].join(path.delimiter);
    return env;
  }

  private spawnCli(
    binary: string,
    invocation: CliInvocation,
    cwd: string,
    signal: AbortSignal | undefined,
    adapter: CliAdapter,
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);

      // Arguments are passed as an array (no shell), so prompt text can never be interpreted as a command.
      const child = spawn(binary, invocation.args, { cwd, env: this.buildEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        if (killTimer) clearTimeout(killTimer);
        fn();
      };
      const onAbort = () => {
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
        finish(() => reject(signal?.reason ?? Object.assign(new Error('CLI call aborted'), { name: 'AbortError' })));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString('utf8');
      });
      child.on('error', (err: any) => {
        finish(() =>
          reject(
            err?.code === 'ENOENT'
              ? Object.assign(
                  new Error(
                    `${adapter.label} CLI not found ("${binary}"). Install it, or set the CLI path for this model in Settings -> Models.`,
                  ),
                  { code: 'CLI_NOT_FOUND' },
                )
              : err,
          ),
        );
      });
      child.on('close', (code) => finish(() => resolve({ stdout, stderr, code })));

      // Always close stdin: some CLIs wait for EOF before starting in headless mode.
      child.stdin.on('error', () => undefined);
      child.stdin.end(invocation.stdin ?? '');
    });
  }

  private cliError(adapter: CliAdapter, what: string, output: string): Error {
    const tail = String(output || '').trim().slice(-1500).replace(/\.+$/, '');
    const hint = AUTH_ERROR_PATTERN.test(tail) ? ` ${adapter.loginHint}` : '';
    return Object.assign(new Error(`${adapter.label} CLI ${what}${tail ? `: ${tail}` : ''}.${hint}`), {
      code: hint ? 'CLI_NOT_AUTHENTICATED' : 'CLI_CALL_FAILED',
    });
  }
}
