'use client';

import React, { useMemo, useState } from 'react';
import {
  Plus,
  GitBranch,
  MoreHorizontal,
  Trash2,
  Settings,
  Copy,
  GripVertical,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { GraphFlowData } from '@/lib/types';
import { getNodeIcon } from '@/components/nodes/node-icons';

export interface BranchPath {
  blockId: string;
  blockName: string;
  output: string;
}

export interface ListViewProps {
  flow: GraphFlowData;
  graphName: string;
  onNodeClick: (blockId: string) => void;
  onAddStep: (afterBlockId?: string, branchPath?: BranchPath[], beforeBlockId?: string) => void;
  onDeleteStep: (blockId: string) => void;
  onDuplicateStep: (blockId: string) => void;
  runStatuses?: Record<string, 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'skipped'>;
}

type Block = GraphFlowData['blocks'][number];

const BRANCH_FIRST_KINDS = new Set([
  'artifact', 'condition', 'foreach', 'human-gate', 'loop', 'orchestrator', 'research-review', 'router', 'validator',
]);

/** Lifecycle handles stay hidden until connected or explicitly exposed in node config. */
const LIFECYCLE_EVENT_NAMES = new Set([
  'done', 'success', 'onsuccess', 'onload', 'completed', 'failed', 'onfailed', 'error', 'partial',
]);

function isBranchFirstBlock(block: Block): boolean {
  const kind = String(block.kind || '').toLowerCase();
  const operation = String(block.config?.operation || '').toLowerCase();
  return (
    BRANCH_FIRST_KINDS.has(kind) ||
    (kind === 'file' && operation === 'exists') ||
    (kind === 'database' && operation === 'ping') ||
    (kind === 'secrets' && operation === 'exists') ||
    (kind === 'log' && operation === 'assert' && String(block.config?.onFail || '').toLowerCase() === 'route')
  );
}

function defaultExposedEvents(block: Block, events: NonNullable<Block['events']>): string[] {
  if (!isBranchFirstBlock(block)) return [];
  return events
    .filter((event) => !LIFECYCLE_EVENT_NAMES.has(event.name.toLowerCase()))
    .map((event) => event.name);
}

function hasNonLifecycleBranch(groups: Map<string, string[]>): boolean {
  return Array.from(groups.keys()).some((output) => !LIFECYCLE_EVENT_NAMES.has(output.toLowerCase()));
}

interface StepBranch {
  key: string;
  output: string;
  label: string;
  targetId?: string;
  steps: Step[];
  joins: boolean;
  empty: boolean;
}

interface Step {
  block: Block;
  branches: StepBranch[];
}

function statusColor(status?: string): string {
  switch (status) {
    case 'running': return '#a855f7';
    case 'waiting': return '#f59e0b';
    case 'completed': return '#10b981';
    case 'failed': return '#ef4444';
    case 'skipped': return '#6b7280';
    case 'pending': return '#6366f1';
    default: return 'transparent';
  }
}

function buildSteps(flow: GraphFlowData): Step[] {
  const byId = new Map(flow.blocks.map((block) => [block.id, block]));
  const outgoing = (id: string) => flow.connections.filter((connection) => connection.from === id);
  const targetsOf = (id: string) =>
    Array.from(new Set(outgoing(id).map((connection) => connection.to)));

  const findContinuation = (fromId: string, halt: Set<string>): string | null => {
    const roots = targetsOf(fromId).filter((id) => !halt.has(id) && byId.has(id));
    if (roots.length < 2) return null;
    const reachCount = new Map<string, number>();
    const distance = new Map<string, number>();
    for (const root of roots) {
      const seen = new Set<string>();
      const queue: Array<{ id: string; depth: number }> = [{ id: root, depth: 0 }];
      while (queue.length) {
        const current = queue.shift()!;
        if (seen.has(current.id) || halt.has(current.id)) continue;
        seen.add(current.id);
        reachCount.set(current.id, (reachCount.get(current.id) || 0) + 1);
        const previous = distance.get(current.id);
        if (previous === undefined || current.depth < previous) distance.set(current.id, current.depth);
        for (const next of targetsOf(current.id)) {
          if (!seen.has(next)) queue.push({ id: next, depth: current.depth + 1 });
        }
      }
    }
    let best: { id: string; depth: number } | null = null;
    for (const [id, count] of Array.from(reachCount.entries())) {
      if (count !== roots.length || halt.has(id)) continue;
      const depth = distance.get(id) ?? Number.POSITIVE_INFINITY;
      if (!best || depth < best.depth) best = { id, depth };
    }
    return best?.id ?? null;
  };

  const spine = (entryIds: string[], halt: Set<string>, seen: Set<string>): Step[] => {
    const steps: Step[] = [];
    let ids = entryIds.filter((id) => byId.has(id) && !halt.has(id) && !seen.has(id));
    while (ids.length === 1) {
      const id = ids[0];
      const block = byId.get(id);
      if (!block) break;
      seen.add(id);
      const groups = new Map<string, string[]>();
      for (const connection of outgoing(id)) {
        const output = connection.output || 'done';
        const list = groups.get(output) || [];
        if (!list.includes(connection.to)) list.push(connection.to);
        groups.set(output, list);
      }
      const connectedOutputs = new Set(groups.keys());
      const configuredExposure = Array.isArray(block.config?.exposedEvents)
        ? block.config.exposedEvents.map((name: unknown) => String(name))
        : null;
      const supportedEvents = (block.events || []).filter((event) => event.type === 'branch');
      const defaultExposed = defaultExposedEvents(block, supportedEvents);
      const exposedEvents = configuredExposure ?? defaultExposed;
      for (const event of supportedEvents) {
        if ((exposedEvents.includes(event.name) || connectedOutputs.has(event.name)) && !groups.has(event.name)) {
          groups.set(event.name, []);
        }
      }
      const direct = Array.from(groups.values()).reduce<string[]>((all, ids) => all.concat(ids), []);
      const hasEmptyEvent = Array.from(groups.values()).some((targets) => targets.length === 0);
      const flattenAsLinear =
        direct.length <= 1 &&
        groups.size <= 1 &&
        !hasEmptyEvent &&
        (!isBranchFirstBlock(block) || !hasNonLifecycleBranch(groups));
      if (flattenAsLinear) {
        steps.push({ block, branches: [] });
        const next = direct[0];
        ids = next && !halt.has(next) && !seen.has(next) ? [next] : [];
        continue;
      }
      const continuation = findContinuation(id, halt);
      const branchHalt = new Set(halt);
      if (continuation) branchHalt.add(continuation);
      const branches: StepBranch[] = [];
      for (const [output, targets] of Array.from(groups.entries())) {
        if (targets.length === 0) {
          const event = supportedEvents.find((candidate) => candidate.name === output);
          branches.push({
            key: `${id}:${output}:empty`,
            output,
            label: event?.label || output,
            targetId: undefined,
            joins: false,
            empty: true,
            steps: [],
          });
          continue;
        }
        targets.forEach((targetId: string, index: number) => {
          const target = byId.get(targetId);
          const joins = branchHalt.has(targetId);
          branches.push({
            key: `${id}:${output}:${targetId}:${index}`,
            output,
            label: targets.length > 1 ? (target?.label || target?.name || output) : output,
            targetId,
            joins,
            empty: false,
            steps: joins ? [] : spine([targetId], branchHalt, seen),
          });
        });
      }
      steps.push({ block, branches });
      ids = continuation && !seen.has(continuation) ? [continuation] : [];
    }
    return steps;
  };

  const seen = new Set<string>();
  const incoming = new Set(flow.connections.map((connection) => connection.to));
  const roots = flow.blocks.filter((block) => !incoming.has(block.id)).map((block) => block.id);
  const steps: Step[] = [];
  for (const id of roots.length ? roots : flow.blocks.map((block) => block.id)) {
    steps.push(...spine([id], new Set(), seen));
  }
  for (const block of flow.blocks) {
    if (!seen.has(block.id)) steps.push(...spine([block.id], new Set(), seen));
  }
  return steps;
}

function Connector({ running = false, onAdd }: { running?: boolean; onAdd?: () => void }) {
  return (
    <div style={{ paddingLeft: 16, position: 'relative' }}>
      <div
        style={{
          width: 2,
          height: 24,
          margin: '2px 0 2px 14px',
          background: running ? 'linear-gradient(to bottom, #6366f1, #a855f7)' : 'var(--border-color)',
          borderRadius: 1,
        }}
      />
      {onAdd && (
        <button
          type="button"
          className="lv-connector-add"
          aria-label="Add step between nodes"
          title="Add step here"
          onClick={onAdd}
          style={{
            position: 'absolute',
            left: 20,
            top: 5,
            width: 20,
            height: 20,
            padding: 0,
            borderRadius: '50%',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-surface)',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
}

function AddStepButton({ onClick, label = 'Add step' }: { onClick: () => void; label?: string }) {
  return (
    <div style={{ paddingTop: 8, paddingBottom: 4 }}>
      <button
        type="button"
        onClick={onClick}
        className="lv-add-btn"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderRadius: 8,
          border: '1px dashed rgba(99,102,241,0.3)',
          background: 'rgba(99,102,241,0.05)',
          color: 'rgba(99,102,241,0.6)',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
          width: '100%',
        }}
      >
        <Plus size={13} /> {label}
      </button>
    </div>
  );
}

function StepCard({
  step,
  branchPath,
  onNodeClick,
  onAddStep,
  onDeleteStep,
  onDuplicateStep,
  runStatuses,
}: {
  step: Step;
  branchPath: BranchPath[];
  onNodeClick: (id: string) => void;
  onAddStep: (afterBlockId?: string, branchPath?: BranchPath[], beforeBlockId?: string) => void;
  onDeleteStep: (id: string) => void;
  onDuplicateStep: (id: string) => void;
  runStatuses: Record<string, string>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { block } = step;
  const status = runStatuses[block.id];
  const eventCount = new Set(step.branches.map((branch) => branch.output)).size;
  const hasNestedSteps = step.branches.some((branch) => branch.steps.length > 0);
  const [eventExpansion, setEventExpansion] = useState<boolean | null>(null);
  const eventsExpanded = eventExpansion ?? (eventCount <= 2 || hasNestedSteps);

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <div
          style={{
            width: 3,
            borderRadius: '3px 0 0 3px',
            background: status ? statusColor(status) : 'transparent',
            flexShrink: 0,
          }}
        />
        <div
          className="lv-node-card"
          onClick={() => onNodeClick(block.id)}
          style={{
            flex: 1,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderLeft: 'none',
            borderRadius: '0 10px 10px 0',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: 'pointer',
          }}
        >
          <GripVertical size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'var(--accent-subtle)',
              border: '1px solid var(--accent-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#818cf8',
              flexShrink: 0,
            }}
          >
            {getNodeIcon(block.kind, 16)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
              {block.label || block.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
              {block.kind}
            </div>
          </div>
          {status && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                padding: '2px 8px',
                borderRadius: 20,
                background: `${statusColor(status)}22`,
                color: statusColor(status),
                border: `1px solid ${statusColor(status)}55`,
              }}
            >
              {status}
            </span>
          )}
          {eventCount > 0 && (
            <button
              type="button"
              className="lv-event-toggle"
              aria-expanded={eventsExpanded}
              aria-label={`${eventsExpanded ? 'Collapse' : 'Expand'} ${eventCount} event ${eventCount === 1 ? 'path' : 'paths'}`}
              title={eventsExpanded ? 'Collapse event paths' : 'Expand event paths'}
              onClick={(event) => {
                event.stopPropagation();
                setEventExpansion(!eventsExpanded);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--border-color)',
                background: 'var(--bg-subtle)',
                color: 'var(--text-secondary)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {eventsExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {eventCount} {eventCount === 1 ? 'event' : 'events'}
            </button>
          )}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="lv-icon-btn"
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((open) => !open);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: 4,
                borderRadius: 6,
                display: 'flex',
              }}
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 28,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 10,
                  padding: 6,
                  zIndex: 100,
                  minWidth: 160,
                  boxShadow: 'var(--shadow-lg)',
                }}
                onClick={(event) => event.stopPropagation()}
              >
                {[
                  { icon: <Settings size={13} />, label: 'Configure', action: () => onNodeClick(block.id) },
                  { icon: <Copy size={13} />, label: 'Duplicate', action: () => onDuplicateStep(block.id) },
                  { icon: <Plus size={13} />, label: 'Add step after', action: () => onAddStep(block.id, branchPath) },
                  { icon: <Trash2 size={13} />, label: 'Delete', action: () => onDeleteStep(block.id), danger: true },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      item.action();
                      setMenuOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '7px 10px',
                      background: 'none',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 12,
                      color: item.danger ? 'var(--danger)' : 'var(--text-secondary)',
                      textAlign: 'left',
                    }}
                  >
                    {item.icon} {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {step.branches.length > 0 && eventsExpanded && (
        <div style={{ marginLeft: 18, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {step.branches.map((branch) => {
            const path: BranchPath[] = [
              ...branchPath,
              { blockId: block.id, blockName: block.name, output: branch.output },
            ];
            const tone = branch.output === 'false' ? '#dc2626' : branch.output === 'true' ? '#059669' : '#4f46e5';
            const firstLabel = branch.steps[0]?.block.label || branch.steps[0]?.block.name;
            const showLabel = branch.label !== firstLabel;
            return (
              <div key={branch.key} style={{ borderLeft: `2px solid ${tone}55`, paddingLeft: 12 }}>
                {showLabel && (
                  <div style={{ fontSize: 11, fontWeight: 600, color: tone, marginBottom: 6 }}>
                    {branch.label}
                  </div>
                )}
                {branch.empty ? (
                  <AddStepButton
                    label={`Add first step for "${branch.label}"`}
                    onClick={() => onAddStep(block.id, path)}
                  />
                ) : branch.joins && branch.steps.length === 0 ? (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0 8px' }}>
                      Joins the next step
                    </div>
                    <AddStepButton
                      label="Add step on this path"
                      onClick={() => onAddStep(block.id, path, branch.targetId)}
                    />
                  </div>
                ) : (
                  <>
                    <Connector onAdd={() => onAddStep(block.id, path, branch.targetId)} />
                    <StepList
                      steps={branch.steps}
                      branchPath={path}
                      onNodeClick={onNodeClick}
                      onAddStep={onAddStep}
                      onDeleteStep={onDeleteStep}
                      onDuplicateStep={onDuplicateStep}
                      runStatuses={runStatuses}
                      emptyLabel={`Add first step in "${branch.label}"`}
                      trailingBlockId={block.id}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StepList({
  steps,
  branchPath,
  onNodeClick,
  onAddStep,
  onDeleteStep,
  onDuplicateStep,
  runStatuses,
  emptyLabel,
  trailingBlockId,
}: {
  steps: Step[];
  branchPath: BranchPath[];
  onNodeClick: (id: string) => void;
  onAddStep: (afterBlockId?: string, branchPath?: BranchPath[], beforeBlockId?: string) => void;
  onDeleteStep: (id: string) => void;
  onDuplicateStep: (id: string) => void;
  runStatuses: Record<string, string>;
  emptyLabel?: string;
  trailingBlockId?: string;
}) {
  if (steps.length === 0) {
    return (
      <AddStepButton
        label={emptyLabel || 'Add step'}
        onClick={() => onAddStep(trailingBlockId, branchPath)}
      />
    );
  }

  const last = steps[steps.length - 1];
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {steps.map((step, index) => {
        const previous = index > 0 ? steps[index - 1] : undefined;
        return (
        <React.Fragment key={step.block.id}>
          {previous && (
            <Connector
              running={runStatuses[previous.block.id] === 'running'}
              onAdd={previous.branches.length === 0
                ? () => onAddStep(previous.block.id, branchPath, step.block.id)
                : undefined}
            />
          )}
          <StepCard
            step={step}
            branchPath={branchPath}
            onNodeClick={onNodeClick}
            onAddStep={onAddStep}
            onDeleteStep={onDeleteStep}
            onDuplicateStep={onDuplicateStep}
            runStatuses={runStatuses}
          />
        </React.Fragment>
        );
      })}
      {last.branches.length === 0 && (
        <>
          <Connector />
          <AddStepButton onClick={() => onAddStep(last.block.id, branchPath)} />
        </>
      )}
    </div>
  );
}

export function FlowListView({
  flow,
  graphName,
  onNodeClick,
  onAddStep,
  onDeleteStep,
  onDuplicateStep,
  runStatuses = {},
}: ListViewProps) {
  const steps = useMemo(() => buildSteps(flow), [flow]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-primary)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--border-color)',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
          background: 'var(--bg-surface)',
          flexShrink: 0,
        }}
      >
        {graphName}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 40px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {steps.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
              <GitBranch size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
              <div style={{ fontSize: 14, marginBottom: 16 }}>No steps yet</div>
              <AddStepButton label="Add first step" onClick={() => onAddStep()} />
            </div>
          ) : (
            <StepList
              steps={steps}
              branchPath={[]}
              onNodeClick={onNodeClick}
              onAddStep={onAddStep}
              onDeleteStep={onDeleteStep}
              onDuplicateStep={onDuplicateStep}
              runStatuses={runStatuses}
            />
          )}
        </div>
      </div>
      <style>{`
        .lv-node-card:hover {
          background: var(--bg-subtle) !important;
          border-color: var(--accent-border) !important;
        }
        .lv-icon-btn:hover {
          background: var(--bg-subtle) !important;
          color: var(--text-secondary) !important;
        }
        .lv-event-toggle:hover {
          border-color: var(--accent-border) !important;
          color: var(--accent-primary) !important;
        }
        .lv-connector-add:hover {
          border-color: var(--accent-primary) !important;
          color: var(--accent-primary) !important;
          background: var(--accent-subtle) !important;
        }
        .lv-add-btn:hover {
          background: var(--accent-subtle) !important;
          border-color: var(--accent-primary) !important;
          color: var(--accent-primary) !important;
        }
      `}</style>
    </div>
  );
}
