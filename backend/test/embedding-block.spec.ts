import { BlockRuntimeService } from '../src/blocks/block-runtime.service';
import * as assert from 'assert';

async function runEmbeddingTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING EMBEDDING BLOCK TESTS');
  console.log('=============================================\n');

  const mockEmbeddings = {
    embedMany: async (texts: string[], config: any) => {
      return texts.map((t, idx) => [idx * 0.1, idx * 0.2]);
    },
  };

  const runtime = new BlockRuntimeService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    mockEmbeddings as any,
    {} as any,
  );

  // 1. Single text string
  const res1 = await runtime.execute('embedding', { input: { text: 'hello world' }, config: {} });
  assert.strictEqual(res1.status, 'completed');
  assert.deepStrictEqual(res1.embedding, [0, 0]);
  assert.strictEqual(res1.embeddings.length, 1);
  assert.deepStrictEqual(res1.result.embedding, [0, 0]);
  console.log('  ✅ PASS: Single text string');

  // 2. Array of strings in text
  const res2 = await runtime.execute('embedding', { input: { text: ['chunk 1', 'chunk 2'] }, config: {} });
  assert.strictEqual(res2.status, 'completed');
  assert.strictEqual(res2.embedding, undefined);
  assert.strictEqual(res2.embeddings.length, 2);
  assert.deepStrictEqual(res2.embeddings[0], [0, 0]);
  assert.deepStrictEqual(res2.embeddings[1], [0.1, 0.2]);
  console.log('  ✅ PASS: Array of strings in text');

  // 3. Stringified JSON array in text
  const res3 = await runtime.execute('embedding', { input: { text: '["item 1", "item 2"]' }, config: {} });
  assert.strictEqual(res3.status, 'completed');
  assert.strictEqual(res3.embeddings.length, 2);
  console.log('  ✅ PASS: JSON string array in text');

  // 4. Backward compatibility with texts
  const res4 = await runtime.execute('embedding', { input: { texts: ['legacy 1', 'legacy 2'] }, config: {} });
  assert.strictEqual(res4.status, 'completed');
  assert.strictEqual(res4.embeddings.length, 2);
  console.log('  ✅ PASS: Backward compatibility with texts');

  // 5. Direct array input
  const res5 = await runtime.execute('embedding', { input: ['raw 1', 'raw 2'], config: {} });
  assert.strictEqual(res5.status, 'completed');
  assert.strictEqual(res5.embeddings.length, 2);
  console.log('  ✅ PASS: Direct array input');

  // 6. Linked to Artifact: Vectors stored out-of-band, raw vectors suppressed from state
  const upsertedRecords: any[] = [];
  const mockVectors = {
    upsert: async (record: any) => {
      upsertedRecords.push(record);
      return record;
    },
  };
  const mockArtifacts = {
    get: async (id: string) => {
      if (id === 'art_100') {
        return { artifactId: 'art_100', logicalId: 'log_auth', version: 2, title: 'Auth PRD', type: 'prd', content: 'Auth spec content' };
      }
      return null;
    },
  };
  const artifactLinkedRuntime = new BlockRuntimeService(
    mockArtifacts as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    mockEmbeddings as any,
    mockVectors as any,
  );

  const res6 = await artifactLinkedRuntime.execute('embedding', {
    input: { text: ['section 1', 'section 2'], artifactId: 'art_100' },
    config: {},
  });
  assert.strictEqual(res6.status, 'completed');
  assert.strictEqual(res6.stored, true);
  assert.strictEqual(res6.artifactId, 'art_100');
  assert.strictEqual(res6.logicalId, 'log_auth');
  assert.strictEqual(res6.indexedChunks, 2);
  // Ensure state bloat is prevented: raw vectors omitted by default
  assert.strictEqual(res6.embedding, undefined);
  assert.strictEqual(res6.embeddings, undefined);
  assert.strictEqual(res6.result.embeddings, undefined);
  assert.strictEqual(upsertedRecords.length, 2);
  assert.strictEqual(upsertedRecords[0].artifactId, 'art_100');
  assert.strictEqual(upsertedRecords[0].logicalId, 'log_auth');
  assert.strictEqual(upsertedRecords[0].version, 2);
  assert.deepStrictEqual(upsertedRecords[0].embedding, [0, 0]);
  console.log('  ✅ PASS: Linked to Artifact (persisted out-of-band, state bloat prevented)');

  // 7. Linked to Artifact with explicit includeRawVectors: true
  const res7 = await artifactLinkedRuntime.execute('embedding', {
    input: { text: 'query string', artifactId: 'art_100', includeRawVectors: true },
    config: {},
  });
  assert.strictEqual(res7.stored, true);
  assert.deepStrictEqual(res7.embedding, [0, 0]);
  assert.strictEqual(res7.embeddings.length, 1);
  console.log('  ✅ PASS: Linked to Artifact with explicit includeRawVectors: true');

  // 8. Artifact ID provided without text: loads content automatically from artifact
  upsertedRecords.length = 0;
  const res8 = await artifactLinkedRuntime.execute('embedding', {
    input: { artifactId: 'art_100' },
    config: {},
  });
  assert.strictEqual(res8.stored, true);
  assert.strictEqual(res8.indexedChunks, 1);
  assert.strictEqual(upsertedRecords[0].text, 'Auth spec content');
  console.log('  ✅ PASS: Content fallback loaded directly from linked artifact');

  console.log('\n=============================================');
  console.log('📊 RESULTS: All 8 embedding tests passed');
  console.log('=============================================\n');
}

runEmbeddingTests().catch((err) => {
  console.error('❌ Embedding tests failed:', err);
  process.exit(1);
});
