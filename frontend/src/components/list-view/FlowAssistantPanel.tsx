'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, X, Minimize2, Maximize2, Loader2, Bot, User, Cpu, Settings } from 'lucide-react';
import { fetchModels, fetchSettings, executeFlowAssistant } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FlowChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  /** If the assistant response generated flow changes, they're described here */
  flowChanges?: string[];
  /** Model used to generate this response */
  modelUsed?: string;
  /** True while the assistant is streaming a reply */
  pending?: boolean;
}

export interface FlowAssistantPanelProps {
  /** Called when the panel is closed */
  onClose: () => void;
  /** Current graph name – shown as context */
  graphName?: string;
  /** Active project ID for scoping settings */
  activeProjectId?: string | null;
  /** Open Settings modal callback */
  onOpenSettings?: () => void;
  /** Current graph blocks & connections passed from FlowStudio */
  currentGraph?: {
    blocks: any[];
    connections: any[];
  };
  /** Callback when assistant generates or updates the graph */
  onApplyGraph?: (graph: { blocks: any[]; connections: any[] }) => void;
  /**
   * Optional custom send message handler.
   * If omitted, FlowAssistantPanel directly calls executeFlowAssistant via API.
   */
  onSendMessage?: (
    message: string,
    history: FlowChatMessage[],
    modelId?: string,
  ) => Promise<{
    reply: string;
    flowChanges?: string[];
    graph?: { blocks: any[]; connections: any[] };
    modelUsed?: string;
  }>;
}

// ─── Suggestion chips ─────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'Create a flow that searches AI news every morning',
  'Add a condition to filter results by score',
  'Add a Telegram notification at the end',
  'Wrap the agent step in a foreach loop',
];

// ─── FlowAssistantPanel ───────────────────────────────────────────────────────

