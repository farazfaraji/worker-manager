import {
  AssistantMode,
  BlockReference,
  ClarifyingQuestion,
  FlowAssistantResponse,
  FlowGraph,
  FlowOperation,
  FlowOutline,
} from '../dto/flow-assistant.dto';

const MODES: AssistantMode[] = ['clarify', 'confirm', 'build', 'edit', 'answer'];

const OUTPUT_KINDS = new Set(['telegram', 'output', 'http-response', 'notification']);

export interface DefinitionPorts {
  kind: string;
  outputs: string[];
}

export interface AssistantGraph {
  blocks: any[];
  connections: any[];
}

export interface AssistantValidationContext {
  currentGraph: AssistantGraph;
  definitions: DefinitionPorts[];
  confirmed: boolean;
}

export interface DirectiveInput {
  confirmed?: boolean;
  confirmedOutline?: FlowOutline | null;
  skipClarification?: boolean;
  history?: { role?: string; mode?: string }[];
}

/**
 * Instruction injected into the user prompt before the model call.
 * Confirmation forces a build. Skipping, or two earlier clarify turns, stops further questions.
 */
export function computeDirective(input: DirectiveInput): string | null {
  if (input.confirmed && input.confirmedOutline) {
    return 'The user confirmed the outline. Return mode "build" now and match the confirmed outline. Do not ask questions and do not return confirm.';
  }

  const clarifyRounds = (input.history || []).filter(
    (message) => message.role === 'assistant' && message.mode === 'clarify',
  ).length;

  if (input.skipClarification || clarifyRounds >= 2) {
    return 'Do not ask more questions. Do not return mode "clarify" or mode "build". If this is a new flow, return mode "confirm" with an outline. If the canvas already has blocks and the user asked for a change, return mode "edit". If they asked a question, return mode "answer".';
  }

  return null;
}

export function normalizeGraph(
  rawGraph: any,
  currentFallback: AssistantGraph,
): FlowGraph {
  if (!rawGraph || !Array.isArray(rawGraph.blocks)) {
    return {
      blocks: (currentFallback.blocks || []).map(normalizeBlock),
      connections: (currentFallback.connections || []).map(normalizeConnection),
    };
  }

  return {
    blocks: rawGraph.blocks.map((block: any, idx: number) => normalizeBlock(block, idx)),
    connections: Array.isArray(rawGraph.connections)
      ? rawGraph.connections.map((connection: any, idx: number) =>
          normalizeConnection(connection, idx),
        )
      : [],
  };
}

/**
 * Enforces confirm-before-build, turns an unconfirmed full graph into an edit diff,
 * caps questions, drops invalid operations, and strips references to unknown blocks.
 */
export function validateAssistantResponse(
  parsed: any,
  ctx: AssistantValidationContext,
): Omit<FlowAssistantResponse, 'modelUsed' | 'provider'> {
  const isNewFlow = (ctx.currentGraph.blocks || []).length === 0;
  let mode = inferMode(parsed, ctx);

  if (ctx.confirmed && hasBlocks(parsed?.graph)) {
    mode = 'build';
  } else if (ctx.confirmed && mode === 'clarify') {
    mode = 'answer';
  }

  if (mode === 'build') {
    const graph = normalizeGraph(parsed.graph, ctx.currentGraph);
    if (!ctx.confirmed && isNewFlow) {
      return finishConfirm(parsed, outlineFromGraph(graph, parsed), graphBlockIds(graph));
    }
    if (!ctx.confirmed && !isNewFlow) {
      return finishEdit(parsed, diffGraphs(ctx.currentGraph, graph), ctx);
    }
    return finishBuild(parsed, graph);
  }

  if (mode === 'edit') {
    return finishEdit(parsed, parsed.operations, ctx);
  }

  if (mode === 'clarify') {
    const questions = normalizeQuestions(parsed.questions);
    if (questions.length === 0) {
      if (parsed.outline) return finishConfirm(parsed, normalizeOutline(parsed.outline, parsed), new Set());
      if (hasBlocks(parsed.graph)) {
        return validateAssistantResponse({ ...parsed, mode: 'build' }, ctx);
      }
      return finishAnswer(parsed, ctx);
    }
    const allowed = currentIds(ctx);
    const { reply, references } = sanitizeReferences(String(parsed.reply || ''), parsed.references, allowed);
    return {
      mode: 'clarify',
      reply: reply || 'I need a couple of details before I build this.',
      questions,
      references,
    };
  }

  if (mode === 'confirm') {
    if (!parsed.outline && hasBlocks(parsed.graph)) {
      const graph = normalizeGraph(parsed.graph, ctx.currentGraph);
      return finishConfirm(parsed, outlineFromGraph(graph, parsed), graphBlockIds(graph));
    }
    if (!parsed.outline) return finishAnswer(parsed, ctx);
    return finishConfirm(parsed, normalizeOutline(parsed.outline, parsed), new Set());
  }

  return finishAnswer(parsed, ctx);
}

