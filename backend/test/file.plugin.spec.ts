import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileStorageService } from '../src/blocks/file-storage.service';
import { FilePlugin } from '../src/runs/plugins/file.plugin';

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING FILE PLUGIN TESTS');
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

  const storage = new FileStorageService();
  storage.setBaseOverride(mkdtempSync(join(tmpdir(), 'flow-files-')));
  const plugin = new FilePlugin(storage);
  const context = { projectId: 'proj_1' };
  const run = (config: any) => plugin.run({
    node: { data: { config } },
    nodeInput: config,
    context,
    initialInput: {},
    runId: 'run-1',
  });

  const written = await run({ operation: 'write', path: 'notes/hello.md', content: 'hello', mode: 'createOnly' });
  assert(written.result.path === 'notes/hello.md', 'write returns a sandbox-relative path');

  let escaped = false;
  try {
    await run({ operation: 'read', path: '../secret.txt' });
  } catch (err: any) {
    escaped = /sandbox/i.test(err.message);
  }
  assert(escaped, 'paths that leave the sandbox are rejected');

  const read = await run({ operation: 'read', path: 'notes/hello.md' });
  assert(read.result.content === 'hello', 'read returns file contents');

  await run({ operation: 'write', path: 'table.csv', content: 'name,qty\nbolt,2\n' });
  const csv = await run({ operation: 'parse', path: 'table.csv', format: 'csv' });
  assert(csv.result.parsed[0].name === 'bolt' && csv.result.parsed[0].qty === '2', 'parse reads CSV rows');

  const exists = await run({ operation: 'exists', path: 'notes/hello.md' });
  assert(exists.conditionMet === true, 'exists follows the true branch when the file is there');
  const missing = await run({ operation: 'exists', path: 'notes/missing.md' });
  assert(missing.conditionMet === false, 'exists follows the false branch when the file is missing');

  const copied = await run({ operation: 'copy', path: 'notes/hello.md', to: 'notes/copy.md' });
  assert(copied.result.to === 'notes/copy.md', 'copy stays inside the sandbox');

  const listed = await run({ operation: 'list', path: 'notes', glob: '*.md' });
  assert(listed.result.files.length === 2, 'list returns matching files');

  console.log(`\n=============================================`);
  console.log(`📊 RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`=============================================\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
