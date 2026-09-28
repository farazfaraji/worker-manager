import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TelegramService } from './telegram.service';

@Controller('api/telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  /**
   * Telegram Webhook Endpoint.
   * Telegram Bot API sends JSON updates to this route.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() update: any) {
    const result = await this.telegramService.processUpdate(update);
    return { ok: true, ...result };
  }

  /**
   * Start local polling worker with configurable seconds.
   */
  @Post('polling/start')
  startPolling(
    @Body()
    body: {
      botToken?: string;
      intervalSeconds?: number;
    },
  ) {
    const state = this.telegramService.startPolling(
      body?.botToken,
      body?.intervalSeconds || 2,
    );
    return {
      ok: true,
      active: state.active,
      intervalSeconds: state.intervalSeconds,
    };
  }

  /**
   * Stop local polling worker.
   */
  @Post('polling/stop')
  stopPolling(@Body() body: { botToken?: string }) {
    this.telegramService.stopPolling(body?.botToken);
    return { ok: true, message: 'Polling stopped' };
  }

  /**
   * Fetch interaction message history.
   */
  @Get('messages')
  getMessages(@Query('chatId') chatId?: string, @Query('runId') runId?: string) {
    const filter: any = {};
    if (chatId) filter.chatId = chatId;
    if (runId) filter.runId = runId;
    return this.telegramService.getMessages(filter);
  }

  /**
   * Send test message directly.
   */
  @Post('send')
  sendMessage(
    @Body()
    body: {
      chatId: string | number;
      text: string;
      botToken?: string;
      messageThreadId?: number | string;
    },
  ) {
    return this.telegramService.sendMessage(body.chatId, body.text, {
      botToken: body.botToken,
      messageThreadId: body.messageThreadId,
    });
  }
}
