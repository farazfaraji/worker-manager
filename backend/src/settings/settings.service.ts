import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Setting, SettingDocument } from './schemas/setting.schema';
import { UpdateSettingDto } from './dto/update-setting.dto';

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectModel(Setting.name)
    private readonly settingModel: Model<SettingDocument>,
  ) {}

  async onModuleInit() {
    await this.getSettings();
  }

  async getSettings(): Promise<SettingDocument> {
    let setting = await this.settingModel.findOne().exec();
    if (!setting) {
      this.logger.log('Initializing default settings in "setting" collection...');
      setting = new this.settingModel({
        typeGeneratorModel: 'gpt-4o',
        typeGeneratorStrictMode: true,
        autoSaveInterval: 30,
        enableSnapToGrid: true,
        autoPanOnRun: true,
        logVerbosity: 'standard',
        nodeTimeout: 60,
      });
      await setting.save();
    }
    return setting;
  }

  async updateSettings(dto: UpdateSettingDto): Promise<SettingDocument> {
    let setting = await this.settingModel.findOne().exec();
    if (!setting) {
      setting = new this.settingModel(dto);
      return setting.save();
    }
    Object.assign(setting, dto);
    return setting.save();
  }
}
