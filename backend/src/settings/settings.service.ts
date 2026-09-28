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

  async getSettings(projectId?: string): Promise<any> {
    // 1. Get or initialize global settings
    let globalSetting = await this.settingModel
      .findOne({
        $or: [{ projectId: null }, { projectId: { $exists: false } }, { projectId: '' }],
      })
      .exec();

    if (!globalSetting) {
      this.logger.log('Initializing default settings in "setting" collection...');
      globalSetting = new this.settingModel({
        projectId: null,
        flowHelperModel: 'gpt-4o',
        typeGeneratorModel: 'gpt-4o',
        typeGeneratorStrictMode: true,
        autoSaveInterval: 30,
        enableSnapToGrid: true,
        autoPanOnRun: true,
        logVerbosity: 'standard',
        nodeTimeout: 60,
        telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
        telegramUpdateMode: 'polling',
        telegramPollIntervalSeconds: 3,
        telegramWebhookUrl: '',
      });
      await globalSetting.save();
    }

    if (!projectId || projectId === 'default' || projectId === 'global') {
      return globalSetting;
    }

    // 2. If project-scoped requested, find project settings and merge on top of global
    const projectSetting = await this.settingModel.findOne({ projectId }).exec();
    if (!projectSetting) {
      return globalSetting;
    }

    const globalObj = globalSetting.toObject ? globalSetting.toObject() : globalSetting;
    const projectObj = projectSetting.toObject ? projectSetting.toObject() : projectSetting;

    // Only non-empty project fields override global settings
    const effectiveProject: Record<string, any> = {};
    for (const [key, val] of Object.entries(projectObj)) {
      if (val !== undefined && val !== null && val !== '') {
        effectiveProject[key] = val;
      }
    }

    return {
      ...globalObj,
      ...effectiveProject,
      projectId,
      isProjectOverride: true,
    };
  }

  async updateSettings(dto: UpdateSettingDto, projectId?: string): Promise<any> {
    const isProject = Boolean(projectId && projectId !== 'default' && projectId !== 'global');
    const filter = isProject
      ? { projectId }
      : { $or: [{ projectId: null }, { projectId: { $exists: false } }, { projectId: '' }] };

    let setting = await this.settingModel.findOne(filter).exec();
    if (!setting) {
      setting = new this.settingModel({
        ...dto,
        projectId: isProject ? projectId : null,
      });
      return setting.save();
    }
    Object.assign(setting, dto);
    if (isProject) {
      setting.projectId = projectId;
    }
    return setting.save();
  }
}
