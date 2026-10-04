'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Bot,
  Check,
  Clock,
  Copy,
  Database,
  ExternalLink,
  Globe,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { clearAllCaches, deleteNodeCache, fetchCaches, fetchProjects } from '@/lib/api';
import { NodeCacheItem, Project } from '@/lib/types';
import { AppNav } from '@/components/AppNav';
import { getBoardHref, readActiveProjectId, writeActiveProjectId } from '@/lib/studio-session';

const formatBytes = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const formatRelativeTime = (value?: string) => {
  if (!value) return '—';
  const diff = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const typeIcon = (type?: string, size = 16) => {
  switch (type?.toLowerCase()) {
    case 'agent':
      return <Bot size={size} />;
    case 'web-search':
      return <Globe size={size} />;
    case 'repo-inspect':
      return <Terminal size={size} />;
    default:
      return <Database size={size} />;
  }
};

const previewOf = (item: NodeCacheItem) => {
  const res = item.result;
  if (!res) return 'No output data recorded';
  if (item.nodeType === 'agent') return String(res.text || res.result || JSON.stringify(res));
  if (item.nodeType === 'web-search') {
    if (Array.isArray(res.results)) return `${res.results.length} search results`;
    if (res.text) return String(res.text).slice(0, 220);
  }
  if (item.nodeType === 'repo-inspect') {
    return res.result?.summary || res.summary || JSON.stringify(res);
  }
  return JSON.stringify(res);
};

function FormattedCache({ item }: { item: NodeCacheItem }) {
  const res = item.result || {};
  if (item.nodeType === 'agent') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {res.text && <pre className="artifact-pre">{res.text}</pre>}
        {res.reasoning && <pre className="artifact-pre">{res.reasoning}</pre>}
        {Array.isArray(res.toolCalls) && res.toolCalls.length > 0 && (
          <pre className="artifact-pre">{JSON.stringify(res.toolCalls, null, 2)}</pre>
        )}
      </div>
    );
  }
  if (item.nodeType === 'web-search' && Array.isArray(res.results)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {res.results.map((result: any, index: number) => (
          <div key={index}>
            <a href={result.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)' }}>
              {result.title || result.url} <ExternalLink size={12} />
            </a>
            {result.snippet && <p style={{ margin: '4px 0 0', fontSize: 13 }}>{result.snippet}</p>}
          </div>
        ))}
      </div>
    );
  }
  if (item.nodeType === 'repo-inspect') {
    const summary = res.result?.summary || res.summary;
    const files = res.result?.relevantFiles;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {summary && <p>{summary}</p>}
        {Array.isArray(files) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {files.map((file: string) => (
              <code key={file}>{file}</code>
            ))}
          </div>
        )}
      </div>
    );
  }
  return <pre className="artifact-pre">{JSON.stringify(res, null, 2)}</pre>;
}

