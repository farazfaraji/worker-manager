'use client';

import React from 'react';
import {
  Save,
  Copy,
  FolderOpen,
  Plus,
  Workflow,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Play,
  Settings,
  History,
  Share2,
  FileText,
} from 'lucide-react';

import { Project } from '@/lib/types';
import { ProjectSelector } from '@/components/ProjectSelector';

interface HeaderProps {
  graphName: string;
  graphId: string | null;
  isDirty: boolean;
  isSaving: boolean;
  isExecuting?: boolean;
  projects?: Project[];
  activeProject?: Project | null;
  onSelectProject?: (projectId: string) => void;
  onOpenCreateProject?: () => void;
  onOpenManageProjects?: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onShare?: () => void;
  onOpenLoadModal: () => void;
  onNewBoard: () => void;
  onOpenRunModal: () => void;
  onOpenSettingsModal: () => void;
  onNameChange: (name: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  graphName,
  graphId,
  isDirty,
  isSaving,
  isExecuting = false,
  projects = [],
  activeProject = null,
  onSelectProject = () => {},
  onOpenCreateProject = () => {},
  onOpenManageProjects = () => {},
  onSave,
  onSaveAs,
  onShare,
  onOpenLoadModal,
  onNewBoard,
  onOpenRunModal,
  onOpenSettingsModal,
  onNameChange,
}) => {
  return (
    <header className="header-container">
      <div className="header-left">
        <div className="brand-badge">
          <Workflow size={18} />
          <span>Flow Studio</span>
        </div>

        {projects.length > 0 && (
          <ProjectSelector
            projects={projects}
            activeProject={activeProject}
            onSelectProject={onSelectProject}
            onOpenCreateProject={onOpenCreateProject}
            onOpenManageProjects={onOpenManageProjects}
          />
        )}

        <div className="graph-title-wrapper">
          <input
            type="text"
            className="graph-title-input"
            value={graphName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Untitled Graph"
            title="Click to rename board"
          />

          {isSaving ? (
            <span className="status-badge" style={{ background: '#e0e7ff', color: '#4338ca' }}>
              <Loader2 size={12} className="animate-spin" />
              Saving...
            </span>
          ) : isDirty ? (
            <span className="status-badge status-unsaved">
              <AlertCircle size={12} />
              Unsaved
            </span>
          ) : graphId ? (
            <span className="status-badge status-saved">
              <CheckCircle2 size={12} />
              Saved
            </span>
          ) : (
            <span className="status-badge" style={{ background: '#f1f5f9', color: '#64748b' }}>
              New Draft
            </span>
          )}
        </div>
      </div>

      <div className="header-actions">
        <button
          type="button"
          className="btn btn-default"
          onClick={onNewBoard}
          title="Create a new blank board"
        >
          <Plus size={15} />
          New
        </button>

        <button
          type="button"
          className="btn btn-default"
          onClick={onOpenLoadModal}
          title="Load an existing graph from MongoDB"
        >
          <FolderOpen size={15} />
          Load
        </button>

        <button
          type="button"
          className="btn btn-default"
          onClick={onSaveAs}
          title="Save a copy under a new name"
        >
          <Copy size={15} />
          Save As
        </button>

        <button
          type="button"
          className="btn btn-default"
          onClick={onSave}
          disabled={isSaving}
          title="Save changes to database"
        >
          {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Save
        </button>

        {graphId && onShare && (
          <button
            type="button"
            className="btn btn-default"
            onClick={onShare}
            title="Copy shareable link for this flow"
          >
            <Share2 size={15} />
            Share
          </button>
        )}

        <button
          type="button"
          className="btn btn-default"
          onClick={onOpenSettingsModal}
          title="Configure LLM Models and Modalities"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Settings size={15} />
          Settings
        </button>

        <button
          type="button"
          className="btn btn-run"
          onClick={onOpenRunModal}
          disabled={isExecuting}
          title="Execute this workflow and inspect outputs"
          style={{
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            color: '#ffffff',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: '0 2px 6px rgba(16, 185, 129, 0.25)',
            border: 'none',
            padding: '0 16px',
          }}
        >
          {isExecuting ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Play size={15} fill="#ffffff" />
          )}
          <span>{isExecuting ? 'Running...' : 'Run Flow'}</span>
        </button>
      </div>
    </header>
  );
};