export function diffGraphs(current: AssistantGraph, next: FlowGraph): FlowOperation[] {
  const oldById = new Map((current.blocks || []).map((block) => [String(block.id), block]));
  const newById = new Map(next.blocks.map((block) => [block.id, block]));
  const ops: FlowOperation[] = [];

  for (const connection of current.connections || []) {
    const from = String(connection.from);
    const to = String(connection.to);
    const output = String(connection.output || 'done');
    const stillThere = next.connections.some(
      (nextConnection) =>
        nextConnection.from === from &&
        nextConnection.to === to &&
        (nextConnection.output || 'done') === output,
    );
    if (!stillThere) ops.push({ op: 'removeConnection', from, to, output });
  }

  for (const [id] of oldById) {
    if (!newById.has(id)) ops.push({ op: 'removeBlock', blockId: id });
  }

  next.blocks.forEach((block, index) => {
    const previous = oldById.get(block.id);
    if (!previous) {
      const after = index > 0 ? next.blocks[index - 1].id : undefined;
      ops.push({
        op: 'addBlock',
        block,
        after,
      });
      return;
    }

    const nameChanged = !!block.name && block.name !== previous.name;
    const configChanged =
      JSON.stringify(block.config || {}) !== JSON.stringify(previous.config || {});
    if (nameChanged || configChanged) {
      ops.push({
        op: 'updateBlock',
        blockId: block.id,
        name: nameChanged ? block.name : undefined,
        configPatch: configChanged ? block.config || {} : undefined,
      });
    }
  });

  for (const connection of next.connections) {
    const exists = (current.connections || []).some(
      (currentConnection) =>
        String(currentConnection.from) === connection.from &&
        String(currentConnection.to) === connection.to &&
        String(currentConnection.output || 'done') === (connection.output || 'done'),
    );
    if (!exists) {
      ops.push({
        op: 'addConnection',
        from: connection.from,
        to: connection.to,
        output: connection.output || 'done',
        input: connection.input || 'in',
      });
    }
  }

  return ops;
}

function finishBuild(
  parsed: any,
  graph: FlowGraph,
): Omit<FlowAssistantResponse, 'modelUsed' | 'provider'> {
  const allowed = graphBlockIds(graph);
  const { reply, references } = sanitizeReferences(
    String(parsed.reply || 'Workflow updated successfully.'),
    parsed.references,
    allowed,
  );
  return {
    mode: 'build',
    reply,
    graph,
    flowChanges: stringList(parsed.flowChanges),
    assumptions: stringList(parsed.assumptions),
    references,
  };
}

function finishConfirm(
  parsed: any,
  outline: FlowOutline,
  extraIds: Set<string>,
): Omit<FlowAssistantResponse, 'modelUsed' | 'provider'> {
  const allowed = new Set(extraIds);
  for (const step of outline.steps) allowed.add(step.id);
  const { reply, references } = sanitizeReferences(
    String(parsed.reply || 'Here is the outline. Confirm it and I will build the flow.'),
    parsed.references,
    allowed,
  );
  return {
    mode: 'confirm',
    reply,
    outline,
    references,
  };
}

