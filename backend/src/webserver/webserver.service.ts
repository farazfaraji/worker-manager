import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleDestroy,
  Inject,
  forwardRef,
} from '@nestjs/common';
import * as http from 'http';
import * as url from 'url';
import { randomUUID } from 'crypto';
import { GraphsService } from '../graphs/graphs.service';
import { GraphRunnerService } from '../runs/graph-runner.service';

export interface RouteConfig {
  id: string;
  endpoint: string;
  method: string;
  responseMode: 'sync' | 'async';
  nodeName: string;
  type?: string;
}

export interface ActiveServerRecord {
  server: http.Server;
  graphId: string;
  nodeId?: string;
  port: number;
  host: string;
  startedAt: Date;
  routes: RouteConfig[];
}

interface PendingRequest {
  res: http.ServerResponse;
  timer: NodeJS.Timeout;
  resolved: boolean;
}

@Injectable()
export class WebserverService implements OnModuleDestroy {
  private readonly logger = new Logger(WebserverService.name);
  private readonly activeServers = new Map<string, ActiveServerRecord>();
  private readonly pendingRequests = new Map<string, PendingRequest>();

  constructor(
    @Inject(forwardRef(() => GraphsService))
    private readonly graphsService: GraphsService,
    @Inject(forwardRef(() => GraphRunnerService))
    private readonly graphRunnerService: GraphRunnerService,
  ) {}

  onModuleDestroy() {
    this.logger.log('🛑 Shutting down all active background webservers...');
    for (const [graphId] of this.activeServers) {
      this.stopServer(graphId);
    }
  }

  /**
   * Check if a server is running for the given graph and optional webserver node ID.
   */
  getServerStatus(
    graphId: string,
    nodeId?: string,
  ): {
    status: 'running' | 'stopped';
    port?: number;
    host?: string;
    url?: string;
    nodeId?: string;
    activeRoutes?: RouteConfig[];
    startedAt?: string;
  } {
    let existing: ActiveServerRecord | undefined;
    if (nodeId) {
      existing = this.activeServers.get(`${graphId}:${nodeId}`);
    }

    if (!existing) {
      // Fallback to searching any active server for this graphId
      for (const [key, record] of this.activeServers.entries()) {
        if (key.startsWith(`${graphId}:`) || key === graphId) {
          existing = record;
          break;
        }
      }
    }

    if (!existing) {
      return { status: 'stopped', nodeId };
    }

    const hostDisplay = existing.host === '0.0.0.0' ? 'localhost' : existing.host;
    return {
      status: 'running',
      port: existing.port,
      host: existing.host,
      url: `http://${hostDisplay}:${existing.port}`,
      nodeId: existing.nodeId,
      activeRoutes: existing.routes,
      startedAt: existing.startedAt.toISOString(),
    };
  }

  /**
   * Start or restart a webserver for a graph (supports multi-webserver boards).
   */
  async startServer(
    graphId: string,
    targetNodeId?: string,
  ): Promise<{
    status: 'running';
    port: number;
    host: string;
    url: string;
    nodeId: string;
    activeRoutes: RouteConfig[];
  }> {
    const graph = await this.graphsService.findOne(graphId);
    if (!graph) {
      throw new NotFoundException(`Graph with ID "${graphId}" not found`);
    }

    const nodes = graph.nodes || [];
    const edges = graph.edges || [];

    const webserverNodes = nodes.filter((node: any) => {
      const type = String(node.data?.definitionType || node.type || '').toLowerCase();
      return type === 'webserver' || node.data?.definitionId === 'webserver';
    });

    if (webserverNodes.length === 0) {
      throw new BadRequestException('Graph does not contain a "Run Webserver" block');
    }

    const webserverNode = targetNodeId
      ? webserverNodes.find((n: any) => n.id === targetNodeId) || webserverNodes[0]
      : webserverNodes[0];

    const serverNodeId = webserverNode.id;
    const serverKey = `${graphId}:${serverNodeId}`;

    const serverConfig = webserverNode.data?.config || {};
    const port = Number(serverConfig.port) || 3000;
    const host = String(serverConfig.host || '0.0.0.0').trim();
    const corsEnabled = String(serverConfig.cors || 'enabled').toLowerCase() !== 'disabled';

    // Stop existing instance for this server key if running
    if (this.activeServers.has(serverKey)) {
      this.stopServer(graphId, serverNodeId);
    }

    // Check if port is already used by another active graph server
    for (const [existingKey, active] of this.activeServers.entries()) {
      if (active.port === port && existingKey !== serverKey) {
        throw new ConflictException(
          `Port ${port} is already used by another webserver (${existingKey})`,
        );
      }
    }

    // Discover routes connected to this webserver via canvas edges
    const connectedRouteIds = new Set<string>();
    for (const edge of edges) {
      if (edge.source === serverNodeId) {
        connectedRouteIds.add(edge.target);
      }
    }

    const allRouteNodes = nodes.filter((node: any) => {
      const type = String(node.data?.definitionType || node.type || '').toLowerCase();
      return type === 'route' || node.data?.definitionId === 'route';
    });

    let assignedRouteNodes: any[] = [];
    if (connectedRouteIds.size > 0) {
      // Use explicitly connected route nodes
      assignedRouteNodes = allRouteNodes.filter((r: any) => connectedRouteIds.has(r.id));
    } else if (webserverNodes.length === 1) {
      // If only one webserver on the board, automatically mount all routes as fallback
      assignedRouteNodes = allRouteNodes;
    } else {
      assignedRouteNodes = [];
    }

    const routes: RouteConfig[] = assignedRouteNodes.map((r: any) => {
      const cfg = r.data?.config || {};
      let endpoint = String(cfg.endpoint || '/api/example').trim();
      if (!endpoint.startsWith('/')) endpoint = `/${endpoint}`;
      return {
        id: r.id,
        endpoint,
        method: String(cfg.method || 'POST').toUpperCase(),
        responseMode: (cfg.responseMode || 'sync') as 'sync' | 'async',
        nodeName: r.data?.nodeName || r.data?.name || r.id,
        type: cfg.type,
      };
    });

    const server = http.createServer((req, res) => {
      this.handleIncomingRequest(graphId, req, res, routes, corsEnabled);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          reject(new ConflictException(`Port ${port} is already in use by system process`));
        } else {
          reject(err);
        }
      });

