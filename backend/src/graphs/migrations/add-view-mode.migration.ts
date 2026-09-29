/**
 * Migration: add-view-mode
 *
 * Stamps `metadata.viewMode = 'canvas'` on every existing Graph document
 * that has no viewMode set. New graphs created after this migration will
 * default to 'list' (set via CreateGraphDto).
 *
 * Run with:
 *   npx ts-node -r tsconfig-paths/register \
 *     src/graphs/migrations/add-view-mode.migration.ts
 */

import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../../app.module';
import { Graph } from '../schemas/graph.schema';

async function runMigration() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const graphModel = app.get<Model<Graph>>(getModelToken(Graph.name));

  // Stamp all existing graphs (no viewMode) as 'canvas' (old behaviour)
  const result = await graphModel.updateMany(
    {
      $or: [
        { 'metadata.viewMode': { $exists: false } },
        { 'metadata.viewMode': null },
      ],
    },
    {
      $set: { 'metadata.viewMode': 'canvas' },
    },
  );

  console.log(`✅ Migration complete.`);
  console.log(`   Matched : ${result.matchedCount} graphs`);
  console.log(`   Modified: ${result.modifiedCount} graphs`);

  await app.close();
}

runMigration().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
