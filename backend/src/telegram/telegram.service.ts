import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Inject,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import {
  TelegramMessage,
  TelegramMessageDocument,
} from './schemas/telegram-message.schema';
import { GraphRunnerService } from '../runs/graph-runner.service';
import { Graph, GraphDocument } from '../graphs/schemas/graph.schema';
import { SettingsService } from '../settings/settings.service';

export interface DispatchQuestionParams {
  runId: string;
  nodeId: string;
  projectId?: string;
  graphId?: string;
  token: string;
  question: string;
  chatId: string | number;
  botToken?: string;
  messageThreadId?: number | string;
  updateMode?: 'polling' | 'webhook';
  pollIntervalSeconds?: number;
}

export interface PollingWorkerState {
  botToken: string;
  intervalSeconds: number;
  timer: NodeJS.Timeout | null;
  lastUpdateId: number;
  active: boolean;
}

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private readonly pollingWorkers = new Map<string, PollingWorkerState>();

  constructor(
    @InjectModel(TelegramMessage.name)
    private readonly telegramMessageModel: Model<TelegramMessageDocument>,
    @InjectModel(Graph.name)
    private readonly graphModel: Model<GraphDocument>,
    @Inject(forwardRef(() => GraphRunnerService))
    private readonly graphRunnerService: GraphRunnerService,
    private readonly configService: ConfigService,
    @Optional()
    private readonly settingsService?: SettingsService,
  ) { }

  async onModuleInit() {
    // Attempt auto-start polling on startup if configured in global settings
    try {
      await this.ensurePolling();
    } catch {
      // Non-fatal if offline or no token configured yet
    }
  }

  onModuleDestroy() {
    this.logger.log('🛑 Stopping all Telegram polling workers...');
    for (const [token, worker] of this.pollingWorkers) {
      this.stopPolling(token);
    }
  }

  /**
   * Resolves effective Telegram bot token with project -> global -> env inheritance.
   */
  resolveBotToken(tokenOverride?: string): string {
    if (tokenOverride && tokenOverride.trim()) {
      return tokenOverride.trim();
    }
    return String(
      this.configService.get<string>('TELEGRAM_BOT_TOKEN') ||
      process.env.TELEGRAM_BOT_TOKEN ||
      '',
    ).trim();
  }

  /**
   * Resolves full Telegram configuration (botToken, updateMode, pollIntervalSeconds)
   * with fallback: explicit override -> project settings -> global settings -> environment.
   */
  async getTelegramConfig(
    projectId?: string,
    tokenOverride?: string,
  ): Promise<{
    botToken: string;
    updateMode: string;
    pollIntervalSeconds: number;
  }> {
    let botToken = tokenOverride ? tokenOverride.trim() : '';
    let updateMode = 'polling';
    let pollIntervalSeconds = 2;

    if (this.settingsService) {
      try {
        const settings = await this.settingsService.getSettings(projectId);
        if (!botToken && settings?.telegramBotToken) {
          botToken = String(settings.telegramBotToken).trim();
        }
        if (settings?.telegramUpdateMode) {
          updateMode = String(settings.telegramUpdateMode).trim();
        }
        if (settings?.telegramPollIntervalSeconds) {
          pollIntervalSeconds = Number(settings.telegramPollIntervalSeconds);
        }
      } catch (err: any) {
        this.logger.warn(`Could not load settings for Telegram config: ${err.message}`);
      }
    }

    if (!botToken) {
      botToken = this.resolveBotToken();
    }

    return { botToken, updateMode, pollIntervalSeconds };
  }

  /**
   * Checks whether polling is already running for the given bot token.
   */
  isPolling(botTokenOverride?: string): boolean {
    const token = this.resolveBotToken(botTokenOverride);
    if (!token) return false;
    const worker = this.pollingWorkers.get(token);
    return Boolean(worker && worker.active);
  }

  /**
   * Ensures polling is started for the resolved bot token.
   * If polling is already running for this bot token, IT WILL NOT START ANOTHER ONE!
   */
  async ensurePolling(
    projectId?: string,
    tokenOverride?: string,
  ): Promise<PollingWorkerState | null> {
    const config = await this.getTelegramConfig(projectId, tokenOverride);
    if (!config.botToken) {
      return null;
    }
    if (config.updateMode !== 'polling') {
      return null;
    }

    // Check if already started — do not start another one!
    if (this.isPolling(config.botToken)) {
      this.logger.log(`Telegram polling already active for bot token; reusing existing poller.`);
      return this.pollingWorkers.get(config.botToken) || null;
    }

    return this.startPolling(config.botToken, config.pollIntervalSeconds);
  }

  /**
   * Send an outbound message via Telegram Bot API.
   * If token is invalid or request fails in offline/dev mode, simulates a message ID.
   */
  async sendMessage(
    chatId: string | number,
    text: string,
    options: {
      botToken?: string;
      messageThreadId?: number | string;
      parseMode?: string;
    } = {},
  ): Promise<{ ok: boolean; messageId: number; raw?: any; mock?: boolean }> {
    const token = this.resolveBotToken(options.botToken);
    const threadId = options.messageThreadId
      ? Number(options.messageThreadId)
      : undefined;

    if (!token) {
      const mockId = Math.floor(100000 + Math.random() * 900000);
      this.logger.warn(
        `[Telegram Mock] No bot token configured. Simulating sent message ${mockId} to chat ${chatId}`,
      );
      return { ok: true, messageId: mockId, mock: true };
    }

    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const bodyPayload: any = {
        chat_id: chatId,
        text,
      };
      if (threadId) {
        bodyPayload.message_thread_id = threadId;
      }
      if (options.parseMode) {
        bodyPayload.parse_mode = options.parseMode;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });

      const data: any = await response.json();
      if (data && data.ok && data.result?.message_id) {
        this.logger.log(
          `✈️ Telegram message ${data.result.message_id} sent successfully to chat ${chatId}`,
        );
        return { ok: true, messageId: data.result.message_id, raw: data.result };
      }

      this.logger.error(
        `Telegram API error: ${data?.description || response.statusText}. Falling back to simulated ID.`,
      );
      const mockId = Math.floor(100000 + Math.random() * 900000);
      return { ok: true, messageId: mockId, raw: data, mock: true };
    } catch (err: any) {
      this.logger.error(
        `Failed to call Telegram API: ${err.message}. Falling back to simulated ID for continuity.`,
      );
      const mockId = Math.floor(100000 + Math.random() * 900000);
      return { ok: true, messageId: mockId, mock: true };
    }
  }

  /**
   * Dispatches a question to Telegram and records the interaction in MongoDB.
   * Also activates local polling if in polling mode.
   */
  async dispatchQuestionAndStore(
    params: DispatchQuestionParams,
  ): Promise<TelegramMessageDocument> {
    const effectiveToken = this.resolveBotToken(params.botToken);
    const sent = await this.sendMessage(params.chatId, params.question, {
      botToken: effectiveToken,
      messageThreadId: params.messageThreadId,
    });

    const record = await this.telegramMessageModel.create({
      messageId: sent.messageId,
      chatId: String(params.chatId),
      messageThreadId: params.messageThreadId
        ? Number(params.messageThreadId)
        : undefined,
      runId: params.runId,
      nodeId: params.nodeId,
      graphId: params.graphId,
      token: params.token,
      question: params.question,
      status: 'waiting',
      updateMode: params.updateMode || 'polling',
      pollIntervalSeconds: params.pollIntervalSeconds || 2,
      sentAt: new Date(),
    });

    this.logger.log(
      `📝 [Telegram Gate] Stored question messageId: ${sent.messageId} for run ${params.runId} (waiting for reply)`,
    );

    // Ensure polling is active if mode is polling, avoiding duplicate workers
    if (params.updateMode !== 'webhook') {
      await this.ensurePolling(params.projectId, params.botToken);
    }

    return record;
  }

  /**
   * Central processor for Telegram updates, invoked by Webhook or Local Polling.
   */
  async processUpdate(update: any): Promise<any> {
    if (!update || (!update.message && !update.edited_message)) {
      return { handled: false, reason: 'No message in update' };
    }

    const message = update.message || update.edited_message;
    const chatId = String(message.chat?.id || '');
    const replyToMessageId = message.reply_to_message?.message_id;
    const incomingText = String(message.text || message.caption || '').trim();

    this.logger.log(
      `📩 [Telegram Update] From Chat: ${chatId}, Message ID: ${message.message_id}, ReplyTo: ${replyToMessageId || 'none'}`,
    );

    // -------------------------------------------------------------------------
    // Scenario 2: Answer a Question (User replies directly to the question message)
    // -------------------------------------------------------------------------
    if (replyToMessageId) {
      const waitingRecord = await this.telegramMessageModel
        .findOne({
          chatId,
          messageId: replyToMessageId,
          status: 'waiting',
        })
        .exec();

      if (waitingRecord) {
        this.logger.log(
          `🎯 [Telegram Match] User replied to question ${replyToMessageId}. Resuming run: ${waitingRecord.runId}`,
        );

        waitingRecord.status = 'answered';
        waitingRecord.replyMessageId = message.message_id;
        waitingRecord.replyText = incomingText;
        waitingRecord.replyFrom = message.from;
        waitingRecord.repliedAt = new Date();
        await waitingRecord.save();

        try {
          const resumeResult = await this.graphRunnerService.resumeRun(
            waitingRecord.runId,
            {
              token: waitingRecord.token,
              value: incomingText,
              decision: incomingText,
              feedback: incomingText,
              approved: true,
              text: incomingText,
              telegramReply: message,
              repliedAt: waitingRecord.repliedAt,
            },
          );

          return {
            handled: true,
            scenario: 'question_answered',
            runId: waitingRecord.runId,
            resumeResult,
          };
        } catch (err: any) {
          this.logger.error(
            `Failed to resume run ${waitingRecord.runId}: ${err.message}`,
          );
          return {
            handled: false,
            scenario: 'question_answered',
            error: err.message,
          };
        }
      }
    }

    // -------------------------------------------------------------------------
    // Scenario 1: Trigger (A new message arrives without replying to a question)
    // -------------------------------------------------------------------------
    const graphs = await this.graphModel.find().lean().exec();
    const triggeredRuns: string[] = [];

    const triggerPayload = {
      text: incomingText,
      chatId,
      messageId: message.message_id,
      threadId: message.message_thread_id,
      userId: message.from?.id,
      username: message.from?.username,
      firstName: message.from?.first_name,
      lastName: message.from?.last_name,
      message,
      ...(incomingText ? { query: incomingText, input: incomingText } : {}),
    };

    for (const rawGraph of graphs) {
      const graph: any = rawGraph;
      let nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
      if (nodes.length === 0 && Array.isArray(graph.flow?.blocks)) {
        nodes = graph.flow.blocks.map((b: any) => ({
          id: b.id,
          type: b.kind || b.definitionId,
          data: {
            definitionType: b.kind || b.definitionId,
            name: b.name,
            config: b.config,
          },
        }));
      }

      const triggerNode = nodes.find((node: any) => {
        const defType = String(
          node.data?.definitionType || node.type || '',
        ).toLowerCase();
        const config = node.data?.config || {};

        // Matches standalone "telegram" node in "trigger" mode
        if (defType === 'telegram') {
          return !config.mode || config.mode === 'trigger';
        }

        // Matches generic "trigger" node configured with triggerType: 'telegram'
        if (defType === 'trigger' && config.triggerType === 'telegram') {
          return true;
        }

        return false;
      });

      if (triggerNode) {
        this.logger.log(
          `⚡ [Telegram Trigger] Triggering Graph "${graph.name}" (${graph._id}) via Node "${triggerNode.id}"`,
        );

        try {
          const runResult = await this.graphRunnerService.runGraph(
            String(graph._id),
            triggerPayload,
            {
              startNodeId: triggerNode.id,
            },
          );
          if (runResult?.runId) {
            triggeredRuns.push(runResult.runId);
          }
        } catch (err: any) {
          this.logger.error(
            `Error triggering graph ${graph._id}: ${err.message}`,
          );
        }
      }
    }

    return {
      handled: true,
      scenario: 'unreplied_trigger',
      triggeredCount: triggeredRuns.length,
      runIds: triggeredRuns,
    };
  }

  /**
   * Starts local polling worker using getUpdates for a bot token.
   */
  startPolling(botTokenOverride?: string, intervalSeconds = 2): PollingWorkerState {
    const token = this.resolveBotToken(botTokenOverride);
    if (!token) {
      throw new Error('Cannot start Telegram polling: no bot token provided');
    }

    const existing = this.pollingWorkers.get(token);
    if (existing && existing.active) {
      this.logger.log(`Telegram polling already active for bot token (${intervalSeconds}s)`);
      return existing;
    }

    const state: PollingWorkerState = {
      botToken: token,
      intervalSeconds: Math.max(1, intervalSeconds),
      timer: null,
      lastUpdateId: -1, // -1 signals "not yet initialized"
      active: true,
    };

    /**
     * On first run, drain any pending (old) updates so we don't re-process
     * messages that arrived while the bot was offline.
     * We do this by calling getUpdates with offset=-1 which returns only the
     * very last pending update (if any). We then advance lastUpdateId past it
     * without dispatching it to processUpdate.
     */
    const drainPendingUpdates = async (): Promise<void> => {
      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=-1&limit=1`;
        const res = await fetch(url);
        if (res.ok) {
          const data: any = await res.json();
          if (data?.ok && Array.isArray(data.result) && data.result.length > 0) {
            const latestId = data.result[data.result.length - 1].update_id;
            // Acknowledge this update so Telegram removes it from the queue
            await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${latestId + 1}&limit=1`);
            state.lastUpdateId = latestId;
            this.logger.log(`🧹 [Telegram Polling] Drained pending updates, starting from update_id ${latestId + 1}`);
          } else {
            // No pending updates — set lastUpdateId to 0 so normal polling works
            state.lastUpdateId = 0;
          }
        } else {
          state.lastUpdateId = 0;
        }
      } catch {
        state.lastUpdateId = 0;
      }
    };

    const poll = async () => {
      if (!state.active) return;

      // Run drain on first iteration (lastUpdateId === -1)
      if (state.lastUpdateId === -1) {
        await drainPendingUpdates();
      }

      try {
        // Always pass offset now — either 0+1=1 (no prior updates) or lastUpdateId+1
        const offset = state.lastUpdateId >= 0 ? state.lastUpdateId + 1 : 0;
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=1`;
        const res = await fetch(url);
        if (res.ok) {
          const data: any = await res.json();
          if (data && data.ok && Array.isArray(data.result)) {
            for (const update of data.result) {
              state.lastUpdateId = Math.max(state.lastUpdateId, update.update_id || 0);
              await this.processUpdate(update);
            }
          }
        }
      } catch (err: any) {
        // Polling network warning (silent so offline testing doesn't flood)
      } finally {
        if (state.active) {
          state.timer = setTimeout(poll, state.intervalSeconds * 1000);
        }
      }
    };

    this.logger.log(`🤖 Started Telegram local polling every ${state.intervalSeconds}s`);
    state.timer = setTimeout(poll, 500);
    this.pollingWorkers.set(token, state);
    return state;
  }

  /**
   * Stops local polling worker for a bot token.
   */
  stopPolling(botTokenOverride?: string) {
    const token = this.resolveBotToken(botTokenOverride);
    const worker = this.pollingWorkers.get(token);
    if (worker) {
      worker.active = false;
      if (worker.timer) {
        clearTimeout(worker.timer);
        worker.timer = null;
      }
      this.pollingWorkers.delete(token);
      this.logger.log(`🛑 Stopped Telegram local polling worker`);
    }
  }

  /**
   * Retrieves messages history.
   */
  async getMessages(filter: any = {}): Promise<TelegramMessage[]> {
    return this.telegramMessageModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .exec();
  }
}
