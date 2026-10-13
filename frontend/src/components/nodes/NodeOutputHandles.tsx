'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { ToolOutput } from '@/lib/types';

interface NodeOutputHandlesProps {
  outputs: ToolOutput[];
}

export function isSuccessName(name?: string): boolean {
  if (!name) return false;
  const n = name.toLowerCase().trim();
  return (
    n === 'done' ||
    n === 'onload' ||
    n === 'success' ||
    n === 'approved' ||
    n === 'pass' ||
    n === 'true' ||
    n === 'valid'
  );
}

export function isFailureName(name?: string): boolean {
  if (!name) return false;
  const n = name.toLowerCase().trim();
  return (
    n === 'onfailed' ||
    n === 'error' ||
    n === 'rejected' ||
    n === 'fail' ||
    n === 'failed' ||
    n === 'false' ||
    n === 'invalid' ||
    n === 'incomplete_needs_human_review'
  );
}

export function classifyOutputs(outputs: ToolOutput[] = []) {
  if (!outputs || outputs.length === 0) {
    return { sideOutputs: [], bottomOutputs: [] };
  }

  // If 1 output, it's the primary bottom output
  if (outputs.length === 1) {
    return { sideOutputs: [], bottomOutputs: outputs };
  }

  // If 2 outputs: both are the two primary ones placed at the bottom
  // Sort so success is first (left) and failure is second (right)
  if (outputs.length === 2) {
    const sorted = [...outputs].sort((a, b) => {
      const isFailA = isFailureName(a.name);
      const isFailB = isFailureName(b.name);
      if (isFailA && !isFailB) return 1;
      if (!isFailA && isFailB) return -1;
      return 0;
    });
    return { sideOutputs: [], bottomOutputs: sorted };
  }

  // If > 2 outputs:
  // Identify the primary bottom outputs (success/done and failure/error)
  const successOut = outputs.find(o => isSuccessName(o.name));
  const failureOut = outputs.find(o => isFailureName(o.name));

  const bottomList: ToolOutput[] = [];
  if (successOut) bottomList.push(successOut);
  if (failureOut && failureOut !== successOut) bottomList.push(failureOut);

  // If no explicit success/failure found, but there's a 'done' or 'result' or 'default', put it in bottom
  if (bottomList.length === 0) {
    const defaultDone = outputs.find(o => o.name === 'done' || o.name === 'result' || o.name === 'default');
    if (defaultDone) bottomList.push(defaultDone);
  }

  const bottomNames = new Set(bottomList.map(o => o.name));
  const sideOutputs = outputs.filter(o => !bottomNames.has(o.name));

  return { sideOutputs, bottomOutputs: bottomList };
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

  const { sideOutputs, bottomOutputs } = classifyOutputs(outputs);

  // Group side outputs into pairs: [leftOutput, rightOutput] for each row
  const sidePairs: { left: ToolOutput; right?: ToolOutput }[] = [];
  for (let i = 0; i < sideOutputs.length; i += 2) {
    sidePairs.push({
      left: sideOutputs[i],
      right: sideOutputs[i + 1],
    });
  }

  const renderSideItem = (out: ToolOutput, side: 'left' | 'right') => {
    const isBranch = out.type === 'branch';
    const isTrue = isSuccessName(out.name);
    const isFalse = isFailureName(out.name);
    const isItemBranch = out.name === 'item';
    const isAgent = out.name.startsWith('agent_');
    const isResult = out.name === 'result' || out.name === 'lastResult';
    const isReasoning = out.name === 'reasoning' || out.name === 'thinking';
    const isToolCalls = out.name === 'toolCalls' || out.name === 'tool_calls' || out.name === 'tools';
    const isText = out.name === 'text';

    let bulletColor = 'var(--accent-primary, #6366f1)';
    let rowBg = 'rgba(255, 255, 255, 0.03)';
    let rowBorder = 'rgba(255, 255, 255, 0.08)';

    if (isResult || isTrue) {
      bulletColor = '#10b981';
      rowBg = 'rgba(16, 185, 129, 0.07)';
      rowBorder = 'rgba(16, 185, 129, 0.22)';
    } else if (isText) {
      bulletColor = '#3b82f6';
      rowBg = 'rgba(59, 130, 246, 0.07)';
      rowBorder = 'rgba(59, 130, 246, 0.22)';
    } else if (isReasoning) {
      bulletColor = '#8b5cf6';
      rowBg = 'rgba(139, 92, 246, 0.07)';
      rowBorder = 'rgba(139, 92, 246, 0.22)';
    } else if (isToolCalls) {
      bulletColor = '#06b6d4';
      rowBg = 'rgba(6, 182, 212, 0.07)';
      rowBorder = 'rgba(6, 182, 212, 0.22)';
    } else if (isItemBranch) {
      bulletColor = '#f97316';
      rowBg = 'rgba(249, 115, 22, 0.07)';
      rowBorder = 'rgba(249, 115, 22, 0.22)';
    } else if (isAgent || isBranch) {
      bulletColor = '#6366f1';
      rowBg = 'rgba(99, 102, 241, 0.07)';
      rowBorder = 'rgba(99, 102, 241, 0.22)';
    } else if (isFalse) {
      bulletColor = '#ef4444';
      rowBg = 'rgba(239, 68, 68, 0.07)';
      rowBorder = 'rgba(239, 68, 68, 0.22)';
    }

    const isLeft = side === 'left';

    return (
      <div
        key={out.name}
        style={{
          flex: 1,
          minWidth: 0,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isLeft ? 'flex-start' : 'flex-end',
          gap: 5,
          padding: '4px 6px',
          paddingLeft: isLeft ? 11 : 6,
          paddingRight: isLeft ? 6 : 11,
          borderRadius: 5,
          background: rowBg,
          border: `1px solid ${rowBorder}`,
          minHeight: 25,
          boxSizing: 'border-box',
        }}
      >
        {/* Handle positioned directly on left or right node edge */}
        <Handle
          type="source"
          id={out.name}
          position={isLeft ? Position.Left : Position.Right}
          style={{
            position: 'absolute',
            ...(isLeft ? { left: -5 } : { right: -5 }),
            top: '50%',
            transform: 'translateY(-50%)',
            background: bulletColor,
            width: 9,
            height: 9,
            borderRadius: '50%',
            border: '2px solid #ffffff',
            boxShadow: `0 0 0 1px ${bulletColor}44`,
            zIndex: 10,
            cursor: 'crosshair',
          }}
        />

        {isLeft ? (
          <>
            <span style={{ fontSize: 8.5, color: bulletColor, fontWeight: 800 }}>◀</span>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={out.label || out.name}
            >
              {out.label || out.name}
            </span>
          </>
        ) : (
          <>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={out.label || out.name}
            >
              {out.label || out.name}
            </span>
            <span style={{ fontSize: 8.5, color: bulletColor, fontWeight: 800 }}>▶</span>
          </>
        )}
      </div>
    );
  };

  return (
    <div style={{ marginTop: 8 }}>
      {/* Side Outputs: Two outputs per row (one left, one right) */}
      {sidePairs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {sidePairs.map((pair, idx) => (
            <div
              key={pair.left.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                position: 'relative',
              }}
            >
              {/* Left output node in this row */}
              {renderSideItem(pair.left, 'left')}

              {/* Right output node in this row (if present) */}
              {pair.right ? (
                renderSideItem(pair.right, 'right')
              ) : (
                <div style={{ flex: 1, minWidth: 0 }} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Bottom Outputs: Two primary ones at the bottom (like successful / failed, or single completion) */}
      {bottomOutputs.length > 0 && (
        <div
          style={{
            display: bottomOutputs.length === 1 ? 'flex' : 'grid',
            gridTemplateColumns: bottomOutputs.length === 2 ? '1fr 1fr' : undefined,
            justifyContent: bottomOutputs.length === 1 ? 'center' : undefined,
            gap: 6,
            marginTop: sidePairs.length > 0 ? 8 : 4,
            paddingTop: sidePairs.length > 0 ? 6 : 4,
            borderTop: sidePairs.length > 0 ? '1px dashed var(--border-color, rgba(255,255,255,0.08))' : 'none',
            position: 'relative',
          }}
        >
          {bottomOutputs.map((out) => {
            const isSuccess = isSuccessName(out.name);
            const isFail = isFailureName(out.name);

            const btnColor = isSuccess ? '#10b981' : isFail ? '#ef4444' : 'var(--accent-primary, #6366f1)';
            const btnBg = isSuccess
              ? 'rgba(16, 185, 129, 0.09)'
              : isFail
              ? 'rgba(239, 68, 68, 0.09)'
              : 'rgba(99, 102, 241, 0.09)';
            const btnBorder = isSuccess
              ? 'rgba(16, 185, 129, 0.28)'
              : isFail
              ? 'rgba(239, 68, 68, 0.28)'
              : 'rgba(99, 102, 241, 0.28)';

            const icon = isSuccess ? '✓' : isFail ? '✕' : '↓';

            return (
              <div
                key={out.name}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  padding: '4px 6px',
                  borderRadius: 5,
                  background: btnBg,
                  border: `1px solid ${btnBorder}`,
                  minHeight: 24,
                  boxSizing: 'border-box',
                  textAlign: 'center',
                  flex: bottomOutputs.length === 1 ? '0 1 180px' : undefined,
                }}
              >
                <span style={{ fontSize: 9.5, fontWeight: 800, color: btnColor }}>{icon}</span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={out.label || out.name}
                >
                  {out.label || out.name}
                </span>

                {/* Bottom handle centered under this button */}
                <Handle
                  type="source"
                  id={out.name}
                  position={Position.Bottom}
                  style={{
                    position: 'absolute',
                    bottom: -5,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: btnColor,
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    border: '2px solid #ffffff',
                    boxShadow: `0 0 0 1px ${btnColor}44`,
                    zIndex: 10,
                    cursor: 'crosshair',
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Hidden fallback flow handle to maintain backwards compatibility for edges without explicit handle */}
      <Handle
        type="source"
        id="flow"
        position={Position.Bottom}
        style={{
          width: 1,
          height: 1,
          bottom: -5,
          left: '50%',
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};
