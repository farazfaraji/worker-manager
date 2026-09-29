'use client';

import React from 'react';
import { LayoutList, GitBranch } from 'lucide-react';

interface ViewModeToggleProps {
  mode: 'canvas' | 'list';
  onChange: (mode: 'canvas' | 'list') => void;
}

/**
 * Small toggle button shown in the header/toolbar that switches between
 * the React Flow canvas view and the new linear list view.
 */
export function ViewModeToggle({ mode, onChange }: ViewModeToggleProps) {
  const options: { key: 'canvas' | 'list'; icon: React.ReactNode; label: string }[] = [
    { key: 'canvas', icon: <GitBranch size={14} />, label: 'Canvas' },
    { key: 'list',   icon: <LayoutList size={14} />, label: 'List' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(0,0,0,0.15)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        padding: 2,
        gap: 2,
      }}
    >
      {options.map(({ key, icon, label }) => {
        const isActive = mode === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            title={`${label} view`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              background: isActive ? 'rgba(99,102,241,0.25)' : 'transparent',
              color: isActive ? '#a5b4fc' : 'rgba(255,255,255,0.35)',
              transition: 'all 0.15s',
            }}
          >
            {icon}
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
