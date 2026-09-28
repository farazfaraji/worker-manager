import { Controller, Get, Put, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateSettingDto } from './dto/update-setting.dto';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getSettings(@Query('projectId') projectId?: string) {
    return this.settingsService.getSettings(projectId);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  async updateSettings(
    @Body() updateSettingDto: UpdateSettingDto,
    @Query('projectId') projectId?: string,
  ) {
    return this.settingsService.updateSettings(updateSettingDto, projectId);
  }
}
