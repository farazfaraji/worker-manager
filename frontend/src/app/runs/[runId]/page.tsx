'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { cancelRun, deleteRun, fetchRunById, rerunFromNode, resumeRun } from '@/lib/api';
import { RunNodeRecord, RunResult } from '@/lib/types';
import { getNodeIcon } from '@/components/nodes/LangGraphCustomNode';

const pretty = (value: any) => JSON.stringify(value, null, 2) || '{}';
const formatBytes = (bytes = 0) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default function RunDetailsPage({ params }: { params: { runId: string } }) {
  const [run, setRun] = useState<RunResult | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [rerunning, setRerunning] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumeTokenInput, setResumeTokenInput] = useState('');
  const [resumeDecision, setResumeDecision] = useState('Approve');
  const [resumeFeedback, setResumeFeedback] = useState('');
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRun = () => {
    fetchRunById(params.runId)
      .then((data) => {
        setRun(data);
        if (data.resumeToken) {
          setResumeTokenInput(data.resumeToken);
        }
      })
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    loadRun();
  }, [params.runId]);

  const handleRerun = async (nodeId: string) => {
    if (!run) return;
    try {
      setRerunning(nodeId);
      const updated = await rerunFromNode(run.runId, nodeId);
      setRun(updated);
    } catch (err: any) {
      window.alert(err.message);
    } finally {
      setRerunning(null);
    }
  };

  const handleCancel = async () => {
    if (!run || !window.confirm('Cancel this active flow run?')) return;
    try {
      setCancelling(true);
      const cancelled = await cancelRun(run.runId);
      setRun(cancelled);
    } catch (err: any) {
      window.alert(err.message);
    } finally {
      setCancelling(false);
    }
  };

  const handleResume = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!run) return;
    setResumeError(null);
    try {
      setResuming(true);
      const updated = await resumeRun(run.runId, {
        token: resumeTokenInput.trim(),
        decision: resumeDecision,
        approved: resumeDecision.toLowerCase() === 'approve',
        feedback: resumeFeedback,
      });
      setRun(updated);
    } catch (err: any) {
      setResumeError(err.message || 'Failed to resume run');
    } finally {
      setResuming(false);
    }
  };

  const remove = async () => {
    if (run && window.confirm('Delete this run?')) {
      await deleteRun(run.runId);
      window.location.href = '/runs';
    }
  };

  if (error) {
    return (
      <div className="run-detail-page">
        <div className="run-history-empty">
          <AlertCircle size={22} />
          {error}
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="run-detail-page">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  const isCancellable = ['queued', 'running', 'waiting'].includes(run.status);
  const isWaiting = run.status === 'waiting';

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="run-status run-status-completed">
            <CheckCircle2 size={16} /> Completed
          </span>
        );
      case 'failed':
        return (
          <span className="run-status run-status-failed">
            <XCircle size={16} /> Failed
          </span>
        );
      case 'waiting':
        return (
          <span className="run-status" style={{ background: '#78350f', color: '#fef3c7' }}>
            <Clock size={16} /> Waiting (Gate)
          </span>
        );
      case 'running':
        return (
          <span className="run-status" style={{ background: '#1e3a8a', color: '#bfdbfe' }}>
            <Loader2 className="animate-spin" size={16} /> Running
          </span>
        );
      case 'partial':
        return (
          <span className="run-status" style={{ background: '#7c2d12', color: '#ffedd5' }}>
            <AlertCircle size={16} /> Partial
          </span>
        );
      case 'cancelled':
        return (
          <span className="run-status" style={{ background: '#374151', color: '#e5e7eb' }}>
            <Ban size={16} /> Cancelled
          </span>
        );
      case 'queued':
      default:
        return (
          <span className="run-status" style={{ background: '#374151', color: '#9ca3af' }}>
            <Clock size={16} /> {status}
          </span>
        );
    }
  };

  return (
    <div className="run-detail-page">
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <div className="run-detail-top" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button className="btn btn-default" onClick={() => { window.location.href = '/runs'; }}>
            ← Run History
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {isCancellable && (
              <button
                className="btn btn-default"
                style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? <Loader2 className="animate-spin" size={15} /> : <Ban size={15} />}
                Cancel Run
              </button>
            )}
            <button className="btn btn-danger" onClick={() => void remove()}>
              Delete Run
            </button>
          </div>
        </div>

        <div className="run-detail-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>{run.graphName}</h1>
            <code>{run.runId}</code>
          </div>
          <div>{renderStatusBadge(run.status)}</div>
        </div>

        <div className="run-summary">
          <span><Clock size={15} />{run.createdAt ? new Date(run.createdAt).toLocaleString() : '—'}</span>
          <span>{run.nodes?.length || 0} steps</span>
          {run.checkpointSequence !== undefined && <span>Checkpoint: #{run.checkpointSequence}</span>}
          {run.metrics?.retryCount ? <span>Retries: {run.metrics.retryCount}</span> : null}
          {run.currentNodeId && <span>Current Node: {run.currentNodeId}</span>}
          <span>{formatBytes(run.dataSizeBytes)}</span>
          {run.parentRunId && (
            <span>
              Parent:{' '}
              <a href={`/runs/${run.parentRunId}`} style={{ color: 'var(--primary)', textDecoration: 'underline' }}>
                {run.parentRunId.slice(0, 8)}
              </a>
            </span>
          )}
        </div>

        {/* Human Gate Waiting Prompt */}
        {isWaiting && (
          <div
            style={{
              marginTop: 20,
              padding: 20,
              borderRadius: 10,
              background: '#1c1917',
              border: '1px solid #78350f',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Clock size={20} color="#f59e0b" />
              <h3 style={{ margin: 0, color: '#fef3c7', fontSize: 16 }}>Human Gate Approval Required</h3>
            </div>
            <p style={{ fontSize: 13, color: '#d6d3d1', marginBottom: 16 }}>
              {run.waitingDescriptor?.uiPayload?.question ||
                'This workflow is waiting for human input before execution can continue.'}
            </p>

            {resumeError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  background: '#450a0a',
                  border: '1px solid #991b1b',
                  borderRadius: 6,
                  color: '#fecaca',
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                <AlertCircle size={16} />
                {resumeError}
              </div>
            )}

            <form onSubmit={handleResume} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#a8a29e', marginBottom: 4 }}>
                  Resume Token
                </label>
                <input
                  type="text"
                  placeholder="rtk_..."
                  value={resumeTokenInput}
                  onChange={(e) => setResumeTokenInput(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: '#292524',
                    border: '1px solid #44403c',
                    color: '#fff',
                    fontFamily: 'monospace',
                    fontSize: 13,
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#a8a29e', marginBottom: 4 }}>
                  Decision
                </label>
                <select
                  value={resumeDecision}
                  onChange={(e) => setResumeDecision(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: '#292524',
                    border: '1px solid #44403c',
                    color: '#fff',
                    fontSize: 13,
                  }}
                >
                  <option value="Approve">Approve</option>
                  <option value="Reject">Reject</option>
                  <option value="Request Changes">Request Changes</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#a8a29e', marginBottom: 4 }}>
                  Feedback / Notes (Optional)
                </label>
                <textarea
                  rows={3}
                  value={resumeFeedback}
                  onChange={(e) => setResumeFeedback(e.target.value)}
                  placeholder="Optional review feedback..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: '#292524',
                    border: '1px solid #44403c',
                    color: '#fff',
                    fontSize: 13,
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button
                  type="submit"
                  className="btn btn-default"
                  style={{ background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' }}
                  disabled={resuming || !resumeTokenInput.trim()}
                >
                  {resuming ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
                  Submit & Resume Execution
                </button>
              </div>
            </form>
          </div>
        )}

        {run.output !== undefined && (
          <div className="run-json-card" style={{ marginTop: 20 }}>
            <h3>Final Output</h3>
            <pre>{pretty(run.output)}</pre>
          </div>
        )}

        <h2 style={{ margin: '28px 0 12px', fontSize: 17 }}>Execution Trace</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(run.nodes || []).map((node: RunNodeRecord, index) => {
            const open = !!expanded[node.nodeId];
            const failed = node.status === 'failed';
            return (
              <div
                key={`${node.nodeId}-${index}`}
                className={`trace-card ${failed ? 'trace-failed' : ''}`}
              >
                <div
                  className="trace-header"
                  onClick={() => setExpanded((current) => ({ ...current, [node.nodeId]: !open }))}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span className="trace-index">#{index + 1}</span>
                    {getNodeIcon(node.nodeType, 17)}
                    <strong>{node.nodeName}</strong>
                    <code>{node.nodeType}</code>
                    {node.attempt && node.attempt > 1 ? (
                      <span
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          background: '#431407',
                          color: '#fed7aa',
                          borderRadius: 4,
                          fontWeight: 600,
                        }}
                      >
                        Attempt #{node.attempt}
                      </span>
                    ) : null}
                    {node.durationMs !== undefined && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {node.durationMs}ms
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {node.childRunId && (
                      <a
                        href={`/runs/${node.childRunId}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          fontSize: 11,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          color: 'var(--primary)',
                          textDecoration: 'none',
                        }}
                      >
                        Child Run <ExternalLink size={12} />
                      </a>
                    )}
                    {node.status === 'completed' ? (
                      <span className="run-status run-status-completed">
                        <Check size={13} /> success
                      </span>
                    ) : node.status === 'waiting' ? (
                      <span className="run-status" style={{ background: '#78350f', color: '#fef3c7' }}>
                        <Clock size={13} /> waiting
                      </span>
                    ) : (
                      <span className="run-status run-status-failed">
                        <XCircle size={13} /> failed
                      </span>
                    )}
                    <button
                      className="btn btn-default trace-rerun"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRerun(node.nodeId);
                      }}
                      disabled={!!rerunning}
                    >
                      <RefreshCw size={12} />
                      {rerunning === node.nodeId ? 'Running…' : 'Rerun from here'}
                    </button>
                    {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                </div>

                {open && (
                  <div className="trace-body">
                    {failed && node.error && (
                      <div className="trace-error">
                        <AlertCircle size={15} />
                        <div>
                          <strong>{node.errorCode || 'Error'}: </strong>
                          {node.error.message}
                        </div>
                      </div>
                    )}
                    <div>
                      <label>Resolved input</label>
                      <pre>{pretty(node.input)}</pre>
                    </div>
                    {node.output !== undefined && (
                      <div>
                        <label>Output</label>
                        <pre>{pretty(node.output)}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
