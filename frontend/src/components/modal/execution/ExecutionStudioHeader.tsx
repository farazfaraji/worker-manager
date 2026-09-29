'use client';

import React from 'react';
import {
  Terminal,
  Loader2,
  Server,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileJson,
  ShieldCheck,
  Play,
  Bug,
  ExternalLink,
  Layers,
  ChevronUp,
  ChevronDown,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react';
import { RunResult } from '@/lib/types';

interface ExecutionStudioHeaderProps {
  graphName: string;
  isDirty: boolean;
  isExecuting: boolean;
  runResult: RunResult | null;
  durationMs: number | null;
  serverStatus: 'running' | 'stopped';
  serverPort: number;
  hasWebserver: boolean;
  activeTab: 'endpoints' | 'input' | 'output';
  setActiveTab: (tab: 'endpoints' | 'input' | 'output') => void;
  jsonError: string | null;
  isValidating: boolean;
  dockMode: 'bottom' | 'floating';
  setDockMode: React.Dispatch<React.SetStateAction<'bottom' | 'floating'>>;
  isMinimized: boolean;
  setIsMinimized: React.Dispatch<React.SetStateAction<boolean>>;
  isMaximized: boolean;
  onValidate: () => void;
  onExecute: () => void;
  onDebugExecute?: () => void;
  useCache?: boolean;
  onToggleUseCache?: (val: boolean) => void;
  onSetPresetHeight: (h: number) => void;
  onToggleMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

export const ExecutionStudioHeader: React.FC<ExecutionStudioHeaderProps> = ({
  graphName,
  isDirty,
  isExecuting,
  runResult,
  durationMs,
  serverStatus,
  serverPort,
  hasWebserver,
  activeTab,
  setActiveTab,
  jsonError,
  isValidating,
  dockMode,
  setDockMode,
  isMinimized,
  setIsMinimized,
  isMaximized,
  onValidate,
  onExecute,
  onDebugExecute,
  useCache,
  onToggleUseCache,
  onSetPresetHeight,
  onToggleMinimize,
  onToggleMaximize,
  onClose,
}) => {
  return (
    <div
      className="execution-studio-header"
      onClick={isMinimized ? onToggleMinimize : undefined}
      title={isMinimized ? 'Click to expand Execution Studio' : undefined}
    >
      {/* Left section: Terminal Branding, Graph Badge, Status, Tabs */}
      <div className="execution-studio-header-left">
        <div className="execution-studio-brand">
          <div
            style={{
              background: 'var(--accent-subtle, #eef2ff)',
              color: 'var(--accent-primary, #4f46e5)',
              padding: 4,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Terminal size={15} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Flow Execution Studio</span>
        </div>

        <span className="execution-studio-target-flow" title={graphName}>
          {graphName}
          {isDirty && <span style={{ color: '#d97706', marginLeft: 4 }}>*</span>}
        </span>

        {/* Live Status indicator badge */}
        {isExecuting ? (
          <span className="status-badge" style={{ background: '#e0e7ff', color: '#4338ca', fontSize: 11, padding: '2px 7px' }}>
            <Loader2 size={12} className="animate-spin" />
            Executing...
          </span>
        ) : runResult ? (
          runResult.status === 'listening' ? (
            <span className="status-badge" style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', fontSize: 11, padding: '2px 7px' }}>
              <Server size={12} />
              Live (:{runResult.output?.port || serverPort})
            </span>
          ) : runResult.status === 'completed' ? (
            <span className="status-badge status-saved" style={{ fontSize: 11, padding: '2px 7px' }}>
              <CheckCircle2 size={12} />
              Done {durationMs !== null ? `(${durationMs}ms)` : ''}
            </span>
          ) : runResult.status === 'waiting' && runResult.waitingDescriptor?.debugBreakpoint ? (
            <span className="status-badge" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #f59e0b', fontSize: 11, padding: '2px 7px' }}>
              <Bug size={12} />
              Debug Paused
            </span>
          ) : runResult.status === 'waiting' ? (
            <span className="status-badge" style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', fontSize: 11, padding: '2px 7px' }}>
              <Clock size={12} />
              Waiting Review
            </span>
          ) : (
            <span className="status-badge" style={{ background: '#fef2f2', color: '#dc2626', fontSize: 11, padding: '2px 7px' }}>
              <AlertCircle size={12} />
              Failed
            </span>
          )
        ) : (
          <span className="status-badge" style={{ background: '#f1f5f9', color: '#64748b', fontSize: 11, padding: '2px 7px' }}>
            Ready
          </span>
        )}

        <div className="execution-studio-divider" />

        {/* VS Code / DevTools Tabs */}
        {hasWebserver && (
          <button
            type="button"
            className={`execution-studio-tab ${activeTab === 'endpoints' ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (isMinimized) setIsMinimized(false);
              setActiveTab('endpoints');
            }}
          >
            <Server size={13} />
            Endpoints
            <span
              style={{
                fontSize: 9.5,
                padding: '1px 5px',
                borderRadius: 8,
                background: serverStatus === 'running' ? '#d1fae5' : '#f3f4f6',
                color: serverStatus === 'running' ? '#065f46' : '#6b7280',
                fontWeight: 700,
              }}
            >
              {serverStatus === 'running' ? 'Live' : 'Off'}
            </span>
          </button>
        )}

        <button
          type="button"
          className={`execution-studio-tab ${activeTab === 'input' ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (isMinimized) setIsMinimized(false);
            setActiveTab('input');
          }}
        >
          <FileJson size={13} />
          Input Payload
        </button>

        <button
          type="button"
          className={`execution-studio-tab ${activeTab === 'output' ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (isMinimized) setIsMinimized(false);
            setActiveTab('output');
          }}
        >
          <Terminal size={13} />
          Output &amp; Trace
          {runResult && (
            <span
              style={{
                fontSize: 9.5,
                padding: '1px 5px',
                borderRadius: 8,
                background:
                  runResult.status === 'completed' || runResult.status === 'listening'
                    ? '#d1fae5'
                    : runResult.status === 'waiting'
                    ? '#fef3c7'
                    : '#fee2e2',
                color:
                  runResult.status === 'completed' || runResult.status === 'listening'
                    ? '#065f46'
                    : runResult.status === 'waiting'
                    ? '#b45309'
                    : '#991b1b',
                fontWeight: 700,
              }}
            >
              {runResult.status}
            </span>
          )}
        </button>
      </div>

      {/* Right section: Execution Actions, Height Presets, Window Controls */}
      <div className="execution-studio-header-right" onClick={(e) => e.stopPropagation()}>
        {/* Quick Validate button */}
        <button
          type="button"
          className="btn btn-default"
          onClick={onValidate}
          disabled={isValidating || isExecuting}
          style={{ fontSize: 11.5, padding: '3px 9px', height: 26 }}
          title="Validate graph variables and node connections"
        >
          {isValidating ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <ShieldCheck size={12} color="var(--accent-primary)" />
          )}
          <span>Validate</span>
        </button>

        {/* Quick Run / Re-run button */}
        <button
          type="button"
          className="btn btn-primary"
          onClick={onExecute}
          disabled={isExecuting || (activeTab === 'input' && !!jsonError)}
          style={{
            fontSize: 11.5,
            padding: '3px 12px',
            height: 26,
            background:
              serverStatus === 'running' && hasWebserver
                ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                : 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
            color: '#ffffff',
            fontWeight: 600,
          }}
        >
          {isExecuting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Play size={11} fill="#ffffff" />
          )}
          <span>{isExecuting ? 'Running...' : hasWebserver && serverStatus === 'running' ? 'Restart' : 'Run'}</span>
        </button>

        {/* Debug (Step-by-Step) Run button & Use Cache option */}
        {onDebugExecute && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="btn btn-default"
              onClick={onDebugExecute}
              disabled={isExecuting || (activeTab === 'input' && !!jsonError)}
              style={{
                fontSize: 11.5,
                padding: '3px 10px',
                height: 26,
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: '#ffffff',
                fontWeight: 600,
                border: 'none',
              }}
              title="Debug Mode: Execute step-by-step, pausing after each node"
            >
              <Bug size={12} />
              <span>Debug</span>
            </button>

            {onToggleUseCache && (
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 500,
                  color: useCache ? '#f59e0b' : 'var(--text-secondary, #94a3b8)',
                  cursor: 'pointer',
                  userSelect: 'none',
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: useCache ? 'rgba(245, 158, 11, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                  border: useCache ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid var(--border-color, rgba(255,255,255,0.08))',
                  transition: 'all 0.15s ease',
                }}
                title="When enabled, execution reuses cached results for nodes that have caching enabled"
              >
                <input
                  type="checkbox"
                  checked={Boolean(useCache)}
                  onChange={(e) => onToggleUseCache(e.target.checked)}
                  style={{
                    cursor: 'pointer',
                    width: 13,
                    height: 13,
                    accentColor: '#f59e0b',
                  }}
                />
                <span>Use Cache</span>
              </label>
            )}
          </div>
        )}

        <div className="execution-studio-divider" />

        {/* Height Presets (only in bottom dock mode) */}
        {dockMode === 'bottom' && !isMinimized && (
          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            <button
              type="button"
              className="execution-studio-preset-btn"
              onClick={() => onSetPresetHeight(280)}
              title="Compact height (280px)"
            >
              280px
            </button>
            <button
              type="button"
              className="execution-studio-preset-btn"
              onClick={() => onSetPresetHeight(420)}
              title="Standard height (420px)"
            >
              420px
            </button>
            <button
              type="button"
              className="execution-studio-preset-btn"
              onClick={() => onSetPresetHeight(620)}
              title="Expanded height (620px)"
            >
              620px
            </button>
          </div>
        )}

        {/* Dock / Float Mode Toggle */}
        <button
          type="button"
          className="execution-studio-tool-btn"
          onClick={() => setDockMode((prev) => (prev === 'bottom' ? 'floating' : 'bottom'))}
          title={dockMode === 'bottom' ? 'Pop out into floating window' : 'Dock to bottom of workspace'}
        >
          {dockMode === 'bottom' ? <ExternalLink size={14} /> : <Layers size={14} />}
        </button>

        {/* Minimize / Collapse button (only in bottom dock mode) */}
        {dockMode === 'bottom' && (
          <button
            type="button"
            className="execution-studio-tool-btn"
            onClick={onToggleMinimize}
            title={isMinimized ? 'Expand Studio' : 'Minimize to bottom bar'}
          >
            {isMinimized ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        )}

        {/* Maximize / Restore button */}
        <button
          type="button"
          className="execution-studio-tool-btn"
          onClick={onToggleMaximize}
          title={isMaximized ? 'Restore height' : 'Maximize height'}
        >
          {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>

        {/* Close button */}
        <button
          type="button"
          className="execution-studio-tool-btn"
          onClick={onClose}
          title="Close Execution Studio"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
};
