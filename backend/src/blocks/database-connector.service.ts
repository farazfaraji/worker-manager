import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';

const IDLE_MS = 10 * 60 * 1000;

interface PoolEntry {
  driver: 'mongodb' | 'postgres';
  fingerprint: string;
  client: any;
  lastUsed: number;
  close: () => Promise<void>;
}

@Injectable()
export class DatabaseConnectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseConnectorService.name);
  private readonly pools = new Map<string, PoolEntry>();
  private timer?: NodeJS.Timeout;

  onModuleInit(): void {
    this.timer = setInterval(() => void this.closeIdle(), 60_000);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.closeAll();
  }

  async getMongo(cacheKey: string, uri: string): Promise<any> {
    return this.borrow('mongodb', cacheKey, uri, async () => {
      const { MongoClient } = this.loadDriver('mongodb');
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
      await client.connect();
      return { client, close: () => client.close() };
    });
  }

  async getPostgres(cacheKey: string, uri: string): Promise<any> {
    return this.borrow('postgres', cacheKey, uri, async () => {
      const { Pool } = this.loadDriver('pg');
      const pool = new Pool({ connectionString: uri, max: 4, connectionTimeoutMillis: 8000 });
      return { client: pool, close: () => pool.end() };
    });
  }

  async drop(cacheKey: string): Promise<void> {
    const entry = this.pools.get(cacheKey);
    if (!entry) return;
    this.pools.delete(cacheKey);
    await entry.close().catch(() => undefined);
  }

  private async borrow(
    driver: 'mongodb' | 'postgres',
    cacheKey: string,
    uri: string,
    open: () => Promise<{ client: any; close: () => Promise<void> }>,
  ): Promise<any> {
    const fingerprint = createHash('sha256').update(uri).digest('hex');
    const existing = this.pools.get(cacheKey);
    if (existing && existing.fingerprint === fingerprint && existing.driver === driver) {
      existing.lastUsed = Date.now();
      return existing.client;
    }
    if (existing) {
      this.pools.delete(cacheKey);
      await existing.close().catch(() => undefined);
    }
    try {
      const opened = await open();
      this.pools.set(cacheKey, {
        driver,
        fingerprint,
        client: opened.client,
        lastUsed: Date.now(),
        close: opened.close,
      });
      return opened.client;
    } catch (err: any) {
      this.logger.error(`Database connection failed for ${cacheKey}: ${err?.message || err}`);
      throw err;
    }
  }

  private loadDriver(name: 'mongodb' | 'pg'): any {
    try {
      return require(name);
    } catch {
      throw new Error(
        name === 'pg'
          ? 'PostgreSQL connections require the "pg" package'
          : 'MongoDB connections require the "mongodb" package',
      );
    }
  }

  private async closeIdle(): Promise<void> {
    const cutoff = Date.now() - IDLE_MS;
    for (const [key, entry] of this.pools) {
      if (entry.lastUsed > cutoff) continue;
      this.pools.delete(key);
      await entry.close().catch(() => undefined);
    }
  }

  private async closeAll(): Promise<void> {
    const entries = [...this.pools.values()];
    this.pools.clear();
    await Promise.all(entries.map((entry) => entry.close().catch(() => undefined)));
  }
}
