import { SecretsService } from '../src/secrets/secrets.service';
import { SecretsPlugin } from '../src/runs/plugins/secrets.plugin';
import { VariableResolverService } from '../src/runs/services/variable-resolver.service';
import { decryptSecret, encryptSecret, deriveSecretsKey } from '../src/secrets/secrets.crypto';
import { clearResolvedSecrets, redactSecrets } from '../src/runs/services/redaction.util';

function memoryModel() {
  const docs: any[] = [];
  return {
    findOne(query: any) {
      return { exec: async () => docs.find((doc) => doc.projectId === query.projectId && doc.name === query.name) || null };
    },
    find(query: any) {
      const matched = docs.filter((doc) => doc.projectId === query.projectId);
      const queryable = {
        sort() { return queryable; },
        lean() { return queryable; },
        exec: async () => matched.map((doc) => ({ ...doc })),
      };
      return queryable;
    },
    findOneAndUpdate(query: any, update: any) {
      return {
        exec: async () => {
          let doc = docs.find((item) => item.projectId === query.projectId && item.name === query.name);
          if (!doc) {
            doc = { _id: `id-${docs.length + 1}`, projectId: query.projectId, name: query.name, description: '', createdAt: new Date() };
            docs.push(doc);
          }
          Object.assign(doc, update.$set || {});
          doc.updatedAt = new Date();
          return doc;
        },
      };
    },
    deleteOne(query: any) {
      return {
        exec: async () => {
          const index = docs.findIndex((doc) => doc.projectId === query.projectId && doc.name === query.name);
          if (index < 0) return { deletedCount: 0 };
          docs.splice(index, 1);
          return { deletedCount: 1 };
        },
      };
    },
    updateOne() {
      return { exec: async () => ({}) };
    },
  };
}

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING SECRETS TESTS');
  console.log('=============================================\n');

  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  process.env.SECRETS_MASTER_KEY = 'test-master-key-value';
  clearResolvedSecrets('run-1');

  const key = deriveSecretsKey(process.env.SECRETS_MASTER_KEY);
  const encrypted = encryptSecret('super-secret-token', key);
  assert(decryptSecret(encrypted, key) === 'super-secret-token', 'AES-GCM round trip');
  assert(!encrypted.ciphertext.includes('super-secret-token'), 'ciphertext does not contain the plaintext');

  const service = new SecretsService(memoryModel() as any);
  const meta = await service.set('p1', 'GITHUB_TOKEN', 'alpha-vault-token', 'ci token');
  assert(meta.name === 'GITHUB_TOKEN' && !('ciphertext' in (meta as any)), 'set returns metadata only');
  const listed = await service.list('p1');
  assert(listed.length === 1 && !JSON.stringify(listed).includes('alpha-vault-token'), 'list never returns the value');

  let rejected = false;
  try {
    await service.set('p1', 'lowercase', 'x');
  } catch {
    rejected = true;
  }
  assert(rejected, 'names must be UPPER_SNAKE_CASE');

  const resolver = new VariableResolverService(service);
  const context: Record<string, any> = { projectId: 'p1', runId: 'run-1' };
  await resolver.warmSecrets('using {{secrets.GITHUB_TOKEN}} today', context);
  const resolved = resolver.resolveTemplate('using {{secrets.GITHUB_TOKEN}} today', context);
  assert(resolved === 'using alpha-vault-token today', '{{secrets.NAME}} resolves from the vault');
  assert(!('secrets' in context), 'resolved secrets are not stored on the run context');
  const redacted = String(redactSecrets(resolved));
  assert(redacted === 'using [REDACTED] today', 'resolved secret values are redacted');

  const plugin = new SecretsPlugin(service);
  const exists = await plugin.run({
    node: { data: { config: { operation: 'exists', name: 'GITHUB_TOKEN' } } },
    nodeInput: { operation: 'exists', name: 'GITHUB_TOKEN' },
    context,
    initialInput: {},
    runId: 'run-1',
  });
  assert(exists.conditionMet === true, 'exists routes true when the secret is present');

  const missing = await plugin.run({
    node: { data: { config: { operation: 'exists', name: 'MISSING_TOKEN' } } },
    nodeInput: { operation: 'exists', name: 'MISSING_TOKEN' },
    context,
    initialInput: {},
    runId: 'run-1',
  });
  assert(missing.conditionMet === false, 'exists routes false when the secret is missing');

  const previousKey = process.env.SECRETS_MASTER_KEY;
  delete process.env.SECRETS_MASTER_KEY;
  const unlocked = new SecretsService(memoryModel() as any);
  let missingKey = false;
  try {
    await unlocked.set('p2', 'TOKEN', 'value');
  } catch (err: any) {
    missingKey = String(err?.message || '').includes('Manage Projects');
  }
  assert(missingKey, 'saving a secret without a project encryption key explains where to set it');
  process.env.SECRETS_MASTER_KEY = previousKey;

  clearResolvedSecrets('run-1');
  console.log(`\n=============================================`);
  console.log(`📊 RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`=============================================\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
