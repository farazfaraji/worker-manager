import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { randomUUID } from 'crypto';
import { GraphsService } from '../graphs/graphs.service';
import { Run, RunDocument, NodeRunRecord } from './schemas/run.schema';
import { RunCheckpoint, RunCheckpointDocument } from './schemas/run-checkpoint.schema';
import { VariableResolverService, RuntimeNode } from './services/variable-resolver.service';
import { NodeExecutorService } from './services/node-executor.service';
import { BrowserRunnerService } from './services/browser-runner.service';
import {
  ExecutionPolicy,
  ResumePayload,
  RunMetrics,
  RunState,
  WaitingDescriptor,
} from './run.types';
import {
  calculateObjectSize,
  clearResolvedSecrets,
  generateResumeToken,
  hashToken,
} from './services/redaction.util';
import { RunLeaseService } from './services/run-lease.service';
import { RunCheckpointService, PersistCheckpointParams } from './services/run-checkpoint.service';
import { RunTopologyService } from './services/run-topology.service';
import { SubgraphRunnerService } from './services/subgraph-runner.service';
import { RunRecoveryService } from './services/run-recovery.service';
import { RunStorageService } from './services/run-storage.service';
import { WebserverService } from '../webserver/webserver.service';
import { TelegramService } from '../telegram/telegram.service';
import { NodeCacheService } from './services/node-cache.service';
import { GraphCompilerService } from './compiler/graph-compiler.service';
import { FlowGraphStateType } from './compiler/graph-state';

export interface RunGraphOptions {
  existingRunId?: string;
  startNodeId?: string;
  parentRunId?: string;
  rootRunId?: string;
  rerunFromNodeId?: string;
  idempotencyKey?: string;
  sourceEventId?: string;
  sourceEventTopic?: string;
  propagationDepth?: number;
  visitedArtifactLogicalIds?: string[];
  propagationRunId?: string;
  subgraphDepth?: number;
  context?: Record<string, any>;
  priorRecords?: any[];
  executionQueue?: string[];
  checkpointSequence?: number;
  projectId?: string;
  metrics?: RunMetrics;
  debugMode?: boolean;
  useCache?: boolean;
  useLangGraph?: boolean;
}

@Injectable()
export class GraphRunnerService {
  private readonly logger = new Logger(GraphRunnerService.name);
  private readonly maxExecutionSteps = 1000;
  private readonly maxSubgraphDepth = 10;
  private readonly maxQueueLength = 1000;
  private readonly maxPropagationDepth = 5;
  private readonly maxVisitedLogicalIds = 100;

  private leaseService: RunLeaseService;
  private checkpointService: RunCheckpointService;
  private topologyService: RunTopologyService;
  private subgraphRunner: SubgraphRunnerService;
  private recoveryService: RunRecoveryService;
  private storageService: RunStorageService;

  constructor(
    @Inject(forwardRef(() => GraphsService))
    private readonly graphsService: GraphsService,
    @InjectModel(Run.name) private readonly runModel: Model<RunDocument>,
    @InjectModel(RunCheckpoint.name) private readonly checkpointModel: Model<RunCheckpointDocument>,
    private readonly variableResolver: VariableResolverService,
    private readonly nodeExecutor: NodeExecutorService,
    private readonly browserRunner: BrowserRunnerService,
    @Optional() leaseService?: RunLeaseService,
    @Optional() checkpointService?: RunCheckpointService,
    @Optional() topologyService?: RunTopologyService,
    @Optional() subgraphRunner?: SubgraphRunnerService,
    @Optional() recoveryService?: RunRecoveryService,
    @Optional() storageService?: RunStorageService,
    @Inject(forwardRef(() => WebserverService))
    @Optional()
    private readonly webserverService?: WebserverService,
    @Inject(forwardRef(() => TelegramService))
    @Optional()
    private readonly telegramService?: TelegramService,
    @Optional()
    private readonly nodeCacheService?: NodeCacheService,
    @Optional()
    private readonly graphCompiler?: GraphCompilerService,
  ) {
    this.checkpointService = checkpointService || new RunCheckpointService(this.checkpointModel);
    this.leaseService = leaseService || new RunLeaseService(this.runModel);
    this.topologyService = topologyService || new RunTopologyService();
    this.subgraphRunner = subgraphRunner || new SubgraphRunnerService();
    this.storageService = storageService || new RunStorageService(this.runModel, this.checkpointService);
    this.recoveryService =
      recoveryService ||
      new RunRecoveryService(
        this.runModel,
        this.leaseService,
        this.checkpointService,
        this.storageService,
      );
  }

  // =========================================================================
  // Lease & Checkpoint Delegations (Compatibility)
  // =========================================================================

  async acquireLease(runId: string, ownerId?: string): Promise<boolean> {
    return this.leaseService.acquireLease(runId, ownerId);
  }

  async releaseLease(runId: string, ownerId?: string): Promise<void> {
    return this.leaseService.releaseLease(runId, ownerId);
  }

  async persistCheckpoint(params: PersistCheckpointParams): Promise<RunCheckpointDocument> {
    return this.checkpointService.persistCheckpoint(params);
  }

  // =========================================================================
  // Main Graph Execution
  // =========================================================================

