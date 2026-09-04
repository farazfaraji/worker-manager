'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, ExternalLink, History, Loader2, Trash2, XCircle } from 'lucide-react';
import { deleteRun, fetchRuns, fetchProjects } from '@/lib/api';
import { RunResult, Project } from '@/lib/types';

const formatBytes = (bytes = 0) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const formatDate = (value?: string) => value ? new Date(value).toLocaleString() : '—';

export default function RunsPage() {
  const [runs, setRuns] = useState<RunResult[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (projectId?: string) => {
    try {
      setLoading(true);
      const [runsData, projectsData] = await Promise.all([
        fetchRuns(projectId || undefined),
        fetchProjects().catch(() => []),
      ]);
      setRuns(runsData);
      setProjects(projectsData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load runs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(selectedProjectId);
  }, [selectedProjectId]);

  const remove = async (run: RunResult) => {
    if (!window.confirm(`Delete run ${run.runId}?`)) return;
    try { await deleteRun(run.runId); setRuns((current) => current.filter((item) => item.runId !== run.runId)); }
    catch (err: any) { window.alert(err.message); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: 32, overflowY: 'auto' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-default" onClick={() => { window.location.href = '/'; }}>← Board</button>
            <div><h1 style={{ fontSize: 24, marginBottom: 4 }}>Run History</h1><p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Inspect, compare and continue previous flow executions.</p></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {projects.length > 0 && (
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="form-input"
                style={{ width: 190, height: 36, fontSize: 13, cursor: 'pointer' }}
              >
                <option value="">All Projects</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <button className="btn btn-default" onClick={() => void load(selectedProjectId)} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" size={15} /> : <History size={15} />} Refresh
            </button>
          </div>
        </div>
        {error && <div className="run-history-empty" style={{ color: 'var(--danger)' }}><AlertCircle size={20} />{error}</div>}
        {!loading && !error && runs.length === 0 && <div className="run-history-empty"><History size={34} /><strong>No runs yet</strong><span>Run a flow to see its execution history here.</span></div>}
        {runs.length > 0 && <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr .8fr .8fr 110px', gap: 12, padding: '12px 18px', background: 'var(--bg-subtle)', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}><span>Flow / Run ID</span><span>Status</span><span>Started</span><span>Steps</span><span>Data</span><span /></div>
          {runs.map((run) => <div key={run.runId} className="run-history-row" onClick={() => { window.location.href = `/runs/${run.runId}`; }}>
            <div><strong>{run.graphName}</strong><code>{run.runId}</code>{run.parentRunId && <small>Rerun of {run.parentRunId.slice(0, 8)}</small>}</div>
            <div className={`run-status run-status-${run.status}`} style={{
              background: run.status === 'waiting' ? '#78350f' : run.status === 'cancelled' ? '#374151' : run.status === 'partial' ? '#7c2d12' : run.status === 'running' ? '#1e3a8a' : undefined,
              color: run.status === 'waiting' ? '#fef3c7' : run.status === 'cancelled' ? '#e5e7eb' : run.status === 'partial' ? '#ffedd5' : run.status === 'running' ? '#bfdbfe' : undefined,
            }}>
              {run.status === 'completed' ? <CheckCircle2 size={15} /> : run.status === 'failed' ? <XCircle size={15} /> : run.status === 'cancelled' ? <AlertCircle size={15} /> : <Clock size={15} />}
              {run.status}
            </div>
            <span>{formatDate(run.createdAt)}</span><span>{run.nodes?.length || 0}</span><span>{formatBytes(run.dataSizeBytes)}</span>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}><button className="icon-btn" title="Open details" onClick={(e) => { e.stopPropagation(); window.location.href = `/runs/${run.runId}`; }}><ExternalLink size={15} /></button><button className="icon-btn danger" title="Delete run" onClick={(e) => { e.stopPropagation(); void remove(run); }}><Trash2 size={15} /></button></div>
          </div>)}
        </div>}
      </div>
    </div>
  );
}
