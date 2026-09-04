import * as assert from 'assert';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { Artifact, ArtifactSchema } from '../src/blocks/schemas/artifact.schema';
import {
  ArtifactRelation,
  ArtifactRelationSchema,
} from '../src/blocks/schemas/artifact-relation.schema';
import {
  VectorRecord,
  VectorRecordSchema,
} from '../src/blocks/schemas/vector-record.schema';
import { EventRecord, EventRecordSchema } from '../src/events/schemas/event.schema';
import { ArtifactService, computeContentHash } from '../src/blocks/artifact.service';
import { ArtifactRelationService } from '../src/blocks/artifact-relation.service';
import {
  ArtifactIndexingService,
  chunkTextWords,
} from '../src/blocks/artifact-indexing.service';
import { VectorStoreService } from '../src/blocks/vector-store.service';
import { EventEngineService } from '../src/events/event-engine.service';
import { runArtifactMigration } from '../src/migrations/artifact-migration';
import { RELATION_INVERSE_MAP } from '../src/blocks/artifact.types';

const TEST_DB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/flow_builder_artifact_test';

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING ARTIFACT FOUNDATION TEST SUITE');
  console.log('=============================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err?.message || err}`);
      if (err?.stack) console.error(err.stack);
      failed++;
    }
  }

  // Connect to test database
  const connection = await mongoose.createConnection(TEST_DB_URI).asPromise();

  // Register schemas on test connection
  const artifactModel = connection.model(Artifact.name, ArtifactSchema);
  const relationModel = connection.model(ArtifactRelation.name, ArtifactRelationSchema);
  const vectorModel = connection.model(VectorRecord.name, VectorRecordSchema);
  const eventModel = connection.model(EventRecord.name, EventRecordSchema);

  // Clean test collections before running
  await artifactModel.deleteMany({});
  await relationModel.deleteMany({});
  await vectorModel.deleteMany({});
  await eventModel.deleteMany({});

  const eventEngine = new EventEngineService(eventModel as any);
  const vectorStore = new VectorStoreService(vectorModel as any);
  const indexingService = new ArtifactIndexingService(vectorModel as any, vectorStore);
  const relationService = new ArtifactRelationService(relationModel as any, eventEngine);
  const artifactService = new ArtifactService(
    artifactModel as any,
    eventEngine,
    relationService,
    indexingService,
  );

  // -------------------------------------------------------------
  // 1. Artifact Identity Tests
  // -------------------------------------------------------------
  console.log('\n--- 1. Artifact Identity Tests ---');

  let createdDoc1: any;
  await test('New artifacts receive logicalId and first version rootArtifactId equals artifactId', async () => {
    createdDoc1 = await artifactService.create({
      artifactId: 'art-identity-test-1',
      title: 'Identity Test Document',
      type: 'prd',
      content: '# Hello World\nInitial version.',
      projectId: 'proj-alpha',
    });

    assert.strictEqual(createdDoc1.artifactId, 'art-identity-test-1');
    assert.strictEqual(createdDoc1.rootArtifactId, 'art-identity-test-1');
    assert.strictEqual(createdDoc1.logicalId, 'art-identity-test-1');
    assert.strictEqual(createdDoc1.version, 1);
    assert.strictEqual(createdDoc1.isLatest, true);
    assert.strictEqual(createdDoc1.schemaVersion, 1);
    assert.ok(createdDoc1.contentHash, 'Should calculate contentHash');
  });

  await test('Custom logicalId is used when explicitly provided', async () => {
    const custom = await artifactService.create({
      logicalId: 'custom-logical-id-xyz',
      title: 'Custom Logical Document',
      type: 'tech-spec',
      content: 'Spec content',
      projectId: 'proj-alpha',
    });

    assert.strictEqual(custom.logicalId, 'custom-logical-id-xyz');
    assert.strictEqual(custom.rootArtifactId, custom.artifactId);
    assert.strictEqual(custom.version, 1);
  });

  await test('Creating an artifact with an already existing logicalId fails with Conflict', async () => {
    await assert.rejects(
      async () => {
        await artifactService.create({
          logicalId: 'custom-logical-id-xyz',
          title: 'Duplicate Logical Document',
          content: 'Conflicting content',
        });
      },
      (err: any) => {
        return err.message.includes('already exists') || err.status === 409;
      },
      'Should reject creating new artifact with duplicate logicalId',
    );
  });

  await test('Exact artifactId lookup returns the requested version', async () => {
    const fetched = await artifactService.getByArtifactId('art-identity-test-1');
    assert.ok(fetched, 'Found by exact artifactId');
    assert.strictEqual(fetched.artifactId, 'art-identity-test-1');
  });

  await test('LogicalId lookup returns the latest version', async () => {
    const fetched = await artifactService.get('art-identity-test-1');
    assert.ok(fetched, 'Found latest by logicalId');
    assert.strictEqual(fetched.logicalId, 'art-identity-test-1');
    assert.strictEqual(fetched.isLatest, true);
  });

  // -------------------------------------------------------------
  // 2. Versioning & Immutability Tests
  // -------------------------------------------------------------
  console.log('\n--- 2. Versioning & Immutability Tests ---');

  let updatedDoc2: any;
  await test('Update creates a new immutable version and marks previous as isLatest: false', async () => {
    updatedDoc2 = await artifactService.update('art-identity-test-1', {
      content: '# Hello World\nSecond revised version.',
      title: 'Identity Test Document Rev 2',
    });

    assert.strictEqual(updatedDoc2.changed, true);
    assert.notStrictEqual(updatedDoc2.artifactId, 'art-identity-test-1');
    assert.strictEqual(updatedDoc2.logicalId, 'art-identity-test-1');
    assert.strictEqual(updatedDoc2.rootArtifactId, 'art-identity-test-1');
    assert.strictEqual(updatedDoc2.parentArtifactId, 'art-identity-test-1');
    assert.strictEqual(updatedDoc2.version, 2);
    assert.strictEqual(updatedDoc2.isLatest, true);

    // Verify previous version record remains unchanged and non-latest
    const prev = await artifactService.getByArtifactId('art-identity-test-1');
    assert.strictEqual(prev.version, 1);
    assert.strictEqual(prev.isLatest, false);
    assert.strictEqual(prev.content, '# Hello World\nInitial version.');
  });

  await test('listVersions returns ordered history ascending by version', async () => {
    const history = await artifactService.listVersions('art-identity-test-1');
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].version, 1);
    assert.strictEqual(history[0].isLatest, false);
    assert.strictEqual(history[1].version, 2);
    assert.strictEqual(history[1].isLatest, true);
  });

  await test('No-op update does not create a new version and returns changed: false', async () => {
    const noopResult = await artifactService.update(updatedDoc2.artifactId, {
      content: '# Hello World\nSecond revised version.',
      title: 'Identity Test Document Rev 2',
    });

    assert.strictEqual(noopResult.changed, false);
    assert.strictEqual(noopResult.artifactId, updatedDoc2.artifactId);
    assert.strictEqual(noopResult.version, 2);

    // Verify no 3rd version was created
    const history = await artifactService.listVersions('art-identity-test-1');
    assert.strictEqual(history.length, 2);
  });

  await test('List query with latestOnly: true filters out older versions', async () => {
    const all = await artifactService.list({ logicalId: 'art-identity-test-1', latestOnly: false });
    assert.strictEqual(all.length, 2);

    const latestList = await artifactService.list({ logicalId: 'art-identity-test-1', latestOnly: true });
    assert.strictEqual(latestList.length, 1);
    assert.strictEqual(latestList[0].version, 2);
  });

  // -------------------------------------------------------------
  // 3. Keyword Tests
  // -------------------------------------------------------------
  console.log('\n--- 3. Keyword Tests ---');

  await test('Canonical keywords written and legacy keyword mirrored for backwards compatibility', async () => {
    const kwDoc = await artifactService.create({
      title: 'Keyword Test Doc',
      keywords: ['auth', 'jwt', 'security'],
      content: 'JWT token details',
    });

    assert.deepStrictEqual(kwDoc.keywords, ['auth', 'jwt', 'security']);
    assert.deepStrictEqual(kwDoc.keyword, ['auth', 'jwt', 'security']);

    const read = await artifactService.get(kwDoc.artifactId);
    assert.deepStrictEqual(read.keywords, ['auth', 'jwt', 'security']);
    assert.deepStrictEqual(read.keyword, ['auth', 'jwt', 'security']);
  });

  // -------------------------------------------------------------
  // 4. Typed Bidirectional Relation Tests
  // -------------------------------------------------------------
  console.log('\n--- 4. Typed Bidirectional Relation Tests ---');

  await test('Self-relations are rejected', async () => {
    await assert.rejects(
      async () => {
        await relationService.addRelation({
          sourceLogicalId: 'doc-self',
          targetLogicalId: 'doc-self',
          type: 'refines',
        });
      },
      (err: any) => err.message.includes('Self-relations are rejected'),
    );
  });

  await test('Typed relation creates forward and inverse directional records in transaction', async () => {
    const res = await relationService.addRelation({
      sourceLogicalId: 'prd-checkout',
      targetLogicalId: 'spec-checkout-api',
      type: 'has-techspec',
      projectId: 'proj-alpha',
    });

    assert.ok(res.forward);
    assert.strictEqual(res.forward.sourceLogicalId, 'prd-checkout');
    assert.strictEqual(res.forward.targetLogicalId, 'spec-checkout-api');
    assert.strictEqual(res.forward.type, 'has-techspec');
    assert.strictEqual(res.forward.inverseType, 'techspec-for');

    assert.ok(res.reverse);
    assert.strictEqual(res.reverse.sourceLogicalId, 'spec-checkout-api');
    assert.strictEqual(res.reverse.targetLogicalId, 'prd-checkout');
    assert.strictEqual(res.reverse.type, 'techspec-for');
    assert.strictEqual(res.reverse.inverseType, 'has-techspec');
  });

  await test('All relation types have inverse mapping defined', async () => {
    for (const [type, inverse] of Object.entries(RELATION_INVERSE_MAP)) {
      assert.strictEqual(RELATION_INVERSE_MAP[inverse as any], type);
    }
  });

  await test('Duplicate relation addition is idempotent and does not throw', async () => {
    const dupRes = await relationService.addRelation({
      sourceLogicalId: 'prd-checkout',
      targetLogicalId: 'spec-checkout-api',
      type: 'has-techspec',
      projectId: 'proj-alpha',
    });

    assert.strictEqual(dupRes.forward.sourceLogicalId, 'prd-checkout');
    assert.strictEqual(dupRes.forward.targetLogicalId, 'spec-checkout-api');

    const count = await relationModel.countDocuments({
      sourceLogicalId: 'prd-checkout',
      targetLogicalId: 'spec-checkout-api',
    });
    assert.strictEqual(count, 1, 'Should not create duplicate relation record');
  });

  await test('Relation lookup supports outgoing, incoming, and both directions', async () => {
    const outgoing = await relationService.getRelations('prd-checkout', { direction: 'outgoing' });
    assert.strictEqual(outgoing.length, 1);
    assert.strictEqual(outgoing[0].type, 'has-techspec');

    const incoming = await relationService.getRelations('prd-checkout', { direction: 'incoming' });
    assert.strictEqual(incoming.length, 1);
    assert.strictEqual(incoming[0].type, 'techspec-for');

    const both = await relationService.getRelations('prd-checkout', { direction: 'both' });
    assert.strictEqual(both.length, 2);
  });

  await test('Relation deletion removes both directions atomically', async () => {
    const forwardRel = await relationModel.findOne({
      sourceLogicalId: 'prd-checkout',
      targetLogicalId: 'spec-checkout-api',
    });
    assert.ok(forwardRel);

    const deleteRes = await relationService.removeRelation(forwardRel.relationId, 'proj-alpha');
    assert.strictEqual(deleteRes.success, true);
    assert.strictEqual(deleteRes.removedCount, 2);

    const remaining = await relationService.getRelations('prd-checkout', { direction: 'both' });
    assert.strictEqual(remaining.length, 0);
  });

  // -------------------------------------------------------------
  // 5. Event Tests
  // -------------------------------------------------------------
  console.log('\n--- 5. Event Tests ---');

  await test('Artifact create and update publish domain events with logical identity', async () => {
    const createEvt = await eventModel.findOne({
      topic: 'artifact.create',
      'data.artifactId': createdDoc1.artifactId,
    }).lean().exec();

    assert.ok(createEvt, 'Create event should be saved in event store');
    assert.strictEqual(createEvt.data.logicalId, createdDoc1.logicalId);
    assert.strictEqual(createEvt.data.rootArtifactId, createdDoc1.rootArtifactId);
    assert.strictEqual(createEvt.data.isLatest, true);

    const updateEvt = await eventModel.findOne({
      topic: 'artifact.update',
      'data.artifactId': updatedDoc2.artifactId,
    }).lean().exec();

    assert.ok(updateEvt, 'Update event should be saved in event store');
    assert.strictEqual(updateEvt.data.logicalId, updatedDoc2.logicalId);
    assert.strictEqual(updateEvt.data.version, 2);
  });

  // -------------------------------------------------------------
  // 6. Retrieval and Vector Indexing Tests
  // -------------------------------------------------------------
  console.log('\n--- 6. Retrieval and Vector Indexing Tests ---');

  await test('chunkTextWords adheres to 400 words max with 50 words overlap', () => {
    const words = Array.from({ length: 900 }, (_, i) => `word${i}`);
    const longText = words.join(' ');

    const chunks = chunkTextWords(longText, 400, 50);
    assert.strictEqual(chunks.length, 3);

    const chunk1Words = chunks[0].split(/\s+/);
    assert.strictEqual(chunk1Words.length, 400);

    const chunk2Words = chunks[1].split(/\s+/);
    assert.strictEqual(chunk2Words.length, 400);
    // Overlap check
    assert.strictEqual(chunk2Words[0], chunk1Words[350]);
  });

  await test('Vector store upserts and queries with default latest-only filter', async () => {
    // Upsert v1 vector
    await vectorStore.upsert({
      namespace: 'test-artifacts',
      sourceType: 'artifact',
      sourceId: 'doc-vec-1',
      logicalId: 'log-vec-1',
      version: 1,
      chunkId: 'c0',
      text: 'First version architecture notes',
      isLatest: false,
      artifactStatus: 'draft',
    });

    // Upsert v2 vector
    await vectorStore.upsert({
      namespace: 'test-artifacts',
      sourceType: 'artifact',
      sourceId: 'doc-vec-2',
      logicalId: 'log-vec-1',
      version: 2,
      chunkId: 'c0',
      text: 'Second version architecture notes',
      isLatest: true,
      artifactStatus: 'draft',
    });

    // Default search (latestOnly: true)
    const latestResults = await vectorStore.search({
      namespace: 'test-artifacts',
      logicalId: 'log-vec-1',
      latestOnly: true,
    });
    assert.strictEqual(latestResults.length, 1);
    assert.strictEqual(latestResults[0].version, 2);

    // Historical search (latestOnly: false)
    const historicalResults = await vectorStore.search({
      namespace: 'test-artifacts',
      logicalId: 'log-vec-1',
      latestOnly: false,
    });
    assert.strictEqual(historicalResults.length, 2);
  });

  // -------------------------------------------------------------
  // 7. Migration Tests
  // -------------------------------------------------------------
  console.log('\n--- 7. Migration Tests ---');

  await test('Artifact migration reconstructs version chains, sets logical identity, and converts relations idempotently', async () => {
    // Setup legacy unmigrated records
    await artifactModel.create([
      {
        artifactId: 'legacy-root',
        title: 'Legacy PRD v1',
        type: 'prd',
        version: 1,
        content: '# Legacy PRD Content',
        keyword: ['legacy', 'prd'],
        linkedArtifactIds: ['legacy-child-spec'],
      },
      {
        artifactId: 'legacy-v2',
        parentArtifactId: 'legacy-root',
        title: 'Legacy PRD v2',
        type: 'prd',
        version: 2,
        content: '# Legacy PRD Content Revised',
      },
      {
        artifactId: 'legacy-child-spec',
        title: 'Legacy Tech Spec',
        type: 'tech-spec',
        version: 1,
        content: '# Child Spec Content',
      },
    ]);

    // 1. Dry run
    const dryReport = await runArtifactMigration(connection, { dryRun: true });
    assert.strictEqual(dryReport.dryRun, true);
    assert.ok(dryReport.migratedCount >= 3);
    assert.strictEqual(dryReport.unresolvedRelationCount, 0);

    // Verify dry run did not touch database (contentHash was not set)
    const unmigratedDoc = await artifactModel.findOne({ artifactId: 'legacy-root' }).lean().exec();
    assert.strictEqual(unmigratedDoc?.contentHash, undefined);

    // 2. Apply migration
    const applyReport = await runArtifactMigration(connection, { dryRun: false });
    assert.strictEqual(applyReport.dryRun, false);
    assert.strictEqual(applyReport.errors.length, 0);

    // Verify highest version is latest: true, older is latest: false
    const rootAfter = await artifactModel.findOne({ artifactId: 'legacy-root' }).lean().exec();
    const v2After = await artifactModel.findOne({ artifactId: 'legacy-v2' }).lean().exec();

    assert.strictEqual(rootAfter?.isLatest, false);
    assert.strictEqual(rootAfter?.logicalId, 'legacy-root');
    assert.strictEqual(rootAfter?.rootArtifactId, 'legacy-root');
    assert.ok(rootAfter?.contentHash);

    assert.strictEqual(v2After?.isLatest, true);
    assert.strictEqual(v2After?.logicalId, 'legacy-root');
    assert.strictEqual(v2After?.rootArtifactId, 'legacy-root');
    assert.ok(v2After?.contentHash);

    // Verify linkedArtifactId was converted to typed 'relates-to' relation
    const rels = await relationModel.find({ sourceLogicalId: 'legacy-root' }).lean().exec();
    assert.strictEqual(rels.length, 1);
    assert.strictEqual(rels[0].targetLogicalId, 'legacy-child-spec');
    assert.strictEqual(rels[0].type, 'relates-to');

    // 3. Second run (idempotency check)
    const idempotentReport = await runArtifactMigration(connection, { dryRun: false });
    assert.strictEqual(idempotentReport.migratedCount, 0);
    assert.strictEqual(idempotentReport.relationsCreatedCount, 0);
  });

  // Teardown
  await connection.dropDatabase();
  await connection.close();

  console.log('\n=============================================');
  console.log(`📊 RESULTS: ${passed} passed, ${failed} failed`);
  console.log('=============================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error('Test runner fatal error:', err);
    process.exit(1);
  });
}