  async runGraph(
    graphId: string,
    initialInput: any = {},
    options: RunGraphOptions = {},
  ): Promise<any> {
    const startTime = Date.now();
    const inputSize = calculateObjectSize(initialInput);
    this.logger.log(`🚀 [FLOW RUN TRIGGERED] Graph ID: ${graphId} | Input size: ${inputSize} bytes`);

    if (!isValidObjectId(graphId)) {
      this.logger.error(`❌ Graph ID "${graphId}" is not a valid MongoDB ObjectId`);
      throw new NotFoundException(`Graph ID "${graphId}" is invalid`);
    }

    const graph = await this.graphsService.findOne(graphId);
    if (!graph) {
      this.logger.error(`❌ Graph with ID "${graphId}" was not found in MongoDB`);
      throw new NotFoundException(`Graph "${graphId}" not found`);
    }

    // 1. Idempotency Check
    if (options.idempotencyKey) {
      const existingRun = await this.runModel.findOne({
        graphId: graph._id,
        idempotencyKey: options.idempotencyKey,
      }).exec();
      if (existingRun) {
        this.logger.log(`♻️ [IDEMPOTENT RUN] Returning existing run ${existingRun.runId} for key: ${options.idempotencyKey}`);
        return this.storageService.publicRun(existingRun);
      }
    }

    const nodes: RuntimeNode[] = graph.nodes || [];
    const edges: any[] = graph.edges || [];

    if (!nodes.length) {
      this.logger.error(`❌ Cannot execute graph "${graph.name}": Graph contains 0 nodes`);
      throw new BadRequestException('Graph has no nodes');
    }

    // Subgraph depth limit check
    const currentDepth = options.subgraphDepth || 0;
    if (currentDepth > this.maxSubgraphDepth) {
      const err: any = new BadRequestException(
        `Exceeded maximum subgraph nesting depth of ${this.maxSubgraphDepth}`,
      );
      err.code = 'MAX_SUBGRAPH_DEPTH_EXCEEDED';
      throw err;
    }

    try {
      await this.graphsService.validateGraphVariables(nodes, edges);
    } catch (valErr: any) {
      this.logger.error(`❌ Graph variable validation failed: ${valErr.message || valErr}`);
      throw valErr;
    }

    const runId = options.existingRunId || randomUUID();
    const rootRunId = options.rootRunId || options.parentRunId || runId;
    const propagationDepth = options.propagationDepth ?? 0;
    const visitedArtifactLogicalIds = [...(options.visitedArtifactLogicalIds || [])];

    // Check Event Propagation Limits
    const currentEntityLogicalId =
      initialInput?.data?.logicalId ||
      initialInput?.logicalId ||
      (initialInput?.entityName === 'artifact' ? initialInput?.entityId : undefined);

    const isLogicalIdAlreadyVisited =
      currentEntityLogicalId && visitedArtifactLogicalIds.includes(currentEntityLogicalId);
    const isPropagationDepthExceeded = propagationDepth > this.maxPropagationDepth;
    const isVisitedLogicalIdsExceeded = visitedArtifactLogicalIds.length > this.maxVisitedLogicalIds;

    if (isLogicalIdAlreadyVisited || isPropagationDepthExceeded || isVisitedLogicalIdsExceeded) {
      this.logger.warn(`🛑 Event propagation limit reached (depth: ${propagationDepth}, visited: ${visitedArtifactLogicalIds.length})`);
      const partialRun = await this.runModel.create({
        runId,
        projectId: (graph as any).projectId || options.projectId || 'default',
        graphId: graph._id,
        graphName: graph.name,
        status: 'partial',
        input: initialInput,
        nodes: [],
        parentRunId: options.parentRunId,
        rootRunId,
        idempotencyKey: options.idempotencyKey,
        sourceEventId: options.sourceEventId,
        sourceEventTopic: options.sourceEventTopic,
        propagationDepth,
        visitedArtifactLogicalIds,
        startedAt: new Date(),
        finishedAt: new Date(),
        error: {
          code: 'EVENT_PROPAGATION_LIMIT_REACHED',
          message: 'Event propagation limit reached: stopped to prevent infinite cycles or overflow',
        },
      });
      await this.checkpointService.persistCheckpoint({
        runId,
        sequence: 1,
        status: 'partial',
        queue: [],
        context: { input: initialInput },
        completedNodeIds: [],
        nodeRecords: [],
      });
      return this.storageService.publicRun(partialRun);
    }

    if (currentEntityLogicalId) {
      visitedArtifactLogicalIds.push(currentEntityLogicalId);
    }

    const metrics: RunMetrics = options.metrics || {
      totalDurationMs: 0,
      nodeCount: nodes.length,
      completedNodeCount: 0,
      failedNodeCount: 0,
      retryCount: 0,
      childRunCount: 0,
    };

    const useLangGraph =
      process.env.USE_LANGGRAPH === 'true' ||
      Boolean(options?.useLangGraph) ||
      Boolean((graph as any)?.metadata?.useLangGraph);

    if (useLangGraph && this.graphCompiler) {
      return this.runViaLangGraph(
        graph,
        initialInput,
        options,
        runId,
        rootRunId,
        propagationDepth,
        visitedArtifactLogicalIds,
        metrics,
        startTime,
      );
    }

    let checkpointSeq = options.checkpointSequence || 1;

    let run: RunDocument;
    if (options.existingRunId) {
      const found = await this.runModel.findOne({ runId }).exec();
      if (!found) throw new NotFoundException(`Run ${runId} not found`);
      run = found;
      run.status = 'running';
      if (options.priorRecords) run.nodes = options.priorRecords;
      run.currentNodeId = undefined;
      run.waitingNodeId = undefined;
      run.waitingChildRunId = undefined;
      run.waitingDescriptor = undefined;
      checkpointSeq = Math.max(run.checkpointSequence || 0, options.checkpointSequence || 0) + 1;
      run.checkpointSequence = checkpointSeq;
      await run.save();
    } else {
      run = await this.runModel.create({
        runId,
        projectId: (graph as any).projectId || options.projectId || 'default',
        graphId: graph._id,
        graphName: graph.name,
        status: 'running',
        input: initialInput,
        nodes: options.priorRecords || [],
        parentRunId: options.parentRunId,
        rootRunId,
        idempotencyKey: options.idempotencyKey,
        sourceEventId: options.sourceEventId,
        sourceEventTopic: options.sourceEventTopic,
        propagationDepth,
        visitedArtifactLogicalIds,
        rerunFromNodeId: options.rerunFromNodeId,
        checkpointSequence: checkpointSeq,
        attempt: 1,
        startedAt: new Date(),
        metrics,
        stateVersion: 1,
        debugMode: options.debugMode || false,
        useCache: options.useCache || false,
      });
    }

    // 2. Acquire Lease
    const leaseAcquired = await this.leaseService.acquireLease(runId);
    if (!leaseAcquired) {
      this.logger.warn(`⚠️ Could not acquire lease for Run ${runId}. Returning active run document.`);
      return this.storageService.publicRun(run);
    }

    const currentProjectId = (graph as any)?.projectId || options.projectId || run.projectId;
    const runtimeContext: Record<string, any> = { input: initialInput, apps: {}, state: {}, projectId: currentProjectId };
    const context = { ...runtimeContext, ...(options.context || {}) };
    context.state = { ...(runtimeContext.state || {}), ...(options.context?.state || context.state || {}) };
    context.runId = runId;
    const records: any[] = options.priorRecords ? [...options.priorRecords] : [];
    const completed = new Set<string>(
      records
        .filter((record) => record.status === 'completed' || (record.status === 'failed' && record.output))
        .map((record) => record.nodeId),
    );

    const { nodeById, outgoing, incoming } = this.topologyService.buildAdjacency(nodes, edges);

    let queue: string[] = [];
    if (options.executionQueue !== undefined) {
      queue = [...options.executionQueue];
    } else {
      const startNodes = this.topologyService.determineStartNodes(nodes, incoming, nodeById, options.startNodeId);
      if (!startNodes.length) {
        // Check if graph contains a webserver block
        const webserverNode = nodes.find((node) => {
          const type = String(node.data?.definitionType || node.type || '').toLowerCase();
          return type === 'webserver' || node.data?.definitionId === 'webserver';
        });

        if (webserverNode && !options.startNodeId) {
          // Flow contains a webserver with route entry points awaiting external HTTP requests.
          // Start or ensure webserver is running, and register a 'listening' run state.
          let serverInfo: any = null;
          if (this.webserverService) {
            try {
              serverInfo = await this.webserverService.startServer(graphId, webserverNode.id);
            } catch (wsErr: any) {
              this.logger.error(`❌ Failed to start webserver for graph ${graphId}: ${wsErr.message}`);
              await this.leaseService.releaseLease(runId);
              run.status = 'failed';
              run.finishedAt = new Date();
              run.error = {
                message: `Failed to start webserver: ${wsErr.message}`,
                code: 'WEBSERVER_START_FAILED',
              };
              await run.save();
              return this.storageService.publicRun(run);
            }
          }

          const serverPort = serverInfo?.port || webserverNode.data?.config?.port || 3000;
          const serverHost = serverInfo?.host || webserverNode.data?.config?.host || '0.0.0.0';
          const hostDisplay = serverHost === '0.0.0.0' ? 'localhost' : serverHost;
          const serverUrl = serverInfo?.url || `http://${hostDisplay}:${serverPort}`;

          const webserverRecord: any = {
            nodeId: webserverNode.id,
            nodeName: webserverNode.data?.nodeName || webserverNode.data?.name || 'Run Webserver',
            nodeType: 'webserver',
            status: 'completed',
            input: webserverNode.data?.config || {},
            output: {
              status: 'running',
              port: serverPort,
              host: serverHost,
              url: serverUrl,
              routes: serverInfo?.activeRoutes || [],
              message: `Webserver listening on ${serverUrl}. Send HTTP requests to trigger routes.`,
            },
            startedAt: new Date(),
            finishedAt: new Date(),
            durationMs: Date.now() - startTime,
            attempt: 1,
          };

          run.status = 'listening';
          run.finishedAt = new Date();
          run.output = {
            status: 'listening',
            port: serverPort,
            host: serverHost,
            url: serverUrl,
            activeRoutes: serverInfo?.activeRoutes || [],
            message: `Webserver is live on ${serverUrl} and listening for incoming HTTP requests`,
          };
          run.nodes = [webserverRecord];
          metrics.completedNodeCount = 1;
          metrics.totalDurationMs = Date.now() - startTime;
          run.metrics = metrics;

          await run.save();
          await this.checkpointService.persistCheckpoint({
            runId,
            sequence: checkpointSeq,
            status: 'completed',
            queue: [],
            context,
            completedNodeIds: [webserverNode.id],
            nodeRecords: [webserverRecord],
            metrics,
          });
          await this.leaseService.releaseLease(runId);
          this.logger.log(`🎧 [WEBSERVER LISTENING] Graph "${graph.name}" running on ${serverUrl} | Waiting for HTTP requests`);
          return this.storageService.publicRun(run);
        }

        await this.leaseService.releaseLease(runId);
        throw new BadRequestException('Graph has no executable entry node');
      }

      // If graph has a webserver and batch entry nodes, ensure webserver is also running
      const webserverNode = nodes.find((node) => {
        const type = String(node.data?.definitionType || node.type || '').toLowerCase();
        return type === 'webserver' || node.data?.definitionId === 'webserver';
      });
      if (webserverNode && !options.startNodeId && this.webserverService) {
        try {
          await this.webserverService.startServer(graphId, webserverNode.id);
        } catch (wsErr: any) {
          this.logger.warn(`Could not start webserver alongside batch execution: ${wsErr.message}`);
        }
      }

      queue = startNodes;
      context.__runStartNodeIds = startNodes;
    }

    await this.variableResolver.warmSecrets(nodes.map((node) => node?.data?.config), context);

    if (!Array.isArray(context.__runStartNodeIds)) {
      context.__runStartNodeIds = options.startNodeId
        ? [options.startNodeId]
        : this.topologyService.determineStartNodes(nodes, incoming, nodeById);
    }
    if (options.executionQueue !== undefined && !options.rerunFromNodeId) {
      const completedOutputs = Object.fromEntries(records
        .filter((entry: any) => entry.status === 'completed')
        .map((entry: any) => [entry.nodeId, entry.output]));
      queue = this.topologyService.readyNodes(
        nodes, edges, context.__runStartNodeIds, completed, completedOutputs, new Set(),
      );
    }

    if (queue.length > this.maxQueueLength) {
      const err: any = new BadRequestException(`Queue length exceeded limit of ${this.maxQueueLength}`);
      err.code = 'MAX_QUEUE_LENGTH_EXCEEDED';
      await this.leaseService.releaseLease(runId);
      throw err;
    }

    // Persist Initial Checkpoint
    await this.checkpointService.persistCheckpoint({
      runId,
      sequence: checkpointSeq,
      status: 'running',
      queue,
      context,
      completedNodeIds: Array.from(completed),
      nodeRecords: records,
      metrics,
    });

    const executedNodes: RuntimeNode[] = [];
    let step = records.length;
    let lastNodeOutput: any;

    try {
      while (queue.length) {
        if (++step > this.maxExecutionSteps) {
          const err: any = new BadRequestException(
            `Graph exceeded maximum execution limit of ${this.maxExecutionSteps} steps; possible infinite loop`,
          );
          err.code = 'MAX_EXECUTION_STEPS_EXCEEDED';
          throw err;
        }

        // Check for run cancellation request
        const freshRun = await this.runModel.findOne({ runId }).exec();
        if (freshRun?.cancelRequestedAt || freshRun?.status === 'cancelled') {
          this.logger.log(`🛑 Run ${runId} cancellation acknowledged during execution loop`);
          await this.browserRunner.closeRuntimeApps(context);
          run.status = 'cancelled';
          run.finishedAt = new Date();
          await run.save();
          await this.checkpointService.persistCheckpoint({
            runId,
            sequence: ++checkpointSeq,
            status: 'cancelled',
            queue,
            context,
            completedNodeIds: Array.from(completed),
            nodeRecords: records,
            lastNodeOutput,
            metrics,
          });
          await this.leaseService.releaseLease(runId);
          return this.publishedRun(runId, run);
        }

        const nodeId = queue.shift()!;
        const node = nodeById.get(nodeId);
        if (!node) continue;
        executedNodes.push(node);

        const data = node.data || {};
        const nodeName = data.name || data.nodeName || node.id;
        const nodeType = String(data.definitionType || node.type || '').toLowerCase();
        const nodeConfig = data.config || {};

        run.currentNodeId = node.id;
        const nodeStartTime = Date.now();

        // Node Execution Policy
        const rawTimeout = Number(nodeConfig.timeoutMs || data.timeoutMs || 120000);
        const timeoutMs = Math.min(900000, Math.max(10, rawTimeout));
        const rawAttempts = Number(nodeConfig.maxAttempts || data.maxAttempts || 1);
        const maxAttempts = Math.min(3, Math.max(1, rawAttempts));
        const rawBackoff = Number(nodeConfig.backoffMs || data.backoffMs || 1000);
        const backoffMs = Math.min(30000, Math.max(10, rawBackoff));

        const executionPolicy: ExecutionPolicy = { timeoutMs, maxAttempts, backoffMs };

        // Create running node record
        const record: NodeRunRecord = {
          nodeId: node.id,
          nodeName,
          nodeType,
          status: 'running',
          input: {},
          attempt: 1,
          startedAt: new Date(),
          checkpointSequence: checkpointSeq + 1,
        };

        const existingRecordIndex = records.findIndex((r) => r.nodeId === node.id);
        if (existingRecordIndex !== -1) {
          records[existingRecordIndex] = record;
        } else {
          records.push(record);
        }
        run.nodes = records;
        await run.save();

        // Resolve input
        let nodeInput: any;
        try {
          nodeInput = this.variableResolver.resolveNodeInput(node, context, initialInput);
          record.input = nodeInput;
        } catch (resolveErr: any) {
          const resolveDuration = Date.now() - nodeStartTime;
          record.durationMs = resolveDuration;
          record.finishedAt = new Date();
          record.status = 'failed';
          record.error = {
            message: resolveErr?.message || String(resolveErr),
            code: 'VARIABLE_RESOLUTION_FAILED',
          };
          metrics.failedNodeCount = (metrics.failedNodeCount || 0) + 1;
          run.nodes = records;
          run.checkpointSequence = ++checkpointSeq;
          run.metrics = metrics;
          await run.save();

          await this.checkpointService.persistCheckpoint({
            runId,
            sequence: checkpointSeq,
            status: 'running',
            currentNodeId: node.id,
            queue,
            context,
            completedNodeIds: Array.from(completed),
            nodeRecords: records,
            metrics,
          });

          throw resolveErr;
        }

        // Determine if node is non-retryable
        const isHumanGate = nodeType === 'human-gate' || nodeType === 'humangate';
        const isArtifactMutation =
          nodeType === 'artifact' &&
          ['create', 'update', 'patch', 'archive', 'addrelation', 'removerelation', 'link'].includes(
            String(nodeConfig.operation || nodeInput?.operation || '').toLowerCase(),
          );
        const isDatabaseWrite =
          nodeType === 'database' &&
          ['insertone', 'insertmany', 'updateone', 'updatemany', 'deleteone', 'deletemany', 'execute', 'transaction'].includes(
            String(nodeConfig.operation || nodeInput?.operation || '').toLowerCase(),
          );

        const effectiveMaxAttempts = (isHumanGate || isArtifactMutation || isDatabaseWrite) ? 1 : executionPolicy.maxAttempts;

        let rawOutput: any;
        let finalError: any = null;
        let routedFailure = false;

        const isCacheEligible = [
          'agent',
          'llm',
          'web-search',
          'websearch',
          'repo-inspect',
          'repo_inspect',
          'cli',
          'repository',
        ].includes(nodeType);

        // Cache is enabled by default for all eligible nodes, unless explicitly disabled (cacheResult === false)
        const hasCacheEnabled =
          nodeConfig.cacheResult !== false &&
          nodeConfig.cacheResult !== 'false' &&
          nodeConfig.enableCache !== false &&
          nodeConfig.enableCache !== 'false';

        const isDebugSession = Boolean(options.debugMode || run.debugMode);
        const isUseCacheSession = options.useCache !== false && run.useCache !== false;

        let isCacheHit = false;
        let cachedRecord: any = null;

        if (isCacheEligible && hasCacheEnabled && isUseCacheSession && this.nodeCacheService) {
          cachedRecord = await this.nodeCacheService.getCachedResult(graph._id.toString(), node.id);
          if (cachedRecord && cachedRecord.result !== undefined) {
            isCacheHit = true;
            rawOutput = cachedRecord.result;
            record.cached = true;
            this.logger.log(`⚡ [NodeCache HIT] Skipping service execution for node "${nodeName}" (${nodeType}) - reusing cached result`);
          } else {
            this.logger.log(`ℹ️ [NodeCache MISS] No cache found for node "${nodeName}" (${nodeType}) - running service`);
          }
        }

        if (!isCacheHit) {
          // Bounded retry loop
          for (let attempt = 1; attempt <= effectiveMaxAttempts; attempt++) {
            record.attempt = attempt;
            if (attempt > 1) {
              metrics.retryCount = (metrics.retryCount || 0) + 1;
              const delay = Math.min(30000, backoffMs * Math.pow(2, attempt - 2));
              this.logger.log(`⏳ Retrying node "${nodeName}" (attempt ${attempt}/${effectiveMaxAttempts}) after ${delay}ms`);
              await new Promise((resolve) => setTimeout(resolve, delay));
            }

            try {
              const execPromise = this.executeNodeDispatch(
                node,
                nodeType,
                nodeInput,
                context,
                initialInput,
                runId,
                currentDepth,
                visitedArtifactLogicalIds,
                nodes,
                edges,
                graph._id.toString(),
                graph.name,
                currentProjectId,
                options,
              );

              // Timeout wrapper
              rawOutput = await Promise.race([
                execPromise,
                new Promise((_, reject) =>
                  setTimeout(() => {
                    const timeoutErr: any = new Error(`Node execution timed out after ${timeoutMs}ms`);
                    timeoutErr.code = 'EXECUTION_TIMEOUT';
                    timeoutErr.status = 408;
                    reject(timeoutErr);
                  }, timeoutMs),
                ),
              ]);

              finalError = null;
              break;
            } catch (err: any) {
              finalError = err;
              const isRetryable =
                err.code === 'EXECUTION_TIMEOUT' ||
                err.status === 429 ||
                (err.status >= 500 && err.status < 600) ||
                /timeout|etimedout|econnreset|enotfound/i.test(err.message || '');

              record.retryable = isRetryable;
              record.errorCode = err.code || (err.status ? `HTTP_${err.status}` : 'EXECUTION_ERROR');

              if (!isRetryable || attempt >= effectiveMaxAttempts) {
                break;
              }
            }
          }
        }

        const nodeDuration = isCacheHit ? 0 : Date.now() - nodeStartTime;
        record.durationMs = nodeDuration;
        record.finishedAt = new Date();

        // Save cache on all successful runs (normal Run and Debug) if node has caching enabled
        if (isCacheEligible && hasCacheEnabled && !finalError && !isCacheHit && this.nodeCacheService) {
          await this.nodeCacheService.saveCachedResult(
            graph._id.toString(),
            node.id,
            nodeName,
            nodeType,
            rawOutput,
            nodeInput,
            graph.name,
            currentProjectId,
          );
          this.logger.log(`💾 [NodeCache] Saved cache for node "${nodeName}" (${nodeType}) in graph "${graph.name || graph._id}"`);
        }

        if (finalError) {
          this.logger.error(`❌ Node "${nodeName}" FAILED after ${nodeDuration}ms (attempt ${record.attempt})`);
          record.status = 'failed';
          record.error = {
            message: finalError.message || String(finalError),
            code: record.errorCode || 'NODE_FAILED',
          };
          metrics.failedNodeCount = (metrics.failedNodeCount || 0) + 1;
          run.nodes = records;
          run.checkpointSequence = ++checkpointSeq;
          run.metrics = metrics;
          await run.save();

          await this.checkpointService.persistCheckpoint({
            runId,
            sequence: checkpointSeq,
            status: 'running',
            currentNodeId: node.id,
            queue,
            context,
            completedNodeIds: Array.from(completed),
            nodeRecords: records,
            metrics,
          });

          const hasFailurePath = (outgoing.get(node.id) || []).some((edge: any) =>
            ['failed', 'onfailed', 'error'].includes(
              String(edge.sourceHandle || '').toLowerCase().trim(),
            ),
          );
          if (!hasFailurePath) throw finalError;

          routedFailure = true;
          rawOutput = {
            status: 'failed',
            error: {
              message: finalError.message || String(finalError),
              code: record.errorCode || 'NODE_FAILED',
            },
          };
          finalError = null;
        }

        const output = this.variableResolver.normalizeOutput(node, rawOutput);
        if (!routedFailure) {
          const outputStatus = String(output?.status ?? output?.result?.status ?? '').toLowerCase();
          const hasFailurePath = (outgoing.get(node.id) || []).some((edge: any) =>
            ['failed', 'onfailed', 'error'].includes(
              String(edge.sourceHandle || '').toLowerCase().trim(),
            ),
          );
          if (hasFailurePath && ['failed', 'error'].includes(outputStatus)) {
            routedFailure = true;
            metrics.failedNodeCount = (metrics.failedNodeCount || 0) + 1;
          }
        }
        lastNodeOutput = output;
        record.output = output;
        this.absorbCustomMetrics(metrics, context);

        // Waiting State Handling (Human-Gate or Waiting Subgraph)
        if (rawOutput?.status === 'waiting') {
          record.status = 'waiting';
          run.status = 'waiting';
          run.waitingNodeId = node.id;
          run.output = { [nodeName]: output };
          run.nodes = records;
          run.checkpointSequence = ++checkpointSeq;

          let rawResumeToken: string | undefined;

          if (rawOutput.childRunId) {
            metrics.childRunCount = (metrics.childRunCount || 0) + 1;
            record.childRunId = rawOutput.childRunId;
            run.waitingChildRunId = rawOutput.childRunId;
            rawResumeToken = rawOutput.resumeToken;
            run.waitingDescriptor = {
              nodeId: node.id,
              nodeName,
              nodeType,
              waitingChildRunId: rawOutput.childRunId,
              uiPayload: rawOutput.waitingDescriptor?.uiPayload,
              createdAt: new Date(),
            };
          } else {
            // Direct human gate node
            const { token, hash, tokenId } = generateResumeToken();
            rawResumeToken = token;
            record.waitingTokenId = tokenId;
            run.resumeTokenHash = hash;
            const waitingDescriptor: WaitingDescriptor = {
              nodeId: node.id,
              nodeName,
              nodeType,
              waitingTokenId: tokenId,
              uiPayload: rawOutput?.result || output,
              createdAt: new Date(),
              timeoutMs: rawOutput?.result?.timeoutMs || 86400000,
            };
            run.waitingDescriptor = waitingDescriptor;

            // Dispatch Telegram question if responseType is telegram or node is telegram question
            const isTelegramGate =
              (nodeType === 'human-gate' || nodeType === 'humangate') &&
              (rawOutput?.result?.responseType === 'telegram' || nodeConfig?.responseType === 'telegram');
            const isTelegramQuestion =
              nodeType === 'telegram' &&
              (rawOutput?.result?.mode === 'question' || nodeConfig?.mode === 'question' || rawOutput?.result?.telegram);

            if ((isTelegramGate || isTelegramQuestion) && this.telegramService) {
              const rawChatId = rawOutput?.result?.chatId || nodeConfig?.chatId;
              const targetChatId = rawChatId ? this.variableResolver.resolveValue(rawChatId, context) : undefined;
              const rawQuestion = rawOutput?.result?.question || nodeConfig?.question || 'Please review and reply to this message.';
              const questionText = this.variableResolver.resolveValue(rawQuestion, context);
              const botToken = nodeConfig?.botToken || rawOutput?.result?.botToken;
              const threadId = nodeConfig?.messageThreadId || rawOutput?.result?.messageThreadId;
              const updateMode = nodeConfig?.updateMode || rawOutput?.result?.updateMode || 'polling';
              const pollIntervalSeconds = nodeConfig?.pollIntervalSeconds || rawOutput?.result?.pollIntervalSeconds || 2;

              if (targetChatId) {
                await this.telegramService
                  .dispatchQuestionAndStore({
                    runId,
                    nodeId: node.id,
                    projectId: run.projectId,
                    graphId: String(run.graphId),
                    token,
                    question: String(questionText),
                    chatId: targetChatId,
                    botToken,
                    updateMode,
                    pollIntervalSeconds: Number(pollIntervalSeconds),
                  })
                  .catch((err) => {
                    this.logger.error(
                      `Failed to dispatch Telegram question for run ${runId}: ${err.message}`,
                    );
                  });
              }
            }
          }

          await run.save();

          await this.checkpointService.persistCheckpoint({
            runId,
            sequence: checkpointSeq,
            status: 'waiting',
            currentNodeId: node.id,
            waitingNodeId: node.id,
            waitingChildRunId: run.waitingChildRunId,
            queue,
            context,
            completedNodeIds: Array.from(completed),
            nodeRecords: records,
            lastNodeOutput,
            waitingDescriptor: run.waitingDescriptor,
            metrics,
          });

          await this.browserRunner.closeRuntimeApps(context);
          await this.leaseService.releaseLease(runId);

          this.logger.log(`⏸️ [FLOW RUN WAITING] Run ${runId} waiting on node "${nodeName}"`);
          return this.storageService.publicRun(run, rawResumeToken ? { resumeToken: rawResumeToken } : undefined);
        }

        // Outbound Telegram message dispatch (one-way message mode)
        if (nodeType === 'telegram' && nodeConfig?.mode === 'message' && this.telegramService) {
          const rawChatId = nodeConfig?.chatId || nodeInput?.chatId;
          const targetChatId = rawChatId ? this.variableResolver.resolveValue(rawChatId, context) : undefined;
          const rawMessage = nodeConfig?.question || nodeConfig?.message || nodeInput?.text || '';
          const messageText = this.variableResolver.resolveValue(rawMessage, context);
          if (targetChatId && messageText) {
            await this.telegramService
              .sendMessage(targetChatId, String(messageText), {
                botToken: nodeConfig?.botToken,
                messageThreadId: nodeConfig?.messageThreadId,
              })
              .catch((err) => {
                this.logger.error(`Failed to dispatch Telegram message: ${err.message}`);
              });
          }
        }

        // Completed Node Handling
        record.status = routedFailure ? 'failed' : 'completed';
        completed.add(node.id);
        if (!routedFailure) {
          metrics.completedNodeCount = (metrics.completedNodeCount || 0) + 1;
        }
        context[nodeName] = output;

        run.nodes = records;
        run.checkpointSequence = ++checkpointSeq;
        run.metrics = metrics;
        await run.save();

        await this.checkpointService.persistCheckpoint({
          runId,
          sequence: checkpointSeq,
          status: 'running',
          currentNodeId: node.id,
          queue,
          context,
          completedNodeIds: Array.from(completed),
          nodeRecords: records,
          lastNodeOutput,
          metrics,
        });

        // Recompute readiness after every transition. A join runs once, after all
        // incoming branches have either completed or become unreachable.
        const completedOutputs = Object.fromEntries(records
          .filter((entry: any) => entry.status === 'completed' || entry.status === 'failed')
          .map((entry: any) => [entry.nodeId, entry.output]));

        // Synchronize orchestrator 'done' and 'result' outputs when all its jobs finish
        for (const candidateNode of nodes) {
          const cType = String(candidateNode.data?.definitionType || candidateNode.type || '').toLowerCase();
          if ((cType === 'orchestrator' || cType === 'delegator') && completed.has(candidateNode.id)) {
            const jobNodes = this.topologyService.getOrchestratedJobNodeIds(candidateNode.id, nodes, edges);
            if (jobNodes.size > 0 && [...jobNodes].every((id) => completed.has(id))) {
              const orchName = candidateNode.data?.name || candidateNode.data?.nodeName || candidateNode.id;
              const orchData = context[orchName] || {};
              const jobResults = Array.from(jobNodes).map((id) => {
                const rec = records.find((r) => r.nodeId === id);
                const n = nodes.find((item) => item.id === id);
                return {
                  id,
                  name: rec?.nodeName || n?.data?.name || id,
                  type: rec?.nodeType || n?.data?.definitionType,
                  output: rec?.output,
                };
              });
              const donePayload = {
                status: 'completed',
                goal: orchData.goal,
                agentCount: jobNodes.size,
                results: jobResults,
                lastResult: jobResults[jobResults.length - 1]?.output,
              };
              orchData.done = donePayload;
              orchData.result = donePayload;
              context[orchName] = orchData;
            }
          }
        }

        queue = [...new Set(queue.filter((id) => !completed.has(id)))];
        const nextTargets = this.topologyService.readyNodes(
          nodes, edges, context.__runStartNodeIds, completed, completedOutputs,
          new Set(queue),
        );
        queue.push(...nextTargets);

        if (queue.length > this.maxQueueLength) {
          const err: any = new BadRequestException(`Queue length exceeded limit of ${this.maxQueueLength}`);
          err.code = 'MAX_QUEUE_LENGTH_EXCEEDED';
          throw err;
        }

        // ── Debug Mode Breakpoint ──
        // If debugMode is active and there are still nodes queued, pause the run
        // and let the frontend decide whether to continue or cancel.
        const isDebug = options.debugMode || run.debugMode;
        if (isDebug && queue.length > 0) {
          const { token, hash, tokenId } = generateResumeToken();

          run.status = 'waiting';
          run.waitingNodeId = node.id;
          run.resumeTokenHash = hash;
          run.output = { [nodeName]: output };
          run.nodes = records;
          run.checkpointSequence = ++checkpointSeq;
          run.waitingDescriptor = {
            nodeId: node.id,
            nodeName,
            nodeType,
            waitingTokenId: tokenId,
            debugBreakpoint: true,
            completedNodeOutput: output,
            nextNodeIds: queue.slice(0, 5),
            createdAt: new Date(),
          };
          run.metrics = metrics;
          await run.save();

          await this.checkpointService.persistCheckpoint({
            runId,
            sequence: checkpointSeq,
            status: 'waiting',
            currentNodeId: node.id,
            waitingNodeId: node.id,
            queue,
            context,
            completedNodeIds: Array.from(completed),
            nodeRecords: records,
            lastNodeOutput,
            waitingDescriptor: run.waitingDescriptor,
            metrics,
          });

          await this.browserRunner.closeRuntimeApps(context);
          await this.leaseService.releaseLease(runId);
          this.logger.log(`🐛 [DEBUG BREAKPOINT] Run ${runId} paused after node "${nodeName}" — awaiting continue/cancel`);
          return this.storageService.publicRun(run, { resumeToken: token });
        }
      }

      // Successful completion
      const output = this.topologyService.buildRunOutput(executedNodes, context, completed);
      const totalDuration = Date.now() - startTime;
      metrics.totalDurationMs = totalDuration;

      run.status = records.some((record: any) => record.status === 'failed') ? 'partial' : 'completed';
      run.output = output;
      run.nodes = records;
      run.metrics = metrics;
      run.finishedAt = new Date();
      run.checkpointSequence = ++checkpointSeq;
      run.dataSizeBytes = this.storageService.calculateDataSize(run);
      await run.save();

      await this.checkpointService.persistCheckpoint({
        runId,
        sequence: checkpointSeq,
        status: run.status,
        queue: [],
        context,
        completedNodeIds: Array.from(completed),
        nodeRecords: records,
        lastNodeOutput,
        metrics,
      });

      await this.browserRunner.closeRuntimeApps(context);
      await this.leaseService.releaseLease(runId);

      this.logger.log(`🏁 [FLOW RUN COMPLETED] Run: ${runId} | Duration: ${totalDuration}ms`);
      return this.publishedRun(runId, run);
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;
      metrics.totalDurationMs = totalDuration;

      if (error?.code === 'RUN_CANCELLED') run.status = 'cancelled';
      if (run.status !== 'cancelled') {
        run.status = 'failed';
        run.error = {
          message: error?.message || String(error),
          code: error?.code || 'RUN_FAILED',
        };
      }
      run.nodes = records;
      run.metrics = metrics;
      run.finishedAt = new Date();
      run.checkpointSequence = ++checkpointSeq;
      run.dataSizeBytes = this.storageService.calculateDataSize(run);

      await this.browserRunner.closeRuntimeApps(context);
      await run.save();

      await this.checkpointService.persistCheckpoint({
        runId,
        sequence: checkpointSeq,
        status: run.status,
        queue,
        context,
        completedNodeIds: Array.from(completed),
        nodeRecords: records,
        lastNodeOutput,
        metrics,
      });

      await this.leaseService.releaseLease(runId);
      this.logger.error(`🚫 [FLOW RUN FAILED] Run: ${runId} | Cause: ${error?.message || String(error)}`);
      return this.publishedRun(runId, run);
    }
  }

