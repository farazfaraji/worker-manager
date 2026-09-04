import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ArtifactService } from './artifact.service';
import { ArtifactRelationService } from './artifact-relation.service';
import { MemoryService } from './memory.service';
import { TraceService } from './trace.service';
import { AgentRunnerService } from '../runs/services/agent-runner.service';
import { BrowserRunnerService } from '../runs/services/browser-runner.service';
import { RuntimeNode } from '../runs/services/variable-resolver.service';
import { AggregateResult, BlockInput, BlockOutput } from './block.types';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';

const execFileAsync = promisify(execFile);

@Injectable()
export class BlockRuntimeService {
  private readonly logger = new Logger(BlockRuntimeService.name);

  constructor(
    private readonly artifacts: ArtifactService,
    private readonly memory: MemoryService,
    private readonly traces: TraceService,
    private readonly agentRunner: AgentRunnerService,
    private readonly browserRunner: BrowserRunnerService,
    private readonly embeddings: EmbeddingService,
    private readonly vectors: VectorStoreService,
    @Optional() private readonly relations?: ArtifactRelationService,
  ) {}

  async execute(type: string, input: BlockInput, node?: RuntimeNode): Promise<BlockOutput> {
    const normalized = String(type || '').toLowerCase();
    switch (normalized) {
      case 'action': return this.action(input);
      case 'memory': return this.memoryBlock(input);
      case 'retrieval': return this.retrieval(input);
      case 'artifact': return this.artifact(input, node);
      case 'embedding': return this.embedding(input);
      case 'router': return this.router(input);
      case 'human-gate': case 'humangate': return this.humanGate(input);
      case 'orchestrator': case 'delegator': return this.orchestrate(input);
      case 'loop': return this.loop(input);
      case 'aggregate': return this.aggregate(input);
      case 'execution': return this.execution(input);
      case 'notification': return this.notification(input);
      default: throw new BadRequestException(`Unsupported generic block: ${type}`);
    }
  }