function finishEdit(
  parsed: any,
  rawOperations: any,
  ctx: AssistantValidationContext,
): Omit<FlowAssistantResponse, 'modelUsed' | 'provider'> {
  const { operations, notes } = validateOperations(rawOperations, ctx);
  const flowChanges = [...stringList(parsed.flowChanges), ...notes];
  const allowed = currentIds(ctx);
  for (const operation of operations) {
    if (operation.op === 'addBlock') allowed.add(operation.block.id);
  }

  if (operations.length === 0) {
    const reason = notes.length
      ? notes.join(' ')
      : 'I could not find a valid change to make.';
    const { reply, references } = sanitizeReferences(
      `${String(parsed.reply || '').trim()} ${reason}`.trim(),
      parsed.references,
      currentIds(ctx),
    );
    return { mode: 'answer', reply, references };
  }

  const { reply, references } = sanitizeReferences(
    String(parsed.reply || 'Here is the change. Apply it when it looks right.'),
    parsed.references,
    allowed,
  );
  return {
    mode: 'edit',
    reply,
    operations,
    flowChanges,
    references,
  };
}

function finishAnswer(
  parsed: any,
  ctx: AssistantValidationContext,
): Omit<FlowAssistantResponse, 'modelUsed' | 'provider'> {
  const { reply, references } = sanitizeReferences(
    String(parsed.reply || parsed.text || 'I could not structure a change from that.'),
    parsed.references,
    currentIds(ctx),
  );
  return {
    mode: 'answer',
    reply: reply || 'I could not structure a change from that.',
    references,
  };
}

function validateOperations(
  raw: any,
  ctx: AssistantValidationContext,
): { operations: FlowOperation[]; notes: string[] } {
  const notes: string[] = [];
  const operations: FlowOperation[] = [];
  const existing = new Set((ctx.currentGraph.blocks || []).map((block) => String(block.id)));
  const added = new Set<string>();
  const kindById = new Map(
    (ctx.currentGraph.blocks || []).map((block) => [
      String(block.id),
      String(block.kind || block.type || ''),
    ]),
  );
  const defByKind = new Map(ctx.definitions.map((definition) => [definition.kind, definition]));
  const exists = (id: string) => existing.has(id) || added.has(id);

  for (const operation of Array.isArray(raw) ? raw : []) {
    if (!operation || typeof operation !== 'object') continue;

    if (operation.op === 'addBlock') {
      const block = operation.block || {};
      const id = String(block.id || '').trim();
      const kind = String(block.kind || '').trim();
      if (!id || !kind) {
        notes.push('Dropped an addBlock that had no id or kind.');
        continue;
      }
      if (exists(id)) {
        notes.push(`Dropped addBlock "${id}" because that id already exists.`);
        continue;
      }
      if (defByKind.size > 0 && !defByKind.has(kind)) {
        notes.push(`Dropped addBlock "${id}" because "${kind}" is not a known block kind.`);
        continue;
      }
      if (operation.after && !exists(String(operation.after))) {
        notes.push(`Dropped addBlock "${id}" because "${operation.after}" does not exist.`);
        continue;
      }
      added.add(id);
      kindById.set(id, kind);
      operations.push({
        op: 'addBlock',
        after: operation.after ? String(operation.after) : undefined,
        block: {
          id,
          kind,
          name: String(block.name || id),
          label: String(block.label || block.name || id),
          config: block.config && typeof block.config === 'object' ? block.config : {},
        },
      });
      continue;
    }

    if (operation.op === 'updateBlock') {
      const id = String(operation.blockId || '');
      if (!exists(id)) {
        notes.push(`Dropped updateBlock "${id}" because that block does not exist.`);
        continue;
      }
      operations.push({
        op: 'updateBlock',
        blockId: id,
        name: operation.name ? String(operation.name) : undefined,
        configPatch:
          operation.configPatch && typeof operation.configPatch === 'object'
            ? operation.configPatch
            : undefined,
      });
      continue;
    }

    if (operation.op === 'removeBlock') {
      const id = String(operation.blockId || '');
      if (!exists(id)) {
        notes.push(`Dropped removeBlock "${id}" because that block does not exist.`);
        continue;
      }
      existing.delete(id);
      added.delete(id);
      operations.push({ op: 'removeBlock', blockId: id });
      continue;
    }

    if (operation.op === 'addConnection') {
      const from = String(operation.from || '');
      const to = String(operation.to || '');
      if (!exists(from) || !exists(to)) {
        notes.push(`Dropped connection ${from} -> ${to} because a block is missing.`);
        continue;
      }
      const output = operation.output ? String(operation.output) : 'done';
      const kind = kindById.get(from) || '';
      if (!portAllowed(kind, output, defByKind)) {
        notes.push(
          `Dropped connection from "${from}" because output "${output}" is not a port on ${kind || 'that block'}.`,
        );
        continue;
      }
      operations.push({
        op: 'addConnection',
        from,
        to,
        output,
        input: operation.input ? String(operation.input) : 'in',
      });
      continue;
    }

    if (operation.op === 'removeConnection') {
      const from = String(operation.from || '');
      const to = String(operation.to || '');
      const output = operation.output ? String(operation.output) : undefined;
      const found = (ctx.currentGraph.connections || []).some((connection) => {
        if (String(connection.from) !== from || String(connection.to) !== to) return false;
        if (!output) return true;
        return String(connection.output || 'done') === output;
      });
      if (!found) {
        notes.push(`Dropped removeConnection ${from} -> ${to} because it does not exist.`);
        continue;
      }
      operations.push({ op: 'removeConnection', from, to, output });
    }
  }

  return { operations, notes };
}