  // =========================================================================
  // Node Dispatcher
  // =========================================================================

  private async executeNodeDispatch(
    node: RuntimeNode,
    nodeType: string,
    nodeInput: any,
    context: Record<string, any>,
    initialInput: any,
    runId: string,
    currentDepth: number,
    visitedArtifactLogicalIds: string[] = [],
    allNodes?: RuntimeNode[],
    allEdges?: any[],
    graphId?: string,
    graphName?: string,
    projectId?: string,
    options?: RunGraphOptions,
  ): Promise<any> {
    if (nodeType === 'subgraph') {
      return this.subgraphRunner.executeSubgraphNode(
        node,
        nodeInput,
        runId,
        currentDepth,
        visitedArtifactLogicalIds,
        this.runGraph.bind(this),
      );
    }
    if (nodeType === 'foreach') {
      const mode = String(nodeInput?.mode || node.data?.config?.mode || ((nodeInput?.graphId || node.data?.config?.graphId) ? 'subgraph' : 'canvas'));
      if (mode === 'subgraph' && (String(nodeInput?.executionType || node.data?.config?.executionType || 'sync') !== 'sync' || Number(nodeInput?.concurrency ?? node.data?.config?.concurrency ?? 1) !== 1)) {
        await this.graphsService.assertNoWaitingGatesInChildGraph(String(nodeInput?.graphId || node.data?.config?.graphId || ''));
      }
      return this.subgraphRunner.executeForeachNode(
        node,
        nodeInput,
        runId,
        currentDepth,
        visitedArtifactLogicalIds,
        this.runGraph.bind(this),
        {
          context,
          nodes: allNodes,
          edges: allEdges,
          executeNode: async (n, inp, ctx, init) => {
            const innerType = String(n.data?.definitionType || n.type || '').toLowerCase();
            const innerName = n.data?.name || n.data?.nodeName || n.id;
            const innerConfig = n.data?.config || {};
            const isEligible = [
              'agent',
              'llm',
              'web-search',
              'websearch',
              'repo-inspect',
              'repo_inspect',
              'cli',
              'repository',
            ].includes(innerType);
            const isEnabled =
              innerConfig.cacheResult !== false &&
              innerConfig.cacheResult !== 'false' &&
              innerConfig.enableCache !== false &&
              innerConfig.enableCache !== 'false';

            // Check cache when useCache is enabled
            if (
              isEligible &&
              isEnabled &&
              options?.useCache !== false &&
              graphId &&
              this.nodeCacheService
            ) {
              const cached = await this.nodeCacheService.getCachedResult(graphId, n.id);
              if (cached && cached.result !== undefined) {
                this.logger.log(`⚡ [NodeCache HIT] (Foreach) Reusing cached result for "${innerName}" (${innerType})`);
                return cached.result;
              }
            }

            const rawResult = await this.nodeExecutor.executeNode(n, inp, ctx, init, runId);

            // Save cache on successful execution
            if (isEligible && isEnabled && graphId && this.nodeCacheService) {
              await this.nodeCacheService.saveCachedResult(
                graphId,
                n.id,
                innerName,
                innerType,
                rawResult,
                inp,
                graphName,
                projectId,
              );
              this.logger.log(`💾 [NodeCache] (Foreach) Saved cache for node "${innerName}" (${innerType})`);
            }

            return rawResult;
          },
          resolveInput: (n, ctx, init) => this.variableResolver.resolveNodeInput(n, ctx, init),
          normalizeOutput: (n, raw) => this.variableResolver.normalizeOutput(n, raw),
        },
      );
    }
    if (nodeType === 'loop' && String(nodeInput?.mode || node.data?.config?.mode || 'map') === 'research') {
      return this.subgraphRunner.executeIterativeLoopNode(node, nodeInput, runId, currentDepth, visitedArtifactLogicalIds, this.runGraph.bind(this), async () => {
        const fresh = await this.runModel.findOne({ runId }).exec();
        return Boolean(fresh?.cancelRequestedAt || fresh?.status === 'cancelled');
      });
    }
    return this.nodeExecutor.executeNode(node, nodeInput, context, initialInput, runId);
  }

