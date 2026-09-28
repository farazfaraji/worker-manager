'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, FolderPlus, Sparkles, Loader2 } from 'lucide-react';
import { Project } from '@/lib/types';
import { createProject, updateProject } from '@/lib/api';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (project: Project) => void;
  projectToEdit?: Project | null;
}

const COLOR_OPTIONS = [
  '#4f46e5', // Indigo
  '#2563eb', // Blue
  '#0d9488', // Teal
  '#059669', // Emerald
  '#d97706', // Amber
  '#dc2626', // Red
  '#9333ea', // Purple
  '#ec4899', // Pink
];

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onClose,
  onProjectCreated,
  projectToEdit,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repositoryPath, setRepositoryPath] = useState('');
  const [allowedRepositoryRoots, setAllowedRepositoryRoots] = useState('');
  const [color, setColor] = useState('#4f46e5');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (projectToEdit) {
        setName(projectToEdit.name || '');
        setDescription(projectToEdit.description || '');
        setRepositoryPath(String(projectToEdit.metadata?.repositoryPath || ''));
        setAllowedRepositoryRoots(Array.isArray(projectToEdit.metadata?.allowedRepositoryRoots)
          ? projectToEdit.metadata.allowedRepositoryRoots.join('\n')
          : '');
        setColor(projectToEdit.color || '#4f46e5');
      } else {
        setName('');
        setDescription('');
        setRepositoryPath('');
        setAllowedRepositoryRoots('');
        setColor('#4f46e5');
      }
      setError(null);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen, projectToEdit]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Project name is required');
      return;
    }
    const repositoryRoots = allowedRepositoryRoots
      .split(/\r?\n/)
      .map((path) => path.trim())
      .filter(Boolean);
    if (repositoryRoots.some((path) => !path.startsWith('/'))) {
      setError('Allowed repository roots must be absolute paths, one per line.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const metadata: Record<string, any> = {
        ...(projectToEdit?.metadata || {}),
        repositoryPath: repositoryPath.trim(),
      };
      if (repositoryRoots.length > 0) {
        metadata.allowedRepositoryRoots = repositoryRoots;
      } else {
        delete metadata.allowedRepositoryRoots;
      }

      if (projectToEdit) {
        const updated = await updateProject(projectToEdit._id, {
          name: name.trim(),
          description: description.trim(),
          color,
          metadata,
        });
        onProjectCreated(updated);
      } else {
        const created = await createProject({
          name: name.trim(),
          description: description.trim(),
          color,
          metadata,
        });
        onProjectCreated(created);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save project');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FolderPlus size={18} color="var(--accent-primary)" />
            <h3 className="modal-title">
              {projectToEdit ? 'Edit Project' : 'Create New Project'}
            </h3>
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

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && (
              <div
                style={{
                  background: 'var(--danger-subtle)',
                  color: 'var(--danger)',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="project-name-input">
                Project Name *
              </label>
              <input
                id="project-name-input"
                ref={inputRef}
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Customer Support AI, Document Intelligence"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="project-desc-input">
                Description (Optional)
              </label>
              <textarea
                id="project-desc-input"
                className="form-textarea"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Briefly describe what flows and agents belong to this project..."
                style={{ resize: 'vertical' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="project-repository-input">
                Repository Path (Optional)
              </label>
              <input
                id="project-repository-input"
                type="text"
                className="form-input"
                value={repositoryPath}
                onChange={(e) => setRepositoryPath(e.target.value)}
                placeholder="/absolute/path/to/your/git/repository"
              />
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                Used by the Repository Inspector when planning features for this project.
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="project-allowed-repositories-input">
                Allowed Repository Roots (Optional)
              </label>
              <textarea
                id="project-allowed-repositories-input"
                className="form-textarea"
                rows={3}
                value={allowedRepositoryRoots}
                onChange={(e) => setAllowedRepositoryRoots(e.target.value)}
                placeholder="/absolute/path/to/repository"
                style={{ resize: 'vertical', fontFamily: 'monospace' }}
              />
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                One absolute folder path per line. Repository Path is always allowed; these add folders and their subfolders. Leave blank to allow only Repository Path.
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Accent Color</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: c,
                      border: color === c ? '2.5px solid var(--text-primary)' : '2px solid transparent',
                      cursor: 'pointer',
                      transform: color === c ? 'scale(1.15)' : 'scale(1)',
                      transition: 'all 0.15s ease',
                    }}
                    title={c}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-default"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!name.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Sparkles size={15} />
                  {projectToEdit ? 'Save Changes' : 'Create Project'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
