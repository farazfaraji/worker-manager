'use client';

import React, { useState } from 'react';
import {
  X,
  FolderKanban,
  Plus,
  Edit2,
  Trash2,
  Check,
  Calendar,
  Layers,
  Play,
  AlertCircle,
  Loader2,
  Copy,
} from 'lucide-react';
import { Project } from '@/lib/types';
import { deleteProject, duplicateProject } from '@/lib/api';

interface ManageProjectsModalProps {
  isOpen: boolean;
  projects: Project[];
  activeProjectId: string | null;
  onClose: () => void;
  onSelectProject: (projectId: string) => void;
  onOpenCreateProject: () => void;
  onOpenEditProject: (project: Project) => void;
  onRefreshProjects: () => Promise<void>;
}

export const ManageProjectsModal: React.FC<ManageProjectsModalProps> = ({
  isOpen,
  projects,
  activeProjectId,
  onClose,
  onSelectProject,
  onOpenCreateProject,
  onOpenEditProject,
  onRefreshProjects,
}) => {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleDuplicate = async (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setDuplicatingId(project._id);
      setError(null);
      setSuccessMessage(null);
      const duplicated = await duplicateProject(project._id);
      await onRefreshProjects();
      if (duplicated?._id) {
        onSelectProject(duplicated._id);
      }
      setSuccessMessage(`Project "${project.name}" duplicated successfully.`);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to duplicate project');
    } finally {
      setDuplicatingId(null);
    }
  };

  const handleDelete = async (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    if (projects.length <= 1) {
      alert('You cannot delete the only existing project.');
      return;
    }
    const confirmed = window.confirm(
      `Are you sure you want to delete project "${project.name}"?\nAll associated flows and runs will also be deleted.`,
    );
    if (!confirmed) return;

    try {
      setDeletingId(project._id);
      setError(null);
      await deleteProject(project._id);
      await onRefreshProjects();
      if (activeProjectId === project._id) {
        const remaining = projects.filter((p) => p._id !== project._id);
        if (remaining.length > 0) {
          onSelectProject(remaining[0]._id);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete project');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 640, width: '90%' }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FolderKanban size={18} color="var(--accent-primary)" />
            <h3 className="modal-title">Manage Projects</h3>
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

        <div className="modal-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
          {error && (
            <div
              style={{
                background: 'var(--danger-subtle)',
                color: 'var(--danger)',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 13,
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <AlertCircle size={15} />
              {error}
            </div>
          )}

          {successMessage && (
            <div
              style={{
                background: 'rgba(16, 185, 129, 0.1)',
                color: '#10b981',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 13,
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid rgba(16, 185, 129, 0.25)',
              }}
            >
              <Check size={15} />
              {successMessage}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Projects group your LangGraph flows, executions, and artifacts.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '6px 12px', fontSize: 13 }}
              onClick={() => {
                onOpenCreateProject();
              }}
            >
              <Plus size={14} />
              New Project
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {projects.map((p) => {
              const isActive = activeProjectId === p._id;
              const isDeleting = deletingId === p._id;
              const isDuplicating = duplicatingId === p._id;
              return (
                <div
                  key={p._id}
                  onClick={() => {
                    onSelectProject(p._id);
                    onClose();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-md)',
                    border: isActive
                      ? `2px solid ${p.color || 'var(--accent-primary)'}`
                      : '1px solid var(--border-color)',
                    background: isActive ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        background: `${p.color || '#4f46e5'}20`,
                        color: p.color || '#4f46e5',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <FolderKanban size={18} />
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong
                          style={{
                            fontSize: 14,
                            color: 'var(--text-primary)',
                            fontWeight: 600,
                          }}
                        >
                          {p.name}
                        </strong>
                        {isActive && (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: p.color || 'var(--accent-primary)',
                              color: '#fff',
                            }}
                          >
                            Active
                          </span>
                        )}
                      </div>
                      {p.description && (
                        <p
                          style={{
                            fontSize: 12,
                            color: 'var(--text-muted)',
                            marginTop: 2,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {p.description}
                        </p>
                      )}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          marginTop: 6,
                          fontSize: 11.5,
                          color: 'var(--text-muted)',
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Layers size={12} />
                          {p.graphCount ?? 0} {p.graphCount === 1 ? 'flow' : 'flows'}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Play size={12} />
                          {p.runCount ?? 0} {p.runCount === 1 ? 'run' : 'runs'}
                        </span>
                        {p.createdAt && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Calendar size={12} />
                            {new Date(p.createdAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginLeft: 12,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="icon-btn"
                      title="Edit project"
                      disabled={isDuplicating || isDeleting || !!duplicatingId}
                      onClick={() => onOpenEditProject(p)}
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Duplicate project (with all flows, artifacts, and caches)"
                      disabled={isDuplicating || isDeleting || !!duplicatingId}
                      onClick={(e) => handleDuplicate(p, e)}
                    >
                      {isDuplicating ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Copy size={15} />
                      )}
                    </button>
                    {projects.length > 1 && (
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="Delete project"
                        disabled={isDeleting || isDuplicating || !!duplicatingId}
                        onClick={(e) => handleDelete(p, e)}
                      >
                        {isDeleting ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Trash2 size={15} />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-default" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