  // =========================================================================
  // Subgraph & Foreach Execution (Exposed for Direct Calls / Tests)
  // =========================================================================

  async executeForeachNode(
    node: RuntimeNode,
    nodeInput: any,
    runId: string,
    currentDepth = 0,
    visitedArtifactLogicalIds: string[] = [],
    options?: any,
  ): Promise<any> {
    return this.subgraphRunner.executeForeachNode(
      node,
      nodeInput,
      runId,
      currentDepth,
      visitedArtifactLogicalIds,
      this.runGraph.bind(this),
      options,
    );
  }

  // =========================================================================
  // Resume & Cancellation Delegations
  // =========================================================================

  async resumeRun(runId: string, resumePayload: ResumePayload = {}): Promise<any> {
    const run = await this.runModel.findOne({ runId }).exec();
    if (!run) throw new NotFoundException(`Run ${runId} not found`);

    const graph = await this.graphsService.findOne(String(run.graphId)).catch(() => null);
    const useLangGraph =
      process.env.USE_LANGGRAPH === 'true' ||
      run.metadata?.engine === 'langgraph' ||
      Boolean((graph as any)?.metadata?.useLangGraph);

    if (useLangGraph && this.graphCompiler && graph) {
      return this.resumeLangGraphRun(run, graph, resumePayload);
    }

    return this.recoveryService.resumeRun(runId, resumePayload, {
      runGraph: this.runGraph.bind(this),
      findGraph: (id: string) => this.graphsService.findOne(id),
    });
  }

