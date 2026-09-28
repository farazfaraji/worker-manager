'use client';

import React from 'react';
import { AlertCircle, Sparkles, MessageSquare } from 'lucide-react';
import { Node } from '@xyflow/react';
import { FlowNodeData } from '@/lib/types';

interface ExecutionInputTabProps {
  inputJson: string;
  setInputJson: (val: string) => void;
  jsonError: string | null;
  setJsonError: (err: string | null) => void;
  /** The human-input trigger node (if any) in the current graph */
  humanInputNode?: Node<FlowNodeData> | null;
}

export const ExecutionInputTab: React.FC<ExecutionInputTabProps> = ({
  inputJson,
  setInputJson,
  jsonError,
  setJsonError,
  humanInputNode,
}) => {
  // Derive human-input config
  const humanCfg = humanInputNode?.data?.config as Record<string, any> | undefined;
  const isHumanInput = !!humanInputNode && humanCfg?.triggerType === 'human-input';
  const question = isHumanInput
    ? String(humanCfg?.question || 'Please enter your input to start the flow.')
    : '';
  const inputKey = isHumanInput ? String(humanCfg?.inputKey || 'userInput') : 'userInput';

  // ── Human-Input answer state (plain text)
  const [humanText, setHumanText] = React.useState('');

  // Keep inputJson in sync when human-input mode is active
  React.useEffect(() => {
    if (!isHumanInput) return;
    try {
      setInputJson(JSON.stringify({ [inputKey]: humanText }));
      setJsonError(null);
    } catch {
      // noop
    }
  }, [humanText, inputKey, isHumanInput]);

  const handleJsonChange = (val: string) => {
    setInputJson(val);
    try {
      if (val.trim() === '') {
        setJsonError(null);
      } else {
        JSON.parse(val);
        setJsonError(null);
      }
    } catch (e: any) {
      setJsonError(e.message);
    }
  };

  const setSampleInput = (sample: string) => {
    setInputJson(sample);
    setJsonError(null);
  };

  // ── HUMAN INPUT MODE ──────────────────────────────────────────
  if (isHumanInput) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Question card */}
        <div
          style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            border: '1px solid var(--accent-border, #334155)',
            borderRadius: 'var(--radius-md, 8px)',
            padding: '18px 20px',
            display: 'flex',
            gap: 14,
            alignItems: 'flex-start',
          }}
        >
          <MessageSquare size={20} color="var(--accent-primary, #6366f1)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--accent-primary, #6366f1)',
                marginBottom: 6,
              }}
            >
              Human Input Required
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 14,
                lineHeight: '1.6',
                color: '#e2e8f0',
                fontWeight: 500,
              }}
            >
              {question}
            </p>
          </div>
        </div>

        {/* Answer textarea */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: 8,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            Your Answer
          </label>
          <textarea
            value={humanText}
            onChange={(e) => setHumanText(e.target.value)}
            placeholder="Type your response here…"
            rows={6}
            autoFocus
            style={{
              width: '100%',
              padding: 14,
              fontFamily: 'inherit',
              fontSize: 14,
              lineHeight: '1.6',
              color: 'var(--text-primary)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              outline: 'none',
              resize: 'vertical',
              boxSizing: 'border-box',
              transition: 'border-color 0.15s',
            }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--accent-primary, #6366f1)')}
            onBlur={(e) => (e.target.style.borderColor = 'var(--border-color)')}
          />
          {humanText.trim() === '' && (
            <div
              style={{
                marginTop: 6,
                fontSize: 11.5,
                color: 'var(--text-muted, #94a3b8)',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <AlertCircle size={12} />
              <span>Your answer is required before the flow can start.</span>
            </div>
          )}
        </div>

        {/* Info pill showing the variable key */}
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-muted, #64748b)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Sparkles size={13} color="var(--accent-primary, #6366f1)" />
          Your answer will be available downstream as{' '}
          <code
            style={{
              background: 'var(--bg-subtle)',
              padding: '1px 6px',
              borderRadius: 4,
              fontSize: 11.5,
              fontFamily: 'monospace',
              color: 'var(--accent-primary, #6366f1)',
            }}
          >
            trigger.{inputKey}
          </code>
        </div>
      </div>
    );
  }

  // ── JSON MODE (existing) ──────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            Initial Flow Input (JSON)
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => setSampleInput('{}')}
              style={{
                fontSize: 11,
                padding: '3px 8px',
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-color)',
                borderRadius: 4,
                cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              Empty &#123;&#125;
            </button>
            <button
              type="button"
              onClick={() =>
                setSampleInput(
                  JSON.stringify(
                    {
                      query: 'Summarize agent architecture',
                      user: { id: 'u_101', name: 'Faraz' },
                    },
                    null,
                    2,
                  ),
                )
              }
              style={{
                fontSize: 11,
                padding: '3px 8px',
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-color)',
                borderRadius: 4,
                cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              Sample Object
            </button>
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            border: `1px solid ${jsonError ? 'var(--danger)' : 'var(--border-color)'}`,
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            background: '#0f172a',
          }}
        >
          <textarea
            value={inputJson}
            onChange={(e) => handleJsonChange(e.target.value)}
            placeholder="Enter JSON input for trigger/root nodes..."
            rows={12}
            style={{
              width: '100%',
              padding: 14,
              fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 13,
              lineHeight: '1.5',
              color: '#f8fafc',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {jsonError && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: 'var(--danger)',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <AlertCircle size={13} />
            <span>{jsonError}</span>
          </div>
        )}
      </div>

      <div
        style={{
          background: 'var(--accent-subtle)',
          border: '1px solid var(--accent-border)',
          borderRadius: 'var(--radius-md)',
          padding: 14,
          fontSize: 12.5,
          color: 'var(--text-secondary)',
          display: 'flex',
          gap: 10,
        }}
      >
        <Sparkles size={18} color="var(--accent-primary)" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong style={{ color: 'var(--accent-primary)', display: 'block', marginBottom: 2 }}>
            How execution input works:
          </strong>
          This JSON payload is fed directly to your root / Trigger nodes as initial input and is accessible across
          the graph context. Nodes execute in topological dependency order.
        </div>
      </div>
    </div>
  );
};
