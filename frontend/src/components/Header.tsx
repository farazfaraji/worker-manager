'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Save,
  Copy,
  FolderOpen,
  Plus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Play,
  Settings,
  Share2,
  Sparkles,
  ChevronDown,
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
  assistantOpen?: boolean;
  onToggleAssistant?: () => void;
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
  assistantOpen = false,
  onToggleAssistant,
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const runMenuAction = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <header className="header-container">
      <div className="header-left">
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
        {onToggleAssistant && (
          <button
            type="button"
            className={`header-icon-btn${assistantOpen ? ' active' : ''}`}
            onClick={onToggleAssistant}
            title="Flow Assistant"
            aria-label="Flow Assistant"
            aria-pressed={assistantOpen}
          >
            <Sparkles size={16} />
          </button>
        )}

        <button
          type="button"
          className="header-icon-btn"
          onClick={onOpenSettingsModal}
          title="Model settings"
          aria-label="Model settings"
        >
          <Settings size={16} />
        </button>

        <div className={`header-split${isDirty ? ' is-dirty' : ''}`} ref={menuRef}>
          <button type="button" className="btn btn-default" onClick={onSave} disabled={isSaving}>
            {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Save
          </button>
          <button
            type="button"
            className="header-split-more"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="More board actions"
            aria-expanded={menuOpen}
            disabled={isSaving}
          >
            <ChevronDown size={14} />
          </button>
          {menuOpen && (
            <div className="header-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => runMenuAction(onNewBoard)}>
                <Plus size={15} />
                <div>
                  <strong>New board</strong>
                  <span>Start from an empty flow</span>
                </div>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(onOpenLoadModal)}>
                <FolderOpen size={15} />
                <div>
                  <strong>Open board</strong>
                  <span>Load a saved flow</span>
                </div>
              </button>
              <div className="header-menu-sep" />
              <button type="button" role="menuitem" onClick={() => runMenuAction(onSaveAs)}>
                <Copy size={15} />
                <div>
                  <strong>Save a copy</strong>
                  <span>Keep this board and store a new one</span>
                </div>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => onShare && runMenuAction(onShare)}
                disabled={!graphId || !onShare}
              >
                <Share2 size={15} />
                <div>
                  <strong>Copy link</strong>
                  <span>{graphId ? 'Share this saved flow' : 'Save the board before sharing'}</span>
                </div>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className="btn btn-run"
          onClick={onOpenRunModal}
          disabled={isExecuting}
          title="Execute this workflow and inspect outputs"
        >
          {isExecuting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} fill="#ffffff" />}
          <span>{isExecuting ? 'Running...' : 'Run'}</span>
        </button>
      </div>
    </header>
  );
};
