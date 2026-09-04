'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  FolderOpen,
  Search,
  Trash2,
  Calendar,
  Layers,
  ArrowRight,
  Plus,
  RefreshCw,
  Loader2,
  FolderKanban,
} from 'lucide-react';
import { GraphSummary, Project } from '../lib/types';
import { fetchGraphs, deleteGraph } from '../lib/api';

interface LoadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectGraph: (id: string) => void;
  onNewGraph: () => void;
  projects?: Project[];
  activeProjectId?: string | null;
  onSelectProject?: (projectId: string) => void;
}

export const LoadModal: React.FC<LoadModalProps> = ({
  isOpen,
  onClose,
  onSelectGraph,
  onNewGraph,
  projects = [],
  activeProjectId = null,
  onSelectProject,
}) => {
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(activeProjectId);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedProjectId(activeProjectId);
  }, [activeProjectId]);

  const loadGraphList = async (projectId?: string | null) => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchGraphs(projectId || undefined);
      setGraphs(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load graphs from MongoDB.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadGraphList(selectedProjectId);
    }
  }, [isOpen, selectedProjectId]);

  if (!isOpen) return null;

  const currentProject = projects.find((p) => p._id === selectedProjectId);

  const filteredGraphs = graphs.filter((g) =>
    g.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete "${name}"?`)) return;

    try {
      setDeletingId(id);
      await deleteGraph(id);
      setGraphs((prev) => prev.filter((g) => g.id !== id));
    } catch (err: any) {
      alert(`Error deleting graph: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 640 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FolderOpen size={18} color="var(--accent-primary)" />
            <h3 className="modal-title">Saved Flows</h3>
          </div>
          <button
            type="button"
            className="collapse-btn"
            onClick={onClose}
            title="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: 480 }}>
          {/* Project Scoping Selector */}
          {projects.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: 'var(--bg-subtle)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                marginBottom: 10,
              }}
            >
              <FolderKanban size={15} color="var(--accent-primary)" />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Project:
              </span>
              <select
                value={selectedProjectId || ''}
                onChange={(e) => {
                  const val = e.target.value || null;
                  setSelectedProjectId(val);
                  if (val && onSelectProject) onSelectProject(val);
                }}
                style={{
                  flex: 1,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 8px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="">All Projects (Show All Flows)</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name} ({p.graphCount ?? 0} flows)
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search
                size={16}
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                type="text"
                className="form-input"
                style={{ paddingLeft: 34, width: '100%' }}
                placeholder="Search saved flows..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-default"
              onClick={() => loadGraphList(selectedProjectId)}
              disabled={isLoading}
              title="Refresh flow list"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {error && (
            <div
              style={{
                padding: '10px 14px',
                background: 'var(--danger-subtle)',
                color: 'var(--danger)',
                borderRadius: 'var(--radius-md)',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {isLoading && graphs.length === 0 ? (
            <div
              style={{
                padding: '40px 0',
                textAlign: 'center',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Loader2 size={18} className="animate-spin" />
              <span>Fetching flows from MongoDB...</span>
            </div>
          ) : filteredGraphs.length === 0 ? (
            <div className="empty-panel-box" style={{ padding: '32px 16px' }}>
              <Layers className="empty-panel-icon" />
              <div className="empty-panel-title">
                {searchQuery
                  ? 'No matching flows found'
                  : selectedProjectId && currentProject
                  ? `No flows in project "${currentProject.name}"`
                  : 'No saved flows yet'}
              </div>
              <div className="empty-panel-desc" style={{ marginBottom: 16 }}>
                {searchQuery
                  ? 'Try a different search query'
                  : 'Start by creating your first flow in this project.'}
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onClose();
                  onNewGraph();
                }}
              >
                <Plus size={14} />
                Create New Flow
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredGraphs.map((graph) => {
                const isDeleting = deletingId === graph.id;
                const flowProject = projects.find((p) => p._id === graph.projectId);

                return (
                  <div
                    key={graph.id}
                    className="dropdown-item-hover"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    onClick={() => onSelectGraph(graph.id)}
                  >
                    <div style={{ minWidth: 0, flex: 1, paddingRight: 12 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <strong
                          style={{
                            fontSize: 14,
                            color: 'var(--text-primary)',
                            fontWeight: 600,
                          }}
                        >
                          {graph.name}
                        </strong>
                        {flowProject && !selectedProjectId && (
                          <span
                            style={{
                              fontSize: 11,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: `${flowProject.color || '#4f46e5'}18`,
                              color: flowProject.color || 'var(--accent-primary)',
                              fontWeight: 600,
                            }}
                          >
                            {flowProject.name}
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          fontSize: 11.5,
                          color: 'var(--text-muted)',
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Layers size={11} />
                          {graph.nodeCount} {graph.nodeCount === 1 ? 'node' : 'nodes'}
                        </span>
                        <span>•</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Calendar size={11} />
                          {formatDate(graph.updatedAt || graph.createdAt)}
                        </span>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="Delete flow"
                        disabled={isDeleting}
                        onClick={(e) => handleDelete(e, graph.id, graph.name)}
                      >
                        {isDeleting ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>

                      <button
                        type="button"
                        className="btn btn-default"
                        style={{ padding: '6px 10px', fontSize: 12 }}
                        onClick={() => onSelectGraph(graph.id)}
                      >
                        <span>Open</span>
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div
          className="modal-footer"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <button
            type="button"
            className="btn btn-default"
            onClick={() => {
              onClose();
              onNewGraph();
            }}
          >
            <Plus size={14} />
            {currentProject ? `New Flow in ${currentProject.name}` : 'New Blank Flow'}
          </button>
          <button type="button" className="btn btn-default" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
