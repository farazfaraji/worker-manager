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
  generateResumeToken,
} from './services/redaction.util';
import { RunLeaseService } from './services/run-lease.service';
import { RunCheckpointService, PersistCheckpointParams } from './services/run-checkpoint.service';
import { RunTopologyService } from './services/run-topology.service';
import { SubgraphRunnerService } from './services/subgraph-runner.service';
import { RunRecoveryService } from './services/run-recovery.service';
import { RunStorageService } from './services/run-storage.service';
import { WebserverService } from '../webserver/webserver.service';

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

    let checkpointSeq = options.checkpointSequence || 1;
    const metrics: RunMetrics = options.metrics || {
      totalDurationMs: 0,
      nodeCount: nodes.length,
      completedNodeCount: 0,
      failedNodeCount: 0,
      retryCount: 0,
      childRunCount: 0,
    };

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
      });
    }

    // 2. Acquire Lease
    const leaseAcquired = await this.leaseService.acquireLease(runId);
    if (!leaseAcquired) {
      this.logger.warn(`⚠️ Could not acquire lease for Run ${runId}. Returning active run document.`);
      return this.storageService.publicRun(run);
    }

    const runtimeContext: Record<string, any> = { input: initialInput, apps: {} };
    const context = { ...runtimeContext, ...(options.context || {}) };
    const records: any[] = options.priorRecords ? [...options.priorRecords] : [];
    const completed = new Set<string>(records.filter((r) => r.status === 'completed').map((r) => r.nodeId));

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
          return this.storageService.publicRun(run);
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

        // Resolve input
        const nodeInput = this.variableResolver.resolveNodeInput(node, context, initialInput);
        const nodeStartTime = Date.now();

        // Node Execution Policy
        const rawTimeout = Number(nodeConfig.timeoutMs || data.timeoutMs || 120000);
        const timeoutMs = Math.min(900000, Math.max(10, rawTimeout));
        const rawAttempts = Number(nodeConfig.maxAttempts || data.maxAttempts || 1);
        const maxAttempts = Math.min(3, Math.max(1, rawAttempts));
        const rawBackoff = Number(nodeConfig.backoffMs || data.backoffMs || 1000);
        const backoffMs = Math.min(30000, Math.max(10, rawBackoff));

        const executionPolicy: ExecutionPolicy = { timeoutMs, maxAttempts, backoffMs };

        // Determine if node is non-retryable
        const isHumanGate = nodeType === 'human-gate' || nodeType === 'humangate';
        const isArtifactMutation =
          nodeType === 'artifact' &&
          ['create', 'update', 'patch', 'archive', 'addrelation', 'removerelation', 'link'].includes(
            String(nodeConfig.operation || nodeInput?.operation || '').toLowerCase(),
          );

        const effectiveMaxAttempts = (isHumanGate || isArtifactMutation) ? 1 : executionPolicy.maxAttempts;

        // Create running node record
        const record: NodeRunRecord = {
          nodeId: node.id,
          nodeName,
          nodeType,
          status: 'running',
          input: nodeInput,
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

        let rawOutput: any;
        let finalError: any = null;

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

        const nodeDuration = Date.now() - nodeStartTime;
        record.durationMs = nodeDuration;
        record.finishedAt = new Date();

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

          throw finalError;
        }

        const output = this.variableResolver.normalizeOutput(node, rawOutput);
        lastNodeOutput = output;
        record.output = output;

        // Waiting State Handling (Human-Gate or Waiting Subgraph)
        if (rawOutput?.status === 'waiting') {
          record.status = 'waiting';
          run.status = 'waiting';
          run.waitingNodeId = node.id;
          run.output = { [nodeName]: output };
          run.nodes = records;
          run.checkpointSequence = ++checkpointSeq;

          let rawResumeToken: string | undefined;

          if (nodeType === 'subgraph' && rawOutput.childRunId) {
            metrics.childRunCount = (metrics.childRunCount || 0) + 1;
            record.childRunId = rawOutput.childRunId;
            run.waitingChildRunId = rawOutput.childRunId;
            run.waitingDescriptor = {
              nodeId: node.id,
              nodeName,
              nodeType,
              waitingChildRunId: rawOutput.childRunId,
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

        // Completed Node Handling
        record.status = 'completed';
        completed.add(node.id);
        metrics.completedNodeCount = (metrics.completedNodeCount || 0) + 1;
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

        // Edge traversal
        const nodeEdges = outgoing.get(node.id) || [];
        const nextTargets = this.topologyService.resolveNextTargets(node, lastNodeOutput, nodeEdges);

        for (const targetId of nextTargets) {
          queue.push(targetId);
        }

        if (queue.length > this.maxQueueLength) {
          const err: any = new BadRequestException(`Queue length exceeded limit of ${this.maxQueueLength}`);
          err.code = 'MAX_QUEUE_LENGTH_EXCEEDED';
          throw err;
        }
      }

      // Successful completion
      const output = this.topologyService.buildRunOutput(executedNodes, context, completed);
      const totalDuration = Date.now() - startTime;
      metrics.totalDurationMs = totalDuration;

      run.status = 'completed';
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
        status: 'completed',
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
      return this.storageService.publicRun(run);
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;
      metrics.totalDurationMs = totalDuration;

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
      return this.storageService.publicRun(run);
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
      return this.subgraphRunner.executeForeachNode(
        node,
        nodeInput,
        runId,
        currentDepth,
        visitedArtifactLogicalIds,
        this.runGraph.bind(this),
      );
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
  ): Promise<any> {
    return this.subgraphRunner.executeForeachNode(
      node,
      nodeInput,
      runId,
      currentDepth,
      visitedArtifactLogicalIds,
      this.runGraph.bind(this),
    );
  }

  // =========================================================================
  // Resume & Cancellation Delegations
  // =========================================================================

  async resumeRun(runId: string, resumePayload: ResumePayload = {}): Promise<any> {
    return this.recoveryService.resumeRun(runId, resumePayload, {
      runGraph: this.runGraph.bind(this),
      findGraph: (id: string) => this.graphsService.findOne(id),
    });
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
}