export function FlowAssistantPanel({
  onClose,
  graphName = 'Untitled Flow',
  activeProjectId,
  onOpenSettings,
  currentGraph,
  onApplyGraph,
  onSendMessage,
}: FlowAssistantPanelProps) {
  const [messages, setMessages] = useState<FlowChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Hi! I'm your Flow Assistant. Describe what you want your flow to do and I'll build or update the graph for you.\n\nWhat would you like to create?`,
      createdAt: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Model selection state
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>(''); // '' = Use Settings Default
  const [defaultModelLabel, setDefaultModelLabel] = useState<string>('gpt-4o');

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load models and current default setting
  useEffect(() => {
    let mounted = true;
    const loadConfig = async () => {
      try {
        const [modelsList, settings] = await Promise.all([
          fetchModels(),
          fetchSettings(activeProjectId || undefined),
        ]);
        if (!mounted) return;
        setAvailableModels(modelsList || []);

        const configuredDefault =
          settings?.flowAssistantModel || settings?.flowHelperModel || 'gpt-4o';
        const match = (modelsList || []).find(
          (m: any) => m.modelId === configuredDefault || m._id === configuredDefault,
        );
        setDefaultModelLabel(match?.label || configuredDefault);
      } catch (err) {
        console.error('Failed to load models for assistant:', err);
      }
    };
    loadConfig();
    return () => {
      mounted = false;
    };
  }, [activeProjectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    const userMsg: FlowChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: msg,
      createdAt: new Date(),
    };

    const pendingMsg: FlowChatMessage = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: '',
      createdAt: new Date(),
      pending: true,
    };

    setMessages((prev) => [...prev, userMsg, pendingMsg]);
    setInput('');
    setLoading(true);

    try {
      let reply = '';
      let flowChanges: string[] | undefined = undefined;
      let modelUsed: string | undefined = undefined;
      let newGraph: { blocks: any[]; connections: any[] } | undefined = undefined;

      if (onSendMessage) {
        const res = await onSendMessage(
          msg,
          [...messages, userMsg],
          selectedModelId || undefined,
        );
        reply = res.reply;
        flowChanges = res.flowChanges;
        modelUsed = res.modelUsed;
        newGraph = res.graph;
      } else {
        const historyPayload = messages
          .filter((m) => !m.pending)
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));

        const res = await executeFlowAssistant({
          message: msg,
          projectId: activeProjectId || undefined,
          modelId: selectedModelId || undefined,
          history: historyPayload,
          currentGraph,
        });

        reply = res.reply;
        flowChanges = res.flowChanges;
        modelUsed = res.modelUsed;
        newGraph = res.graph;
      }

      // If new graph blocks exist, apply to flow state
      if (newGraph && newGraph.blocks && newGraph.blocks.length > 0 && onApplyGraph) {
        onApplyGraph(newGraph);
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingMsg.id
            ? { ...m, content: reply, flowChanges, modelUsed, pending: false }
            : m,
        ),
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingMsg.id
            ? { ...m, content: `Sorry, something went wrong: ${err?.message ?? err}`, pending: false }
            : m,
        ),
      );
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        right: 20,
        width: collapsed ? 280 : 360,
        height: collapsed ? 52 : 520,
        borderRadius: 16,
        background: '#12141f',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.15)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
        zIndex: 200,
      }}
    >
      {/* ── Header ────────────────────────────────────────── */}
      <div
        style={{
          background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
          cursor: 'pointer',
        }}
        onClick={() => collapsed && setCollapsed(false)}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: 'rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Sparkles size={14} color="white" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Flow Assistant</div>
          {!collapsed && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
              {graphName}
            </div>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setCollapsed((v) => !v); }}
          style={{ ...iconBtn }}
        >
          {collapsed ? <Maximize2 size={13} color="rgba(255,255,255,0.7)" /> : <Minimize2 size={13} color="rgba(255,255,255,0.7)" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{ ...iconBtn }}
        >
          <X size={13} color="rgba(255,255,255,0.7)" />
        </button>
      </div>

      {/* ── Model Selection Bar ──────────────────────────────── */}
      {!collapsed && (
        <div
          style={{
            padding: '6px 12px',
            background: 'rgba(0,0,0,0.3)',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 11,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, overflow: 'hidden' }}>
            <Cpu size={12} color="#a78bfa" />
            <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>Model:</span>
            <select
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#e2e8f0',
                borderRadius: 6,
                padding: '2px 8px',
                fontSize: 11,
                cursor: 'pointer',
                outline: 'none',
                maxWidth: 190,
                textOverflow: 'ellipsis',
              }}
            >
              <option value="" style={{ background: '#1e1e2f', color: '#fff' }}>
                ⚙️ Default ({defaultModelLabel})
              </option>
              {availableModels.map((m) => (
                <option key={m._id || m.modelId} value={m.modelId} style={{ background: '#1e1e2f', color: '#fff' }}>
                  {m.label || m.modelId} ({m.provider})
                </option>
              ))}
            </select>
          </div>

          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              title="Open Settings to configure AI models"
              style={{
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,0.5)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '2px 4px',
                borderRadius: 4,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.5)')}
            >
              <Settings size={13} />
            </button>
          )}
        </div>
      )}

      {/* ── Messages ──────────────────────────────────────── */}
      {!collapsed && (
        <>
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '14px 14px 4px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} />
            ))}

            {/* Suggestion chips — shown only at start */}
            {messages.length === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSend(s)}
                    disabled={loading}
                    style={{
                      padding: '7px 12px',
                      borderRadius: 8,
                      border: '1px solid rgba(99,102,241,0.25)',
                      background: 'rgba(99,102,241,0.07)',
                      color: 'rgba(255,255,255,0.55)',
                      fontSize: 11,
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    className="suggestion-chip"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* ── Input ─────────────────────────────────────── */}
          <div
            style={{
              padding: '10px 12px 12px',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 8,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10,
                padding: '8px 10px',
              }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe what you want to build or change…"
                rows={1}
                disabled={loading}
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  color: '#f1f5f9',
                  fontSize: 12,
                  resize: 'none',
                  maxHeight: 100,
                  fontFamily: 'inherit',
                  lineHeight: '1.5',
                }}
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || loading}
                style={{
                  background: input.trim() && !loading ? '#4f46e5' : 'rgba(255,255,255,0.06)',
                  border: 'none',
                  borderRadius: 7,
                  padding: '6px 8px',
                  cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }}
              >
                {loading
                  ? <Loader2 size={14} color="#818cf8" style={{ animation: 'spin 1s linear infinite' }} />
                  : <Send size={14} color={input.trim() ? 'white' : 'rgba(255,255,255,0.2)'} />}
              </button>
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 6, textAlign: 'center' }}>
              Enter to send · Shift+Enter for newline
            </div>
          </div>
        </>
      )}

      <style>{`
        .suggestion-chip:hover {
          background: rgba(99,102,241,0.15) !important;
          border-color: rgba(99,102,241,0.4) !important;
          color: #c7d2fe !important;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}

// ─── ChatBubble ───────────────────────────────────────────────────────────────

function ChatBubble({ message }: { message: FlowChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        flexDirection: isUser ? 'row-reverse' : 'row',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 8,
          background: isUser ? 'rgba(99,102,241,0.2)' : 'rgba(124,58,237,0.2)',
          border: `1px solid ${isUser ? 'rgba(99,102,241,0.3)' : 'rgba(124,58,237,0.3)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {isUser
          ? <User size={12} color="#818cf8" />
          : <Bot size={12} color="#a78bfa" />
        }
      </div>

      {/* Bubble */}
      <div style={{ maxWidth: '82%' }}>
        <div
          style={{
            padding: '9px 12px',
            borderRadius: isUser ? '10px 2px 10px 10px' : '2px 10px 10px 10px',
            background: isUser ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${isUser ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.08)'}`,
            fontSize: 12,
            lineHeight: '1.6',
            color: message.pending ? 'rgba(255,255,255,0.35)' : '#e2e8f0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {message.pending ? (
            <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <LoadingDots />
            </span>
          ) : message.content}
        </div>

        {/* Flow changes summary */}
        {message.flowChanges && message.flowChanges.length > 0 && (
          <div
            style={{
              marginTop: 6,
              padding: '7px 10px',
              borderRadius: 8,
              background: 'rgba(16,185,129,0.08)',
              border: '1px solid rgba(16,185,129,0.2)',
              fontSize: 11,
              color: '#6ee7b7',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>✓ Changes applied:</div>
            {message.flowChanges.map((change, i) => (
              <div key={i} style={{ opacity: 0.8 }}>· {change}</div>
            ))}
          </div>
        )}

        {/* Model used indicator */}
        {!isUser && !message.pending && message.modelUsed && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4, paddingLeft: 2 }}>
            ⚡ Generated with {message.modelUsed}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LoadingDots ──────────────────────────────────────────────────────────────

function LoadingDots() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.3)',
            display: 'inline-block',
            animation: `bounce 1.2s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
      `}</style>
    </>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const iconBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.1)',
  border: 'none',
  borderRadius: 6,
  padding: '4px 5px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
};
