'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { ToolOutput } from '@/lib/types';

interface NodeOutputHandlesProps {
  outputs: ToolOutput[];
}

export const NodeOutputHandles: React.FC<NodeOutputHandlesProps> = ({ outputs }) => {
  // If no explicit outputs defined, render a default source handle for sequence connections
  if (!outputs || outputs.length === 0) {
    return (
      <div
        style={{
          marginTop: 6,
          paddingTop: 4,
          display: 'flex',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <Handle
          type="source"
          id="flow"
          position={Position.Bottom}
          style={{
            background: 'var(--accent-primary)',
            width: 9,
            height: 9,
            bottom: -5,
            border: '2px solid #ffffff',
          }}
        />
      </div>
    );
  }

  // Single output handle centered at bottom
  if (outputs.length === 1) {
    const out = outputs[0];
    return (
      <div
        style={{
          marginTop: 8,
          paddingTop: 6,
          borderTop: '1px dashed var(--border-color)',
          display: 'flex',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            fontFamily: 'monospace',
            color: 'var(--text-muted)',
          }}
        >
          {out.name} ({out.type})
        </span>
        <Handle
          type="source"
          id={out.name}
          position={Position.Bottom}
          style={{
            background: 'var(--accent-primary)',
            width: 9,
            height: 9,
            bottom: -5,
            border: '2px solid #ffffff',
          }}
        />
      </div>
    );
  }

  const hasBranches = outputs.some(
    (o) =>
      o.type === 'branch' ||
      o.name === 'true' ||
      o.name === 'false' ||
      o.name === 'valid' ||
      o.name === 'invalid',
  );

  if (!hasBranches && outputs.length > 2) {
    return (
      <div
        style={{
          marginTop: 8,
          paddingTop: 6,
          borderTop: '1px dashed var(--border-color)',
          display: 'flex',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            fontFamily: 'monospace',
            color: 'var(--text-muted)',
          }}
        >
          outputs ({outputs.length})
        </span>
        <Handle
          type="source"
          id="flow"
          position={Position.Bottom}
          style={{
            background: 'var(--accent-primary)',
            width: 9,
            height: 9,
            bottom: -5,
            border: '2px solid #ffffff',
          }}
        />
      </div>
    );
  }

  // Multiple output handles distributed horizontally
  return (
    <div
      style={{
        marginTop: 8,
        paddingTop: 6,
        borderTop: '1px dashed var(--border-color)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        position: 'relative',
      }}
    >
      {outputs.map((out) => {
        const isBranch = out.type === 'branch';
        const isTrueBranch = out.name === 'true' || out.name === 'valid';
        const isFalseBranch = out.name === 'false' || out.name === 'invalid';
        const isDefaultBranch = out.name === 'default';
        const isError = out.type === 'error' || out.name === 'error';

        let badgeBg = 'var(--bg-subtle)';
        let badgeColor = 'var(--text-secondary)';
        let handleColor = 'var(--accent-primary)';

        if (isTrueBranch) {
          badgeBg = 'var(--success-subtle)';
          badgeColor = 'var(--success)';
          handleColor = 'var(--success)';
        } else if (isFalseBranch || isError) {
          badgeBg = 'var(--danger-subtle)';
          badgeColor = 'var(--danger)';
          handleColor = 'var(--danger)';
        } else if (isDefaultBranch) {
          badgeBg = 'rgba(107, 114, 128, 0.12)';
          badgeColor = 'var(--text-secondary)';
          handleColor = '#6b7280';
        } else if (isBranch) {
          badgeBg = 'rgba(99, 102, 241, 0.12)';
          badgeColor = '#6366f1';
          handleColor = '#6366f1';
        }

        return (
          <div
            key={out.name}
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              flex: 1,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                fontFamily: 'monospace',
                padding: '1px 5px',
                borderRadius: 3,
                background: badgeBg,
                color: badgeColor,
                marginBottom: 2,
                whiteSpace: 'nowrap',
              }}
            >
              {out.label || out.name}
            </span>
            <Handle
              type="source"
              id={out.name}
              position={Position.Bottom}
              style={{
                background: handleColor,
                width: 9,
                height: 9,
                bottom: -5,
                position: 'relative',
                transform: 'none',
                left: 'auto',
                border: '2px solid #ffffff',
              }}
            />
          </div>
        );
      })}
    </div>
  );
};