  private async action(input: BlockInput): Promise<BlockOutput> {
    const config: any = input.config || {};
    const provider = String(config.provider || config.integration || 'http').toLowerCase();
    const action = String(config.action || config.operation || 'request').toLowerCase();
    if (provider === 'browser') {
      const node: any = { id: `action-${input.runId || Date.now()}`, data: { appId: config.appId || 'browser-action', name: config.appId || 'browser-action', config } };
      const result = await this.browserRunner.executeBrowserNode(node, config, input.context || {}, input.runId || `action-${Date.now()}`);
      return { status: 'completed', result: { provider, action, ...result } };
    }
    if (provider === 'http' || provider === 'web') {
      const url = String(config.url || input.input?.url || '');
      if (!/^https?:\/\//i.test(url)) throw new BadRequestException('action.http requires a valid http(s) URL');
      const hostname = new URL(url).hostname;
      const allowedHosts = Array.isArray(config.allowedHosts) ? config.allowedHosts.map(String) : [];
      if (!allowedHosts.includes(hostname) && !config.allowAnyHost) {
        return { status: 'completed', result: { provider, action, dryRun: true, blocked: true, reason: 'Host is not in allowedHosts', url } };
      }
      const response = await fetch(url, { method: String(config.method || 'GET').toUpperCase(), headers: config.headers || {}, body: config.body === undefined ? undefined : JSON.stringify(config.body) });
      const text = await response.text();
      let body: any = text;
      try { body = JSON.parse(text); } catch {}
      return { status: 'completed', result: { provider, action, status: response.status, ok: response.ok, headers: Object.fromEntries(response.headers.entries()), body } };
    }
    return { status: 'completed', result: { provider, action, parameters: config.parameters || input.input, delegated: true } };
  }

  private async memoryBlock(input: BlockInput): Promise<BlockOutput> {
    const op = String(input.config?.operation || 'recall').toLowerCase();
    const result = op === 'remember' ? await this.memory.remember({ ...input.input, ...input.config }) : op === 'forget' ? await this.memory.forget({ ...input.input, ...input.config }) : await this.memory.recall({ ...input.input, ...input.config });
    return { status: 'completed', result };
  }

  private async retrieval(input: BlockInput): Promise<BlockOutput> {
    const config: any = input.config || {};
    const payload: any = input.input && typeof input.input === 'object' ? input.input : { query: input.input };
    const operation = String(config.operation || payload.operation || 'search').toLowerCase();
    if (operation === 'index' || operation === 'upsert') {
      const documents = Array.isArray(payload.documents) ? payload.documents : [payload];
      const records = [];
      for (const document of documents) {
        const text = String(document.text || document.content || '').trim();
        if (!text) continue;
        const embedding = Array.isArray(document.embedding) ? document.embedding : await this.embeddings.embed(text, config);
        records.push(await this.vectors.upsert({ namespace: config.namespace || payload.namespace, sourceType: document.sourceType || config.sourceType || 'document', sourceId: document.sourceId || document.artifactId || config.sourceId || `document-${Date.now()}`, version: document.version, chunkId: document.chunkId, text, embedding, metadata: { ...(document.metadata || {}), projectId: document.projectId || config.projectId, status: document.status || config.status } }));
      }
      return { status: 'completed', result: { operation: 'index', indexedCount: records.length, records } };
    }
    const query = String(payload.query || config.query || '').trim();
    const rawEmbedding = payload.embedding !== undefined ? payload.embedding : config.embedding;
    const embedding = Array.isArray(rawEmbedding) && rawEmbedding.length > 0
      ? rawEmbedding
      : (query ? await this.embeddings.embed(query, config) : []);
    const keywords = payload.keywords !== undefined ? payload.keywords : (config.keywords !== undefined ? config.keywords : payload.keyword || config.keyword);
    const results = await this.vectors.search({
      embedding,
      namespace: config.namespace || payload.namespace || 'artifact-index',
      sourceType: config.sourceType || payload.sourceType,
      projectId: config.projectId || payload.projectId,
      status: config.status || payload.status,
      keywords,
      limit: config.limit || payload.limit || 5,
      latestOnly: config.latestOnly !== undefined ? config.latestOnly : payload.latestOnly,
      logicalId: config.logicalId || payload.logicalId,
      artifactType: config.artifactType || payload.artifactType,
    });

    const context = results
      .map((r: any, idx: number) => {
        const title = r.metadata?.title || r.logicalId || r.artifactId || `Source #${idx + 1}`;
        const score = typeof r.score === 'number' ? ` (Similarity: ${(r.score * 100).toFixed(1)}%)` : '';
        return `### ${title}${score}\n${r.text || ''}`;
      })
      .join('\n\n---\n\n');

    return {
      status: 'completed',
      context,
      results,
      count: results.length,
      result: {
        operation: 'search',
        query,
        context,
        results,
        count: results.length,
        embeddingDimension: embedding.length,
      },
    };
  }

  private async embedding(input: BlockInput): Promise<BlockOutput> {
    const config: any = input.config || {};
    const payload: any = input.input && typeof input.input === 'object' ? input.input : {};

    const artifactId = String(payload.artifactId || config.artifactId || '').trim();
    let logicalId = String(payload.logicalId || config.logicalId || '').trim();
    const projectId = String(payload.projectId || config.projectId || '').trim();
    const namespace = String(payload.namespace || config.namespace || 'default').trim();
    const includeRawVectors = Boolean(payload.includeRawVectors ?? config.includeRawVectors ?? false);

    let rawInput: any;

    if (Array.isArray(input.input)) {
      rawInput = input.input;
    } else if (typeof input.input === 'string' || typeof input.input === 'number') {
      rawInput = input.input;
    } else if (input.input && typeof input.input === 'object') {
      rawInput = input.input.text !== undefined ? input.input.text : input.input.texts !== undefined ? input.input.texts : input.input.input;
    }

    if (rawInput === undefined) {
      rawInput = config.text !== undefined ? config.text : config.texts !== undefined ? config.texts : config.input;
    }

    let texts: string[] = [];
    if (Array.isArray(rawInput)) {
      texts = rawInput.map((t) => (typeof t === 'string' ? t : JSON.stringify(t)));
    } else if (typeof rawInput === 'string') {
      const trimmed = rawInput.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            texts = parsed.map((t) => (typeof t === 'string' ? t : JSON.stringify(t)));
          } else {
            texts = [trimmed];
          }
        } catch {
          texts = [trimmed];
        }
      } else {
        texts = [trimmed];
      }
    } else if (rawInput !== undefined && rawInput !== null) {
      texts = [String(rawInput)];
    }

    // If no text provided, attempt to fetch from linked artifact
    let artifactDoc: any = null;
    if (artifactId) {
      try {
        artifactDoc = await this.artifacts.get(artifactId, projectId || undefined, false);
        if (artifactDoc) {
          if (!logicalId) logicalId = artifactDoc.logicalId || '';
          if (texts.length === 0 && artifactDoc.content) {
            const contentStr = typeof artifactDoc.content === 'object'
              ? JSON.stringify(artifactDoc.content, null, 2)
              : String(artifactDoc.content);
            texts = [contentStr];
          }
        }
      } catch (err: any) {
        this.logger.warn(`Could not load artifact ${artifactId} for embedding: ${err.message}`);
      }
    }

    const embeddings = await this.embeddings.embedMany(texts, config);
    const singleVector = embeddings.length === 1 ? embeddings[0] : undefined;
    const hasArtifactLink = Boolean(artifactId || logicalId);

    // If linked to an artifact, store vectors out-of-band in MongoDB VectorStore
    if (hasArtifactLink) {
      const version = Number(artifactDoc?.version || payload.version || config.version || 1);
      const artifactType = String(artifactDoc?.type || payload.artifactType || config.artifactType || 'document');
      const isLatest = config.isLatest !== undefined ? Boolean(config.isLatest) : (artifactDoc?.isLatest ?? true);

      for (let i = 0; i < texts.length; i++) {
        const chunkId = `c${i}`;
        await this.vectors.upsert({
          namespace,
          sourceType: 'artifact',
          sourceId: artifactId || logicalId,
          logicalId: logicalId || undefined,
          artifactId: artifactId || undefined,
          artifactType,
          version,
          chunkId,
          text: texts[i],
          embedding: embeddings[i],
          isLatest,
          projectId: projectId || artifactDoc?.projectId || 'default',
          metadata: {
            title: artifactDoc?.title || payload.title || config.title,
            ...(artifactDoc?.metadata || {}),
            ...(config.metadata || {}),
            ...(payload.metadata || {}),
          },
        });
      }
    }

    // Keep state lean: exclude raw vectors if linked to an artifact unless includeRawVectors is requested
    const shouldIncludeVectors = includeRawVectors || !hasArtifactLink;

    return {
      status: 'completed',
      ...(artifactId ? { artifactId } : {}),
      ...(logicalId ? { logicalId } : {}),
      indexedChunks: texts.length,
      dimensions: embeddings[0]?.length || 0,
      stored: hasArtifactLink,
      result: {
        model: config.embeddingModel || config.model || process.env.EMBEDDING_MODEL || 'default',
        dimensions: embeddings[0]?.length || 0,
        indexedChunks: texts.length,
        stored: hasArtifactLink,
        ...(artifactId ? { artifactId } : {}),
        ...(logicalId ? { logicalId } : {}),
        ...(shouldIncludeVectors
          ? { embeddings, ...(singleVector ? { embedding: singleVector } : {}) }
          : {}),
      },
      ...(shouldIncludeVectors
        ? { embeddings, ...(singleVector ? { embedding: singleVector } : {}) }
        : {}),
    };
  }

  private async artifact(input: BlockInput, node?: RuntimeNode): Promise<BlockOutput> {
    const op = String(input.config?.operation || 'create').toLowerCase();
    const payload: any = { ...(input.input && typeof input.input === 'object' ? input.input : {}), ...input.config };
    if (!payload.projectId && payload.namespace) {
      payload.projectId = payload.namespace;
    }
    if (!payload.namespace && payload.projectId) {
      payload.namespace = payload.projectId;
    }

    if (op === 'list') {
      const items = await this.artifacts.list(payload);
      const firstItem = Array.isArray(items) && items.length > 0 ? items[0] : null;
      return {
        status: 'completed',
        artifacts: items,
        count: Array.isArray(items) ? items.length : 0,
        artifact: firstItem,
        artifactId: firstItem?.artifactId || '',
        logicalId: firstItem?.logicalId || '',
        rootArtifactId: firstItem?.rootArtifactId || '',
        isLatest: firstItem?.isLatest ?? true,
      };
    }

    if (op === 'diff') {
      let prev = payload.previous;
      let next = payload.next;
      if (typeof prev === 'string' && prev.trim() && !prev.includes('\n') && !prev.startsWith('{')) {
        const doc = await this.artifacts.get(prev.trim(), payload.projectId, false);
        if (doc) prev = doc.content;
      }
      if (typeof next === 'string' && next.trim() && !next.includes('\n') && !next.startsWith('{')) {
        const doc = await this.artifacts.get(next.trim(), payload.projectId, false);
        if (doc) next = doc.content;
      }
      const diffResult = this.artifacts.diff(prev, next);
      return {
        status: 'completed',
        ...(typeof diffResult === 'object' && diffResult !== null ? diffResult : { diff: diffResult }),
      };
    }

    if (op === 'get') {
      const id = String(payload.artifactId || payload.logicalId || payload.docId || payload.id || '');
      const projectId = payload.projectId ? String(payload.projectId).trim() : undefined;
      const doc = id ? await this.artifacts.get(id, projectId, false) : null;
      const existing = Boolean(doc);
      return {
        status: doc?.status || (existing ? 'completed' : 'not_found'),
        existing,
        artifact: doc,
        artifactId: doc?.artifactId || id,
        logicalId: doc?.logicalId || id,
        rootArtifactId: doc?.rootArtifactId || '',
        isLatest: doc?.isLatest ?? true,
        contentHash: doc?.contentHash || '',
        schemaVersion: doc?.schemaVersion || 1,
        projectId: doc?.projectId || projectId || '',
        title: doc?.title || '',
        type: doc?.type || '',
        format: doc?.format || 'markdown',
        keyword: doc?.keyword || doc?.keywords || [],
        keywords: doc?.keywords || doc?.keyword || [],
        content: doc?.content || null,
        version: doc?.version || 0,
      };
    }

    if (op === 'getlatest' || op === 'get-latest') {
      const id = String(payload.logicalId || payload.artifactId || payload.id || '');
      const projectId = payload.projectId ? String(payload.projectId).trim() : undefined;
      const doc = id ? await this.artifacts.getLatest(id, projectId) : null;
      const existing = Boolean(doc);
      return {
        status: doc?.status || (existing ? 'completed' : 'not_found'),
        existing,
        artifact: doc,
        artifactId: doc?.artifactId || '',
        logicalId: doc?.logicalId || id,
        rootArtifactId: doc?.rootArtifactId || '',
        isLatest: doc?.isLatest ?? true,
        contentHash: doc?.contentHash || '',
        schemaVersion: doc?.schemaVersion || 1,
        projectId: doc?.projectId || projectId || '',
        title: doc?.title || '',
        type: doc?.type || '',
        format: doc?.format || 'markdown',
        keyword: doc?.keyword || doc?.keywords || [],
        keywords: doc?.keywords || doc?.keyword || [],
        content: doc?.content || null,
        version: doc?.version || 0,
      };
    }

    if (op === 'listversions' || op === 'list-versions') {
      const id = String(payload.logicalId || payload.artifactId || payload.id || '');
      const versions = id ? await this.artifacts.listVersions(id, payload.projectId) : [];
      const latest = versions.length > 0 ? versions[versions.length - 1] : null;
      return {
        status: 'completed',
        versions,
        count: versions.length,
        artifact: latest,
        artifactId: latest?.artifactId || '',
        logicalId: latest?.logicalId || id,
      };
    }

    if (op === 'getrelations' || op === 'get-relations') {
      const id = String(payload.logicalId || payload.artifactId || payload.id || '');
      const direction = payload.relationDirection || payload.direction || 'both';
      const relations = this.relations
        ? await this.relations.getRelations(id, { direction, projectId: payload.projectId })
        : [];
      return {
        status: 'completed',
        relations,
        count: relations.length,
        logicalId: id,
      };
    }

    if (op === 'removerelation' || op === 'remove-relation') {
      const relationId = String(payload.relationId || payload.id || '');
      const res = this.relations
        ? await this.relations.removeRelation(relationId, payload.projectId, {
            origin: 'flow',
            runId: input.runId,
            nodeId: node?.id,
          })
        : { success: false, removedCount: 0 };
      return {
        status: 'completed',
        success: res.success,
        removedCount: res.removedCount,
        relationId,
      };
    }

    if (op === 'addrelation' || op === 'add-relation' || op === 'link') {
      const id = String(payload.artifactId || payload.logicalId || payload.id || '');
      // If typed relation input provided
      if (this.relations && payload.targetLogicalId && (payload.relationType || payload.type)) {
        const type = payload.relationType || payload.type;
        const result = await this.relations.addRelation({
          sourceLogicalId: id,
          targetLogicalId: payload.targetLogicalId,
          type,
          projectId: payload.projectId,
          metadata: payload.metadata,
          source: { origin: 'flow', runId: input.runId, nodeId: node?.id },
        });
        return {
          status: 'completed',
          forward: result.forward,
          reverse: result.reverse,
          relationId: result.forward.relationId,
          relations: [result.forward, result.reverse],
        };
      }

      const relations = payload.linkedArtifactIds !== undefined ? payload.linkedArtifactIds : (payload.relations !== undefined ? payload.relations : payload.newRelations);
      const doc = await this.artifacts.addRelation(id, relations, { origin: 'flow', runId: input.runId, nodeId: node?.id });
      return {
        status: 'completed',
        artifact: doc,
        artifactId: doc?.artifactId || id,
        logicalId: doc?.logicalId || '',
        rootArtifactId: doc?.rootArtifactId || '',
        isLatest: doc?.isLatest ?? true,
        linkedArtifactIds: doc?.linkedArtifactIds || [],
        projectId: doc?.projectId || payload.projectId || '',
        title: doc?.title,
        type: doc?.type,
        format: doc?.format || 'markdown',
        version: doc?.version,
        content: doc?.content,
        keyword: doc?.keyword || doc?.keywords || [],
        keywords: doc?.keywords || doc?.keyword || [],
      };
    }

    const doc = op === 'approve' ? await this.artifacts.approve(String(payload.artifactId || payload.logicalId || payload.id), payload.metadata)
      : op === 'archive' ? await this.artifacts.archive(String(payload.artifactId || payload.logicalId || payload.id))
      : op === 'update' || op === 'patch' ? await this.artifacts.update(String(payload.artifactId || payload.logicalId || payload.id), payload)
      : await this.artifacts.create(payload);

    return {
      status: 'completed',
      artifact: doc,
      artifactId: doc?.artifactId,
      logicalId: doc?.logicalId || '',
      rootArtifactId: doc?.rootArtifactId || '',
      isLatest: doc?.isLatest ?? true,
      contentHash: doc?.contentHash || '',
      schemaVersion: doc?.schemaVersion || 1,
      changed: doc?.changed ?? true,
      projectId: doc?.projectId || payload.projectId || '',
      title: doc?.title,
      type: doc?.type,
      format: doc?.format || 'markdown',
      keyword: doc?.keyword || doc?.keywords || [],
      keywords: doc?.keywords || doc?.keyword || [],
      content: doc?.content,
      version: doc?.version,
      linkedArtifactIds: doc?.linkedArtifactIds || [],
      ...(doc?.parentArtifactId ? { parentArtifactId: doc.parentArtifactId } : {}),
      ...(doc?.metadata ? { metadata: doc.metadata } : {}),
    };
  }

  private async change(input: BlockInput): Promise<BlockOutput> {
    const request = input.input?.request || input.input || input.config?.request || '';
    const text = typeof request === 'string' ? request : JSON.stringify(request);
    const lower = text.toLowerCase();
    const category = /task|implement|code|cli|commit/.test(lower) ? 'task' : /api|database|architecture|technical|integration/.test(lower) ? 'tech-spec' : /ui|ux|screen|design/.test(lower) ? 'prd' : /add|remove|change|support|feature|gateway/.test(lower) ? 'change' : 'clarification';
    const affectedLayers = category === 'change' ? ['high-level', 'prd', 'tech-spec', 'task'] : category === 'task' ? ['task'] : category === 'tech-spec' ? ['tech-spec', 'task'] : ['prd'];
    return { status: 'completed', result: { kind: category, request, affectedLayers, confidence: 0.7, proposedOperation: 'patch', questions: category === 'clarification' ? [text] : [] } };
  }

  private router(input: BlockInput): BlockOutput {
    const config: any = input.config || {};
    let value = input.input?.value ?? input.input;
    if (value && typeof value === 'object' && value.value !== undefined) {
      value = value.value;
    }
    let routes = config.routes;
    if (typeof routes === 'string') {
      try {
        routes = JSON.parse(routes);
      } catch {
        routes = [];
      }
    }
    routes = Array.isArray(routes) ? routes : [];

    const valueStr = String(value ?? '').trim().toLowerCase();
    const selected =
      routes.find((route: any) => {
        if (route.when === value) return true;
        if (typeof route.when === 'string' && route.when.trim().toLowerCase() === valueStr) return true;
        if (Array.isArray(route.when)) {
          return route.when.some(
            (w: any) => w === value || String(w ?? '').trim().toLowerCase() === valueStr,
          );
        }
        return false;
      }) || routes.find((route: any) => route.default);

    const isMatched = Boolean(selected && !selected.default);
    const chosenRoute = selected?.name || selected?.id || config.defaultRoute || 'default';

    return {
      status: 'completed',
      result: {
        route: chosenRoute,
        matched: isMatched,
        value,
      },
    };
  }

  private humanGate(input: BlockInput): BlockOutput {
    const config: any = input.config || {};
    const payload: any = input.input || {};

    const hasResumed =
      payload.decision !== undefined ||
      payload.approved !== undefined ||
      payload.value !== undefined ||
      payload.formValues !== undefined ||
      payload.__resumed === true;

    if (hasResumed) {
      const approved = payload.approved !== undefined ? Boolean(payload.approved) : (payload.decision !== undefined ? Boolean(payload.decision) : true);
      const value = payload.value !== undefined ? payload.value : (payload.formValues !== undefined ? payload.formValues : (payload.decision !== undefined ? payload.decision : payload.feedback));
      const formValues = payload.formValues || (typeof value === 'object' && value !== null ? value : { value });
      const feedback = payload.feedback || (typeof value === 'string' ? value : '');
      const draft = payload.draft !== undefined ? payload.draft : (config.draft !== undefined ? config.draft : payload.draft);

      return {
        status: 'completed',
        result: {
          approved,
          decision: payload.decision !== undefined ? payload.decision : approved,
          value,
          formValues,
          feedback,
          draft,
          inputType: config.inputType || 'approval',
          submittedAt: new Date().toISOString(),
        },
        approved,
        value,
      };
    }

    // Waiting state
    const inputType = config.inputType || 'approval';
    const rawOptions = config.options;
    let options = Array.isArray(rawOptions) ? rawOptions : (typeof rawOptions === 'string' ? rawOptions.split(',').map((s: string) => s.trim()).filter(Boolean) : []);
    if (!options.length && (inputType === 'select' || inputType === 'radio')) {
      options = ['Approve', 'Request Changes', 'Reject'];
    }

    let formFields = Array.isArray(config.formFields) ? config.formFields : [];
    if (!formFields.length && inputType === 'form') {
      formFields = [
        { name: 'decision', label: 'Decision', type: 'radio', options: ['Approve', 'Reject'], required: true },
        { name: 'feedback', label: 'Review Feedback', type: 'textarea', required: false },
      ];
    }

    return {
      status: 'waiting',
      result: {
        approvalRequired: true,
        token: payload.token || `approval-${Date.now()}`,
        question: config.question || 'Please review this request and provide your response.',
        inputType,
        options,
        formFields,
        draft: config.draft !== undefined ? config.draft : payload.draft,
        allowDraftEdit: config.allowDraftEdit === true || config.allowDraftEdit === 'true',
        timeoutMs: Number(config.timeoutMs || 86400000),
      },
    };
  }

  private async orchestrate(input: BlockInput): Promise<BlockOutput> {
    const agents = Array.isArray(input.config?.agents) ? input.config.agents : [];
    const goal = input.config?.goal || input.input;
    const results = await Promise.all(agents.map(async (agent: any) => {
      const node: any = { id: `delegated-${agent.id || agent.name}`, data: { config: { ...agent, userPrompt: agent.prompt || goal, outputFormat: agent.outputFormat || 'json' } } };
      const result = await this.agentRunner.executeAgentNode(node, goal, input.context || {});
      return { id: agent.id || agent.name, role: agent.role, result };
    }));
    return { status: 'completed', result: { goal, results, agentCount: results.length } };
  }

  private async loop(input: BlockInput): Promise<BlockOutput> {
    const items = Array.isArray(input.input) ? input.input : Array.isArray(input.input?.items) ? input.input.items : [];
    const limit = Math.min(items.length, Number(input.config?.maxIterations || 100));
    const results = items.slice(0, limit).map((item, index) => ({ index, item }));
    return { status: 'completed', result: { items: results, count: results.length, truncated: items.length > limit } };
  }

  private aggregate(input: BlockInput): BlockOutput {
    const config: any = input.config || {};
    const inputSource: any = input.input !== undefined ? input.input : input.config;

    let rawItems: any = undefined;
    if (Array.isArray(inputSource)) {
      rawItems = inputSource;
    } else if (inputSource && typeof inputSource === 'object') {
      if (Array.isArray(inputSource.items)) {
        rawItems = inputSource.items;
      } else if (inputSource.result && Array.isArray(inputSource.result.items)) {
        rawItems = inputSource.result.items;
      } else if (inputSource.items && typeof inputSource.items === 'object' && Array.isArray(inputSource.items.items)) {
        rawItems = inputSource.items.items;
      } else if (Array.isArray(config.items)) {
        rawItems = config.items;
      } else if (config.items && typeof config.items === 'object' && Array.isArray(config.items.items)) {
        rawItems = config.items.items;
      }
    } else if (typeof inputSource === 'string') {
      const trimmed = inputSource.trim();
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            rawItems = parsed;
          } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
            rawItems = parsed.items;
          }
        } catch {}
      }
    }

    if (!Array.isArray(rawItems)) {
      const failedResult: AggregateResult = {
        items: [],
        errors: [{ index: -1, error: 'Invalid input: expected an array or an object containing an items array' }],
        count: 0,
        successCount: 0,
        failureCount: 0,
        allSucceeded: false,
        truncated: false,
      };
      return {
        status: 'failed',
        result: failedResult,
        error: 'Invalid input: expected an array or an object containing an items array',
      };
    }

    const includeSuccessful = config.includeSuccessful !== undefined
      ? Boolean(config.includeSuccessful)
      : (inputSource?.includeSuccessful !== undefined ? Boolean(inputSource.includeSuccessful) : true);
    const includeFailed = config.includeFailed !== undefined
      ? Boolean(config.includeFailed)
      : (inputSource?.includeFailed !== undefined ? Boolean(inputSource.includeFailed) : true);

    let truncated = false;
    if (inputSource && typeof inputSource === 'object') {
      if (typeof inputSource.truncated === 'boolean') {
        truncated = inputSource.truncated;
      } else if (inputSource.result && typeof inputSource.result.truncated === 'boolean') {
        truncated = inputSource.result.truncated;
      } else if (inputSource.items && typeof inputSource.items.truncated === 'boolean') {
        truncated = inputSource.items.truncated;
      }
    }

    const filteredItems: any[] = [];
    const errors: Array<{ index: number; childRunId?: string; error: any }> = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < rawItems.length; i++) {
      const it = rawItems[i];
      const isFailed = Boolean(
        it &&
        typeof it === 'object' &&
        (it.status === 'failed' || (it.error !== undefined && it.error !== null && it.error !== false))
      ) || (it instanceof Error);

      if (isFailed) {
        failureCount++;
        const itemError = (it && typeof it === 'object' && it.error !== undefined)
          ? it.error
          : (it instanceof Error ? it.message : 'Item execution failed');
        const errObj: { index: number; childRunId?: string; error: any } = {
          index: (it && typeof it === 'object' && typeof it.index === 'number') ? it.index : i,
          error: itemError,
        };
        if (it && typeof it === 'object' && it.childRunId) {
          errObj.childRunId = it.childRunId;
        }
        errors.push(errObj);

        if (includeFailed) {
          filteredItems.push(it);
        }
      } else {
        successCount++;
        if (includeSuccessful) {
          filteredItems.push(it);
        }
      }
    }

    const result: AggregateResult = {
      items: filteredItems,
      errors,
      count: filteredItems.length,
      successCount,
      failureCount,
      allSucceeded: failureCount === 0,
      truncated,
    };

    return {
      status: 'completed',
      result,
    };
  }

  private async execution(input: BlockInput): Promise<BlockOutput> {
    const config: any = input.config || {};
    const command = String(config.command || input.input?.command || '');
    const args = Array.isArray(config.args) ? config.args.map(String) : [];
    if (!command) throw new BadRequestException('execution requires command');
    const allowedCommands = Array.isArray(config.allowedCommands) ? config.allowedCommands.map(String) : [];
    if (!allowedCommands.includes(command) && !config.allowAnyCommand) {
      return { status: 'completed', result: { command, args, dryRun: true, blocked: true, reason: 'Command is not in allowedCommands' } };
    }
    try {
      const result: any = await execFileAsync(command, args, { cwd: config.cwd, timeout: Number(config.timeoutMs || 120000), maxBuffer: Number(config.maxBuffer || 5_000_000), env: config.env ? { ...process.env, ...config.env } : process.env });
      return { status: 'completed', result: { command, args, exitCode: 0, stdout: result.stdout, stderr: result.stderr } };
    } catch (error: any) {
      return { status: 'failed', result: { command, args, exitCode: error.code, stdout: error.stdout, stderr: error.stderr }, error: error.message };
    }
  }

  private async notification(input: BlockInput): Promise<BlockOutput> {
    const config: any = input.config || {};
    if (config.url) return this.action({ ...input, config: { provider: 'http', url: config.url, method: config.method || 'POST', headers: config.headers || { 'content-type': 'application/json' }, body: input.input } });
    return { status: 'completed', result: { delivered: false, channel: config.channel || 'internal', payload: input.input } };
  }
}
