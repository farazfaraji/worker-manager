'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  FileText,
  Search,
  Filter,
  RefreshCw,
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
  fetchArtifactTypes,
  fetchArtifactCategories,
  deleteArtifact,
  updateArtifact,
  approveArtifact,
  fetchArtifactVersions,
  fetchArtifactRelations,
  createArtifactRelation,
  deleteArtifactRelation,
} from '@/lib/api';
import { ArtifactItem, ArtifactRelationItem, Project } from '@/lib/types';
import { MarkdownViewer } from '@/components/artifacts/MarkdownViewer';
import { CreateArtifactModal } from '@/components/artifacts/CreateArtifactModal';
import { SuggestionCombobox } from '@/components/modal/SuggestionCombobox';
import { AppNav } from '@/components/AppNav';
import { readActiveProjectId, writeActiveProjectId } from '@/lib/studio-session';
import { downloadArtifact, downloadArtifacts } from '@/lib/artifact-download';

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
  const [projectReady, setProjectReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('');
  const [artifactTypes, setArtifactTypes] = useState<Array<{ label: string; value: string }>>([
    { label: 'All Document Types', value: '' },
  ]);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [artifactCategories, setArtifactCategories] = useState<Array<{ label: string; value: string }>>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [latestOnly, setLatestOnly] = useState<boolean>(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);

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
      const [items, projList, types, categories] = await Promise.all([
        fetchArtifacts({
          latestOnly,
          projectId: selectedProjectId || undefined,
          type: selectedType || undefined,
          status: selectedStatus || undefined,
        }),
        fetchProjects().catch(() => []),
        fetchArtifactTypes(selectedProjectId || undefined).catch(() => [{ label: 'All Document Types', value: '' }]),
        fetchArtifactCategories(selectedProjectId || undefined).catch(() => []),
      ]);
      setArtifacts(items);
      setProjects(projList);
      setArtifactTypes(types);
      setArtifactCategories(categories);
      setSelectedIds(new Set());
      if (items.length > 0 && !selectedId) {
        setSelectedId(items[0].artifactId);
      } else if (selectedId && !items.some((item) => item.artifactId === selectedId)) {
        setSelectedId(items[0]?.artifactId || null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load artifacts');
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
    void loadData();
  }, [latestOnly, selectedProjectId, selectedType, selectedStatus, projectReady]);

  const categoryOptions = useMemo(
    () => artifactCategories.filter((option) => option.value),
    [artifactCategories],
  );

  // Filtered items
  const filteredArtifacts = useMemo(() => {
    return artifacts.filter((item) => {
      if (categoryFilter.trim()) {
        const q = categoryFilter.toLowerCase();
        const category = (item.category || '').toLowerCase();
        if (!category.includes(q)) return false;
      }
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
  }, [artifacts, categoryFilter, searchQuery]);

  const allVisibleSelected =
    filteredArtifacts.length > 0 && filteredArtifacts.every((item) => selectedIds.has(item.artifactId));
  const someVisibleSelected = filteredArtifacts.some((item) => selectedIds.has(item.artifactId));

  const toggleArtifactSelection = (artifactId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(artifactId)) next.delete(artifactId);
      else next.add(artifactId);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(filteredArtifacts.map((item) => item.artifactId)));
  };

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

  const buildBulkZipName = (suffix = '') => {
    const stamp = new Date().toISOString().slice(0, 10);
    const projectName = projects.find((p) => p._id === selectedProjectId)?.name;
    const safeProject = projectName
      ? projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      : 'artifacts';
    return `${safeProject || 'artifacts'}${suffix}-${stamp}.zip`;
  };

  const handleDownload = (artifact: ArtifactItem) => {
    downloadArtifact(artifact, 'native');
  };

  const handleDownloadMarkdown = (artifact: ArtifactItem) => {
    downloadArtifact(artifact, 'markdown');
  };

  const handleBulkDownload = (mode: 'native' | 'markdown' = 'native') => {
    const targets = filteredArtifacts.filter((item) => selectedIds.has(item.artifactId));
    if (targets.length === 0) return;

    try {
      setBulkDownloading(true);
      downloadArtifacts(
        targets,
        mode,
        buildBulkZipName(mode === 'markdown' ? '-md' : ''),
      );
    } catch (err: any) {
      window.alert(`Bulk download failed: ${err.message || 'Unknown error'}`);
    } finally {
      setBulkDownloading(false);
    }
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
      await deleteArtifact(artifact.artifactId, artifact.projectId || selectedProjectId || undefined);
      const nextList = artifacts.filter((a) => a.artifactId !== artifact.artifactId);
      setArtifacts(nextList);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(artifact.artifactId);
        return next;
      });
      if (selectedId === artifact.artifactId) {
        setSelectedId(nextList[0]?.artifactId || null);
      }
    } catch (err: any) {
      window.alert(`Error deleting artifact: ${err.message}`);
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Delete ${ids.length} selected artifact${ids.length === 1 ? '' : 's'}? This removes all versions of each selected document.`,
      )
    ) {
      return;
    }

    try {
      setBulkDeleting(true);
      const targets = artifacts.filter((item) => selectedIds.has(item.artifactId));
      const results = await Promise.allSettled(
        targets.map((artifact) =>
          deleteArtifact(artifact.artifactId, artifact.projectId || selectedProjectId || undefined),
        ),
      );
      const failed = results.filter((result) => result.status === 'rejected').length;
      const deletedIds = new Set(
        results
          .map((result, index) => (result.status === 'fulfilled' ? targets[index].artifactId : null))
          .filter(Boolean) as string[],
      );
      const nextList = artifacts.filter((item) => !deletedIds.has(item.artifactId));
      setArtifacts(nextList);
      setSelectedIds(new Set());
      if (selectedId && deletedIds.has(selectedId)) {
        setSelectedId(nextList[0]?.artifactId || null);
      }
      if (failed > 0) {
        window.alert(`Deleted ${deletedIds.size} artifact(s), but ${failed} failed.`);
      }
    } catch (err: any) {
      window.alert(`Bulk delete failed: ${err.message}`);
    } finally {
      setBulkDeleting(false);
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

  const handleArtifactCreated = (artifact: ArtifactItem) => {
    setArtifacts((prev) => [artifact, ...prev]);
    setSelectedId(artifact.artifactId);
    setActiveTab('content');
    if (artifact.projectId && artifact.projectId !== selectedProjectId) {
      setSelectedProjectId(artifact.projectId);
      writeActiveProjectId(artifact.projectId);
    }
    void loadData();
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
    <div className="page-shell">
      <AppNav />
      <div className="artifacts-page-container">
      <header className="artifacts-header">
        <div className="artifacts-header-left">
          <div className="artifacts-header-title-block">
            <div className="artifacts-title-row">
              <FileText size={20} className="artifacts-brand-icon" />
              <h1 className="artifacts-title">Documents & Artifacts</h1>
              <span className="artifacts-count-pill">{filteredArtifacts.length}</span>
            </div>
            <p className="artifacts-subtitle">
              Browse versioned logical artifacts, immutable history, and bidirectional semantic relations.
            </p>
          </div>
        </div>

        <div className="artifacts-header-right">
          {selectedIds.size > 0 && (
            <>
              <button
                type="button"
                className="btn btn-default"
                onClick={() => handleBulkDownload('native')}
                disabled={bulkDownloading || bulkDeleting}
                title="Download selected artifacts in their native format"
              >
                <Download size={15} />
                <span>{bulkDownloading ? 'Preparing...' : `Download ${selectedIds.size} selected`}</span>
              </button>
              <button
                type="button"
                className="btn btn-default"
                onClick={() => handleBulkDownload('markdown')}
                disabled={bulkDownloading || bulkDeleting}
                title="Download selected artifacts as markdown files"
              >
                <FileText size={15} />
                <span>{bulkDownloading ? 'Preparing...' : `Download ${selectedIds.size} as MD`}</span>
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void handleBulkDelete()}
                disabled={bulkDeleting || bulkDownloading}
                title="Delete selected artifacts"
              >
                <Trash2 size={15} />
                <span>{bulkDeleting ? 'Deleting...' : `Delete ${selectedIds.size} selected`}</span>
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreateModalOpen(true)}
            title="Create a new artifact"
          >
            <PlusCircle size={15} />
            <span>New Artifact</span>
          </button>

          <button
            type="button"
            className="btn btn-default"
            onClick={() => void loadData()}
            disabled={loading || bulkDeleting || bulkDownloading}
            title="Refresh artifacts list"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
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
              onChange={(e) => {
                const next = e.target.value;
                setSelectedProjectId(next);
                setSelectedType('');
                setCategoryFilter('');
                if (next) writeActiveProjectId(next);
              }}
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
            {artifactTypes.map((typeOption) => (
              <option key={typeOption.value || 'all'} value={typeOption.value}>
                {typeOption.label}
              </option>
            ))}
          </select>
        </div>

        {/* Category Filter */}
        <div className="artifacts-filter-group artifacts-category-filter">
          <Tag size={14} className="filter-icon" />
          <SuggestionCombobox
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={categoryOptions}
            placeholder="Filter by category..."
          />
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
        {(selectedType || categoryFilter || selectedStatus || searchQuery || !latestOnly || selectedProjectId) && (
          <button
            type="button"
            className="btn btn-subtle"
            onClick={() => {
              setSelectedType('');
              setCategoryFilter('');
              setSelectedStatus('');
              setSearchQuery('');
              setLatestOnly(true);
              setSelectedProjectId('');
              setSelectedIds(new Set());
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
          {filteredArtifacts.length > 0 && (
            <label className="artifacts-bulk-select-row">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={(input) => {
                  if (input) input.indeterminate = someVisibleSelected && !allVisibleSelected;
                }}
                onChange={toggleSelectAllVisible}
              />
              <span>
                {selectedIds.size > 0
                  ? `${selectedIds.size} selected`
                  : `Select all (${filteredArtifacts.length})`}
              </span>
            </label>
          )}

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
                {searchQuery || selectedType || categoryFilter || selectedStatus
                  ? 'No documents match the current filter criteria.'
                  : 'Flows using the Artifact tool will automatically register documents here.'}
              </p>
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: 12 }}
                onClick={() => setCreateModalOpen(true)}
              >
                <PlusCircle size={14} />
                <span>Create Artifact</span>
              </button>
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
                className={`artifact-list-card ${isSelected ? 'selected' : ''} ${selectedIds.has(artifact.artifactId) ? 'bulk-selected' : ''}`}
                onClick={() => setSelectedId(artifact.artifactId)}
              >
                <div className="artifact-card-select-row">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(artifact.artifactId)}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => toggleArtifactSelection(artifact.artifactId)}
                    aria-label={`Select ${artifact.title || artifact.artifactId}`}
                  />
                </div>
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
                      <button
                        type="button"
                        className="artifact-card-kw-pill"
                        onClick={(event) => {
                          event.stopPropagation();
                          setCategoryFilter(artifact.category || '');
                        }}
                        title={`Filter by category "${artifact.category}"`}
                      >
                        {artifact.category}
                      </button>
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
                        Project: {projects.find((p) => p._id === currentArtifact.projectId)?.name || currentArtifact.projectId}
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
                    title="Download in native format (json, md, or txt)"
                  >
                    <Download size={14} />
                    <span>Download</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-default"
                    onClick={() => handleDownloadMarkdown(currentArtifact)}
                    title="Download content as a markdown file named after the document title"
                  >
                    <FileText size={14} />
                    <span>Download MD</span>
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
                        <button
                          type="button"
                          className="artifact-keywords-count"
                          onClick={() => setCategoryFilter(currentArtifact.category || 'general')}
                          title={`Filter by category "${currentArtifact.category || 'general'}"`}
                        >
                          {currentArtifact.category || 'general'}
                        </button>
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

      <CreateArtifactModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={handleArtifactCreated}
        projects={projects}
        defaultProjectId={selectedProjectId}
      />
    </div>
  );
}