      server.listen(port, host, () => {
        this.logger.log(
          `🚀 [WEBSERVER STARTED] Graph "${graph.name}" [Node: ${serverNodeId}] listening on http://${host}:${port} (${routes.length} routes)`,
        );
        resolve();
      });
    });

    this.activeServers.set(serverKey, {
      server,
      graphId,
      nodeId: serverNodeId,
      port,
      host,
      startedAt: new Date(),
      routes,
    });

    const hostDisplay = host === '0.0.0.0' ? 'localhost' : host;
    return {
      status: 'running',
      port,
      host,
      url: `http://${hostDisplay}:${port}`,
      nodeId: serverNodeId,
      activeRoutes: routes,
    };
  }

  /**
   * Stop an active webserver for a graph.
   */
  stopServer(graphId: string, targetNodeId?: string): { status: 'stopped'; graphId: string; nodeId?: string } {
    if (targetNodeId) {
      const serverKey = `${graphId}:${targetNodeId}`;
      const active = this.activeServers.get(serverKey);
      if (active) {
        try {
          active.server.close(() => {
            this.logger.log(`🛑 [WEBSERVER STOPPED] Graph (${graphId}) Node (${targetNodeId}) port ${active.port} released`);
          });
        } catch (e) {
          this.logger.warn(`Error closing server on port ${active.port}: ${e?.message}`);
        }
        this.activeServers.delete(serverKey);
      }
      return { status: 'stopped', graphId, nodeId: targetNodeId };
    }

    // Stop all servers for this graphId
    for (const [key, active] of Array.from(this.activeServers.entries())) {
      if (key.startsWith(`${graphId}:`) || key === graphId) {
        try {
          active.server.close(() => {
            this.logger.log(`🛑 [WEBSERVER STOPPED] Graph (${graphId}) port ${active.port} released`);
          });
        } catch (e) {
          this.logger.warn(`Error closing server on port ${active.port}: ${e?.message}`);
        }
        this.activeServers.delete(key);
      }
    }

    return { status: 'stopped', graphId };
  }

  /**
   * Resolves a pending HTTP request when an HTTP Response block is executed.
   */
  resolvePendingResponse(
    requestId: string,
    response: {
      statusCode?: number;
      body?: any;
      headers?: Record<string, any>;
    },
  ): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending || pending.resolved) {
      return false;
    }

    clearTimeout(pending.timer);
    pending.resolved = true;
    this.pendingRequests.delete(requestId);

    const res = pending.res;
    const statusCode = response.statusCode || 200;
    const customHeaders = response.headers || {};

    try {
      for (const [headerKey, headerVal] of Object.entries(customHeaders)) {
        res.setHeader(headerKey, String(headerVal));
      }

      let payload = response.body;
      if (typeof payload === 'object' && payload !== null) {
        if (!res.getHeader('Content-Type')) {
          res.setHeader('Content-Type', 'application/json');
        }
        payload = JSON.stringify(payload);
      } else if (payload === undefined || payload === null) {
        payload = '';
      } else {
        payload = String(payload);
      }

      res.writeHead(statusCode);
      res.end(payload);
      return true;
    } catch (err) {
      this.logger.error(`Error sending response for request ${requestId}: ${err?.message}`);
      return false;
    }
  }

  /**
   * Internal HTTP Request Handler for incoming endpoint hits.
   */
  private async handleIncomingRequest(
    graphId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    routes: RouteConfig[],
    corsEnabled: boolean,
  ) {
    // 1. CORS Headers
    if (corsEnabled) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    const parsedUrl = url.parse(req.url || '/', true);
    const pathname = parsedUrl.pathname || '/';
    const reqMethod = (req.method || 'GET').toUpperCase();

    // 2. Find matching route
    let matchedRoute: RouteConfig | undefined;
    let pathParams: Record<string, string> = {};

    for (const r of routes) {
      if (r.method !== reqMethod && r.method !== 'ALL') continue;
      const match = this.matchRoutePattern(r.endpoint, pathname);
      if (match) {
        matchedRoute = r;
        pathParams = match;
        break;
      }
    }

    if (!matchedRoute) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Not Found',
          message: `No route matching [${reqMethod}] ${pathname}`,
          availableRoutes: routes.map((r) => `[${r.method}] ${r.endpoint}`),
        }),
      );
      return;
    }

    // 3. Read Body
    let body: any = {};
    try {
      body = await this.readRequestBody(req);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad Request', message: 'Failed to parse JSON body' }));
      return;
    }

    const requestId = randomUUID();
    const triggerPayload = {
      body,
      params: pathParams,
      query: parsedUrl.query || {},
      headers: req.headers,
      ...(typeof body === 'object' && body !== null ? body : {}),
    };

    this.logger.log(
      `🌐 [HTTP INCOMING] [${reqMethod}] ${pathname} -> Routing to Node "${matchedRoute.nodeName}" (${matchedRoute.id})`,
    );

    // 4. Asynchronous Mode: Return immediate 202
    if (matchedRoute.responseMode === 'async') {
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'dispatched',
          message: 'Workflow accepted and running in background',
          requestId,
        }),
      );

      // Execute graph in background
      this.graphRunnerService
        .runGraph(graphId, triggerPayload, {
          startNodeId: matchedRoute.id,
        })
        .catch((err) => {
          this.logger.error(`Async execution failed for route ${matchedRoute?.endpoint}: ${err?.message}`);
        });
      return;
    }

    // 5. Synchronous Mode: Hold connection and wait for response block or completion
    const timer = setTimeout(() => {
      if (this.pendingRequests.has(requestId)) {
        this.pendingRequests.delete(requestId);
        if (!res.headersSent) {
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'Gateway Timeout',
              message: 'Execution timed out waiting for HTTP response block',
            }),
          );
        }
      }
    }, 30000);

    this.pendingRequests.set(requestId, { res, timer, resolved: false });

    try {
      const runResult = await this.graphRunnerService.runGraph(graphId, triggerPayload, {
        startNodeId: matchedRoute.id,
        context: { __webserverRequestId: requestId },
      });

      // If run completed and HTTP Response block was not used, respond with final output
      if (this.pendingRequests.has(requestId)) {
        const finalOutput = runResult?.output || runResult;
        this.resolvePendingResponse(requestId, {
          statusCode: 200,
          body: finalOutput,
        });
      }
    } catch (err) {
      if (this.pendingRequests.has(requestId)) {
        this.resolvePendingResponse(requestId, {
          statusCode: 500,
          body: {
            error: 'Internal Server Error',
            message: err?.message || 'Flow execution failed',
          },
        });
      }
    }
  }

  private readRequestBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        if (chunks.length === 0) {
          return resolve({});
        }
        const text = Buffer.concat(chunks).toString('utf-8').trim();
        if (!text) return resolve({});
        try {
          resolve(JSON.parse(text));
        } catch {
          resolve(text);
        }
      });
      req.on('error', (err) => reject(err));
    });
  }

  /**
   * Matches URL patterns like /users/:id or /api/webhook
   */
  private matchRoutePattern(pattern: string, actualPath: string): Record<string, string> | null {
    const cleanPattern = pattern.replace(/\/+$/, '') || '/';
    const cleanActual = actualPath.replace(/\/+$/, '') || '/';

    if (cleanPattern === cleanActual) return {};

    const patternParts = cleanPattern.split('/');
    const actualParts = cleanActual.split('/');

    if (patternParts.length !== actualParts.length) return null;

    const params: Record<string, string> = {};
    for (let i = 0; i < patternParts.length; i++) {
      const p = patternParts[i];
      const a = actualParts[i];

      if (p.startsWith(':')) {
        const paramName = p.slice(1);
        params[paramName] = decodeURIComponent(a);
      } else if (p.toLowerCase() !== a.toLowerCase()) {
        return null;
      }
    }

    return params;
  }
}