  // =========================================================================
  // LangGraph Engine Execution & Resumption
  // =========================================================================

  private async runViaLangGraph(
    graph: any,
    initialInput: any,
    options: RunGraphOptions,
    runId: string,
    rootRunId: string,
    propagationDepth: number,
    visitedArtifactLogicalIds: string[],
    metrics: RunMetrics,
    startTime: number,
  ): Promise<any> {
    const nodes: RuntimeNode[] = graph.nodes || [];
    const edges: any[] = graph.edges || [];

    let checkpointSeq = options.checkpointSequence || 1;
    let run: RunDocument;

    if (options.existingRunId) {
      const found = await this.runModel.findOne({ runId }).exec();
      if (!found) throw new NotFoundException(`Run ${runId} not found`);
      run = found;
      run.status = 'running';
      if (options.priorRecords) run.nodes = options.priorRecords;
      run.currentNodeId = undefined;
      run.waitingNodeId = undefined;
      run.waitingChildRunId = undefined;
      run.waitingDescriptor = undefined;
      checkpointSeq = Math.max(run.checkpointSequence || 0, options.checkpointSequence || 0) + 1;
      run.checkpointSequence = checkpointSeq;
      run.metadata = { ...(run.metadata || {}), engine: 'langgraph' };
      await run.save();
    } else {
      run = await this.runModel.create({
        runId,
        projectId: (graph as any).projectId || options.projectId || 'default',
        graphId: graph._id,
        graphName: graph.name,
        status: 'running',
        input: initialInput,
        nodes: options.priorRecords || [],
        parentRunId: options.parentRunId,
        rootRunId,
        idempotencyKey: options.idempotencyKey,
        sourceEventId: options.sourceEventId,
        sourceEventTopic: options.sourceEventTopic,
        propagationDepth,
        visitedArtifactLogicalIds,
        rerunFromNodeId: options.rerunFromNodeId,
        checkpointSequence: checkpointSeq,
        attempt: 1,
        startedAt: new Date(),
        metrics,
        stateVersion: 1,
        debugMode: options.debugMode || false,
        useCache: options.useCache || false,
        metadata: { engine: 'langgraph' },
      });
    }

    const leaseAcquired = await this.leaseService.acquireLease(runId);
    if (!leaseAcquired) {
      this.logger.warn(`⚠️ Could not acquire lease for Run ${runId}. Returning active run document.`);
      return this.storageService.publicRun(run);
    }

    const currentProjectId = (graph as any)?.projectId || options.projectId || run.projectId;
    const runtimeContext: Record<string, any> = {
      input: initialInput,
      apps: {},
      state: {},
      projectId: currentProjectId,
      __allNodes: nodes,
      __allEdges: edges,
    };
    const context = { ...runtimeContext, ...(options.context || {}) };
    context.state = { ...(runtimeContext.state || {}), ...(options.context?.state || context.state || {}) };
    context.runId = runId;
    await this.variableResolver.warmSecrets(nodes.map((node) => node?.data?.config), context);

    if (!this.graphCompiler) {
      await this.leaseService.releaseLease(runId);
      throw new BadRequestException('GraphCompilerService is not available');
    }

    const compiled = this.graphCompiler.compile(nodes, edges, {
      requestedStartNodeId: options.startNodeId,
    });

    let result: FlowGraphStateType | undefined;
    let executionError: any = null;

    try {
      result = await this.graphCompiler.execute(compiled, {
        runId,
        initialInput,
        initialContext: context,
      });
    } catch (err: any) {
      executionError = err;
    }

    const isPaused = await this.graphCompiler.isWaiting(compiled, runId);

    if (isPaused) {
      const waitingPayload = await this.graphCompiler.getInterruptPayload(compiled, runId);
      const waitingNodeId = waitingPayload?.nodeId || 'unknown';
      const { token, hash } = generateResumeToken();

      const stateSnapshot = await this.graphCompiler.getState(compiled, runId);
      const recordedNodes = [...(stateSnapshot.values?.nodeRecords || [])];

      const hasWaitingRecord = recordedNodes.some((r: any) => r.nodeId === waitingNodeId);
      if (!hasWaitingRecord) {
        recordedNodes.push({
          nodeId: waitingNodeId,
          nodeName: waitingPayload?.nodeName || waitingNodeId,
          nodeType: 'human-gate',
          status: 'waiting',
          input: waitingPayload?.data || {},
          startedAt: new Date(),
          attempt: 1,
        });
      } else {
        const rec = recordedNodes.find((r: any) => r.nodeId === waitingNodeId);
        if (rec) rec.status = 'waiting';
      }

      run.status = 'waiting';
      run.waitingNodeId = waitingNodeId;
      run.resumeTokenHash = hash;
      run.waitingDescriptor = {
        nodeId: waitingNodeId,
        nodeName: waitingPayload?.nodeName,
        uiPayload: waitingPayload,
      } as any;
      run.nodes = recordedNodes;
      metrics.completedNodeCount = recordedNodes.filter((n: any) => n.status === 'completed').length;
      metrics.totalDurationMs = Date.now() - startTime;
      run.metrics = metrics;

      await run.save();
      await this.checkpointService.persistCheckpoint({
        runId,
        sequence: checkpointSeq + 1,
        status: 'waiting',
        queue: [],
        context: stateSnapshot.values?.context || context,
        completedNodeIds: recordedNodes.filter((n: any) => n.status === 'completed').map((n: any) => n.nodeId),
        nodeRecords: recordedNodes,
        waitingNodeId,
        metrics,
      });
      await this.leaseService.releaseLease(runId);
      return this.storageService.publicRun(run, { resumeToken: token });
    }

    if (executionError) {
      this.logger.error(`❌ [LangGraph Engine] Run ${runId} failed: ${executionError.message || executionError}`);
      run.status = 'failed';
      run.finishedAt = new Date();
      run.error = {
        message: executionError.message || String(executionError),
        code: executionError.code || 'LANGGRAPH_EXECUTION_ERROR',
      };
      metrics.failedNodeCount += 1;
      metrics.totalDurationMs = Date.now() - startTime;
      run.metrics = metrics;

      const stateSnapshot = await this.graphCompiler.getState(compiled, runId).catch(() => null);
      if (stateSnapshot?.values?.nodeRecords) {
        run.nodes = stateSnapshot.values.nodeRecords;
      }

      await run.save();
      await this.leaseService.releaseLease(runId);
      return this.publishedRun(runId, run);
    }

    const stateSnapshot = await this.graphCompiler.getState(compiled, runId);
    const recordedNodes = stateSnapshot.values?.nodeRecords || result?.nodeRecords || [];

    run.status = 'completed';
    run.finishedAt = new Date();
    run.nodes = recordedNodes;
    run.output = result?.lastOutput !== undefined ? result.lastOutput : result?.context;
    metrics.completedNodeCount = recordedNodes.length;
    metrics.totalDurationMs = Date.now() - startTime;
    this.absorbCustomMetrics(metrics, result?.context || context);
    run.metrics = metrics;

    await run.save();
    await this.checkpointService.persistCheckpoint({
      runId,
      sequence: checkpointSeq + 1,
      status: 'completed',
      queue: [],
      context: result?.context || context,
      completedNodeIds: recordedNodes.map((n: any) => n.nodeId),
      nodeRecords: recordedNodes,
      metrics,
    });
    await this.leaseService.releaseLease(runId);
    return this.publishedRun(runId, run);
  }