/**
 * "done" is the canvas default and is always accepted.
 * Any other port must be declared on the source block kind.
 */
function portAllowed(
  kind: string,
  output: string,
  defByKind: Map<string, DefinitionPorts>,
): boolean {
  if (!output || output === 'done') return true;
  const definition = defByKind.get(kind);
  if (!definition || definition.outputs.length === 0) return true;
  return definition.outputs.includes(output);
}

function normalizeQuestions(raw: any): ClarifyingQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 3)
    .map((question, index) => ({
      id: String(question?.id || `q_${index + 1}`),
      question: String(question?.question || '').trim(),
      why: question?.why ? String(question.why) : undefined,
      options: Array.isArray(question?.options)
        ? question.options
            .filter((option: any) => option && option.label)
            .map((option: any) => ({
              id: String(option.id || option.label),
              label: String(option.label),
              blockId: option.blockId ? String(option.blockId) : undefined,
            }))
        : undefined,
      allowFreeText: question?.allowFreeText !== false,
      default: question?.default != null ? String(question.default) : undefined,
    }))
    .filter((question) => question.question);
}

function normalizeOutline(raw: any, parsed: any): FlowOutline {
  const steps = Array.isArray(raw?.steps) ? raw.steps : [];
  return {
    title: String(raw?.title || 'Proposed flow'),
    trigger: String(raw?.trigger || 'Manual start'),
    steps: steps.map((step: any, index: number) => ({
      id: String(step?.id || `step_${index + 1}`),
      kind: String(step?.kind || 'agent'),
      summary: String(step?.summary || step?.name || step?.kind || `Step ${index + 1}`),
    })),
    outputs: stringList(raw?.outputs),
    assumptions: stringList(raw?.assumptions?.length ? raw.assumptions : parsed?.assumptions),
  };
}

function outlineFromGraph(graph: FlowGraph, parsed: any): FlowOutline {
  const trigger = graph.blocks.find((block) => block.kind === 'trigger') || graph.blocks[0];
  return {
    title: String(parsed?.outline?.title || 'Proposed flow'),
    trigger: parsed?.outline?.trigger
      ? String(parsed.outline.trigger)
      : trigger
        ? `${trigger.name || trigger.id} (${trigger.kind})`
        : 'Manual start',
    steps: graph.blocks.map((block) => ({
      id: block.id,
      kind: block.kind,
      summary: block.name || block.label || block.kind,
    })),
    outputs: graph.blocks
      .filter((block) => OUTPUT_KINDS.has(block.kind))
      .map((block) => block.name || block.id),
    assumptions: stringList(parsed?.assumptions || parsed?.outline?.assumptions),
  };
}

