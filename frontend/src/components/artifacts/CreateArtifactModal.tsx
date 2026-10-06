'use client';

import React, { useEffect, useRef, useState } from 'react';
import { FilePlus, Loader2, X } from 'lucide-react';
import { createArtifact } from '@/lib/api';
import { ArtifactItem, Project } from '@/lib/types';

const TYPE_OPTIONS = [
  { value: 'document', label: 'General Document' },
  { value: 'high-level', label: 'High-Level Concept' },
  { value: 'prd', label: 'Product Spec (PRD)' },
  { value: 'tech-spec', label: 'Technical Spec' },
  { value: 'task', label: 'Task / Plan' },
  { value: 'decision', label: 'Decision' },
  { value: 'change', label: 'Change Request' },
  { value: 'code', label: 'Code / Patch' },
];

const FORMAT_OPTIONS = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: 'Plain Text' },
  { value: 'json', label: 'JSON' },
  { value: 'code', label: 'Code' },
];

interface CreateArtifactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (artifact: ArtifactItem) => void;
  projects: Project[];
  defaultProjectId?: string;
}

export function CreateArtifactModal({
  isOpen,
  onClose,
  onCreated,
  projects,
  defaultProjectId = '',
}: CreateArtifactModalProps) {
  const [title, setTitle] = useState('');
  const [logicalId, setLogicalId] = useState('');
  const [type, setType] = useState('document');
  const [category, setCategory] = useState('general');
  const [tags, setTags] = useState('');
  const [format, setFormat] = useState('markdown');
  const [content, setContent] = useState('');
  const [projectId, setProjectId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTitle('');
    setLogicalId('');
    setType('document');
    setCategory('general');
    setTags('');
    setFormat('markdown');
    setContent('');
    setProjectId(defaultProjectId || projects[0]?._id || '');
    setError(null);
    setTimeout(() => titleRef.current?.focus(), 50);
  }, [isOpen, defaultProjectId, projects]);

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (!projectId) {
      setError('Select a project for this artifact');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const tagList = tags
        .split(/[\r\n,]+/)
        .map((tag) => tag.trim())
        .filter(Boolean);
      const created = await createArtifact({
        projectId,
        title: title.trim(),
        logicalId: logicalId.trim() || undefined,
        type,
        category: category.trim() || 'general',
        tags: tagList,
        format,
        content,
      });
      onCreated(created);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create artifact');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FilePlus size={18} color="var(--accent-primary)" />
            <h3 className="modal-title">Create New Artifact</h3>
          </div>
          <button type="button" className="collapse-btn" onClick={onClose} title="Close dialog">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ maxHeight: '70vh' }}>
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
              <label className="form-label" htmlFor="artifact-title-input">Title *</label>
              <input
                id="artifact-title-input"
                ref={titleRef}
                type="text"
                className="form-input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. API Design Specification"
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="artifact-type-input">Type</label>
                <select
                  id="artifact-type-input"
                  className="form-input"
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                >
                  {TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="artifact-format-input">Format</label>
                <select
                  id="artifact-format-input"
                  className="form-input"
                  value={format}
                  onChange={(event) => setFormat(event.target.value)}
                >
                  {FORMAT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {projects.length > 0 && (
              <div className="form-group">
                <label className="form-label" htmlFor="artifact-project-input">Project *</label>
                <select
                  id="artifact-project-input"
                  className="form-input"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  required
                >
                  <option value="">Select project...</option>
                  {projects.map((project) => (
                    <option key={project._id} value={project._id}>{project.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="artifact-logical-id-input">Logical ID</label>
                <input
                  id="artifact-logical-id-input"
                  type="text"
                  className="form-input"
                  value={logicalId}
                  onChange={(event) => setLogicalId(event.target.value)}
                  placeholder="auto-generated if empty"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="artifact-category-input">Category</label>
                <input
                  id="artifact-category-input"
                  type="text"
                  className="form-input"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  placeholder="general"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="artifact-tags-input">Tags</label>
              <input
                id="artifact-tags-input"
                type="text"
                className="form-input"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="api, backend, v1"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="artifact-content-input">Content</label>
              <textarea
                id="artifact-content-input"
                className="form-textarea"
                rows={10}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder={format === 'json' ? '{\n  "key": "value"\n}' : '# Start writing...'}
                style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-default" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting || !title.trim()}>
              {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <FilePlus size={14} />}
              <span>{isSubmitting ? 'Creating...' : 'Create Artifact'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
