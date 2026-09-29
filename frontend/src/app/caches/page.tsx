'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  Database,
  Zap,
  Bot,
  Globe,
  Terminal,
  Search,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  AlertCircle,
  Clock,
  ExternalLink,
  History,
  FileText,
  Filter,
  X,
  Code,
  Sparkles,
  Layers,
  ChevronRight,
  FolderGit2,
} from 'lucide-react';
import { fetchCaches, deleteNodeCache, clearAllCaches, fetchProjects } from '@/lib/api';
import { NodeCacheItem, Project } from '@/lib/types';

// Helper formatting utilities
const formatBytes = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const formatDate = (value?: string) => {
  if (!value) return '—';
  try {
    const d = new Date(value);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return value;
  }
};

const formatRelativeTime = (value?: string) => {
  if (!value) return '—';
  try {
    const diff = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
    if (diff < 10) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return '—';
  }
};

const getNodeTypeIcon = (type?: string, size = 16) => {
  switch (type?.toLowerCase()) {
    case 'agent':
      return <Bot size={size} style={{ color: '#a855f7' }} />;
    case 'web-search':
      return <Globe size={size} style={{ color: '#06b6d4' }} />;
    case 'repo-inspect':
      return <Terminal size={size} style={{ color: '#10b981' }} />;
    default:
      return <Database size={size} style={{ color: '#f59e0b' }} />;
  }
};

const getNodeTypeBadge = (type?: string) => {
  switch (type?.toLowerCase()) {
    case 'agent':
      return {
        label: 'LLM Agent',
        bg: 'rgba(168, 85, 247, 0.12)',
        border: 'rgba(168, 85, 247, 0.3)',
        color: '#c084fc',
      };
    case 'web-search':
      return {
        label: 'Web Search',
        bg: 'rgba(6, 182, 212, 0.12)',
        border: 'rgba(6, 182, 212, 0.3)',
        color: '#38bdf8',
      };
    case 'repo-inspect':
      return {
        label: 'CLI Repo Inspector',
        bg: 'rgba(16, 185, 129, 0.12)',
        border: 'rgba(16, 185, 129, 0.3)',
        color: '#34d399',
      };
    default:
      return {
        label: type || 'Node',
        bg: 'rgba(245, 158, 11, 0.12)',
        border: 'rgba(245, 158, 11, 0.3)',
        color: '#fbbf24',
      };
  }
};