function sanitizeReferences(
  reply: string,
  rawReferences: any,
  allowed: Set<string>,
): { reply: string; references: BlockReference[] } {
  const references: BlockReference[] = [];
  const seen = new Set<string>();
  let primaryUsed = false;

  for (const reference of Array.isArray(rawReferences) ? rawReferences : []) {
    const blockId = String(reference?.blockId || '');
    if (!blockId || !allowed.has(blockId) || seen.has(blockId)) continue;
    seen.add(blockId);
    const wantsPrimary = reference?.role === 'primary' && !primaryUsed;
    if (wantsPrimary) primaryUsed = true;
    references.push({ blockId, role: wantsPrimary ? 'primary' : 'related' });
  }

  if (references.length > 0 && !references.some((reference) => reference.role === 'primary')) {
    references[0] = { ...references[0], role: 'primary' };
  }

  const cleaned = reply
    .replace(/\[\[([^\]]+)\]\]/g, (token, id: string) => (allowed.has(id) ? token : ''))
    .replace(/[ ]{2,}/g, ' ')
    .replace(/ +([.,!?])/g, '$1')
    .trim();

  return { reply: cleaned, references };
}

function inferMode(parsed: any, ctx: AssistantValidationContext): AssistantMode {
  if (parsed && MODES.includes(parsed.mode)) return parsed.mode;
  if (Array.isArray(parsed?.operations) && parsed.operations.length > 0) return 'edit';
  if (Array.isArray(parsed?.questions) && parsed.questions.length > 0) return 'clarify';
  if (parsed?.outline) return 'confirm';
  if (hasBlocks(parsed?.graph)) {
    // A question often comes back with the canvas copied in and no mode.
    // Same blocks and connections means nothing was proposed, so answer.
    if (isGraphEcho(ctx.currentGraph, parsed.graph)) return 'answer';
    return 'build';
  }
  return 'answer';
}

function isGraphEcho(current: AssistantGraph, next: any): boolean {
  const currentIds = (current.blocks || []).map((block) => String(block.id)).sort();
  const nextIds = (next.blocks || []).map((block: any) => String(block?.id || '')).sort();
  if (currentIds.length === 0 || currentIds.length !== nextIds.length) return false;
  if (currentIds.some((id, index) => id !== nextIds[index])) return false;

  const signature = (connections: any[]) =>
    (connections || [])
      .map(
        (connection) =>
          `${connection?.from}|${connection?.to}|${connection?.output || 'done'}`,
      )
      .sort()
      .join('\n');

  return signature(current.connections || []) === signature(next.connections || []);
}

function hasBlocks(graph: any): boolean {
  return !!graph && Array.isArray(graph.blocks) && graph.blocks.length > 0;
}

function currentIds(ctx: AssistantValidationContext): Set<string> {
  return new Set((ctx.currentGraph.blocks || []).map((block) => String(block.id)));
}

function graphBlockIds(graph: FlowGraph): Set<string> {
  return new Set(graph.blocks.map((block) => block.id));
}

function stringList(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function normalizeBlock(block: any, idx = 0) {
  return {
    id: String(block?.id || `node_${Date.now()}_${idx}`),
    kind: String(block?.kind || 'agent'),
    name: String(block?.name || block?.id || `Node ${idx + 1}`),
    label: String(block?.label || block?.name || block?.id || `Node ${idx + 1}`),
    config: block?.config && typeof block.config === 'object' ? block.config : {},
  };
}

function normalizeConnection(connection: any, idx = 0) {
  const from = String(connection?.from || '');
  const to = String(connection?.to || '');
  return {
    id: String(connection?.id || `conn_${from}_${to}_${idx}`),
    from,
    to,
    output: String(connection?.output || 'done'),
    input: String(connection?.input || 'in'),
    data: connection?.data && typeof connection.data === 'object' ? connection.data : {},
  };
}
