'use client';

import React, { useState, useEffect } from 'react';
import {
  Terminal,
  Play,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Check,
  Copy,
  Clock,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Wrench,
  Bug,
  StopCircle,
  SkipForward,
} from 'lucide-react';
import { RunResult, RunNodeRecord } from '@/lib/types';
import { getNodeIcon } from '../../nodes/LangGraphCustomNode';
import { ExecutionGateReview } from './ExecutionGateReview';

interface ExecutionTraceTabProps {
  runResult: RunResult | null;
  isExecuting: boolean;
  durationMs: number | null;
  onExecute: () => void;
  onRerunNode?: (nodeId: string) => Promise<RunResult>;
  onResumeRun?: (payload: any) => Promise<RunResult>;
  onCancelRun?: () => Promise<RunResult>;
  jsonError?: string | null;
}

export const ExecutionTraceTab: React.FC<ExecutionTraceTabProps> = ({
  runResult,
  isExecuting,
  durationMs,
  onExecute,
  onRerunNode,
  onResumeRun,
  onCancelRun,
  jsonError,
}) => {
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<boolean>(false);

  // Identify waiting node in runResult
  const waitingNodeRecord =
    runResult?.status === 'waiting'
      ? (runResult.nodes || []).find((n) => n.status === 'waiting')
      : null;

  // Identify debug breakpoint (separate from human gate waiting)
  const isDebugBreakpoint =
    runResult?.status === 'waiting' && runResult?.waitingDescriptor?.debugBreakpoint === true;

  // Auto expand failed, waiting, or last node when runResult changes
  useEffect(() => {
    if (runResult?.nodes && runResult.nodes.length > 0) {
      const expanded: Record<string, boolean> = {};
      runResult.nodes.forEach((node, idx) => {
        if (
          node.status === 'failed' ||
          node.status === 'waiting' ||
          idx === runResult.nodes!.length - 1
        ) {
          expanded[node.nodeId] = true;
        }
      });
      setExpandedNodes(expanded);
    }
  }, [runResult]);

  const toggleNodeExpand = (nodeId: string) => {
    setExpandedNodes((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 1. Empty State */}
      {!runResult && !isExecuting && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: 'var(--text-muted)',
            background: 'var(--bg-subtle)',
            borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--border-color)',
          }}
        >
          <Terminal size={32} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
          <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
            No Execution Data Yet
          </h4>
          <p style={{ fontSize: 12, maxWidth: 360, margin: '0 auto 16px' }}>
            Click &ldquo;Run Flow&rdquo; to execute this workflow and inspect step-by-step traces.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onExecute}
            disabled={isExecuting || !!jsonError}
            style={{ margin: '0 auto' }}
          >
            <Play size={13} fill="#ffffff" />
            Run Flow Now
          </button>
        </div>
      )}

      {/* 2. Executing State */}
      {isExecuting && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 20px',
            background: 'var(--bg-surface)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
          }}
        >
          <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto 12px', color: 'var(--accent-primary)' }} />
          <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Executing Workflow Graph...
          </h4>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Running nodes in topological order and streaming execution results.
          </p>
        </div>
      )}

      {/* 3. Run Results */}
      {runResult && (
        <>
          {/* Overall Error Banner if run failed */}
          {runResult.status === 'failed' && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
                color: '#991b1b',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
                <AlertCircle size={17} color="#dc2626" />
                <span>Execution Error</span>
              </div>
              <div style={{ fontSize: 13, marginTop: 6, fontFamily: 'monospace' }}>
                {runResult.error?.message || 'Graph execution encountered an error'}
              </div>
            </div>
          )}

          {/* n8n-Style Human Gate Interactive Review & Form Card */}
          {waitingNodeRecord && !isDebugBreakpoint && (
            <ExecutionGateReview
              waitingNodeRecord={waitingNodeRecord}
              onResumeRun={onResumeRun}
            />
          )}

          {/* Debug Breakpoint Interactive Card */}
          {isDebugBreakpoint && runResult.resumeToken && (
            <div
              style={{
                background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
                border: '2px solid #f59e0b',
                borderRadius: 'var(--radius-md)',
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                boxShadow: '0 4px 14px rgba(245, 158, 11, 0.15)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    background: '#f59e0b',
                    color: '#ffffff',
                    padding: 6,
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Bug size={18} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#92400e' }}>
                    Debug Breakpoint
                  </div>
                  <div style={{ fontSize: 12.5, color: '#a16207', marginTop: 2 }}>
                    Paused after <strong>&ldquo;{runResult.waitingDescriptor?.nodeName}&rdquo;</strong>
                    {' '}&mdash; inspect the output below, then continue or cancel.
                  </div>
                </div>
              </div>

              {/* Last node output preview */}
              {runResult.waitingDescriptor?.completedNodeOutput !== undefined && (
                <div
                  style={{
                    background: '#0f172a',
                    borderRadius: 8,
                    border: '1px solid #334155',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 12px',
                      background: '#1e293b',
                      borderBottom: '1px solid #334155',
                    }}
                  >
                    <CheckCircle2 size={13} color="#34d399" />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#f8fafc' }}>
                      Output of &ldquo;{runResult.waitingDescriptor.nodeName}&rdquo;
                    </span>
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 12,
                      fontSize: 12,
                      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      color: '#34d399',
                      overflowX: 'auto',
                      maxHeight: 180,
                    }}
                  >
                    {JSON.stringify(runResult.waitingDescriptor.completedNodeOutput, null, 2)}
                  </pre>
                </div>
              )}

              {/* Next nodes preview */}
              {Array.isArray(runResult.waitingDescriptor?.nextNodeIds) && runResult.waitingDescriptor.nextNodeIds.length > 0 && (
                <div style={{ fontSize: 11.5, color: '#92400e' }}>
                  <span style={{ fontWeight: 600 }}>Next up:</span>{' '}
                  {runResult.waitingDescriptor.nextNodeIds.slice(0, 3).map((id: string, i: number) => {
                    const nodeRec = (runResult.nodes || []).find((n) => n.nodeId === id);
                    return (
                      <span key={id} style={{ fontFamily: 'monospace', background: '#fef9c3', padding: '1px 6px', borderRadius: 4, marginRight: 4 }}>
                        {nodeRec?.nodeName || id.substring(0, 12)}
                      </span>
                    );
                  })}
                  {runResult.waitingDescriptor.nextNodeIds.length > 3 && (
                    <span style={{ color: '#a16207' }}>+{runResult.waitingDescriptor.nextNodeIds.length - 3} more</span>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    if (onResumeRun) {
                      onResumeRun({ token: runResult.resumeToken, debugContinue: true });
                    }
                  }}
                  disabled={isExecuting}
                  style={{
                    fontSize: 12.5,
                    padding: '6px 18px',
                    height: 32,
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    color: '#ffffff',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {isExecuting ? <Loader2 size={14} className="animate-spin" /> : <SkipForward size={14} />}
                  Continue to Next Step
                </button>
                {onCancelRun && (
                  <button
                    type="button"
                    className="btn btn-default"
                    onClick={() => onCancelRun()}
                    disabled={isExecuting}
                    style={{
                      fontSize: 12.5,
                      padding: '6px 14px',
                      height: 32,
                      background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                      color: '#ffffff',
                      fontWeight: 600,
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <StopCircle size={14} />
                    Cancel Flow
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Final Output Summary */}
          {runResult.output !== undefined && runResult.status !== 'waiting' && (
            <div
              style={{
                background: '#0f172a',
                borderRadius: 'var(--radius-md)',
                border: '1px solid #334155',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: '#1e293b',
                  borderBottom: '1px solid #334155',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle2 size={15} color="#10b981" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                    Final Flow Output
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(JSON.stringify(runResult.output, null, 2))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 11,
                    background: '#334155',
                    color: '#f8fafc',
                    border: 'none',
                    padding: '4px 8px',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  {copied ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy JSON'}
                </button>
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 14,
                  fontSize: 12.5,
                  fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  color: '#38bdf8',
                  overflowX: 'auto',
                  maxHeight: 220,
                }}
              >
                {JSON.stringify(runResult.output, null, 2)}
              </pre>
            </div>
          )}

          {/* Step-by-Step Node Execution Timeline */}
          <div>
            <h4
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginBottom: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>Execution Trace ({runResult.nodes?.length || 0} nodes executed)</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)' }}>
                Run ID: {runResult.runId ? runResult.runId.substring(0, 8) : 'N/A'}
              </span>
            </h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(runResult.nodes || []).map((nodeRecord: RunNodeRecord, idx: number) => {
                const isExpanded = !!expandedNodes[nodeRecord.nodeId];
                const isFailed = nodeRecord.status === 'failed';
                const isDone = nodeRecord.status === 'completed';
                const isWaiting = nodeRecord.status === 'waiting';

                let nodeDuration: number | null = null;
                if (nodeRecord.startedAt && nodeRecord.finishedAt) {
                  const s = new Date(nodeRecord.startedAt).getTime();
                  const f = new Date(nodeRecord.finishedAt).getTime();
                  if (!isNaN(s) && !isNaN(f)) nodeDuration = f - s;
                }

                return (
                  <div
                    key={nodeRecord.nodeId || idx}
                    style={{
                      border: `1px solid ${isFailed ? '#fecaca' : 'var(--border-color)'}`,
                      borderRadius: 'var(--radius-md)',
                      background: isFailed ? '#fff5f5' : 'var(--bg-surface)',
                      overflow: 'hidden',
                      boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    {/* Step Header */}
                    <div
                      onClick={() => toggleNodeExpand(nodeRecord.nodeId)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        cursor: 'pointer',
                        background: isFailed ? '#fef2f2' : 'transparent',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: 'var(--text-muted)',
                            width: 18,
                          }}
                        >
                          #{idx + 1}
                        </span>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {getNodeIcon(nodeRecord.nodeType || 'function', 16)}
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                            {nodeRecord.nodeName}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              background: 'var(--bg-subtle)',
                              padding: '1px 6px',
                              borderRadius: 4,
                              color: 'var(--text-secondary)',
                              fontFamily: 'monospace',
                            }}
                          >
                            {nodeRecord.nodeType}
                          </span>
                          {nodeRecord.cached && (
                            <a
                              href="/caches"
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                fontSize: 10,
                                background: 'rgba(245, 158, 11, 0.15)',
                                color: '#f59e0b',
                                border: '1px solid rgba(245, 158, 11, 0.3)',
                                padding: '1px 6px',
                                borderRadius: 4,
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3,
                                textDecoration: 'none',
                                cursor: 'pointer',
                              }}
                              title="Result retrieved from node cache. Click to open Node Cache Explorer"
                            >
                              ⚡ Cached
                            </a>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {nodeDuration !== null && (
                          <span
                            style={{
                              fontSize: 11,
                              color: 'var(--text-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 3,
                            }}
                          >
                            <Clock size={11} />
                            {nodeDuration}ms
                          </span>
                        )}

                        {isDone && (
                          <span
                            style={{
                              fontSize: 11,
                              color: '#059669',
                              background: '#ecfdf5',
                              padding: '2px 8px',
                              borderRadius: 9999,
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <Check size={12} />
                            Success
                          </span>
                        )}

                        {isFailed && (
                          <span
                            style={{
                              fontSize: 11,
                              color: '#dc2626',
                              background: '#fee2e2',
                              padding: '2px 8px',
                              borderRadius: 9999,
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <AlertCircle size={12} />
                            Failed
                          </span>
                        )}

                        {isWaiting && (
                          <span
                            style={{
                              fontSize: 11,
                              color: '#b45309',
                              background: '#fef3c7',
                              border: '1px solid #fde68a',
                              padding: '2px 8px',
                              borderRadius: 9999,
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <Clock size={12} />
                            Waiting for Input
                          </span>
                        )}

                        {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </div>
                    </div>

                    {onRerunNode && (
                      <div style={{ padding: '0 14px 10px', display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-default"
                          onClick={(event) => {
                            event.stopPropagation();
                            void onRerunNode(nodeRecord.nodeId);
                          }}
                          disabled={isExecuting}
                          style={{ fontSize: 11, padding: '4px 9px', display: 'flex', alignItems: 'center', gap: 5 }}
                          title="Run the flow again from this node"
                        >
                          <RefreshCw size={12} />
                          Rerun from here
                        </button>
                      </div>
                    )}

                    {/* Step Expanded Content: Input & Output */}
                    {isExpanded && (
                      <div
                        style={{
                          padding: 12,
                          borderTop: '1px solid var(--border-color)',
                          background: '#fafbfc',
                          fontSize: 12,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                        }}
                      >
                        {isFailed && nodeRecord.error && (
                          <div
                            style={{
                              padding: '10px 12px',
                              background: '#fee2e2',
                              border: '1px solid #fecaca',
                              borderRadius: 6,
                              color: '#991b1b',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}
                          >
                            <div style={{ fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <AlertCircle size={14} color="#dc2626" />
                              <span>Error: {nodeRecord.error.message || JSON.stringify(nodeRecord.error)}</span>
                            </div>
                            {nodeRecord.error.stack && (
                              <pre
                                style={{
                                  margin: '4px 0 0 0',
                                  padding: 8,
                                  background: '#0f172a',
                                  color: '#f87171',
                                  fontSize: 11,
                                  fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                  borderRadius: 4,
                                  overflowX: 'auto',
                                  maxHeight: 140,
                                  lineHeight: 1.4,
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-all',
                                }}
                              >
                                {nodeRecord.error.stack}
                              </pre>
                            )}
                          </div>
                        )}

                        {/* Autonomous Agent Tool Calls Trace */}
                        {Array.isArray(nodeRecord.output?.toolCalls) && nodeRecord.output.toolCalls.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div
                              style={{
                                fontWeight: 600,
                                color: 'var(--text-secondary)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                fontSize: 11.5,
                              }}
                            >
                              <Wrench size={13} color="var(--accent-primary)" />
                              <span>Autonomous Tool Calls ({nodeRecord.output.toolCalls.length} steps):</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {nodeRecord.output.toolCalls.map((tc: any, tcIdx: number) => {
                                const isTcSuccess = tc.status === 'completed';
                                return (
                                  <div
                                    key={tc.id || tcIdx}
                                    style={{
                                      background: '#0f172a',
                                      borderRadius: 6,
                                      border: `1px solid ${isTcSuccess ? '#334155' : '#7f1d1d'}`,
                                      padding: '8px 10px',
                                      fontSize: 11.5,
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        marginBottom: 4,
                                      }}
                                    >
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span
                                          style={{
                                            fontFamily: 'monospace',
                                            fontWeight: 700,
                                            background: 'var(--accent-subtle, rgba(99, 102, 241, 0.2))',
                                            color: 'var(--accent-primary, #818cf8)',
                                            padding: '1px 6px',
                                            borderRadius: 4,
                                          }}
                                        >
                                          {tc.tool}
                                        </span>
                                        <span style={{ color: '#94a3b8', fontSize: 11 }}>
                                          #{tcIdx + 1}
                                        </span>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        {tc.durationMs !== undefined && (
                                          <span style={{ color: '#64748b', fontSize: 10.5 }}>
                                            {tc.durationMs}ms
                                          </span>
                                        )}
                                        <span
                                          style={{
                                            color: isTcSuccess ? '#34d399' : '#f87171',
                                            fontSize: 10.5,
                                            fontWeight: 600,
                                          }}
                                        >
                                          {isTcSuccess ? '✓ Success' : '✗ Failed'}
                                        </span>
                                      </div>
                                    </div>
                                    {tc.resultSummary && (
                                      <div style={{ color: '#cbd5e1', fontSize: 11, marginBottom: 4 }}>
                                        {tc.resultSummary}
                                      </div>
                                    )}
                                    {tc.error && (
                                      <div style={{ color: '#f87171', fontSize: 11, marginBottom: 4 }}>
                                        Error: {tc.error}
                                      </div>
                                    )}
                                    <details style={{ marginTop: 2 }}>
                                      <summary
                                        style={{
                                          color: '#64748b',
                                          cursor: 'pointer',
                                          fontSize: 10.5,
                                          userSelect: 'none',
                                        }}
                                      >
                                        Inspect Arguments & Result
                                      </summary>
                                      <pre
                                        style={{
                                          margin: '6px 0 0 0',
                                          padding: 6,
                                          background: '#020617',
                                          borderRadius: 4,
                                          color: '#94a3b8',
                                          fontFamily: 'monospace',
                                          fontSize: 10.5,
                                          overflowX: 'auto',
                                          maxHeight: 120,
                                        }}
                                      >
                                        {JSON.stringify(
                                          { arguments: tc.args, result: tc.result, error: tc.error },
                                          null,
                                          2,
                                        )}
                                      </pre>
                                    </details>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                            Resolved Node Input:
                          </div>
                          <pre
                            style={{
                              background: '#0f172a',
                              color: '#94a3b8',
                              padding: 10,
                              borderRadius: 6,
                              margin: 0,
                              maxHeight: 140,
                              overflowY: 'auto',
                              fontFamily: 'monospace',
                              fontSize: 11.5,
                            }}
                          >
                            {JSON.stringify(nodeRecord.input, null, 2) || '{}'}
                          </pre>
                        </div>

                        {nodeRecord.output !== undefined && (
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                              Node Output:
                            </div>
                            <pre
                              style={{
                                background: '#0f172a',
                                color: '#34d399',
                                padding: 10,
                                borderRadius: 6,
                                margin: 0,
                                maxHeight: 160,
                                overflowY: 'auto',
                                fontFamily: 'monospace',
                                fontSize: 11.5,
                              }}
                            >
                              {JSON.stringify(nodeRecord.output, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
