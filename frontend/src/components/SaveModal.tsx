'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Sparkles, FolderKanban } from 'lucide-react';
import { Project } from '../lib/types';

interface SaveModalProps {
  isOpen: boolean;
  isSaveAs: boolean;
  initialName: string;
  onClose: () => void;
  onConfirm: (name: string, projectId: string) => void;
  isSaving: boolean;
  projects?: Project[];
  activeProjectId?: string | null;
}

export const SaveModal: React.FC<SaveModalProps> = ({
  isOpen,
  isSaveAs,
  initialName,
  onClose,
  onConfirm,
  isSaving,
  projects = [],
  activeProjectId = null,
}) => {
  const [boardName, setBoardName] = useState(initialName || '');
  const [targetProjectId, setTargetProjectId] = useState<string>(activeProjectId || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setBoardName(initialName ? (isSaveAs ? `${initialName} (Copy)` : initialName) : 'My LangGraph Flow');
      setTargetProjectId(activeProjectId || (projects[0]?._id ?? ''));
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, initialName, isSaveAs, activeProjectId, projects]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!boardName.trim()) return;
    const finalProjectId = targetProjectId || projects[0]?._id || '';
    onConfirm(boardName.trim(), finalProjectId);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={18} color="var(--accent-primary)" />
            <h3 className="modal-title">{isSaveAs ? 'Save As New Graph' : 'Save Flow'}</h3>
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
            {/* Target Project Selection */}
            {projects.length > 0 && (
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FolderKanban size={14} color="var(--accent-primary)" />
                  Target Project
                </label>
                <select
                  className="form-input"
                  value={targetProjectId}
                  onChange={(e) => setTargetProjectId(e.target.value)}
                  style={{ cursor: 'pointer', fontWeight: 500 }}
                  required
                >
                  {projects.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="board-name-input">
                Flow Name
              </label>
              <input
                id="board-name-input"
                ref={inputRef}
                type="text"
                className="form-input"
                value={boardName}
                onChange={(e) => setBoardName(e.target.value)}
                placeholder="e.g. Chatbot Supervisor Flow"
                required
              />
            </div>

            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              {isSaveAs
                ? 'This will create a new distinct copy of your current flow in MongoDB under the selected project.'
                : 'Enter a name for your LangGraph flow board to save it into MongoDB.'}
            </p>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-default"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!boardName.trim() || isSaving}
            >
              <Save size={15} />
              {isSaving ? 'Saving...' : isSaveAs ? 'Save Copy' : 'Save Flow'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
