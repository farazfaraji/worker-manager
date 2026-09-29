'use client';

import React, { useState, useCallback } from 'react';
import {
  ArrowLeft,
  Plus,
  ChevronRight,
  GitBranch,
  Zap,
  Search,
  Brain,
  SplitSquareHorizontal,
  ArrowRight,
  Database,
  Bell,
  Code2,
  Globe,
  RefreshCw,
  Layers,
  FileText,
  MessageSquare,
  MoreHorizontal,
  Trash2,
  Settings,
  Copy,
  GripVertical,
} from 'lucide-react';
import { GraphFlowData } from '@/lib/types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BranchPath {
  blockId: string;
  blockName: string;
  output: string; // e.g. "true", "false", "done", "agent_1"
}

export interface ListViewProps {
  flow: GraphFlowData;
  graphName: string;
  onNodeClick: (blockId: string) => void;
  onAddStep: (afterBlockId?: string, branchPath?: BranchPath[]) => void;
  onDeleteStep: (blockId: string) => void;
  onDuplicateStep: (blockId: string) => void;
  runStatuses?: Record<string, 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'skipped'>;
}

// ─── Node Icon Map ───────────────────────────────────────────────────────────

const NODE_ICONS: Record<string, React.ReactNode> = {
  trigger:       <Zap size={16} />,
  'web-search':  <Search size={16} />,
  websearch:     <Search size={16} />,
  agent:         <Brain size={16} />,
  condition:     <SplitSquareHorizontal size={16} />,
  output:        <ArrowRight size={16} />,
  memory:        <Database size={16} />,
  notification:  <Bell size={16} />,
  script:        <Code2 size={16} />,
  'web-server':  <Globe size={16} />,
  loop:          <RefreshCw size={16} />,
  foreach:       <RefreshCw size={16} />,
  orchestrator:  <Layers size={16} />,
  artifact:      <FileText size={16} />,
  telegram:      <MessageSquare size={16} />,
  retrieval:     <Search size={16} />,
  embedding:     <Database size={16} />,
};

function nodeIcon(kind: string): React.ReactNode {
  return NODE_ICONS[kind.toLowerCase()] ?? <GitBranch size={16} />;
}

// ─── Branch types that expose sub-paths ─────────────────────────────────────
const BRANCH_KINDS = new Set(['condition', 'router', 'foreach', 'loop', 'orchestrator', 'subgraph']);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStatusColor(status?: string): string {
  switch (status) {
    case 'running':   return '#a855f7';
    case 'waiting':   return '#f59e0b';
    case 'completed': return '#10b981';
    case 'failed':    return '#ef4444';
    case 'skipped':   return '#6b7280';
    case 'pending':   return '#6366f1';
    default:          return 'transparent';
  }
}

function getStatusGlow(status?: string): string {
  switch (status) {
    case 'running':   return '0 0 12px rgba(168,85,247,0.5)';
    case 'completed': return '0 0 12px rgba(16,185,129,0.4)';
    case 'failed':    return '0 0 12px rgba(239,68,68,0.5)';
    default:          return 'none';
  }
}

// ─── NodeCard ────────────────────────────────────────────────────────────────

interface NodeCardProps {
  block: GraphFlowData['blocks'][0];
  branchPath: BranchPath[];
  connections: GraphFlowData['connections'];
  allBlocks: GraphFlowData['blocks'];
  onNodeClick: (id: string) => void;
  onAddStep: (afterBlockId?: string, branchPath?: BranchPath[]) => void;
  onDeleteStep: (id: string) => void;
  onDuplicateStep: (id: string) => void;
  runStatuses: Record<string, string>;
  depth: number;
}

