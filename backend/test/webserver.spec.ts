import * as assert from 'assert';
import * as http from 'http';
import { NodeDefinitionsService } from '../src/node-definitions/node-definitions.service';
import { WebserverService } from '../src/webserver/webserver.service';
import { GraphsService } from '../src/graphs/graphs.service';
import { GraphShapeService } from '../src/graphs/graph-shape.service';
import { RunTopologyService } from '../src/runs/services/run-topology.service';

function makeHttpRequest(
  port: number,
  path: string,
  method: string,
  body?: any,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          let parsed: any = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {}
          resolve({
            statusCode: res.statusCode || 200,
            headers: res.headers,
            body: parsed,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING WEBSERVER & ROUTE TEST SUITE');
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

  // 1. Tool Definitions
  await test('1.1 Webserver tool definition exists and loads with correct inputs', async () => {
    const service = new NodeDefinitionsService();
    const defs = await service.getAllDefinitions();
    const webserverDef = defs.find((d) => d.type === 'webserver' || d.id === 'webserver');
    assert.ok(webserverDef, 'webserver definition should exist');
    assert.strictEqual(webserverDef.category, 'Integration');
    const portInput = webserverDef.inputs.find((i) => i.name === 'port');
    assert.ok(portInput, 'webserver must have a port input');
  });

  await test('1.2 Route tool definition exists and loads with schemaFrom type', async () => {
    const service = new NodeDefinitionsService();
    const defs = await service.getAllDefinitions();
    const routeDef = defs.find((d) => d.type === 'route' || d.id === 'route');
    assert.ok(routeDef, 'route definition should exist');
    assert.strictEqual(routeDef.category, 'Flow');
    const bodyOutput = routeDef.outputs.find((o) => o.name === 'body');
    assert.ok(bodyOutput, 'route must output body');
    assert.strictEqual(bodyOutput.schemaFrom, 'type');
  });

  await test('1.3 HTTP Response tool definition exists and loads with statusCode and responseBody', async () => {
    const service = new NodeDefinitionsService();
    const defs = await service.getAllDefinitions();
    const respDef = defs.find((d) => d.type === 'http-response' || d.id === 'http-response');
    assert.ok(respDef, 'http-response definition should exist');
    assert.strictEqual(respDef.category, 'Integration');
    assert.ok(respDef.inputs.some((i) => i.name === 'statusCode'));
    assert.ok(respDef.inputs.some((i) => i.name === 'responseBody'));
  });

  // 2. Variable Extraction from Route type
  await test('2.1 GraphsService enriches Route node outputs by parsing type schema', async () => {
    const defService = new NodeDefinitionsService();
    const graphsService = new GraphsService({} as any, defService, new GraphShapeService());

    const testNodes = [
      {
        id: 'route-1',
        type: 'route',
        data: {
          nodeName: 'route_1',
          config: {
            endpoint: '/api/order',
            method: 'POST',
            type: `z.object({
              orderId: z.string(),
              totalAmount: z.number(),
              items: z.array(z.string())
            })`,
          },
        },
      },
    ];

    const enriched = await graphsService.enrichNodesWithOutputs(testNodes);
    assert.strictEqual(enriched.length, 1);
    const bodyOutput = enriched[0].data.outputs.find((o: any) => o.name === 'body');
    assert.ok(bodyOutput, 'body output must be present');
    assert.ok(bodyOutput.schema, 'body output must have parsed schema');
    assert.strictEqual(bodyOutput.schema.orderId, 'string');
    assert.strictEqual(bodyOutput.schema.totalAmount, 'number');
    assert.strictEqual(bodyOutput.schema.items, 'array');
  });

  await test('2.2 GraphsService enriches Route node query outputs by parsing querySchema', async () => {
    const defService = new NodeDefinitionsService();
    const graphsService = new GraphsService({} as any, defService, new GraphShapeService());

    const testNodes = [
      {
        id: 'route-query-test',
        type: 'route',
        data: {
          nodeName: 'route_get',
          config: {
            endpoint: '/api/search',
            method: 'GET',
            querySchema: `z.object({
              search: z.string(),
              limit: z.number().optional(),
              filters: z.array(z.string())
            })`,
          },
        },
      },
    ];

    const enriched = await graphsService.enrichNodesWithOutputs(testNodes);
    assert.strictEqual(enriched.length, 1);
    const queryOutput = enriched[0].data.outputs.find((o: any) => o.name === 'query');
    assert.ok(queryOutput, 'query output must be present');
    assert.ok(queryOutput.schema, 'query output must have parsed schema');
    assert.strictEqual(queryOutput.schema.search, 'string');
    assert.strictEqual(queryOutput.schema.limit, 'number');
    assert.strictEqual(queryOutput.schema.filters, 'array');
  });

  // 3. Webserver lifecycle & Route dispatching
  await test('3.1 WebserverService starts server, handles routes, and returns synchronous response', async () => {
    const testPort = 7892;
    const testGraphId = 'test-graph-123';

    let dispatchedPayload: any = null;
    let dispatchedOptions: any = null;

    const mockGraphsService: any = {
      findOne: async () => ({
        _id: testGraphId,
        name: 'Test Flow Webserver',
        nodes: [
          {
            id: 'ws-1',
            type: 'webserver',
            data: {
              config: { port: testPort, host: '127.0.0.1' },
            },
          },
          {
            id: 'route-1',
            type: 'route',
            data: {
              nodeName: 'route_1',
              config: {
                endpoint: '/api/hello',
                method: 'POST',
                responseMode: 'sync',
              },
            },
          },
        ],
      }),
    };

    let webserverService: WebserverService;

    const mockGraphRunner: any = {
      runGraph: async (graphId: string, payload: any, options: any) => {
        dispatchedPayload = payload;
        dispatchedOptions = options;

        // Simulate execution hitting HTTP Response block resolving the request
        const reqId = options.context?.__webserverRequestId;
        if (reqId) {
          webserverService.resolvePendingResponse(reqId, {
            statusCode: 201,
            body: { message: `Hello ${payload.body?.name || 'World'}`, received: true },
            headers: { 'X-Custom-Header': 'FlowBuilder' },
          });
        }
        return { status: 'completed' };
      },
    };

    webserverService = new WebserverService(mockGraphsService, mockGraphRunner);

    // Start server
    const startResult = await webserverService.startServer(testGraphId);
    assert.strictEqual(startResult.status, 'running');
    assert.strictEqual(startResult.port, testPort);

    // Send HTTP Request
    const res = await makeHttpRequest(testPort, '/api/hello', 'POST', { name: 'Faraz' });
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.message, 'Hello Faraz');
    assert.strictEqual(res.body.received, true);
    assert.strictEqual(res.headers['x-custom-header'], 'FlowBuilder');

    // Verify dispatched payload to runner
    assert.ok(dispatchedPayload, 'GraphRunner must receive payload');
    assert.strictEqual(dispatchedPayload.name, 'Faraz');
    assert.strictEqual(dispatchedPayload.body.name, 'Faraz');
    assert.strictEqual(dispatchedOptions.startNodeId, 'route-1');

    // Stop server
    const stopResult = webserverService.stopServer(testGraphId);
    assert.strictEqual(stopResult.status, 'stopped');

    // Verify status returns stopped
    const status = webserverService.getServerStatus(testGraphId);
    assert.strictEqual(status.status, 'stopped');
  });

  await test('3.2 WebserverService handles 404 for unregistered routes', async () => {
    const testPort = 7893;
    const testGraphId = 'test-graph-404';

    const mockGraphsService: any = {
      findOne: async () => ({
        _id: testGraphId,
        name: '404 Test Flow',
        nodes: [
          {
            id: 'ws-1',
            type: 'webserver',
            data: { config: { port: testPort, host: '127.0.0.1' } },
          },
          {
            id: 'route-1',
            type: 'route',
            data: { config: { endpoint: '/api/v1/valid', method: 'GET' } },
          },
        ],
      }),
    };

    const mockGraphRunner: any = { runGraph: async () => {} };
    const webserverService = new WebserverService(mockGraphsService, mockGraphRunner);

    await webserverService.startServer(testGraphId);
    const res = await makeHttpRequest(testPort, '/api/v1/invalid', 'GET');
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.error, 'Not Found');

    webserverService.stopServer(testGraphId);
  });

  await test('3.3 WebserverService handles async responseMode with immediate 202', async () => {
    const testPort = 7894;
    const testGraphId = 'test-graph-async';

    let asyncDispatched = false;
    const mockGraphsService: any = {
      findOne: async () => ({
        _id: testGraphId,
        name: 'Async Test Flow',
        nodes: [
          {
            id: 'ws-1',
            type: 'webserver',
            data: { config: { port: testPort, host: '127.0.0.1' } },
          },
          {
            id: 'route-async',
            type: 'route',
            data: {
              config: {
                endpoint: '/webhook/event',
                method: 'POST',
                responseMode: 'async',
              },
            },
          },
        ],
      }),
    };

    const mockGraphRunner: any = {
      runGraph: async () => {
        asyncDispatched = true;
        return { status: 'completed' };
      },
    };

    const webserverService = new WebserverService(mockGraphsService, mockGraphRunner);
    await webserverService.startServer(testGraphId);

    const res = await makeHttpRequest(testPort, '/webhook/event', 'POST', { event: 'created' });
    assert.strictEqual(res.statusCode, 202);
    assert.strictEqual(res.body.status, 'dispatched');

    // Wait a brief tick for background dispatch
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(asyncDispatched, true);

    webserverService.stopServer(testGraphId);
  });

  await test('3.4 WebserverService supports multiple webservers per board routed via edges', async () => {
    const portPublic = 7895;
    const portAdmin = 7896;
    const testGraphId = 'multi-ws-graph';

    const mockGraphsService: any = {
      findOne: async () => ({
        _id: testGraphId,
        name: 'Multi-Webserver Flow',
        nodes: [
          {
            id: 'ws-public',
            type: 'webserver',
            data: { config: { port: portPublic, host: '127.0.0.1' } },
          },
          {
            id: 'ws-admin',
            type: 'webserver',
            data: { config: { port: portAdmin, host: '127.0.0.1' } },
          },
          {
            id: 'route-public',
            type: 'route',
            data: { nodeName: 'public_route', config: { endpoint: '/api/public', method: 'GET', responseMode: 'sync' } },
          },
          {
            id: 'route-admin',
            type: 'route',
            data: { nodeName: 'admin_route', config: { endpoint: '/api/admin', method: 'GET', responseMode: 'sync' } },
          },
        ],
        edges: [
          { source: 'ws-public', target: 'route-public' },
          { source: 'ws-admin', target: 'route-admin' },
        ],
      }),
    };

    let webserverService: WebserverService;
    const mockGraphRunner: any = {
      runGraph: async (_graphId: string, _payload: any, options: any) => {
        const reqId = options.context?.__webserverRequestId;
        if (reqId) {
          const isPublic = options.startNodeId === 'route-public';
          webserverService.resolvePendingResponse(reqId, {
            statusCode: 200,
            body: { scope: isPublic ? 'public' : 'admin' },
          });
        }
        return { status: 'completed' };
      },
    };

    webserverService = new WebserverService(mockGraphsService, mockGraphRunner);

    // Start both webservers
    await webserverService.startServer(testGraphId, 'ws-public');
    await webserverService.startServer(testGraphId, 'ws-admin');

    // Test public server handles /api/public (200) but not /api/admin (404)
    const resPublic1 = await makeHttpRequest(portPublic, '/api/public', 'GET');
    assert.strictEqual(resPublic1.statusCode, 200);
    assert.strictEqual(resPublic1.body.scope, 'public');

    const resPublic2 = await makeHttpRequest(portPublic, '/api/admin', 'GET');
    assert.strictEqual(resPublic2.statusCode, 404);

    // Test admin server handles /api/admin (200) but not /api/public (404)
    const resAdmin1 = await makeHttpRequest(portAdmin, '/api/admin', 'GET');
    assert.strictEqual(resAdmin1.statusCode, 200);
    assert.strictEqual(resAdmin1.body.scope, 'admin');

    const resAdmin2 = await makeHttpRequest(portAdmin, '/api/public', 'GET');
    assert.strictEqual(resAdmin2.statusCode, 404);

    // Cleanup both
    webserverService.stopServer(testGraphId, 'ws-public');
    webserverService.stopServer(testGraphId, 'ws-admin');
  });

  await test('3.5 RunTopologyService isolates webserver route start nodes from batch execution', async () => {
    const topology = new RunTopologyService();
    const nodes: any[] = [
      { id: 'ws-1', type: 'webserver', data: { definitionType: 'webserver' } },
      { id: 'route-1', type: 'route', data: { definitionType: 'route' } },
      { id: 'route-2', type: 'route', data: { definitionType: 'route' } },
      { id: 'step-1', type: 'artifact', data: { definitionType: 'artifact' } },
    ];
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const incoming = new Map([
      ['ws-1', 0],
      ['route-1', 1],
      ['route-2', 1],
      ['step-1', 1],
    ]);

    // Top-level run (without requestedStartNodeId): routes must NOT be auto-selected
    const topLevelStarts = topology.determineStartNodes(nodes, incoming, nodeById);
    assert.deepStrictEqual(topLevelStarts, [], 'Must return empty start nodes for webserver flow without standalone triggers');

    // Webserver incoming request (with requestedStartNodeId): only the specific route must be selected
    const route1Starts = topology.determineStartNodes(nodes, incoming, nodeById, 'route-1');
    assert.deepStrictEqual(route1Starts, ['route-1'], 'Must return only route-1 when requested');

    const route2Starts = topology.determineStartNodes(nodes, incoming, nodeById, 'route-2');
    assert.deepStrictEqual(route2Starts, ['route-2'], 'Must return only route-2 when requested');
  });

  console.log('\n=============================================');
  console.log(`📊 RESULTS: ${passed} passed, ${failed} failed`);
  console.log('=============================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
