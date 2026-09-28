'use client';

import React from 'react';
import { RefreshCw, Play, Loader2 } from 'lucide-react';
import { RunResult } from '@/lib/types';

interface ExecutionStudioFooterProps {
  runResult: RunResult | null;
  isExecuting: boolean;
  hasWebserver: boolean;
  serverStatus: 'running' | 'stopped';
  activeTab: 'endpoints' | 'input' | 'output';
  jsonError: string | null;
  dockMode: 'bottom' | 'floating';
  onClose: () => void;
  onExecute: () => void;
}

export const ExecutionStudioFooter: React.FC<ExecutionStudioFooterProps> = ({
  runResult,
  isExecuting,
  hasWebserver,
  serverStatus,
  activeTab,
  jsonError,
  dockMode,
  onClose,
  onExecute,
}) => {
  return (
    <div
      className="modal-footer"
      style={{
        padding: '12px 20px',
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#ffffff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-default" onClick={onClose} style={{ fontSize: 12, padding: '5px 12px' }}>
          Close
        </button>
        {dockMode === 'bottom' && (
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Tip: Drag top edge to change height
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        {runResult && (
          <button
            type="button"
            className="btn btn-default"
            onClick={onExecute}
            disabled={isExecuting}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 12px' }}
          >
            <RefreshCw size={13} />
            Re-run
          </button>
        )}

        <button
          type="button"
          className="btn btn-primary"
          onClick={onExecute}
          disabled={isExecuting || (activeTab === 'input' && !!jsonError)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            padding: '5px 16px',
            background:
              serverStatus === 'running' && hasWebserver
                ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                : 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
            boxShadow: '0 2px 4px rgba(79, 70, 229, 0.25)',
          }}
        >
          {isExecuting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : hasWebserver ? (
            serverStatus === 'running' ? (
              <RefreshCw size={14} />
            ) : (
              <Play size={14} fill="#ffffff" />
            )
          ) : (
            <Play size={14} fill="#ffffff" />
          )}
          {isExecuting
            ? hasWebserver
              ? 'Starting Server...'
              : 'Running Flow...'
            : hasWebserver
            ? serverStatus === 'running'
              ? 'Restart Server'
              : 'Start Server & Listen'
            : 'Run Flow'}
        </button>
      </div>
    </div>
  );
};