  private async resumeLangGraphRun(
    run: RunDocument,
    graph: any,
    resumePayload: ResumePayload = {},
  ): Promise<any> {
    const runId = run.runId;
    const startTime = Date.now();

    if (run.status !== 'waiting') {
      throw new BadRequestException(`Run is not in waiting state (current status: ${run.status})`);
    }

    // 1. Token validation
    const submittedToken = resumePayload.token || resumePayload.resumeToken;
    if (run.resumeTokenHash) {
      if (!submittedToken) {
        throw new BadRequestException('Resume token is required');
      }
      const hashedInput = hashToken(submittedToken);
      if (hashedInput !== run.resumeTokenHash) {
        throw new BadRequestException('Invalid or expired resume token');
      }
    }

    // 2. Lease acquisition & Token consumption
    const leaseAcquired = await this.leaseService.acquireLease(runId);
    if (!leaseAcquired) {
      throw new BadRequestException('Could not acquire lease to resume run');
    }

    run.resumeTokenHash = undefined;
    run.status = 'running';
    run.waitingNodeId = undefined;
    run.waitingDescriptor = undefined;
    await run.save();

    if (!this.graphCompiler) {
      await this.leaseService.releaseLease(runId);
      throw new BadRequestException('GraphCompilerService is not available');
    }

    const compiled = this.graphCompiler.compile(graph.nodes || [], graph.edges || []);
    await this.variableResolver.warmSecrets(
      (graph.nodes || []).map((node: any) => node?.data?.config),
      { projectId: (graph as any)?.projectId || run.projectId, runId },
    );
    const decision = resumePayload.decision !== undefined ? resumePayload.decision : resumePayload;

    let result: FlowGraphStateType | undefined;
    let resumeError: any = null;

    try {
      result = await this.graphCompiler.resume(compiled, runId, decision);
    } catch (err: any) {
      resumeError = err;
    }

    const isWaitingAgain = await this.graphCompiler.isWaiting(compiled, runId);
    if (isWaitingAgain) {
      const waitingPayload = await this.graphCompiler.getInterruptPayload(compiled, runId);
      const waitingNodeId = waitingPayload?.nodeId || 'unknown';
      const { token, hash } = generateResumeToken();

      const stateSnapshot = await this.graphCompiler.getState(compiled, runId);
      const recordedNodes = stateSnapshot.values?.nodeRecords || [];

      run.status = 'waiting';
      run.waitingNodeId = waitingNodeId;
      run.resumeTokenHash = hash;
      run.waitingDescriptor = {
        nodeId: waitingNodeId,
        nodeName: waitingPayload?.nodeName,
        uiPayload: waitingPayload,
      } as any;
      run.nodes = recordedNodes;

      await run.save();
      await this.checkpointService.persistCheckpoint({
        runId,
        sequence: (run.checkpointSequence || 1) + 1,
        status: 'waiting',
        queue: [],
        context: stateSnapshot.values?.context || {},
        completedNodeIds: recordedNodes.filter((n: any) => n.status === 'completed').map((n: any) => n.nodeId),
        nodeRecords: recordedNodes,
        waitingNodeId,
      });
      await this.leaseService.releaseLease(runId);
      return this.storageService.publicRun(run, { resumeToken: token });
    }

    if (resumeError) {
      this.logger.error(`❌ [LangGraph Engine] Resumed run ${runId} failed: ${resumeError.message || resumeError}`);
      run.status = 'failed';
      run.finishedAt = new Date();
      run.error = {
        message: resumeError.message || String(resumeError),
        code: resumeError.code || 'LANGGRAPH_RESUME_ERROR',
      };
      await run.save();
      await this.leaseService.releaseLease(runId);
      return this.publishedRun(runId, run);
    }

    const stateSnapshot = await this.graphCompiler.getState(compiled, runId);
    const recordedNodes = stateSnapshot.values?.nodeRecords || result?.nodeRecords || [];

    run.status = 'completed';
    run.finishedAt = new Date();
    run.nodes = recordedNodes;
    run.output = result?.lastOutput !== undefined ? result.lastOutput : result?.context;
    if (run.metrics) {
      run.metrics.completedNodeCount = recordedNodes.length;
      run.metrics.totalDurationMs = (run.metrics.totalDurationMs || 0) + (Date.now() - startTime);
    }

    await run.save();
    await this.checkpointService.persistCheckpoint({
      runId,
      sequence: (run.checkpointSequence || 1) + 1,
      status: 'completed',
      queue: [],
      context: result?.context || {},
      completedNodeIds: recordedNodes.map((n: any) => n.nodeId),
      nodeRecords: recordedNodes,
      metrics: run.metrics,
    });
    await this.leaseService.releaseLease(runId);
    return this.publishedRun(runId, run);
  }

