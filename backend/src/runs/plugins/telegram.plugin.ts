import { Injectable, Logger } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';

@Injectable()
export class TelegramPlugin implements ToolPlugin {
  readonly toolType = 'telegram';
  private readonly logger = new Logger(TelegramPlugin.name);

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context } = ctx;
    const config: any = node?.data?.config || {};
    const payload: any = { ...config, ...nodeInput, ...(context.__resumeDecision || {}) };
    const mode = String(config.mode || payload.mode || 'trigger').toLowerCase();

    // Resumed state: user replied to the question
    const hasResumed =
      payload.decision !== undefined ||
      payload.value !== undefined ||
      payload.text !== undefined ||
      payload.replyText !== undefined ||
      payload.__resumed === true;

    if (hasResumed) {
      const value =
        payload.value !== undefined
          ? payload.value
          : payload.text !== undefined
          ? payload.text
          : payload.replyText !== undefined
          ? payload.replyText
          : payload.decision;
      const text = typeof value === 'string' ? value : JSON.stringify(value);

      return {
        status: 'completed',
        result: {
          value,
          text,
          replyText: text,
          repliedAt: payload.repliedAt || new Date().toISOString(),
          telegramReply: payload.telegramReply || null,
        },
        value,
        text,
      };
    }

    // Question mode: pauses the flow and waits for user's reply via Telegram
    if (mode === 'question') {
      return {
        status: 'waiting',
        result: {
          telegram: true,
          mode: 'question',
          question: config.question || payload.question || 'Please review and reply directly to this message.',
          chatId: config.chatId || payload.chatId,
          botToken: config.botToken || payload.botToken,
          messageThreadId: config.messageThreadId || payload.messageThreadId,
          updateMode: config.updateMode || 'polling',
          pollIntervalSeconds: Number(config.pollIntervalSeconds || 2),
          timeoutMs: Number(config.timeoutMs || 86400000),
        },
      };
    }

    // Trigger mode: pass through trigger payload
    if (mode === 'trigger') {
      return {
        status: 'completed',
        result: payload,
        text: payload.text || '',
        chatId: payload.chatId || '',
        userId: payload.userId || '',
        username: payload.username || '',
        threadId: payload.threadId || '',
      };
    }

    // One-way outbound message mode
    const chatId = config.chatId || payload.chatId;
    const text = config.question || payload.question || config.message || payload.text || '';
    return {
      status: 'completed',
      result: {
        sent: true,
        chatId,
        text,
      },
      text,
      chatId,
    };
  }

  getValidHandles(_config?: any, _outputs?: any[], _nodeData?: any, _nodeName?: string): Set<string> {
    return new Set(['result', 'value', 'text', 'chatId', 'userId', 'username', 'threadId']);
  }

  getProducedPaths(nodeName: string, _config?: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>();
    for (const key of ['result', 'value', 'text', 'chatId', 'userId', 'username', 'threadId']) {
      paths.add(`${nodeName}.${key}`);
    }
    return paths;
  }
}
