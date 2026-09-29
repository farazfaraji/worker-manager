'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  FileText,
  Search,
  Filter,
  RefreshCw,
  ArrowLeft,
  Copy,
  Check,
  Download,
  Trash2,
  Calendar,
  Layers,
  CheckCircle2,
  Clock,
  Archive,
  Code,
  Eye,
  Terminal,
  PlusCircle,
  Pencil,
  Save,
  AlertCircle,
  Tag,
  Hash,
  GitBranch,
  Link2,
  ShieldCheck,
  History,
  Key,
} from 'lucide-react';
import {
  fetchProjects,
  fetchArtifacts,
  deleteArtifact,
  createArtifact,
  updateArtifact,
  approveArtifact,
  fetchArtifactVersions,
  fetchArtifactRelations,
  createArtifactRelation,
  deleteArtifactRelation,
} from '@/lib/api';
import { ArtifactItem, ArtifactRelationItem, Project } from '@/lib/types';
import { MarkdownViewer } from '@/components/artifacts/MarkdownViewer';

const TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  'high-level': { label: 'High-Level Concept', color: '#0284c7', bg: '#e0f2fe' },
  prd: { label: 'Product Spec (PRD)', color: '#4338ca', bg: '#e0e7ff' },
  'tech-spec': { label: 'Tech Spec', color: '#0369a1', bg: '#e0f2fe' },
  task: { label: 'Task / Plan', color: '#15803d', bg: '#dcfce7' },
  decision: { label: 'Decision', color: '#b45309', bg: '#fef3c7' },
  change: { label: 'Change Request', color: '#7e22ce', bg: '#f3e8ff' },
  document: { label: 'Document', color: '#4b5563', bg: '#f3f4f6' },
  code: { label: 'Code / Patch', color: '#0f766e', bg: '#ccfbf1' },
};

const STATUS_ICONS: Record<string, { icon: any; color: string; label: string }> = {
  draft: { icon: Clock, color: '#eab308', label: 'Draft' },
  'in-review': { icon: Clock, color: '#2563eb', label: 'In review' },
  approved: { icon: CheckCircle2, color: '#10b981', label: 'Approved' },
  rejected: { icon: AlertCircle, color: '#dc2626', label: 'Rejected' },
  archived: { icon: Archive, color: '#94a3b8', label: 'Archived' },
};

