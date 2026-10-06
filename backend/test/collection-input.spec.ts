import * as assert from 'node:assert';
import { normalizeCollectionInput } from '../src/runs/utils/collection-input.util';

function runTests() {
  console.log('\n=============================================');
  console.log('RUNNING COLLECTION INPUT TESTS');
  console.log('=============================================\n');

  assert.deepStrictEqual(normalizeCollectionInput([1, 2]), [1, 2]);
  assert.deepStrictEqual(normalizeCollectionInput({ items: ['a'] }), ['a']);
  assert.deepStrictEqual(normalizeCollectionInput({ files: [{ path: '1.png' }] }), [{ path: '1.png' }]);
  assert.deepStrictEqual(
    normalizeCollectionInput({ result: { files: [{ path: '2.png' }] } }),
    [{ path: '2.png' }],
  );
  assert.strictEqual(normalizeCollectionInput({ result: { path: 'x' } }), null);

  console.log('All collection input tests passed.\n');
}

runTests();