  async cancelRun(runId: string): Promise<any> {
    return this.recoveryService.cancelRun(runId, {
      closeRuntimeApps: (context: any) => this.browserRunner.closeRuntimeApps(context),
    });
  }

  // =========================================================================
  // State Endpoint
  // =========================================================================

  async getRunState(runId: string): Promise<RunState> {
    const run = await this.runModel.findOne({ runId }).exec();
    if (!run) throw new NotFoundException(`Run ${runId} not found`);

    const latestCheckpoint = await this.checkpointService.getLatestCheckpoint(runId);
    return this.checkpointService.buildRunState(run, latestCheckpoint);
  }

  // =========================================================================
  // Run Storage Delegations & Public Helpers
  // =========================================================================

  async getRun(runId: string): Promise<any> {
    return this.storageService.getRun(runId);
  }

  async listRuns(projectId?: string, graphId?: string): Promise<any[]> {
    return this.storageService.listRuns(projectId, graphId);
  }

  async deleteRun(runId: string): Promise<{ success: boolean; runId: string }> {
    return this.storageService.deleteRun(runId);
  }

  async rerunRun(runId: string, nodeId: string): Promise<any> {
    return this.storageService.rerunRun(runId, nodeId, this.runGraph.bind(this));
  }

  topologicalOrder(nodes: RuntimeNode[], edges: any[]): RuntimeNode[] {
    return this.topologyService.topologicalOrder(nodes, edges);
  }

  private absorbCustomMetrics(metrics: Record<string, any>, context: Record<string, any>): void {
    const extra = context?.__customMetrics;
    if (!Array.isArray(extra) || extra.length === 0) return;
    metrics.customMetrics = [...(metrics.customMetrics || []), ...extra];
    context.__customMetrics = [];
  }

  private publishedRun(runId: string, run: any, extra?: any) {
    const published = this.storageService.publicRun(run, extra);
    clearResolvedSecrets(runId);
    return published;
  }
}
