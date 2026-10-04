import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { DatabaseConnectorService } from '../../blocks/database-connector.service';
import { SecretsService } from '../../secrets/secrets.service';
import { registerResolvedSecret } from '../services/redaction.util';

const MONGO_WRITES = new Set(['insertone', 'insertmany', 'updateone', 'updatemany', 'deleteone', 'deletemany']);
const POSTGRES_WRITES = new Set(['execute', 'transaction']);
const BLOCKED_MONGO_OPERATORS = new Set(['$where', '$function', '$accumulator']);

@Injectable()
export class DatabasePlugin implements ToolPlugin {
  readonly toolType = 'database';

  constructor(
    @Optional() private readonly connector?: DatabaseConnectorService,
    @Optional() private readonly secrets?: SecretsService,
  ) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context, runId } = ctx;
    const config = node?.data?.config || {};
    const payload = { ...config, ...(nodeInput && typeof nodeInput === 'object' ? nodeInput : {}) };
    const op = String(payload.operation || 'ping').toLowerCase();
    const driver = String(payload.driver || 'mongodb').toLowerCase();
    const projectId = String(context?.projectId || '');
    const secretName = String(payload.connectionSecret || payload.secret || '');
    if (!projectId) throw new BadRequestException('database requires a projectId on the run');
    if (!secretName) throw new BadRequestException('database requires connectionSecret');
    if (!this.connector || !this.secrets) throw new BadRequestException('Database connector is not available');

    const readOnly = payload.readOnly !== false && payload.readOnly !== 'false';
    if (readOnly && (MONGO_WRITES.has(op) || POSTGRES_WRITES.has(op))) {
      throw new BadRequestException('Database node is read-only. Set readOnly to false to write.');
    }

    const started = Date.now();
    const uri = await this.secrets.resolve(projectId, secretName);
    if (!uri) throw new BadRequestException(`Secret "${secretName}" was not found`);
    registerResolvedSecret(runId, uri);
    const cacheKey = `${projectId}:${secretName}:${driver}`;
    const maxRows = clamp(Number(payload.maxRows ?? payload.limit ?? 1000), 1, 5000);
    const timeoutMs = clamp(Number(payload.timeoutMs ?? 15000), 100, 120000);

    try {
      if (driver === 'postgres' || driver === 'postgresql') {
        const pool = await this.connector.getPostgres(cacheKey, uri);
        const result = await this.runPostgres(pool, op, payload, config, maxRows, timeoutMs);
        return { status: 'completed', ...result, result: { ...result.result, durationMs: Date.now() - started, driver: 'postgres' } };
      }
      const client = await this.connector.getMongo(cacheKey, uri);
      const result = await this.runMongo(client, op, payload, maxRows, timeoutMs);
      return { status: 'completed', ...result, result: { ...result.result, durationMs: Date.now() - started, driver: 'mongodb' } };
    } catch (err: any) {
      if (op === 'ping') {
        return {
          status: 'completed',
          conditionMet: false,
          result: { ok: false, driver, durationMs: Date.now() - started, error: err?.message || String(err) },
        };
      }
      throw err;
    }
  }

  getValidHandles(): Set<string> {
    return new Set(['result', 'true', 'false']);
  }

  getProducedPaths(nodeName: string): Set<string> {
    return new Set([
      `${nodeName}.result`,
      `${nodeName}.result.documents`,
      `${nodeName}.result.rows`,
      `${nodeName}.result.rowCount`,
      `${nodeName}.result.durationMs`,
    ]);
  }

  private async runMongo(client: any, op: string, payload: any, maxRows: number, timeoutMs: number) {
    if (op === 'ping') {
      await client.db().command({ ping: 1 }, { maxTimeMS: timeoutMs });
      return { conditionMet: true, result: { ok: true } };
    }
    if (op === 'listcollections') {
      const docs = await client.db().listCollections({}, { nameOnly: true }).toArray();
      return { result: { collections: docs.map((doc: any) => doc.name) } };
    }

    const collectionName = String(payload.collection || '');
    if (!/^[A-Za-z0-9_.-]+$/.test(collectionName)) {
      throw new BadRequestException('A collection name is required');
    }
    const collection = client.db().collection(collectionName);
    const filter = asObject(payload.filter);
    assertSafeMongo(filter);
    assertSafeMongo(payload.pipeline);
    assertSafeMongo(payload.update);

    if (op === 'describe') {
      const sample = await collection.findOne({}, { maxTimeMS: timeoutMs });
      const indexes = await collection.indexes();
      return { result: { collection: collectionName, sampleKeys: sample ? Object.keys(sample) : [], indexes } };
    }
    if (op === 'find') {
      const limit = clamp(Number(payload.limit ?? maxRows), 1, maxRows);
      const findOptions: Record<string, any> = { maxTimeMS: timeoutMs };
      const projection = asObject(payload.projection);
      if (projection) findOptions.projection = projection;
      const documents = await collection
        .find(filter, findOptions)
        .sort(asObject(payload.sort) || {})
        .skip(Math.max(0, Number(payload.skip) || 0))
        .limit(limit)
        .toArray();
      return { result: { documents, rowCount: documents.length } };
    }
    if (op === 'findone') {
      const findOneOptions: Record<string, any> = { maxTimeMS: timeoutMs };
      const oneProjection = asObject(payload.projection);
      if (oneProjection) findOneOptions.projection = oneProjection;
      const document = await collection.findOne(filter, findOneOptions);
      return { result: { documents: document ? [document] : [], rowCount: document ? 1 : 0 } };
    }
    if (op === 'count') {
      const rowCount = await collection.countDocuments(filter, { maxTimeMS: timeoutMs });
      return { result: { rowCount } };
    }
    if (op === 'distinct') {
      const field = String(payload.field || payload.distinct || '');
      if (!field) throw new BadRequestException('distinct requires a field');
      const documents = await collection.distinct(field, filter, { maxTimeMS: timeoutMs });
      return { result: { documents: documents.slice(0, maxRows), rowCount: documents.length } };
    }
    if (op === 'aggregate') {
      const pipeline = Array.isArray(payload.pipeline) ? payload.pipeline : [];
      const documents = await collection.aggregate(pipeline, { maxTimeMS: timeoutMs }).limit(maxRows).toArray();
      return { result: { documents, rowCount: documents.length } };
    }
    if (op === 'insertone') {
      const res = await collection.insertOne(asObject(payload.document) || {});
      return { result: { rowCount: 1, insertedId: String(res.insertedId) } };
    }
    if (op === 'insertmany') {
      const docs = Array.isArray(payload.documents) ? payload.documents : [];
      const res = await collection.insertMany(docs);
      return { result: { rowCount: res.insertedCount } };
    }
    if (op === 'updateone' || op === 'updatemany') {
      const update = asObject(payload.update) || {};
      const res = op === 'updateone'
        ? await collection.updateOne(filter, update)
        : await collection.updateMany(filter, update);
      return { result: { rowCount: res.modifiedCount, matchedCount: res.matchedCount } };
    }
    if (op === 'deleteone' || op === 'deletemany') {
      const res = op === 'deleteone' ? await collection.deleteOne(filter) : await collection.deleteMany(filter);
      return { result: { rowCount: res.deletedCount } };
    }
    throw new BadRequestException(`Unknown MongoDB operation: ${op}`);
  }

  private async runPostgres(pool: any, op: string, payload: any, originalConfig: any, maxRows: number, timeoutMs: number) {
    if (op === 'ping') {
      await this.query(pool, 'SELECT 1', [], timeoutMs);
      return { conditionMet: true, result: { ok: true } };
    }
    if (op === 'listtables' || op === 'listcollections') {
      const res = await this.query(
        pool,
        `SELECT table_schema, table_name FROM information_schema.tables
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
         ORDER BY 1, 2 LIMIT $1`,
        [maxRows],
        timeoutMs,
      );
      return { result: { tables: res.rows, rowCount: res.rowCount } };
    }
    if (op === 'describe') {
      const table = String(payload.table || payload.collection || '');
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new BadRequestException('A table name is required');
      const res = await this.query(
        pool,
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
        [table],
        timeoutMs,
      );
      return { result: { table, columns: res.rows, rowCount: res.rowCount } };
    }
    if (op === 'query' || op === 'execute') {
      const sql = this.sqlText(payload, originalConfig, op === 'query' ? 'sql' : 'sql');
      this.assertSql(sql, originalConfig, payload);
      if (op === 'query' && !/^(select|with)\b/i.test(sql.trim())) {
        throw new BadRequestException('query only runs SELECT. Use execute for writes.');
      }
      if (op === 'execute' && !/^(insert|update|delete)\b/i.test(sql.trim())) {
        throw new BadRequestException('execute only runs INSERT, UPDATE, or DELETE.');
      }
      const res = await this.query(pool, sql, asParams(payload.params), timeoutMs, op === 'query' ? maxRows : undefined);
      return { result: { rows: res.rows, rowCount: res.rowCount, fields: (res.fields || []).map((field: any) => field.name) } };
    }
    if (op === 'transaction') {
      const statements = Array.isArray(payload.statements) ? payload.statements : [];
      if (!statements.length) throw new BadRequestException('transaction requires statements');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT set_config($1, $2, true)', ['statement_timeout', String(timeoutMs)]);
        let rowCount = 0;
        const rows: any[] = [];
        for (const statement of statements) {
          const sql = String(statement?.sql || '');
          this.assertSql(sql, statement, payload);
          const res = await client.query(sql, asParams(statement?.params));
          rowCount += res.rowCount || 0;
          if (res.rows?.length) rows.push(...res.rows.slice(0, maxRows - rows.length));
        }
        await client.query('COMMIT');
        return { result: { rows, rowCount } };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }
    throw new BadRequestException(`Unknown PostgreSQL operation: ${op}`);
  }

  private sqlText(payload: any, originalConfig: any, field: string): string {
    const original = originalConfig?.[field] ?? originalConfig?.query;
    return String(original ?? payload[field] ?? payload.query ?? '');
  }

  private assertSql(sql: string, originalConfig: any, payload: any) {
    const allowRaw = payload.allowRawSql === true || payload.allowRawSql === 'true' || originalConfig?.allowRawSql === true;
    const source = typeof originalConfig?.sql === 'string' ? originalConfig.sql : typeof originalConfig?.query === 'string' ? originalConfig.query : sql;
    if (!allowRaw && String(source).includes('{{')) {
      throw new BadRequestException('Parameterized queries are required. Pass values in params, or set allowRawSql.');
    }
    const stripped = sql.replace(/'(?:[^']|'')*'/g, '').replace(/--.*$/gm, '');
    const parts = stripped.split(';').map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) throw new BadRequestException('Multiple SQL statements are not allowed');
  }

  private async query(pool: any, sql: string, params: any[], timeoutMs: number, maxRows?: number) {
    const client = await pool.connect();
    try {
      await client.query('SELECT set_config($1, $2, false)', ['statement_timeout', String(timeoutMs)]);
      const text = maxRows ? `SELECT * FROM (${sql.replace(/;\s*$/, '')}) AS q LIMIT ${Number(maxRows)}` : sql;
      if (maxRows && !/^(select|with)\b/i.test(sql.trim())) {
        return client.query(sql, params);
      }
      return client.query(maxRows ? text : sql, params);
    } finally {
      client.release();
    }
  }
}

function asObject(value: any): Record<string, any> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function asParams(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }
  return [];
}

function assertSafeMongo(value: any): void {
  if (Array.isArray(value)) {
    value.forEach(assertSafeMongo);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (BLOCKED_MONGO_OPERATORS.has(key)) {
      throw new BadRequestException(`Mongo operator ${key} is not allowed`);
    }
    assertSafeMongo(child);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