export default function CachesPage() {
  const [caches, setCaches] = useState<NodeCacheItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCache, setSelectedCache] = useState<NodeCacheItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'formatted' | 'raw' | 'input'>('formatted');

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [cacheData, projectList] = await Promise.all([
        fetchCaches(),
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
    void load();
  }, []);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleDelete = async (item: NodeCacheItem) => {
    if (!window.confirm(`Delete cache for node "${item.nodeName || item.nodeId}" in flow "${item.graphName || item.graphId}"?`)) {
      return;
    }
    try {
      await deleteNodeCache(item.graphId, item.nodeId);
      setCaches((prev) => prev.filter((c) => !(c.graphId === item.graphId && c.nodeId === item.nodeId)));
      if (selectedCache?.graphId === item.graphId && selectedCache?.nodeId === item.nodeId) {
        setSelectedCache(null);
      }
    } catch (err: any) {
      alert(`Failed to delete cache: ${err.message}`);
    }
  };

  const handleClearAll = async () => {
    const msg = selectedProjectId
      ? `Clear all caches for the selected project?`
      : `Are you sure you want to clear ALL cached node results across all flows?`;
    if (!window.confirm(msg)) return;

    try {
      await clearAllCaches();
      setCaches([]);
      setSelectedCache(null);
    } catch (err: any) {
      alert(`Failed to clear caches: ${err.message}`);
    }
  };

  // Filtered caches
  const filteredCaches = useMemo(() => {
    return caches.filter((item) => {
      if (selectedProjectId && item.projectId !== selectedProjectId) return false;
      if (selectedType !== 'all' && item.nodeType?.toLowerCase() !== selectedType.toLowerCase()) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = item.nodeName?.toLowerCase().includes(q);
        const idMatch = item.nodeId?.toLowerCase().includes(q);
        const flowMatch = item.graphName?.toLowerCase().includes(q);
        const typeMatch = item.nodeType?.toLowerCase().includes(q);
        const resultString = JSON.stringify(item.result || {}).toLowerCase();
        const contentMatch = resultString.includes(q);
        return nameMatch || idMatch || flowMatch || typeMatch || contentMatch;
      }
      return true;
    });
  }, [caches, selectedProjectId, selectedType, searchQuery]);

  // Aggregate Stats
  const stats = useMemo(() => {
    let agentCount = 0;
    let webSearchCount = 0;
    let repoInspectCount = 0;
    let totalBytes = 0;

    caches.forEach((c) => {
      if (c.nodeType === 'agent') agentCount++;
      else if (c.nodeType === 'web-search') webSearchCount++;
      else if (c.nodeType === 'repo-inspect') repoInspectCount++;

      const payload = JSON.stringify(c.result || {}) + JSON.stringify(c.input || {});
      totalBytes += payload.length;
    });

    return {
      total: caches.length,
      agentCount,
      webSearchCount,
      repoInspectCount,
      totalBytes,
    };
  }, [caches]);

  // Helper to extract a readable preview string from a node result
  const getResultPreview = (item: NodeCacheItem) => {
    const res = item.result;
    if (!res) return 'No output data recorded';

    if (item.nodeType === 'agent') {
      if (typeof res === 'string') return res;
      if (res.text) return String(res.text);
      if (res.result) {
        return typeof res.result === 'string' ? res.result : JSON.stringify(res.result);
      }
      return JSON.stringify(res);
    }

    if (item.nodeType === 'web-search') {
      if (Array.isArray(res.results)) {
        return `${res.results.length} search results found. Top: ${res.results[0]?.title || res.results[0]?.url || 'Result'}`;
      }
      if (res.text) return `Extracted Article: ${String(res.text).slice(0, 200)}...`;
      if (res.content) return `HTML Cleaned: ${String(res.content).slice(0, 200)}...`;
      return JSON.stringify(res);
    }

    if (item.nodeType === 'repo-inspect') {
      if (res.result?.summary) return res.result.summary;
      if (res.summary) return res.summary;
      if (Array.isArray(res.result?.relevantFiles)) {
        return `Identified ${res.result.relevantFiles.length} relevant files in repository`;
      }
      return JSON.stringify(res);
    }

    return JSON.stringify(res);
  };

  return (
    <div
      style={{
        height: '100vh',
        maxHeight: '100vh',
        overflowY: 'auto',
        overflowX: 'hidden',
        background: 'linear-gradient(180deg, var(--bg-primary, #090d16) 0%, #06080e 100%)',
        color: 'var(--text-primary, #f1f5f9)',
        padding: '28px 36px 60px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        {/* Top Header Bar */}
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 24,
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              type="button"
              className="btn btn-default"
              onClick={() => {
                window.location.href = '/';
              }}
              style={{
                fontSize: 12,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
              }}
            >
              ← Back to Board
            </button>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25) 0%, rgba(217, 119, 6, 0.1) 100%)',
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 0 15px rgba(245, 158, 11, 0.2)',
                  }}
                >
                  <Zap size={18} style={{ color: '#f59e0b' }} />
                </div>
                <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
                  Node Cache Explorer
                </h1>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: 'rgba(245, 158, 11, 0.15)',
                    color: '#fbbf24',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                  }}
                >
                  {caches.length} cached {caches.length === 1 ? 'node' : 'nodes'}
                </span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted, #94a3b8)' }}>
                Persistent result caches for LLM Agent, Web Search, and CLI Repository Inspector nodes.
              </p>
            </div>
          </div>

          {/* Quick links & Top Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="btn btn-default"
              onClick={() => {
                window.location.href = '/runs';
              }}
              style={{ fontSize: 12, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
              title="View Run History"
            >
              <History size={14} /> Runs
            </button>
            <button
              type="button"
              className="btn btn-default"
              onClick={() => {
                window.location.href = '/artifacts';
              }}
              style={{ fontSize: 12, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
              title="View Generated Artifacts & Documents"
            >
              <FileText size={14} /> Documents
            </button>
            <button
              type="button"
              className="btn btn-default"
              onClick={() => void load()}
              disabled={loading}
              style={{ fontSize: 12, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            {caches.length > 0 && (
              <button
                type="button"
                className="btn btn-default"
                onClick={handleClearAll}
                style={{
                  fontSize: 12,
                  padding: '6px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: '#ef4444',
                  borderColor: 'rgba(239, 68, 68, 0.3)',
                }}
                title="Invalidate all stored node caches"
              >
                <Trash2 size={14} /> Clear All
              </button>
            )}
          </div>
        </header>

        {/* Aggregate Metrics Grid */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 14,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.65)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'rgba(245, 158, 11, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f59e0b',
              }}
            >
              <Database size={20} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', fontWeight: 600 }}>
                Total Cached
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>{stats.total}</div>
            </div>
          </div>

          <div
            style={{
              background: 'rgba(15, 23, 42, 0.65)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'rgba(168, 85, 247, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#c084fc',
              }}
            >
              <Bot size={20} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', fontWeight: 600 }}>
                Agent (LLM)
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>{stats.agentCount}</div>
            </div>
          </div>

          <div
            style={{
              background: 'rgba(15, 23, 42, 0.65)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'rgba(6, 182, 212, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38bdf8',
              }}
            >
              <Globe size={20} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', fontWeight: 600 }}>
                Web Search
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>{stats.webSearchCount}</div>
            </div>
          </div>

          <div
            style={{
              background: 'rgba(15, 23, 42, 0.65)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'rgba(16, 185, 129, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#34d399',
              }}
            >
              <Terminal size={20} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', fontWeight: 600 }}>
                CLI Inspector
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>{stats.repoInspectCount}</div>
            </div>
          </div>

          <div
            style={{
              background: 'rgba(15, 23, 42, 0.65)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#94a3b8',
              }}
            >
              <Layers size={20} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', fontWeight: 600 }}>
                Memory Footprint
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>{formatBytes(stats.totalBytes)}</div>
            </div>
          </div>
        </section>

        {/* Filter and Search Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 20,
            flexWrap: 'wrap',
          }}
        >
          {/* Node Type Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: 'All Types' },
              { id: 'agent', label: 'Agent (LLM)', icon: <Bot size={13} /> },
              { id: 'web-search', label: 'Web Search', icon: <Globe size={13} /> },
              { id: 'repo-inspect', label: 'CLI Inspector', icon: <Terminal size={13} /> },
            ].map((tab) => {
              const active = selectedType === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSelectedType(tab.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: active ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : 'rgba(255, 255, 255, 0.05)',
                    color: active ? '#ffffff' : 'var(--text-secondary, #94a3b8)',
                    border: active ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Project & Search Inputs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {projects.length > 0 && (
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="form-input"
                style={{
                  height: 34,
                  fontSize: 12,
                  padding: '4px 10px',
                  borderRadius: 8,
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#f8fafc',
                  minWidth: 160,
                }}
              >
                <option value="">All Projects</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}

            <div style={{ position: 'relative', width: 260 }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted, #94a3b8)',
                  pointerEvents: 'none',
                }}
              />
              <input
                type="text"
                placeholder="Search caches by node, flow, or content..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  height: 34,
                  padding: '4px 28px 4px 30px',
                  fontSize: 12,
                  borderRadius: 8,
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#f8fafc',
                  outline: 'none',
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted, #94a3b8)',
                    cursor: 'pointer',
                    padding: 2,
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div
            style={{
              padding: '14px 18px',
              borderRadius: 10,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 20,
            }}
          >
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredCaches.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '60px 20px',
              background: 'rgba(15, 23, 42, 0.4)',
              borderRadius: 16,
              border: '1px dashed rgba(255, 255, 255, 0.12)',
              marginTop: 10,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'rgba(245, 158, 11, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                color: '#f59e0b',
              }}
            >
              <Zap size={28} />
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 600, color: '#f8fafc', marginBottom: 6 }}>
              {searchQuery || selectedType !== 'all' || selectedProjectId
                ? 'No matching cached nodes found'
                : 'No Cached Node Results Yet'}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted, #94a3b8)', maxWidth: 480, margin: '0 auto 20px', lineHeight: 1.5 }}>
              {searchQuery || selectedType !== 'all' || selectedProjectId
                ? 'Try broadening your search query or switching filters.'
                : 'To cache node outputs, enable "Cache Last Result" in any Agent, Web Search, or Repository Inspector node, then execute the flow. When debugging with "Use Cache" active, the cached output will be reused instantly.'}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                window.location.href = '/';
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                fontSize: 13,
                borderRadius: 8,
              }}
            >
              Open Flow Board
            </button>
          </div>
        )}

        {/* Cached Nodes Grid */}
        {filteredCaches.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
              gap: 16,
            }}
          >
            {filteredCaches.map((item) => {
              const badge = getNodeTypeBadge(item.nodeType);
              const preview = getResultPreview(item);
              const payloadSize = formatBytes(JSON.stringify(item.result || {}).length);
              const isCopied = copiedId === `${item.graphId}:${item.nodeId}`;

              return (
                <div
                  key={`${item.graphId}:${item.nodeId}`}
                  onClick={() => setSelectedCache(item)}
                  style={{
                    background: 'rgba(15, 23, 42, 0.65)',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 12,
                    padding: 18,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.4)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 8px 24px rgba(245, 158, 11, 0.12)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
                  }}
                >
                  <div>
                    {/* Header Row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {getNodeTypeIcon(item.nodeType, 18)}
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>
                            {item.nodeName || item.nodeId}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', fontFamily: 'monospace' }}>
                            ID: {item.nodeId}
                          </div>
                        </div>
                      </div>

                      {/* Type Badge */}
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 6,
                          background: badge.bg,
                          color: badge.color,
                          border: `1px solid ${badge.border}`,
                          textTransform: 'uppercase',
                        }}
                      >
                        {badge.label}
                      </span>
                    </div>

                    {/* Flow name tag */}
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-secondary, #cbd5e1)',
                        marginBottom: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <Layers size={12} style={{ color: 'var(--text-muted, #94a3b8)' }} />
                      <span>Flow: <strong>{item.graphName || item.graphId}</strong></span>
                    </div>

                    {/* Output Preview Snippet */}
                    <div
                      style={{
                        background: 'rgba(0, 0, 0, 0.35)',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        borderRadius: 8,
                        padding: '10px 12px',
                        fontSize: 12,
                        color: 'var(--text-secondary, #cbd5e1)',
                        lineHeight: 1.45,
                        fontFamily: 'monospace',
                        maxHeight: 74,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        marginBottom: 14,
                      }}
                      title="Cached result payload snippet"
                    >
                      {preview}
                    </div>
                  </div>

                  {/* Card Footer Bar */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                      paddingTop: 10,
                      marginTop: 4,
                      fontSize: 11,
                      color: 'var(--text-muted, #94a3b8)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={`Updated: ${formatDate(item.updatedAt)}`}>
                        <Clock size={12} /> {formatRelativeTime(item.updatedAt)}
                      </span>
                      <span>•</span>
                      <span>{payloadSize}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => handleCopy(JSON.stringify(item.result, null, 2), `${item.graphId}:${item.nodeId}`)}
                        title="Copy raw JSON"
                        style={{ padding: 4 }}
                      >
                        {isCopied ? <Check size={14} style={{ color: '#10b981' }} /> : <Copy size={14} />}
                      </button>
                      <button
                        type="button"
                        className="icon-btn danger"
                        onClick={() => handleDelete(item)}
                        title="Delete this node cache"
                        style={{ padding: 4, color: '#ef4444' }}
                      >
                        <Trash2 size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setSelectedCache(item)}
                        title="Inspect full details"
                        style={{ padding: 4 }}
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail Inspector Modal */}
      {selectedCache && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
          onClick={() => setSelectedCache(null)}
        >
          <div
            style={{
              background: '#0d131f',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 16,
              width: '100%',
              maxWidth: 820,
              maxHeight: '88vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '16px 22px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(15, 23, 42, 0.8)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {getNodeTypeIcon(selectedCache.nodeType, 20)}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                      {selectedCache.nodeName || selectedCache.nodeId}
                    </h2>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: getNodeTypeBadge(selectedCache.nodeType).bg,
                        color: getNodeTypeBadge(selectedCache.nodeType).color,
                        border: `1px solid ${getNodeTypeBadge(selectedCache.nodeType).border}`,
                      }}
                    >
                      {selectedCache.nodeType}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', marginTop: 2 }}>
                    Flow: {selectedCache.graphName || selectedCache.graphId} • Node ID: <code>{selectedCache.nodeId}</code>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-default"
                  onClick={() =>
                    handleCopy(
                      JSON.stringify(selectedCache.result, null, 2),
                      `modal-${selectedCache.graphId}:${selectedCache.nodeId}`,
                    )
                  }
                  style={{ fontSize: 11.5, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  {copiedId === `modal-${selectedCache.graphId}:${selectedCache.nodeId}` ? (
                    <>
                      <Check size={13} style={{ color: '#10b981' }} /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy size={13} /> Copy JSON
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-default"
                  onClick={() => handleDelete(selectedCache)}
                  style={{
                    fontSize: 11.5,
                    padding: '4px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    color: '#ef4444',
                    borderColor: 'rgba(239, 68, 68, 0.3)',
                  }}
                >
                  <Trash2 size={13} /> Delete Cache
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCache(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted, #94a3b8)',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Tabs */}
            <div
              style={{
                display: 'flex',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(0, 0, 0, 0.2)',
                padding: '0 16px',
              }}
            >
              {[
                { id: 'formatted', label: 'Formatted View' },
                { id: 'raw', label: 'Raw Output JSON' },
                { id: 'input', label: 'Node Input' },
              ].map((t) => {
                const active = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTab(t.id as any)}
                    style={{
                      padding: '10px 16px',
                      fontSize: 12,
                      fontWeight: active ? 600 : 400,
                      color: active ? '#f59e0b' : 'var(--text-secondary, #94a3b8)',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: active ? '2px solid #f59e0b' : '2px solid transparent',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Modal Content Body */}
            <div style={{ padding: 22, overflowY: 'auto', flex: 1 }}>
              {activeTab === 'formatted' && (
                <div>
                  {selectedCache.nodeType === 'agent' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {selectedCache.result?.text && (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                            Text Response:
                          </div>
                          <div
                            style={{
                              background: 'rgba(0, 0, 0, 0.3)',
                              border: '1px solid rgba(255, 255, 255, 0.06)',
                              borderRadius: 8,
                              padding: 14,
                              fontSize: 13,
                              lineHeight: 1.6,
                              whiteSpace: 'pre-wrap',
                              color: '#f1f5f9',
                            }}
                          >
                            {selectedCache.result.text}
                          </div>
                        </div>
                      )}

                      {selectedCache.result?.reasoning && (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b', marginBottom: 6 }}>
                            Thinking / Reasoning Trace:
                          </div>
                          <div
                            style={{
                              background: 'rgba(245, 158, 11, 0.05)',
                              border: '1px solid rgba(245, 158, 11, 0.2)',
                              borderRadius: 8,
                              padding: 12,
                              fontSize: 12,
                              lineHeight: 1.5,
                              color: '#fde68a',
                              fontFamily: 'monospace',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {selectedCache.result.reasoning}
                          </div>
                        </div>
                      )}

                      {Array.isArray(selectedCache.result?.toolCalls) && selectedCache.result.toolCalls.length > 0 && (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#06b6d4', marginBottom: 6 }}>
                            Autonomous Tool Calls ({selectedCache.result.toolCalls.length}):
                          </div>
                          <pre
                            style={{
                              background: 'rgba(0, 0, 0, 0.4)',
                              border: '1px solid rgba(255, 255, 255, 0.06)',
                              borderRadius: 8,
                              padding: 12,
                              fontSize: 11.5,
                              overflowX: 'auto',
                              color: '#7dd3fc',
                            }}
                          >
                            {JSON.stringify(selectedCache.result.toolCalls, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {selectedCache.nodeType === 'web-search' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {Array.isArray(selectedCache.result?.results) && (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
                            Search Results ({selectedCache.result.results.length}):
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {selectedCache.result.results.map((r: any, idx: number) => (
                              <div
                                key={idx}
                                style={{
                                  background: 'rgba(0, 0, 0, 0.3)',
                                  border: '1px solid rgba(255, 255, 255, 0.06)',
                                  borderRadius: 8,
                                  padding: '10px 14px',
                                }}
                              >
                                <a
                                  href={r.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: '#38bdf8',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    textDecoration: 'none',
                                  }}
                                >
                                  {r.title || r.url} <ExternalLink size={12} />
                                </a>
                                {r.snippet && (
                                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary, #cbd5e1)', lineHeight: 1.45 }}>
                                    {r.snippet}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedCache.result?.text && !selectedCache.result?.results && (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                            Article Content:
                          </div>
                          <div
                            style={{
                              background: 'rgba(0, 0, 0, 0.3)',
                              border: '1px solid rgba(255, 255, 255, 0.06)',
                              borderRadius: 8,
                              padding: 14,
                              fontSize: 12.5,
                              lineHeight: 1.5,
                              whiteSpace: 'pre-wrap',
                              color: '#f1f5f9',
                              maxHeight: 400,
                              overflowY: 'auto',
                            }}
                          >
                            {selectedCache.result.text}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {selectedCache.nodeType === 'repo-inspect' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {selectedCache.result?.result?.summary && (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                            Codebase Summary:
                          </div>
                          <div
                            style={{
                              background: 'rgba(0, 0, 0, 0.3)',
                              border: '1px solid rgba(255, 255, 255, 0.06)',
                              borderRadius: 8,
                              padding: 14,
                              fontSize: 13,
                              lineHeight: 1.5,
                              color: '#f1f5f9',
                            }}
                          >
                            {selectedCache.result.result.summary}
                          </div>
                        </div>
                      )}

                      {Array.isArray(selectedCache.result?.result?.relevantFiles) && (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#10b981', marginBottom: 6 }}>
                            Relevant Files ({selectedCache.result.result.relevantFiles.length}):
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {selectedCache.result.result.relevantFiles.map((f: string, fIdx: number) => (
                              <span
                                key={fIdx}
                                style={{
                                  fontSize: 11,
                                  fontFamily: 'monospace',
                                  background: 'rgba(16, 185, 129, 0.1)',
                                  border: '1px solid rgba(16, 185, 129, 0.25)',
                                  color: '#34d399',
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                }}
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Fallback for raw objects without dedicated custom layout */}
                  {selectedCache.nodeType !== 'agent' &&
                    selectedCache.nodeType !== 'web-search' &&
                    selectedCache.nodeType !== 'repo-inspect' && (
                      <pre
                        style={{
                          background: 'rgba(0, 0, 0, 0.4)',
                          border: '1px solid rgba(255, 255, 255, 0.06)',
                          borderRadius: 8,
                          padding: 14,
                          fontSize: 12,
                          overflowX: 'auto',
                          color: '#f8fafc',
                        }}
                      >
                        {JSON.stringify(selectedCache.result, null, 2)}
                      </pre>
                    )}
                </div>
              )}

              {activeTab === 'raw' && (
                <pre
                  style={{
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: 8,
                    padding: 14,
                    fontSize: 12,
                    overflowX: 'auto',
                    color: '#f8fafc',
                    fontFamily: 'monospace',
                    margin: 0,
                  }}
                >
                  {JSON.stringify(selectedCache.result, null, 2)}
                </pre>
              )}

              {activeTab === 'input' && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)', marginBottom: 8 }}>
                    Parameters and inputs passed to this node at the time of execution:
                  </div>
                  <pre
                    style={{
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: 8,
                      padding: 14,
                      fontSize: 12,
                      overflowX: 'auto',
                      color: '#cbd5e1',
                      fontFamily: 'monospace',
                      margin: 0,
                    }}
                  >
                    {JSON.stringify(selectedCache.input || {}, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '12px 22px',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(15, 23, 42, 0.8)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 11,
                color: 'var(--text-muted, #94a3b8)',
              }}
            >
              <span>Saved in MongoDB collection <code>node_caches</code></span>
              <button
                type="button"
                className="btn btn-default"
                onClick={() => setSelectedCache(null)}
                style={{ fontSize: 11, padding: '4px 12px' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
