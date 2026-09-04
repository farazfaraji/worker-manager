import * as assert from 'assert';
import { GraphShapeService } from '../src/graphs/graph-shape.service';

function runTests() {
  const service = new GraphShapeService();

  const saved = service.reshapeForSave({
    nodes: [
      {
        id: 'fetch',
        type: 'langgraphNode',
        position: { x: 120, y: 80 },
        selected: true,
        dragging: false,
        data: { name: 'fetch_data', config: { url: 'https://example.com' } },
      },
      {
        id: 'retry',
        type: 'langgraphNode',
        position: { x: 120, y: 260 },
        data: { name: 'retry' },
      },
    ],
    edges: [
      {
        id: 'fetch-retry',
        source: 'fetch',
        target: 'retry',
        sourceHandle: 'failure',
        animated: true,
        style: { stroke: '#00aaff' },
      },
    ],
    viewport: { x: 10, y: 20, zoom: 1.25 },
  });

  const semanticFirst = saved.nodes[0] as Record<string, any>;
  assert.strictEqual(semanticFirst.position, undefined);
  assert.deepStrictEqual(semanticFirst, {
    id: 'fetch',
    type: 'langgraphNode',
    data: { name: 'fetch_data', config: { url: 'https://example.com' } },
  });
  assert.deepStrictEqual(saved.layout.nodes.fetch, { x: 120, y: 80 });
  assert.deepStrictEqual(saved.layout.viewport, { x: 10, y: 20, zoom: 1.25 });
  assert.deepStrictEqual(saved.edges[0], {
    id: 'fetch-retry',
    source: 'fetch',
    target: 'retry',
    sourceHandle: 'failure',
  });
  assert.deepStrictEqual(saved.layout.edges['fetch-retry'], {
    animated: true,
    style: { stroke: '#00aaff' },
  });

  const loaded = service.reshapeForLoad(saved);
  assert.deepStrictEqual(loaded.nodes[0].position, { x: 120, y: 80 });
  assert.strictEqual(loaded.nodes[0].selected, undefined);
  assert.strictEqual(loaded.edges[0].animated, true);
  assert.deepStrictEqual(loaded.edges[0].style, { stroke: '#00aaff' });

  // Graphs saved before the layout field existed retain their inline positions.
  const legacy = service.reshapeForLoad({
    nodes: [{ id: 'legacy', position: { x: 42, y: 84 }, data: { name: 'legacy' } }],
    edges: [],
  });
  assert.deepStrictEqual(legacy.layout.nodes.legacy, { x: 42, y: 84 });
  assert.deepStrictEqual(legacy.nodes[0].position, { x: 42, y: 84 });

  console.log('✅ Graph shape service tests passed');
}

runTests();