function NodeCard({
  block,
  branchPath,
  connections,
  allBlocks,
  onNodeClick,
  onAddStep,
  onDeleteStep,
  onDuplicateStep,
  runStatuses,
  depth,
}: NodeCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeBranch, setActiveBranch] = useState<string | null>(null);

  const status = runStatuses[block.id];
  const isBranching = BRANCH_KINDS.has(block.kind.toLowerCase());

  // Outgoing connections from this block
  const outgoing = connections.filter((c) => c.from === block.id);

  // Branch outputs (unique output handles e.g. "true", "false", "agent_1")
  const branchOutputs = isBranching
    ? Array.from(new Set(outgoing.map((c) => c.output || 'done').filter(Boolean)))
    : [];

  // Active branch display
  const activeBranchOutput = activeBranch ?? branchOutputs[0] ?? null;
  const branchConnections = outgoing.filter(
    (c) => (c.output || 'done') === activeBranchOutput,
  );
  const branchBlocks = branchConnections
    .map((c) => allBlocks.find((b) => b.id === c.to))
    .filter(Boolean) as GraphFlowData['blocks'];

  const currentBranchPath: BranchPath[] = [
    ...branchPath,
    ...(isBranching && activeBranchOutput
      ? [{ blockId: block.id, blockName: block.name, output: activeBranchOutput }]
      : []),
  ];

  return (
    <div style={{ width: '100%' }}>
      {/* ── Card ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 0,
          position: 'relative',
        }}
      >
        {/* Depth indent line */}
        {depth > 0 && (
          <div style={{ width: depth * 24, flexShrink: 0 }} />
        )}

        {/* Status bar */}
        <div
          style={{
            width: 3,
            borderRadius: '3px 0 0 3px',
            background: status ? getStatusColor(status) : 'transparent',
            flexShrink: 0,
          }}
        />

        {/* Main card */}
        <div
          className="lv-node-card"
          style={{
            flex: 1,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderLeft: 'none',
            borderRadius: '0 10px 10px 0',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            boxShadow: getStatusGlow(status),
          }}
          onClick={() => onNodeClick(block.id)}
        >
          {/* Drag handle */}
          <GripVertical size={14} style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />

          {/* Icon */}
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'rgba(99,102,241,0.15)',
              border: '1px solid rgba(99,102,241,0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#818cf8',
              flexShrink: 0,
            }}
          >
            {nodeIcon(block.kind)}
          </div>

          {/* Labels */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', marginBottom: 2 }}>
              {block.label || block.name}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'capitalize' }}>
              {block.kind}
            </div>
          </div>

          {/* Status badge */}
          {status && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                padding: '2px 8px',
                borderRadius: 20,
                background: `${getStatusColor(status)}22`,
                color: getStatusColor(status),
                border: `1px solid ${getStatusColor(status)}55`,
              }}
            >
              {status}
            </span>
          )}

          {/* Menu */}
          <div style={{ position: 'relative' }}>
            <button
              className="lv-icon-btn"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              style={{
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,0.3)',
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
                  background: '#1e2030',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10,
                  padding: 6,
                  zIndex: 100,
                  minWidth: 160,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {[
                  { icon: <Settings size={13} />, label: 'Configure', action: () => { onNodeClick(block.id); setMenuOpen(false); } },
                  { icon: <Copy size={13} />, label: 'Duplicate', action: () => { onDuplicateStep(block.id); setMenuOpen(false); } },
                  { icon: <Plus size={13} />, label: 'Add step after', action: () => { onAddStep(block.id, branchPath); setMenuOpen(false); } },
                  { icon: <Trash2 size={13} />, label: 'Delete', action: () => { onDeleteStep(block.id); setMenuOpen(false); }, danger: true },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={item.action}
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
                      color: (item as any).danger ? '#f87171' : 'rgba(255,255,255,0.7)',
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

      {/* ── Branch tabs ──────────────────────────────────────── */}
      {isBranching && branchOutputs.length > 0 && (
        <div style={{ marginLeft: depth * 24 + 3, marginTop: 4 }}>
          {/* Tab bar */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              padding: '4px 8px',
              background: 'rgba(255,255,255,0.02)',
              borderRadius: '0 0 8px 8px',
              border: '1px solid rgba(255,255,255,0.06)',
              borderTop: 'none',
            }}
          >
            {branchOutputs.map((output) => {
              const isActive = output === activeBranchOutput;
              const isTrue = output === 'true' || output === 'done';
              const isFalse = output === 'false';
              const tabColor = isTrue ? '#10b981' : isFalse ? '#ef4444' : '#6366f1';
              return (
                <button
                  key={output}
                  onClick={(e) => { e.stopPropagation(); setActiveBranch(output); }}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 20,
                    border: `1px solid ${isActive ? tabColor + '66' : 'rgba(255,255,255,0.08)'}`,
                    background: isActive ? tabColor + '18' : 'transparent',
                    color: isActive ? tabColor : 'rgba(255,255,255,0.35)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    transition: 'all 0.15s',
                  }}
                >
                  {isFalse ? '✕' : isTrue ? '✓' : '→'} {output}
                </button>
              );
            })}

            {/* Add branch button */}
            <button
              onClick={(e) => { e.stopPropagation(); onAddStep(block.id, currentBranchPath); }}
              style={{
                padding: '4px 10px',
                borderRadius: 20,
                border: '1px dashed rgba(255,255,255,0.15)',
                background: 'transparent',
                color: 'rgba(255,255,255,0.25)',
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Plus size={10} /> branch
            </button>
          </div>

          {/* Branch contents */}
          {branchBlocks.length > 0 ? (
            <div style={{ marginTop: 4, paddingLeft: 16, borderLeft: '2px solid rgba(255,255,255,0.06)' }}>
              <FlowListInner
                blocks={branchBlocks}
                allBlocks={allBlocks}
                connections={connections}
                branchPath={currentBranchPath}
                onNodeClick={onNodeClick}
                onAddStep={onAddStep}
                onDeleteStep={onDeleteStep}
                onDuplicateStep={onDuplicateStep}
                runStatuses={runStatuses}
                depth={depth + 1}
              />
            </div>
          ) : (
            <AddStepButton
              onClick={() => onAddStep(block.id, currentBranchPath)}
              indent={depth + 1}
              label={`Add first step in "${activeBranchOutput}" branch`}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── AddStepButton ────────────────────────────────────────────────────────────

function AddStepButton({
  onClick,
  indent = 0,
  label = 'Add step',
}: {
  onClick: () => void;
  indent?: number;
  label?: string;
}) {
  return (
    <div style={{ paddingLeft: indent * 24, paddingTop: 8, paddingBottom: 4 }}>
      <button
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
          transition: 'all 0.15s',
        }}
      >
        <Plus size={13} /> {label}
      </button>
    </div>
  );
}

// ─── Connector line ───────────────────────────────────────────────────────────

function Connector({ indent = 0, running = false }: { indent?: number; running?: boolean }) {
  return (
    <div style={{ paddingLeft: indent * 24 + 16 }}>
      <div
        style={{
          width: 2,
          height: 20,
          margin: '2px 0 2px 14px',
          background: running
            ? 'linear-gradient(to bottom, #6366f1, #a855f7)'
            : 'rgba(255,255,255,0.07)',
          borderRadius: 1,
        }}
      />
    </div>
  );
}

// ─── FlowListInner (recursive) ────────────────────────────────────────────────

interface FlowListInnerProps {
  blocks: GraphFlowData['blocks'];
  allBlocks: GraphFlowData['blocks'];
  connections: GraphFlowData['connections'];
  branchPath: BranchPath[];
  onNodeClick: (id: string) => void;
  onAddStep: (afterBlockId?: string, branchPath?: BranchPath[]) => void;
  onDeleteStep: (id: string) => void;
  onDuplicateStep: (id: string) => void;
  runStatuses: Record<string, string>;
  depth: number;
}

function FlowListInner({
  blocks,
  allBlocks,
  connections,
  branchPath,
  onNodeClick,
  onAddStep,
  onDeleteStep,
  onDuplicateStep,
  runStatuses,
  depth,
}: FlowListInnerProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {blocks.map((block, idx) => (
        <React.Fragment key={block.id}>
          {idx > 0 && <Connector indent={depth} running={runStatuses[blocks[idx - 1].id] === 'running'} />}
          <NodeCard
            block={block}
            branchPath={branchPath}
            connections={connections}
            allBlocks={allBlocks}
            onNodeClick={onNodeClick}
            onAddStep={onAddStep}
            onDeleteStep={onDeleteStep}
            onDuplicateStep={onDuplicateStep}
            runStatuses={runStatuses}
            depth={depth}
          />
        </React.Fragment>
      ))}
      <Connector indent={depth} />
      <AddStepButton onClick={() => onAddStep(blocks[blocks.length - 1]?.id, branchPath)} indent={depth} />
    </div>
  );
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({
  graphName,
  branchPath,
  onNavigate,
}: {
  graphName: string;
  branchPath: BranchPath[];
  onNavigate: (index: number) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 4px',
        flexWrap: 'wrap',
      }}
    >
      <button
        onClick={() => onNavigate(-1)}
        style={{
          background: 'none',
          border: 'none',
          color: branchPath.length === 0 ? '#f1f5f9' : '#6366f1',
          fontSize: 13,
          fontWeight: 600,
          cursor: branchPath.length > 0 ? 'pointer' : 'default',
          padding: 0,
        }}
      >
        {graphName}
      </button>
      {branchPath.map((crumb, i) => (
        <React.Fragment key={`${crumb.blockId}-${crumb.output}`}>
          <ChevronRight size={12} style={{ color: 'rgba(255,255,255,0.2)' }} />
          <button
            onClick={() => onNavigate(i)}
            style={{
              background: 'none',
              border: 'none',
              color: i === branchPath.length - 1 ? '#f1f5f9' : '#6366f1',
              fontSize: 13,
              fontWeight: 500,
              cursor: i < branchPath.length - 1 ? 'pointer' : 'default',
              padding: 0,
            }}
          >
            {crumb.blockName}
            <span style={{ color: 'rgba(255,255,255,0.3)', marginLeft: 4 }}>
              [{crumb.output}]
            </span>
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Root: FlowListView ────────────────────────────────────────────────────────

export function FlowListView({
  flow,
  graphName,
  onNodeClick,
  onAddStep,
  onDeleteStep,
  onDuplicateStep,
  runStatuses = {},
}: ListViewProps) {
  // Navigation state — which branch path are we currently viewing
  const [navPath, setNavPath] = useState<BranchPath[]>([]);

  // Derive the blocks to show at the current navigation level
  const visibleBlocks = useCallback((): GraphFlowData['blocks'] => {
    if (navPath.length === 0) {
      // Root: blocks with no incoming connections (or trigger)
      const targets = new Set(flow.connections.map((c) => c.to));
      return flow.blocks.filter((b) => !targets.has(b.id));
    }

    // Follow the nav path to get the current level's blocks
    const last = navPath[navPath.length - 1];
    const outgoing = flow.connections.filter(
      (c) => c.from === last.blockId && (c.output || 'done') === last.output,
    );
    return outgoing
      .map((c) => flow.blocks.find((b) => b.id === c.to))
      .filter(Boolean) as GraphFlowData['blocks'];
  }, [flow, navPath]);

  const handleNavigate = (index: number) => {
    if (index === -1) {
      setNavPath([]);
    } else {
      setNavPath((p) => p.slice(0, index + 1));
    }
  };

  const blocks = visibleBlocks();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#0d0f18',
        overflow: 'hidden',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
        }}
      >
        {navPath.length > 0 && (
          <button
            onClick={() => handleNavigate(navPath.length - 2)}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              padding: '5px 8px',
              cursor: 'pointer',
              color: 'rgba(255,255,255,0.6)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <ArrowLeft size={14} />
          </button>
        )}
        <Breadcrumb
          graphName={graphName}
          branchPath={navPath}
          onNavigate={handleNavigate}
        />
      </div>

      {/* Flow list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 20px 40px',
        }}
      >
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          {blocks.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '60px 20px',
                color: 'rgba(255,255,255,0.2)',
              }}
            >
              <GitBranch size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
              <div style={{ fontSize: 14, marginBottom: 16 }}>No steps yet</div>
              <button
                onClick={() => onAddStep(undefined, navPath)}
                style={{
                  padding: '8px 20px',
                  borderRadius: 8,
                  border: '1px solid rgba(99,102,241,0.4)',
                  background: 'rgba(99,102,241,0.1)',
                  color: '#818cf8',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                <Plus size={13} style={{ marginRight: 6, display: 'inline' }} />
                Add first step
              </button>
            </div>
          ) : (
            <FlowListInner
              blocks={blocks}
              allBlocks={flow.blocks}
              connections={flow.connections}
              branchPath={navPath}
              onNodeClick={onNodeClick}
              onAddStep={onAddStep}
              onDeleteStep={onDeleteStep}
              onDuplicateStep={onDuplicateStep}
              runStatuses={runStatuses}
              depth={0}
            />
          )}
        </div>
      </div>

      {/* CSS */}
      <style>{`
        .lv-node-card:hover {
          background: rgba(255,255,255,0.07) !important;
          border-color: rgba(255,255,255,0.14) !important;
        }
        .lv-icon-btn:hover {
          background: rgba(255,255,255,0.08) !important;
          color: rgba(255,255,255,0.6) !important;
        }
        .lv-add-btn:hover {
          background: rgba(99,102,241,0.12) !important;
          border-color: rgba(99,102,241,0.5) !important;
          color: #818cf8 !important;
        }
      `}</style>
    </div>
  );
}
