import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProjectVaultKey, ProjectVaultKeyDocument } from './schemas/project-vault-key.schema';
import { Secret, SecretDocument } from './schemas/secret.schema';
import { decryptSecret, deriveSecretsKey, encryptSecret } from './secrets.crypto';

const NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const MISSING_KEY_MESSAGE =
  'Set an encryption key for this project in Manage Projects → Secrets.';

export interface SecretMeta {
  name: string;
  description: string;
  createdAt?: Date;
  updatedAt?: Date;
  lastUsedAt?: Date;
}

@Injectable()
export class SecretsService {
  /** Derived AES keys, keyed by project id. */
  private readonly keyCache = new Map<string, Buffer>();
  /** Decrypted values for the process. Never copied onto run context. null means "known missing". */
  private readonly cache = new Map<string, string | null>();

  constructor(
    @InjectModel(Secret.name) private readonly secrets: Model<SecretDocument>,
    @Optional() @InjectModel(ProjectVaultKey.name) private readonly vaultKeys?: Model<ProjectVaultKeyDocument>,
    @Optional() private readonly config?: ConfigService,
  ) {}

  assertName(name: string): string {
    const normalized = String(name || '').trim();
    if (!NAME_PATTERN.test(normalized)) {
      throw new BadRequestException('Secret names must be UPPER_SNAKE_CASE (for example GITHUB_TOKEN)');
    }
    return normalized;
  }

  async set(projectId: string, name: string, value: string, description?: string): Promise<SecretMeta> {
    const secretName = this.assertName(name);
    if (value === undefined || value === null || String(value) === '') {
      throw new BadRequestException('Secret value is required');
    }
    const enc = encryptSecret(String(value), await this.keyFor(projectId));
    const doc = await this.secrets
      .findOneAndUpdate(
        { projectId, name: secretName },
        {
          $set: {
            ciphertext: enc.ciphertext,
            iv: enc.iv,
            authTag: enc.authTag,
            ...(description !== undefined ? { description: String(description) } : {}),
          },
          $setOnInsert: { projectId, name: secretName },
        },
        { upsert: true, new: true },
      )
      .exec();
    this.cache.set(this.cacheKey(projectId, secretName), String(value));
    return this.toMeta(doc);
  }

  async delete(projectId: string, name: string): Promise<{ name: string; deleted: boolean }> {
    const secretName = this.assertName(name);
    const res = await this.secrets.deleteOne({ projectId, name: secretName }).exec();
    this.cache.delete(this.cacheKey(projectId, secretName));
    return { name: secretName, deleted: (res?.deletedCount || 0) > 0 };
  }

  async list(projectId: string): Promise<SecretMeta[]> {
    const docs = await this.secrets.find({ projectId }).sort({ name: 1 }).lean().exec();
    return (docs || []).map((doc) => this.toMeta(doc));
  }

  async exists(projectId: string, name: string): Promise<boolean> {
    const value = await this.resolve(projectId, name);
    return value !== undefined;
  }

  /**
   * Load and decrypt a secret. Result is cached in memory for `peek`.
   * Callers must not place the return value on run context or checkpoints.
   */
  async resolve(projectId: string, name: string): Promise<string | undefined> {
    const secretName = this.assertName(name);
    const key = this.cacheKey(projectId, secretName);
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      return cached == null ? undefined : cached;
    }
    const doc = await this.secrets.findOne({ projectId, name: secretName }).exec();
    if (!doc) {
      this.cache.set(key, null);
      return undefined;
    }
    const value = decryptSecret(doc, await this.keyFor(projectId));
    this.cache.set(key, value);
    void this.secrets
      .updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date() } })
      .exec()
      .catch(() => undefined);
    return value;
  }

  /** Synchronous read of a secret already loaded by `resolve`. */
  peek(projectId: string, name: string): string | undefined {
    const key = this.cacheKey(projectId, String(name || '').trim());
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    return value == null ? undefined : value;
  }

  private cacheKey(projectId: string, name: string): string {
    return `${projectId}:${name}`;
  }

  private toMeta(doc: any): SecretMeta {
    return {
      name: doc?.name,
      description: doc?.description || '',
      createdAt: doc?.createdAt,
      updatedAt: doc?.updatedAt,
      lastUsedAt: doc?.lastUsedAt,
    };
  }

  async encryptionKeyStatus(projectId: string): Promise<{ configured: boolean }> {
    if (!projectId || !this.vaultKeys) return { configured: false };
    const doc = await this.vaultKeys.findOne({ projectId }).select('_id').lean().exec();
    return { configured: Boolean(doc) };
  }

  /**
   * Store this project's encryption key. Existing secrets are re-encrypted with it.
   * The passphrase is never returned.
   */
  async setEncryptionKey(projectId: string, raw: string): Promise<{ configured: true }> {
    const material = String(raw || '').trim();
    if (material.length < 8) {
      throw new BadRequestException('Encryption key must be at least 8 characters');
    }
    if (!this.vaultKeys) {
      throw new BadRequestException('Project encryption keys are not available');
    }
    const next = deriveSecretsKey(material);
    const docs = await this.secrets.find({ projectId }).exec();
    if (docs.length > 0) {
      const current = await this.keyFor(projectId);
      for (const doc of docs) {
        const plain = decryptSecret(doc, current);
        const enc = encryptSecret(plain, next);
        await this.secrets.updateOne({ _id: doc._id }, { $set: enc }).exec();
        this.cache.set(this.cacheKey(projectId, doc.name), plain);
      }
    }
    await this.vaultKeys
      .findOneAndUpdate(
        { projectId },
        { $set: { keyMaterial: material }, $setOnInsert: { projectId } },
        { upsert: true },
      )
      .exec();
    this.keyCache.set(projectId, next);
    return { configured: true };
  }

  async purge(projectId: string): Promise<void> {
    await this.secrets.deleteMany({ projectId }).exec();
    await this.vaultKeys?.deleteMany({ projectId }).exec();
    this.keyCache.delete(projectId);
    const prefix = `${projectId}:`;
    for (const cacheKey of this.cache.keys()) {
      if (cacheKey.startsWith(prefix)) this.cache.delete(cacheKey);
    }
  }

  private envKey(): string | undefined {
    return this.config?.get<string>('SECRETS_MASTER_KEY') || process.env.SECRETS_MASTER_KEY || undefined;
  }

  private async keyFor(projectId: string): Promise<Buffer> {
    const cached = this.keyCache.get(projectId);
    if (cached) return cached;
    const stored = this.vaultKeys
      ? await this.vaultKeys.findOne({ projectId }).lean().exec()
      : null;
    const raw = stored?.keyMaterial || this.envKey();
    if (!raw) {
      throw new BadRequestException(MISSING_KEY_MESSAGE);
    }
    const derived = deriveSecretsKey(raw);
    this.keyCache.set(projectId, derived);
    return derived;
  }
}