export function ArtifactsView() {
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [latestOnly, setLatestOnly] = useState<boolean>(true);

  // Selected item for full content display
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'rendered' | 'raw'>('rendered');
  const [activeTab, setActiveTab] = useState<'content' | 'versions' | 'relations'>('content');
  const [editingArtifactId, setEditingArtifactId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [savingArtifact, setSavingArtifact] = useState(false);

  // Related data for selected artifact
  const [versions, setVersions] = useState<ArtifactItem[]>([]);
  const [relations, setRelations] = useState<ArtifactRelationItem[]>([]);
  const [loadingRelations, setLoadingRelations] = useState<boolean>(false);

  // New relation form state
  const [targetLogicalId, setTargetLogicalId] = useState<string>('');
  const [newRelationType, setNewRelationType] = useState<string>('relates-to');
  const [submittingRelation, setSubmittingRelation] = useState<boolean>(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [items, projList] = await Promise.all([
        fetchArtifacts({ latestOnly, projectId: selectedProjectId || undefined }),
        fetchProjects().catch(() => []),
      ]);
      setArtifacts(items);
      setProjects(projList);
      if (items.length > 0 && !selectedId) {
        setSelectedId(items[0].artifactId);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load artifacts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [latestOnly, selectedProjectId]);

  // Filtered items
  const filteredArtifacts = useMemo(() => {
    return artifacts.filter((item) => {
      if (selectedType && item.type !== selectedType) return false;
      if (selectedStatus && item.status !== selectedStatus) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const titleMatch = (item.title || '').toLowerCase().includes(q);
        const idMatch = (item.artifactId || '').toLowerCase().includes(q);
        const logicalMatch = (item.logicalId || '').toLowerCase().includes(q);
        const typeMatch = (item.type || '').toLowerCase().includes(q);
        const categoryMatch = (item.category || '').toLowerCase().includes(q);
        const tagMatch = (item.tags || []).some((tag) => String(tag).toLowerCase().includes(q));
        if (!titleMatch && !idMatch && !logicalMatch && !typeMatch && !categoryMatch && !tagMatch) return false;
      }
      return true;
    });
  }, [artifacts, searchQuery, selectedType, selectedStatus]);

  // Selected artifact
  const currentArtifact = useMemo(() => {
    if (!selectedId) return filteredArtifacts[0] || null;
    return artifacts.find((a) => a.artifactId === selectedId) || filteredArtifacts[0] || null;
  }, [artifacts, selectedId, filteredArtifacts]);

  // Fetch versions and relations when currentArtifact changes
  useEffect(() => {
    if (!currentArtifact) {
      setVersions([]);
      setRelations([]);
      return;
    }

    const logicalId = currentArtifact.logicalId || currentArtifact.artifactId;

    // Load versions
    fetchArtifactVersions(logicalId, currentArtifact.projectId)
      .then((data) => setVersions(data || []))
      .catch(() => setVersions([]));

    // Load relations
    setLoadingRelations(true);
    fetchArtifactRelations(logicalId, 'both', currentArtifact.projectId)
      .then((data) => setRelations(data || []))
      .catch(() => setRelations([]))
      .finally(() => setLoadingRelations(false));
  }, [currentArtifact?.artifactId, currentArtifact?.logicalId]);

  // Copy helper
  const handleCopy = (text: any, fieldKey: string) => {
    const str = typeof text === 'object' ? JSON.stringify(text, null, 2) : String(text || '');
    navigator.clipboard.writeText(str);
    setCopiedField(fieldKey);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Download whole content
  const handleDownload = (artifact: ArtifactItem) => {
    const isJson = artifact.format === 'json' || typeof artifact.content === 'object';
    const ext = isJson ? 'json' : artifact.format === 'code' ? 'txt' : 'md';
    const mime = isJson ? 'application/json' : 'text/markdown';
    const text = isJson ? JSON.stringify(artifact.content, null, 2) : String(artifact.content || '');

    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.logicalId || artifact.artifactId || 'artifact'}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveContent = async (artifact: ArtifactItem) => {
    try {
      setSavingArtifact(true);
      setError(null);
      const updated = await updateArtifact(artifact.artifactId, {
        projectId: artifact.projectId,
        content: editContent,
        status: 'draft',
      });
      await loadData();
      setSelectedId(updated.artifactId);
      setEditingArtifactId(null);
    } catch (err: any) {
      setError(err.message || 'Failed to save artifact');
    } finally {
      setSavingArtifact(false);
    }
  };

  const handleApprove = async (artifact: ArtifactItem) => {
    try {
      setSavingArtifact(true);
      setError(null);
      const approved = await approveArtifact(artifact.artifactId);
      await loadData();
      setSelectedId(approved.artifactId);
    } catch (err: any) {
      setError(err.message || 'Failed to approve artifact');
    } finally {
      setSavingArtifact(false);
    }
  };

  // Delete an artifact
  const handleDelete = async (artifact: ArtifactItem) => {
    if (!window.confirm(`Are you sure you want to delete artifact "${artifact.title || artifact.artifactId}"?`)) {
      return;
    }
    try {
      await deleteArtifact(artifact.artifactId);
      const nextList = artifacts.filter((a) => a.artifactId !== artifact.artifactId);
      setArtifacts(nextList);
      if (selectedId === artifact.artifactId) {
        setSelectedId(nextList[0]?.artifactId || null);
      }
    } catch (err: any) {
      window.alert(`Error deleting artifact: ${err.message}`);
    }
  };

  // Add typed relation
  const handleAddRelation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentArtifact || !targetLogicalId.trim()) return;

    try {
      setSubmittingRelation(true);
      const res = await createArtifactRelation(currentArtifact.logicalId || currentArtifact.artifactId, {
        targetLogicalId: targetLogicalId.trim(),
        relationType: newRelationType,
        projectId: currentArtifact.projectId,
      });

      const updatedRelations = await fetchArtifactRelations(
        currentArtifact.logicalId || currentArtifact.artifactId,
        'both',
        currentArtifact.projectId,
      );
      setRelations(updatedRelations);
      setTargetLogicalId('');
    } catch (err: any) {
      window.alert(`Failed to add relation: ${err.message}`);
    } finally {
      setSubmittingRelation(false);
    }
  };

  // Remove typed relation
  const handleRemoveRelation = async (relId: string) => {
    if (!currentArtifact) return;
    if (!window.confirm('Delete this relation and its inverse?')) return;

    try {
      await deleteArtifactRelation(
        currentArtifact.logicalId || currentArtifact.artifactId,
        relId,
        currentArtifact.projectId,
      );
      setRelations(relations.filter((r) => r.relationId !== relId));
    } catch (err: any) {
      window.alert(`Failed to remove relation: ${err.message}`);
    }
  };

  // Create sample artifact if empty
  const handleCreateSample = async () => {
    try {
      const sample = await createArtifact({
        artifactId: `doc-${Date.now().toString().slice(-4)}`,
        logicalId: `system-arch-spec`,
        title: 'System Architecture Specification',
        type: 'tech-spec',
        category: 'architecture',
        tags: ['microservices', 'vector-rag', 'retrieval', 'api-gateway'],
        format: 'markdown',
        content: `# System Architecture Specification\n\n## Overview\nThis artifact documents the microservice boundaries, event pipelines, and storage engines.\n\n### Key Components\n1. **API Gateway**: Handles authentication and routing.\n2. **Workflow Orchestrator**: LangGraph state machine.\n3. **Artifact Repository**: Persistent store for documents & PRDs with logical identity.\n\n\`\`\`json\n{\n  \"service\": \"flow-builder\",\n  \"status\": \"healthy\",\n  \"version\": \"1.0.0\"\n}\n\`\`\`\n\n> This document was generated automatically by the flow tool builder.`,
      });
      setArtifacts([sample, ...artifacts]);
      setSelectedId(sample.artifactId);
    } catch (err: any) {
      window.alert(`Failed to create sample: ${err.message}`);
    }
  };

  const renderContentBody = (artifact: ArtifactItem) => {
    const rawText =
      typeof artifact.content === 'object'
        ? JSON.stringify(artifact.content, null, 2)
        : String(artifact.content ?? '');

    if (viewMode === 'raw') {
      return (
        <div className="artifact-raw-view">
          <pre className="artifact-pre">
            <code>{rawText}</code>
          </pre>
        </div>
      );
    }

    if (artifact.format === 'json' || typeof artifact.content === 'object') {
      return (
        <div className="artifact-json-view">
          <pre className="artifact-pre json-pre">
            <code>{rawText}</code>
          </pre>
        </div>
      );
    }

    if (artifact.format === 'code') {
      return (
        <div className="artifact-code-view">
          <pre className="artifact-pre code-pre">
            <code>{rawText}</code>
          </pre>
        </div>
      );
    }

    // Default to markdown
    return <MarkdownViewer content={rawText} />;
  };

  return (
    <div className="artifacts-page-container">
      {/* Top Navigation Bar */}
      <header className="artifacts-header">
        <div className="artifacts-header-left">
          <button
            type="button"
            className="btn btn-default"
            onClick={() => {
              window.location.href = '/';
            }}
            title="Return to Flow Studio Board"
          >
            <ArrowLeft size={16} />
            <span>Board</span>
          </button>

          <div className="artifacts-header-title-block">
            <div className="artifacts-title-row">
              <FileText size={20} className="artifacts-brand-icon" />
              <h1 className="artifacts-title">Documents & Artifacts</h1>
              <span className="artifacts-count-pill">{artifacts.length}</span>
            </div>
            <p className="artifacts-subtitle">
              Browse versioned logical artifacts, immutable history, and bidirectional semantic relations.
            </p>
          </div>
        </div>

        <div className="artifacts-header-right">
          <button
            type="button"
            className="btn btn-default"
            onClick={() => void loadData()}
            disabled={loading}
            title="Refresh artifacts list"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          {artifacts.length === 0 && !loading && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCreateSample}
              title="Create a sample artifact document"
            >
              <PlusCircle size={15} />
              <span>Create Sample Doc</span>
            </button>
          )}
        </div>
      </header>

      {/* Filter Toolbar */}
      <div className="artifacts-filter-bar">
        {/* Search */}
        <div className="artifacts-search-box">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            className="artifacts-search-input"
            placeholder="Search by title, logical ID, category, or tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearchQuery('')}
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {/* Latest Only Toggle */}
        <label className="artifacts-checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={latestOnly}
            onChange={(e) => setLatestOnly(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <span>Latest Only</span>
        </label>

        {/* Project Filter */}
        {projects.length > 0 && (
          <div className="artifacts-filter-group">
            <select
              className="artifacts-filter-select"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              aria-label="Filter by Project"
            >
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Type Filter */}
        <div className="artifacts-filter-group">
          <Filter size={14} className="filter-icon" />
          <select
            className="artifacts-filter-select"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            aria-label="Filter by Type"
          >
            <option value="">All Document Types</option>
            <option value="high-level">High-Level Concept</option>
            <option value="prd">Product Spec (PRD)</option>
            <option value="tech-spec">Technical Spec</option>
            <option value="task">Task / Plan</option>
            <option value="decision">Decision</option>
            <option value="change">Change Request</option>
            <option value="document">General Document</option>
            <option value="code">Code / Patch</option>
          </select>
        </div>

        {/* Status Filter */}
        <div className="artifacts-filter-group">
          <select
            className="artifacts-filter-select"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            aria-label="Filter by Status"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="in-review">In review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {/* Quick Filter Reset */}
        {(selectedType || selectedStatus || searchQuery || !latestOnly) && (
          <button
            type="button"
            className="btn btn-subtle"
            onClick={() => {
              setSelectedType('');
              setSelectedStatus('');
              setSearchQuery('');
              setLatestOnly(true);
            }}
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Main Content: Split Master-Detail */}
      <div className="artifacts-split-layout">
        {/* Left Master List */}
        <div className="artifacts-master-list">
          {error && (
            <div className="artifacts-error-card">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          {!loading && filteredArtifacts.length === 0 && (
            <div className="artifacts-empty-list">
              <FileText size={32} strokeWidth={1.5} />
              <h4>No artifacts found</h4>
              <p>
                {searchQuery || selectedType || selectedStatus
                  ? 'No documents match the current filter criteria.'
                  : 'Flows using the Artifact tool will automatically register documents here.'}
              </p>
              {artifacts.length === 0 && (
                <button
                  type="button"
                  className="btn btn-default"
                  style={{ marginTop: 12 }}
                  onClick={handleCreateSample}
                >
                  <PlusCircle size={14} />
                  <span>Generate Sample Artifact</span>
                </button>
              )}
            </div>
          )}

          {filteredArtifacts.map((artifact) => {
            const isSelected = currentArtifact?.artifactId === artifact.artifactId;
            const typeInfo = TYPE_LABELS[artifact.type] || {
              label: artifact.type || 'Custom',
              color: '#6366f1',
              bg: '#eef2ff',
            };
            const statusInfo = STATUS_ICONS[artifact.status] || STATUS_ICONS.draft;
            const StatusIcon = statusInfo.icon;
            const preview =
              typeof artifact.content === 'object'
                ? JSON.stringify(artifact.content).slice(0, 100)
                : String(artifact.content || '').slice(0, 100);

            return (
              <div
                key={artifact.artifactId}
                className={`artifact-list-card ${isSelected ? 'selected' : ''}`}
                onClick={() => setSelectedId(artifact.artifactId)}
              >
                <div className="artifact-card-header">
                  <span
                    className="artifact-type-chip"
                    style={{ color: typeInfo.color, background: typeInfo.bg }}
                  >
                    {typeInfo.label}
                  </span>
                  <span className="artifact-version-chip">v{artifact.version || 1}</span>
                  {artifact.isLatest !== false && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: '#059669',
                        background: '#d1fae5',
                        padding: '1px 5px',
                        borderRadius: 3,
                      }}
                    >
                      LATEST
                    </span>
                  )}
                  <span
                    className="artifact-status-chip"
                    style={{ color: statusInfo.color }}
                  >
                    <StatusIcon size={12} />
                    {statusInfo.label}
                  </span>
                </div>

                <h3 className="artifact-card-title">{artifact.title || 'Untitled Artifact'}</h3>

                <div className="artifact-card-id" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <code style={{ fontSize: 11, color: '#334155' }}>
                    {artifact.logicalId ? `ID: ${artifact.logicalId}` : artifact.artifactId}
                  </code>
                </div>

                {preview && <p className="artifact-card-preview">{preview}...</p>}

                {/* Keywords preview pills in card */}
                {(artifact.category || (artifact.tags || []).length > 0) && (
                  <div className="artifact-card-keywords">
                    {artifact.category && (
                      <span className="artifact-card-kw-pill">{artifact.category}</span>
                    )}
                    {(artifact.tags || []).slice(0, 3).map((tag: string, i: number) => (
                      <span key={i} className="artifact-card-kw-pill">#{tag}</span>
                    ))}
                    {(artifact.tags || []).length > 3 && (
                      <span className="artifact-card-kw-more">+{(artifact.tags || []).length - 3}</span>
                    )}
                  </div>
                )}

                <div className="artifact-card-footer">
                  <span className="artifact-card-date">
                    <Calendar size={12} />
                    {artifact.updatedAt ? new Date(artifact.updatedAt).toLocaleDateString() : 'Recent'}
                  </span>
                  <span className="artifact-card-format">{artifact.format || 'markdown'}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Detail Panel: Full Content Inspector */}
        <div className="artifacts-detail-panel">
          {currentArtifact ? (
            <div className="artifact-detail-wrapper">
              {/* Detail Header */}
              <div className="artifact-detail-header">
                <div className="artifact-detail-meta-left">
                  <div className="artifact-detail-tag-row">
                    <span
                      className="artifact-type-chip"
                      style={{
                        color: (TYPE_LABELS[currentArtifact.type] || {}).color || '#6366f1',
                        background: (TYPE_LABELS[currentArtifact.type] || {}).bg || '#eef2ff',
                        padding: '4px 10px',
                        fontSize: 12,
                      }}
                    >
                      {(TYPE_LABELS[currentArtifact.type] || {}).label || currentArtifact.type}
                    </span>

                    <span className="artifact-version-chip" style={{ fontSize: 12, padding: '3px 8px' }}>
                      Version {currentArtifact.version || 1}
                    </span>

                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: currentArtifact.isLatest !== false ? '#d1fae5' : '#f1f5f9',
                        color: currentArtifact.isLatest !== false ? '#065f46' : '#64748b',
                      }}
                    >
                      {currentArtifact.isLatest !== false ? 'LATEST VERSION' : 'HISTORICAL VERSION'}
                    </span>

                    <span
                      className="artifact-status-chip"
                      style={{
                        color: (STATUS_ICONS[currentArtifact.status] || STATUS_ICONS.draft).color,
                        fontSize: 12,
                      }}
                    >
                      {currentArtifact.status.toUpperCase()}
                    </span>

                    {currentArtifact.projectId && (
                      <span className="artifact-project-chip">
                        Project: {currentArtifact.projectId}
                      </span>
                    )}
                  </div>

                  <h2 className="artifact-detail-title">{currentArtifact.title || 'Untitled Document'}</h2>

                  {/* Dual Identity Bar */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    {currentArtifact.logicalId && (
                      <div className="artifact-id-bar">
                        <span className="artifact-id-label">Logical ID:</span>
                        <code className="artifact-id-code" style={{ background: '#e0f2fe', color: '#0369a1' }}>
                          {currentArtifact.logicalId}
                        </code>
                        <button
                          type="button"
                          className="artifact-icon-action"
                          onClick={() => handleCopy(currentArtifact.logicalId, 'logicalId')}
                          title="Copy Logical ID"
                        >
                          {copiedField === 'logicalId' ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                        </button>
                      </div>
                    )}

                    <div className="artifact-id-bar">
                      <span className="artifact-id-label">Version ID:</span>
                      <code className="artifact-id-code">{currentArtifact.artifactId}</code>
                      <button
                        type="button"
                        className="artifact-icon-action"
                        onClick={() => handleCopy(currentArtifact.artifactId, 'artifactId')}
                        title="Copy Version Artifact ID"
                      >
                        {copiedField === 'artifactId' ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                      </button>

                      {currentArtifact.rootArtifactId && currentArtifact.rootArtifactId !== currentArtifact.artifactId && (
                        <span className="artifact-parent-ref">
                          (Root: <code>{currentArtifact.rootArtifactId}</code>)
                        </span>
                      )}

                      {currentArtifact.parentArtifactId && (
                        <span className="artifact-parent-ref">
                          (Parent: <code>{currentArtifact.parentArtifactId}</code>)
                        </span>
                      )}
                    </div>

                    {currentArtifact.contentHash && (
                      <div className="artifact-id-bar">
                        <span className="artifact-id-label">Content Hash:</span>
                        <code className="artifact-id-code" style={{ fontSize: 11 }}>
                          {currentArtifact.contentHash.slice(0, 16)}...
                        </code>
                        <button
                          type="button"
                          className="artifact-icon-action"
                          onClick={() => handleCopy(currentArtifact.contentHash, 'contentHash')}
                          title="Copy SHA-256 Hash"
                        >
                          {copiedField === 'contentHash' ? <Check size={14} color="#10b981" /> : <Key size={13} />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Header Action Buttons */}
                <div className="artifact-detail-actions">
                  {(currentArtifact.format === 'markdown' || currentArtifact.format === 'text') && currentArtifact.isLatest !== false && (
                    editingArtifactId === currentArtifact.artifactId ? (
                      <>
                        <button type="button" className="btn btn-primary" disabled={savingArtifact || !editContent.trim()} onClick={() => void handleSaveContent(currentArtifact)}>
                          <Save size={14} /><span>Save New Version</span>
                        </button>
                        <button type="button" className="btn btn-default" disabled={savingArtifact} onClick={() => setEditingArtifactId(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-default" onClick={() => { setEditingArtifactId(currentArtifact.artifactId); setEditContent(String(currentArtifact.content || '')); setActiveTab('content'); }}>
                        <Pencil size={14} /><span>Edit</span>
                      </button>
                    )
                  )}
                  {currentArtifact.status === 'draft' && currentArtifact.isLatest !== false && editingArtifactId !== currentArtifact.artifactId && (
                    <button type="button" className="btn btn-primary" disabled={savingArtifact || !String(currentArtifact.content || '').trim() || (currentArtifact.logicalId === 'seacher-project-brief' && String(currentArtifact.content || '').includes('TODO'))} onClick={() => void handleApprove(currentArtifact)} title="Approve this version for use by project workflows">
                      <CheckCircle2 size={14} /><span>Approve</span>
                    </button>
                  )}
                  <div className="view-mode-toggle">
                    <button
                      type="button"
                      className={`view-mode-btn ${viewMode === 'rendered' ? 'active' : ''}`}
                      onClick={() => setViewMode('rendered')}
                      title="Rich rendered view"
                    >
                      <Eye size={14} />
                      <span>Preview</span>
                    </button>
                    <button
                      type="button"
                      className={`view-mode-btn ${viewMode === 'raw' ? 'active' : ''}`}
                      onClick={() => setViewMode('raw')}
                      title="Raw content view"
                    >
                      <Code size={14} />
                      <span>Raw</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    className="btn btn-default"
                    onClick={() => handleCopy(currentArtifact.content, 'content')}
                    title="Copy full content to clipboard"
                  >
                    {copiedField === 'content' ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                    <span>{copiedField === 'content' ? 'Copied' : 'Copy'}</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-default"
                    onClick={() => handleDownload(currentArtifact)}
                    title="Download document file"
                  >
                    <Download size={14} />
                    <span>Download</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-default btn-danger-hover"
                    onClick={() => handleDelete(currentArtifact)}
                    title="Delete artifact"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Navigation Tabs for Inspector */}
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', margin: '16px 24px 0 24px', gap: 12 }}>
                <button
                  type="button"
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: 13,
                    color: activeTab === 'content' ? 'var(--accent-primary)' : 'var(--text-muted)',
                    borderBottom: activeTab === 'content' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                  }}
                  onClick={() => setActiveTab('content')}
                >
                  Document Content
                </button>
                <button
                  type="button"
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: 13,
                    color: activeTab === 'versions' ? 'var(--accent-primary)' : 'var(--text-muted)',
                    borderBottom: activeTab === 'versions' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                  }}
                  onClick={() => setActiveTab('versions')}
                >
                  Version History ({versions.length || 1})
                </button>
                <button
                  type="button"
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: 13,
                    color: activeTab === 'relations' ? 'var(--accent-primary)' : 'var(--text-muted)',
                    borderBottom: activeTab === 'relations' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                  }}
                  onClick={() => setActiveTab('relations')}
                >
                  Typed Relations ({relations.length})
                </button>
              </div>

              {/* TAB 1: Document Content */}
              {activeTab === 'content' && (
                <>
                  {/* Search & Retrieval Keywords Section */}
                  <div className="artifact-keywords-panel">
                    <div className="artifact-keywords-header">
                      <div className="artifact-keywords-header-title">
                        <Tag size={15} />
                        <span>Category and tags</span>
                        <span className="artifact-keywords-count">
                          {currentArtifact.category || 'general'}
                        </span>
                      </div>
                      <div className="artifact-retrieval-badge">
                        <Search size={12} />
                        <span>Semantic Vector Indexed (400w chunks)</span>
                      </div>
                    </div>

                    <div className="artifact-keywords-body">
                      {((currentArtifact.tags || []) as string[]).length > 0 ? (
                        <div className="artifact-keywords-chips">
                          {((currentArtifact.tags || []) as string[]).map((tag: string, idx: number) => (
                            <button
                              key={idx}
                              type="button"
                              className="artifact-keyword-tag"
                              onClick={() => setSearchQuery(tag)}
                              title={`Filter artifacts by tag "${tag}"`}
                            >
                              <Hash size={12} />
                              <span>{tag}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="artifact-no-keywords">
                          No tags yet. Category is the subject folder. Tags are optional extra labels for search.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Scrollable Content Body */}
                  <div className="artifact-content-container">
                    {editingArtifactId === currentArtifact.artifactId ? (
                      <textarea
                        className="form-textarea"
                        aria-label="Artifact content"
                        value={editContent}
                        onChange={(event) => setEditContent(event.target.value)}
                        style={{ width: '100%', minHeight: 480, resize: 'vertical', fontFamily: 'monospace' }}
                      />
                    ) : renderContentBody(currentArtifact)}
                  </div>
                </>
              )}

              {/* TAB 2: Version History */}
              {activeTab === 'versions' && (
                <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                      Immutable Revisions for <code>{currentArtifact.logicalId || currentArtifact.artifactId}</code>
                    </h3>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Total Versions: {versions.length}
                    </span>
                  </div>

                  {versions.map((ver) => {
                    const isSelectedVer = ver.artifactId === currentArtifact.artifactId;
                    return (
                      <div
                        key={ver.artifactId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '12px 16px',
                          border: isSelectedVer ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                          background: isSelectedVer ? '#f8fafc' : '#ffffff',
                          borderRadius: 6,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span
                            style={{
                              background: '#f1f5f9',
                              color: '#1e293b',
                              fontSize: 12,
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 4,
                            }}
                          >
                            v{ver.version || 1}
                          </span>

                          {ver.isLatest !== false && (
                            <span
                              style={{
                                background: '#d1fae5',
                                color: '#065f46',
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '1px 6px',
                                borderRadius: 4,
                              }}
                            >
                              LATEST
                            </span>
                          )}

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                              {ver.title || 'Untitled'}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              Artifact ID: <code>{ver.artifactId}</code>
                              {ver.contentHash && ` • Hash: ${ver.contentHash.slice(0, 12)}...`}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {ver.updatedAt ? new Date(ver.updatedAt).toLocaleString() : ''}
                          </span>
                          {!isSelectedVer ? (
                            <button
                              type="button"
                              className="btn btn-default"
                              style={{ fontSize: 12, padding: '4px 10px' }}
                              onClick={() => setSelectedId(ver.artifactId)}
                            >
                              Inspect
                            </button>
                          ) : (
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-primary)' }}>
                              Viewing
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* TAB 3: Typed Relations */}
              {activeTab === 'relations' && (
                <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Add Relation Form */}
                  <form
                    onSubmit={handleAddRelation}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: 12,
                      background: '#f8fafc',
                      border: '1px solid var(--border-color)',
                      borderRadius: 6,
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Connect:</span>

                    <select
                      value={newRelationType}
                      onChange={(e) => setNewRelationType(e.target.value)}
                      className="artifacts-filter-select"
                      style={{ fontSize: 13 }}
                    >
                      <option value="refines">refines (refined-by)</option>
                      <option value="has-techspec">has-techspec (techspec-for)</option>
                      <option value="decomposes-to">decomposes-to (decomposed-from)</option>
                      <option value="depends-on">depends-on (required-by)</option>
                      <option value="constrains">constrains (constrained-by)</option>
                      <option value="derived-from">derived-from (source-of)</option>
                      <option value="conflicts-with">conflicts-with</option>
                      <option value="relates-to">relates-to</option>
                    </select>

                    <input
                      type="text"
                      placeholder="Target Logical ID..."
                      value={targetLogicalId}
                      onChange={(e) => setTargetLogicalId(e.target.value)}
                      className="artifacts-search-input"
                      style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
                      required
                    />

                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={submittingRelation || !targetLogicalId.trim()}
                      style={{ fontSize: 13 }}
                    >
                      Add Relation
                    </button>
                  </form>

                  {/* Relations List */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {relations.length === 0 && !loadingRelations && (
                      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '8px 0' }}>
                        No typed bidirectional relations found for this artifact. Connect another artifact above to link PRDs, Tech Specs, or Tasks.
                      </p>
                    )}

                    {relations.map((rel) => {
                      const isOutgoing = rel.sourceLogicalId === (currentArtifact.logicalId || currentArtifact.artifactId);
                      return (
                        <div
                          key={rel.relationId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 14px',
                            border: '1px solid var(--border-color)',
                            borderRadius: 6,
                            background: '#ffffff',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Link2 size={15} color="var(--accent-primary)" />
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: 4,
                                background: '#e0e7ff',
                                color: '#4338ca',
                              }}
                            >
                              {rel.type}
                            </span>
                            <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                              {isOutgoing ? (
                                <>
                                  Target: <strong>{rel.targetLogicalId}</strong>
                                </>
                              ) : (
                                <>
                                  Source: <strong>{rel.sourceLogicalId}</strong> (inverse)
                                </>
                              )}
                            </span>
                          </div>

                          <button
                            type="button"
                            className="btn btn-default btn-danger-hover"
                            style={{ padding: '4px 8px' }}
                            onClick={() => handleRemoveRelation(rel.relationId)}
                            title="Delete relation"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                </div>
              )}

              {/* Metadata / Details Footer */}
              {currentArtifact.metadata && Object.keys(currentArtifact.metadata).length > 0 && (
                <div className="artifact-metadata-drawer">
                  <div className="artifact-metadata-header">
                    <Terminal size={14} />
                    <span>Attached Metadata & Provenance</span>
                  </div>
                  <pre className="artifact-metadata-json">
                    <code>{JSON.stringify(currentArtifact.metadata, null, 2)}</code>
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="artifact-empty-selection">
              <FileText size={48} strokeWidth={1} />
              <h3>Select a Document</h3>
              <p>Choose any artifact from the left list to inspect its complete content, version history, and relations.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