export default function CachesPage() {
  const [caches, setCaches] = useState<NodeCacheItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectReady, setProjectReady] = useState(false);
  const [selectedType, setSelectedType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCache, setSelectedCache] = useState<NodeCacheItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'formatted' | 'raw' | 'input'>('formatted');
  const [boardHref, setBoardHref] = useState('/');

  const load = async (projectId = selectedProjectId) => {
    try {
      setLoading(true);
      setError(null);
      const [cacheData, projectList] = await Promise.all([
        fetchCaches(projectId ? { projectId } : undefined),
        fetchProjects().catch(() => []),
      ]);
      setCaches(cacheData);
      setProjects(projectList);
    } catch (err: any) {
      setError(err.message || 'Failed to load node caches');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedProjectId(readActiveProjectId());
    setBoardHref(getBoardHref());
    setProjectReady(true);
  }, []);

  useEffect(() => {
    if (!projectReady) return;
    void load(selectedProjectId);
  }, [selectedProjectId, projectReady]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleDelete = async (item: NodeCacheItem) => {
    if (!window.confirm(`Delete cache for node "${item.nodeName || item.nodeId}"?`)) return;
    try {
      await deleteNodeCache(item.graphId, item.nodeId);
      setCaches((prev) => prev.filter((entry) => !(entry.graphId === item.graphId && entry.nodeId === item.nodeId)));
      if (selectedCache?.graphId === item.graphId && selectedCache?.nodeId === item.nodeId) setSelectedCache(null);
    } catch (err: any) {
      window.alert(`Failed to delete cache: ${err.message}`);
    }
  };

  const handleClearAll = async () => {
    const scoped = Boolean(selectedProjectId);
    const msg = scoped
      ? 'Clear cached results for the selected project?'
      : 'Clear every cached node result?';
    if (!window.confirm(msg)) return;
    try {
      await clearAllCaches(scoped ? { projectId: selectedProjectId } : undefined);
      setCaches([]);
      setSelectedCache(null);
    } catch (err: any) {
      window.alert(`Failed to clear caches: ${err.message}`);
    }
  };

  const filteredCaches = useMemo(() => {
    return caches.filter((item) => {
      if (selectedType !== 'all' && item.nodeType?.toLowerCase() !== selectedType.toLowerCase()) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return [item.nodeName, item.nodeId, item.graphName, item.nodeType, JSON.stringify(item.result || {})]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [caches, selectedType, searchQuery]);

  const stats = useMemo(() => {
    const count = (type: string) => caches.filter((item) => item.nodeType === type).length;
    const totalBytes = caches.reduce((sum, item) => sum + JSON.stringify(item.result || {}).length + JSON.stringify(item.input || {}).length, 0);
    return { total: caches.length, agent: count('agent'), web: count('web-search'), repo: count('repo-inspect'), totalBytes };
  }, [caches]);

  return (
    <div className="page-shell">
      <AppNav />
      <div className="page-shell-scroll">
        <header className="page-heading">
          <div>
            <h1>Node Cache Explorer</h1>
            <p>Saved results for agent, web search, and repository inspector nodes.</p>
          </div>
          <div className="page-heading-actions">
            <button type="button" className="btn btn-default" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
            </button>
            {caches.length > 0 && (
              <button type="button" className="btn btn-danger" onClick={() => void handleClearAll()}>
                <Trash2 size={14} /> {selectedProjectId ? 'Clear project' : 'Clear all'}
              </button>
            )}
          </div>
        </header>

        <section className="metric-grid">
          {[
            ['Total cached', stats.total, <Database size={18} key="db" />],
            ['Agent', stats.agent, <Bot size={18} key="bot" />],
            ['Web search', stats.web, <Globe size={18} key="web" />],
            ['CLI inspector', stats.repo, <Terminal size={18} key="cli" />],
            ['Payload', formatBytes(stats.totalBytes), <Layers size={18} key="layers" />],
          ].map(([label, value, icon]) => (
            <div className="metric-card" key={String(label)}>
              {icon}
              <div>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            </div>
          ))}
        </section>

        <div className="filter-row">
          <div className="segmented">
            {[
              { id: 'all', label: 'All types' },
              { id: 'agent', label: 'Agent' },
              { id: 'web-search', label: 'Web search' },
              { id: 'repo-inspect', label: 'CLI inspector' },
            ].map((tab) => (
              <button key={tab.id} type="button" className={selectedType === tab.id ? 'active' : undefined} onClick={() => setSelectedType(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>
          <div className="page-heading-actions">
            {projects.length > 0 && (
              <select
                className="form-input"
                value={selectedProjectId}
                onChange={(e) => {
                  const next = e.target.value;
                  setSelectedProjectId(next);
                  if (next) writeActiveProjectId(next);
                }}
                style={{ height: 34, minWidth: 160 }}
              >
                <option value="">All Projects</option>
                {projects.map((project) => (
                  <option key={project._id} value={project._id}>{project.name}</option>
                ))}
              </select>
            )}
            <div style={{ position: 'relative', width: 260 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
              <input
                className="form-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search caches"
                style={{ width: '100%', height: 34, paddingLeft: 30 }}
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="gate-error">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {!loading && filteredCaches.length === 0 && (
          <div className="run-history-empty">
            <Zap size={28} />
            <strong>{searchQuery || selectedType !== 'all' ? 'No matching caches' : 'No cached node results yet'}</strong>
            <span>Enable cache on a node, run the flow, then come back here.</span>
            <Link href={boardHref} className="btn btn-primary">Open flow board</Link>
          </div>
        )}

        {filteredCaches.length > 0 && (
          <div className="cache-grid">
            {filteredCaches.map((item) => {
              const copyKey = `${item.graphId}:${item.nodeId}`;
              return (
                <div key={copyKey} className="cache-card" onClick={() => { setSelectedCache(item); setActiveTab('formatted'); }}>
                  <div className="cache-card-top">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {typeIcon(item.nodeType)}
                      <div>
                        <strong>{item.nodeName || item.nodeId}</strong>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.nodeType || 'node'}</div>
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    <Link href={item.graphId ? `/flow/${encodeURIComponent(item.graphId)}` : '/'} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent-primary)' }}>
                      {item.graphName || item.graphId}
                    </Link>
                  </div>
                  <div className="cache-preview">{previewOf(item)}</div>
                  <div className="cache-card-foot">
                    <span><Clock size={12} /> {formatRelativeTime(item.updatedAt)}</span>
                    <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 4 }}>
                      <span className="icon-btn" onClick={() => handleCopy(JSON.stringify(item.result, null, 2), copyKey)} title="Copy JSON">
                        {copiedId === copyKey ? <Check size={14} /> : <Copy size={14} />}
                      </span>
                      <span className="icon-btn danger" onClick={() => void handleDelete(item)} title="Delete cache">
                        <Trash2 size={14} />
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedCache && (
        <div className="inspector-backdrop" onClick={() => setSelectedCache(null)}>
          <div className="inspector-dialog" onClick={(e) => e.stopPropagation()}>
            <header>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {typeIcon(selectedCache.nodeType, 18)}
                <div>
                  <strong>{selectedCache.nodeName || selectedCache.nodeId}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedCache.graphName || selectedCache.graphId}</div>
                </div>
              </div>
              <div className="page-heading-actions">
                <button type="button" className="btn btn-default" onClick={() => handleCopy(JSON.stringify(selectedCache.result, null, 2), 'modal')}>
                  {copiedId === 'modal' ? <Check size={13} /> : <Copy size={13} />} Copy JSON
                </button>
                <button type="button" className="btn btn-danger" onClick={() => void handleDelete(selectedCache)}>
                  <Trash2 size={13} /> Delete
                </button>
                <button type="button" className="icon-btn" onClick={() => setSelectedCache(null)} aria-label="Close">
                  <X size={16} />
                </button>
              </div>
            </header>
            <div className="inspector-tabs">
              {(['formatted', 'raw', 'input'] as const).map((tab) => (
                <button key={tab} type="button" className={activeTab === tab ? 'active' : undefined} onClick={() => setActiveTab(tab)}>
                  {tab === 'formatted' ? 'Formatted' : tab === 'raw' ? 'Raw output' : 'Node input'}
                </button>
              ))}
            </div>
            <div className="inspector-body">
              {activeTab === 'formatted' && <FormattedCache item={selectedCache} />}
              {activeTab === 'raw' && <pre className="artifact-pre">{JSON.stringify(selectedCache.result, null, 2)}</pre>}
              {activeTab === 'input' && <pre className="artifact-pre">{JSON.stringify(selectedCache.input || {}, null, 2)}</pre>}
            </div>
            <footer>
              <span>Stored with the flow run caches</span>
              {selectedCache.graphId && (
                <Link className="btn btn-default" href={`/flow/${encodeURIComponent(selectedCache.graphId)}`}>Open flow</Link>
              )}
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
