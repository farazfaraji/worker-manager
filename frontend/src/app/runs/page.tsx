'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ExternalLink, History, Loader2, Trash2 } from 'lucide-react';
import { deleteRun, fetchRuns, fetchProjects } from '@/lib/api';
import { RunResult, Project } from '@/lib/types';
import { AppNav } from '@/components/AppNav';
import { RunStatusBadge } from '@/components/RunStatusBadge';
import { readActiveProjectId, writeActiveProjectId } from '@/lib/studio-session';

const formatBytes = (bytes = 0) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const formatDate = (value?: string) => value ? new Date(value).toLocaleString() : '—';

export default function RunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunResult[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [projectReady, setProjectReady] = useState(false);
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
    setSelectedProjectId(readActiveProjectId());
    setProjectReady(true);
  }, []);

  useEffect(() => {
    if (!projectReady) return;
    void load(selectedProjectId);
  }, [selectedProjectId, projectReady]);

  const remove = async (run: RunResult) => {
    if (!window.confirm(`Delete run ${run.runId}?`)) return;
    try { await deleteRun(run.runId); setRuns((current) => current.filter((item) => item.runId !== run.runId)); }
    catch (err: any) { window.alert(err.message); }
  };

  return (
    <div className="page-shell">
      <AppNav />
      <div className="page-shell-scroll">
        <header className="page-heading">
          <div>
            <h1>Run History</h1>
            <p>Inspect previous executions and jump back to the flow that produced them.</p>
          </div>
          <div className="page-heading-actions">
            {projects.length > 0 && (
              <select
                value={selectedProjectId}
                onChange={(e) => {
                  const next = e.target.value;
                  setSelectedProjectId(next);
                  if (next) writeActiveProjectId(next);
                }}
                className="form-input"
                style={{ width: 190, height: 36, fontSize: 13, cursor: 'pointer' }}
              >
                <option value="">All Projects</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>{p.name}</option>
                ))}
              </select>
            )}
            <button className="btn btn-default" onClick={() => void load(selectedProjectId)} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" size={15} /> : <History size={15} />} Refresh
            </button>
          </div>
        </header>
        {error && <div className="run-history-empty" style={{ color: 'var(--danger)' }}><AlertCircle size={20} />{error}</div>}
        {!loading && !error && runs.length === 0 && <div className="run-history-empty"><History size={34} /><strong>No runs yet</strong><span>Run a flow to see its execution history here.</span></div>}
        {runs.length > 0 && <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr .8fr .8fr 110px', gap: 12, padding: '12px 18px', background: 'var(--bg-subtle)', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}><span>Flow / Run ID</span><span>Status</span><span>Started</span><span>Steps</span><span>Data</span><span /></div>
          {runs.map((run) => (
            <div key={run.runId} className="run-history-row" onClick={() => router.push(`/runs/${run.runId}`)}>
              <div>
                <strong>{run.graphName}</strong>
                <code>{run.runId}</code>
                {run.graphId && (
                  <Link href={`/flow/${encodeURIComponent(run.graphId)}`} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent-primary)', fontSize: 11 }}>
                    Open flow
                  </Link>
                )}
                {run.parentRunId && <small>Rerun of {run.parentRunId.slice(0, 8)}</small>}
              </div>
              <RunStatusBadge status={run.status} />
              <span>{formatDate(run.createdAt)}</span>
              <span>{run.nodes?.length || 0}</span>
              <span>{formatBytes(run.dataSizeBytes)}</span>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <button className="icon-btn" title="Open details" onClick={(e) => { e.stopPropagation(); router.push(`/runs/${run.runId}`); }}><ExternalLink size={15} /></button>
                <button className="icon-btn danger" title="Delete run" onClick={(e) => { e.stopPropagation(); void remove(run); }}><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>}
      </div>
    </div>
  );
}
