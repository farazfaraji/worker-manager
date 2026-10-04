'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, X, Minimize2, Maximize2, Loader2, Bot, User, Cpu, Settings } from 'lucide-react';
import { fetchModels, fetchSettings, executeFlowAssistant } from '@/lib/api';
import {
  AssistantMode,
  BlockReference,
  ClarifyingQuestion,
  FlowOperation,
  FlowOutline,
  describeOperation,
} from '@/lib/flow-assistant';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FlowChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  flowChanges?: string[];
  assumptions?: string[];
  modelUsed?: string;
  pending?: boolean;
  mode?: AssistantMode;
  questions?: ClarifyingQuestion[];
  outline?: FlowOutline;
  operations?: FlowOperation[];
  references?: BlockReference[];
  cardStatus?: 'open' | 'answered' | 'applied' | 'discarded';
}

export interface FlowAssistantPanelProps {
  onClose: () => void;
  graphName?: string;
  activeProjectId?: string | null;
  onOpenSettings?: () => void;
  currentGraph?: {
    blocks: any[];
    connections: any[];
  };
  selectedBlockIds?: string[];
  onApplyGraph?: (graph: { blocks: any[]; connections: any[] }) => void;
  onFocusBlock?: (ids: string[], opts?: { pan?: boolean }) => void;
  onPreviewOperations?: (ops: FlowOperation[] | null) => void;
  onApplyOperations?: (ops: FlowOperation[]) => void;
  onUndoAssistant?: () => void;
  onSendMessage?: (
    message: string,
    history: FlowChatMessage[],
    modelId?: string,
    extras?: SendExtras,
  ) => Promise<{
    mode?: AssistantMode;
    reply: string;
    flowChanges?: string[];
    assumptions?: string[];
    graph?: { blocks: any[]; connections: any[] };
    operations?: FlowOperation[];
    questions?: ClarifyingQuestion[];
    outline?: FlowOutline;
    references?: BlockReference[];
    modelUsed?: string;
  }>;
}

interface SendExtras {
  answers?: Record<string, string>;
  skipClarification?: boolean;
  confirmed?: boolean;
  confirmedOutline?: FlowOutline;
}

interface SendOptions extends SendExtras {
  message: string;
  displayText?: string;
}

const SUGGESTIONS = [
  'Create a flow that searches AI news every morning',
  'Where is the web search?',
  'Add a Telegram notification at the end',
  'What does the agent step do?',
];

export function FlowAssistantPanel({
  onClose,
  graphName = 'Untitled Flow',
  activeProjectId,
  onOpenSettings,
  currentGraph,
  selectedBlockIds,
  onApplyGraph,
  onFocusBlock,
  onPreviewOperations,
  onApplyOperations,
  onUndoAssistant,
  onSendMessage,
}: FlowAssistantPanelProps) {
  const [messages, setMessages] = useState<FlowChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Hi! I'm your Flow Assistant. Describe a flow and I'll ask a couple of questions if something important is unclear, then show an outline before I build it.\n\nYou can also ask about the current flow, or ask me to change it.`,
      createdAt: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [defaultModelLabel, setDefaultModelLabel] = useState<string>('gpt-4o');

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);

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

  const blockLabel = (id: string, message?: FlowChatMessage) => {
    const added = message?.operations?.find(
      (operation) => operation.op === 'addBlock' && operation.block.id === id,
    );
    if (added && added.op === 'addBlock') return added.block.label || added.block.name || id;
    const step = message?.outline?.steps.find((item) => item.id === id);
    if (step) return step.summary;
    const block = currentGraph?.blocks?.find((item) => item.id === id);
    return block?.label || block?.name || id;
  };

  const handleSend = async (textOrOptions?: string | SendOptions) => {
    const options: SendOptions =
      typeof textOrOptions === 'string' || textOrOptions == null
        ? { message: (textOrOptions ?? input).trim() }
        : textOrOptions;
    const msg = options.message.trim();
    if (!msg || sendingRef.current) return;

    sendingRef.current = true;
    onPreviewOperations?.(null);

    const userMsg: FlowChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: options.displayText || msg,
      createdAt: new Date(),
    };
    const pendingMsg: FlowChatMessage = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: '',
      createdAt: new Date(),
      pending: true,
    };

    const historyPayload = messages
      .filter((message) => !message.pending && message.id !== 'welcome')
      .map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
        mode: message.mode,
        payload:
          message.mode === 'clarify'
            ? { questions: message.questions }
            : message.mode === 'confirm'
              ? { outline: message.outline }
              : undefined,
      }));

    setMessages((prev) => [
      ...prev.map((message) =>
        message.cardStatus === 'open'
          ? { ...message, cardStatus: message.mode === 'edit' ? 'discarded' as const : 'answered' as const }
          : message,
      ),
      userMsg,
      pendingMsg,
    ]);
    setInput('');
    setLoading(true);

    try {
      const res = onSendMessage
        ? await onSendMessage(msg, [...messages, userMsg], selectedModelId || undefined, options)
        : await executeFlowAssistant({
            message: msg,
            projectId: activeProjectId || undefined,
            modelId: selectedModelId || undefined,
            history: historyPayload,
            currentGraph,
            focusBlockIds: selectedBlockIds,
            answers: options.answers,
            skipClarification: options.skipClarification,
            confirmed: options.confirmed,
            confirmedOutline: options.confirmedOutline,
          });

      const mode = res.mode;
      if ((mode === 'build' || (!mode && res.graph?.blocks?.length)) && res.graph) {
        onApplyGraph?.(res.graph);
      }
      if (mode === 'edit' && res.operations?.length) {
        onPreviewOperations?.(res.operations);
      }
      if (mode === 'answer') {
        const primary = res.references?.find((reference) => reference.role === 'primary');
        if (primary) onFocusBlock?.([primary.blockId]);
      }

      setMessages((prev) =>
        prev.map((message) =>
          message.id === pendingMsg.id
            ? {
                ...message,
                content: res.reply,
                mode,
                flowChanges: res.flowChanges,
                assumptions: res.assumptions,
                questions: res.questions,
                outline: res.outline,
                operations: res.operations,
                references: res.references,
                modelUsed: res.modelUsed,
                pending: false,
                cardStatus:
                  mode === 'clarify' || mode === 'confirm' || mode === 'edit' ? 'open' : undefined,
              }
            : message,
        ),
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === pendingMsg.id
            ? { ...message, content: `Sorry, something went wrong: ${err?.message ?? err}`, pending: false }
            : message,
        ),
      );
    } finally {
      sendingRef.current = false;
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
        width: collapsed ? 280 : 400,
        height: collapsed ? 52 : 600,
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
                maxWidth: 210,
                textOverflow: 'ellipsis',
              }}
            >
              <option value="" style={{ background: '#1e1e2f', color: '#fff' }}>
                Default ({defaultModelLabel})
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
              <ChatBubble
                key={msg.id}
                message={msg}
                blockLabel={(id) => blockLabel(id, msg)}
                loading={loading}
                onFocusBlock={onFocusBlock}
                onSubmitAnswers={(answers) => {
                  const summary = Object.entries(answers)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('\n');
                  handleSend({
                    message: summary || 'Here are my answers.',
                    displayText: summary || 'Here are my answers.',
                    answers,
                  });
                }}
                onSkip={() =>
                  handleSend({
                    message: 'Skip the questions and use sensible defaults.',
                    displayText: 'Skip, use defaults.',
                    skipClarification: true,
                  })
                }
                onConfirm={(outline) =>
                  handleSend({
                    message: 'Build it.',
                    displayText: 'Build it.',
                    confirmed: true,
                    confirmedOutline: outline,
                  })
                }
                onChangeOutline={() => inputRef.current?.focus()}
                onApplyEdit={(operations) => {
                  onApplyOperations?.(operations);
                  setMessages((prev) =>
                    prev.map((item) =>
                      item.id === msg.id ? { ...item, cardStatus: 'applied' } : item,
                    ),
                  );
                }}
                onDiscardEdit={() => {
                  onPreviewOperations?.(null);
                  setMessages((prev) =>
                    prev.map((item) =>
                      item.id === msg.id ? { ...item, cardStatus: 'discarded' } : item,
                    ),
                  );
                }}
                onUndoEdit={(operations) => {
                  onUndoAssistant?.();
                  setMessages((prev) =>
                    prev.map((item) =>
                      item.id === msg.id
                        ? { ...item, cardStatus: operations.length > 0 ? 'open' : 'discarded' }
                        : item,
                    ),
                  );
                  if (operations.length > 0) onPreviewOperations?.(operations);
                }}
              />
            ))}

            {messages.length === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => handleSend(suggestion)}
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
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

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
                placeholder="Describe a flow, ask about it, or request a change…"
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

function ChatBubble({
  message,
  blockLabel,
  loading,
  onFocusBlock,
  onSubmitAnswers,
  onSkip,
  onConfirm,
  onChangeOutline,
  onApplyEdit,
  onDiscardEdit,
  onUndoEdit,
}: {
  message: FlowChatMessage;
  blockLabel: (id: string) => string;
  loading: boolean;
  onFocusBlock?: (ids: string[], opts?: { pan?: boolean }) => void;
  onSubmitAnswers: (answers: Record<string, string>) => void;
  onSkip: () => void;
  onConfirm: (outline: FlowOutline) => void;
  onChangeOutline: () => void;
  onApplyEdit: (operations: FlowOperation[]) => void;
  onDiscardEdit: () => void;
  onUndoEdit: (operations: FlowOperation[]) => void;
}) {
  const isUser = message.role === 'user';
  const showApplied =
    !!message.flowChanges?.length &&
    (message.mode === 'build' || message.cardStatus === 'applied');

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        flexDirection: isUser ? 'row-reverse' : 'row',
        animation: 'fadeIn 0.2s ease',
      }}
    >
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
        {isUser ? <User size={12} color="#818cf8" /> : <Bot size={12} color="#a78bfa" />}
      </div>

      <div style={{ maxWidth: '88%', minWidth: 0, flex: 1 }}>
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
          ) : (
            <ReplyText content={message.content} blockLabel={blockLabel} onFocusBlock={onFocusBlock} />
          )}
        </div>

        {message.mode === 'clarify' && message.questions && message.cardStatus === 'open' && (
          <QuestionCard
            questions={message.questions}
            disabled={loading}
            onFocusBlock={onFocusBlock}
            onSubmit={onSubmitAnswers}
            onSkip={onSkip}
          />
        )}

        {message.mode === 'confirm' && message.outline && message.cardStatus === 'open' && (
          <OutlineCard
            outline={message.outline}
            disabled={loading}
            onConfirm={() => onConfirm(message.outline!)}
            onChange={onChangeOutline}
          />
        )}

        {message.mode === 'edit' && message.operations && message.operations.length > 0 && (
          <EditCard
            operations={message.operations}
            notes={message.cardStatus === 'applied' ? undefined : message.flowChanges}
            status={message.cardStatus}
            disabled={loading}
            onApply={() => onApplyEdit(message.operations!)}
            onDiscard={onDiscardEdit}
            onUndo={() => onUndoEdit(message.operations!)}
          />
        )}

        {message.assumptions && message.assumptions.length > 0 && message.mode === 'build' && (
          <div
            style={{
              marginTop: 6,
              padding: '7px 10px',
              borderRadius: 8,
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.25)',
              fontSize: 11,
              color: '#fcd34d',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Assumptions</div>
            {message.assumptions.map((assumption, index) => (
              <div key={index} style={{ opacity: 0.85 }}>· {assumption}</div>
            ))}
          </div>
        )}

        {showApplied && (
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
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Changes applied</div>
            {message.flowChanges!.map((change, index) => (
              <div key={index} style={{ opacity: 0.8 }}>· {change}</div>
            ))}
          </div>
        )}

        {message.mode === 'build' && message.cardStatus !== 'discarded' && (
          <button type="button" onClick={() => onUndoEdit([])} style={{ ...textBtn, marginTop: 6 }}>
            Undo
          </button>
        )}

        {!isUser && !message.pending && message.modelUsed && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4, paddingLeft: 2 }}>
            Generated with {message.modelUsed}
          </div>
        )}
      </div>
    </div>
  );
}

function ReplyText({
  content,
  blockLabel,
  onFocusBlock,
}: {
  content: string;
  blockLabel: (id: string) => string;
  onFocusBlock?: (ids: string[], opts?: { pan?: boolean }) => void;
}) {
  const parts = content.split(/(\[\[[^\]]+\]\])/g);
  return (
    <>
      {parts.map((part, index) => {
        const match = part.match(/^\[\[([^\]]+)\]\]$/);
        if (!match) return <span key={index}>{part}</span>;
        const id = match[1];
        return (
          <button
            key={index}
            type="button"
            onClick={() => onFocusBlock?.([id])}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              margin: '0 2px',
              padding: '0 6px',
              borderRadius: 999,
              border: '1px solid rgba(129,140,248,0.45)',
              background: 'rgba(99,102,241,0.18)',
              color: '#c7d2fe',
              fontSize: 11,
              cursor: 'pointer',
              verticalAlign: 'baseline',
            }}
          >
            {blockLabel(id)}
          </button>
        );
      })}
    </>
  );
}

function QuestionCard({
  questions,
  disabled,
  onFocusBlock,
  onSubmit,
  onSkip,
}: {
  questions: ClarifyingQuestion[];
  disabled: boolean;
  onFocusBlock?: (ids: string[], opts?: { pan?: boolean }) => void;
  onSubmit: (answers: Record<string, string>) => void;
  onSkip: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});

  const submit = () => {
    const answers: Record<string, string> = {};
    for (const question of questions) {
      const text = (texts[question.id] || '').trim();
      const option = question.options?.find((item) => item.id === choices[question.id]);
      answers[question.id] = text || option?.label || question.default || 'Use a sensible default';
    }
    onSubmit(answers);
  };

  return (
    <div style={cardStyle}>
      {questions.map((question) => (
        <div key={question.id} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600 }}>{question.question}</div>
          {question.why && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{question.why}</div>
          )}
          {question.options && question.options.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {question.options.map((option) => {
                const selected = choices[question.id] === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={disabled}
                    onMouseEnter={() => option.blockId && onFocusBlock?.([option.blockId], { pan: false })}
                    onClick={() => {
                      setChoices((prev) => ({ ...prev, [question.id]: option.id }));
                      if (option.blockId) onFocusBlock?.([option.blockId]);
                    }}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 999,
                      border: `1px solid ${selected ? 'rgba(129,140,248,0.8)' : 'rgba(255,255,255,0.12)'}`,
                      background: selected ? 'rgba(99,102,241,0.28)' : 'rgba(255,255,255,0.04)',
                      color: selected ? '#e0e7ff' : 'rgba(255,255,255,0.7)',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
          {question.allowFreeText && (
            <input
              value={texts[question.id] || ''}
              disabled={disabled}
              onChange={(event) => setTexts((prev) => ({ ...prev, [question.id]: event.target.value }))}
              placeholder={question.default ? `Or type your own (default: ${question.default})` : 'Or type your own answer'}
              style={{
                width: '100%',
                marginTop: 6,
                boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                color: '#e2e8f0',
                fontSize: 11,
                padding: '5px 8px',
                outline: 'none',
              }}
            />
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={disabled} onClick={submit} style={primaryBtn}>
          Build it
        </button>
        <button type="button" disabled={disabled} onClick={onSkip} style={textBtn}>
          Skip, use defaults
        </button>
      </div>
    </div>
  );
}

function OutlineCard({
  outline,
  disabled,
  onConfirm,
  onChange,
}: {
  outline: FlowOutline;
  disabled: boolean;
  onConfirm: () => void;
  onChange: () => void;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{outline.title}</div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
        Trigger: {outline.trigger}
      </div>
      <ol style={{ margin: '8px 0 0', paddingLeft: 18, color: '#e2e8f0', fontSize: 11 }}>
        {outline.steps.map((step) => (
          <li key={step.id} style={{ marginBottom: 3 }}>
            {step.summary} <span style={{ color: 'rgba(255,255,255,0.35)' }}>({step.kind})</span>
          </li>
        ))}
      </ol>
      {outline.outputs.length > 0 && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>
          Output: {outline.outputs.join(', ')}
        </div>
      )}
      {outline.assumptions.length > 0 && (
        <div style={{ fontSize: 11, color: '#fcd34d', marginTop: 6 }}>
          {outline.assumptions.map((assumption) => (
            <div key={assumption}>· {assumption}</div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" disabled={disabled} onClick={onConfirm} style={primaryBtn}>
          Build it
        </button>
        <button type="button" disabled={disabled} onClick={onChange} style={textBtn}>
          Change something
        </button>
      </div>
    </div>
  );
}

function EditCard({
  operations,
  notes,
  status,
  disabled,
  onApply,
  onDiscard,
  onUndo,
}: {
  operations: FlowOperation[];
  notes?: string[];
  status?: FlowChatMessage['cardStatus'];
  disabled: boolean;
  onApply: () => void;
  onDiscard: () => void;
  onUndo: () => void;
}) {
  return (
    <div style={cardStyle}>
      {operations.map((operation, index) => (
        <div key={index} style={{ fontSize: 11, color: '#e2e8f0', marginBottom: 3 }}>
          · {describeOperation(operation)}
        </div>
      ))}
      {notes && notes.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(252, 211, 77, 0.85)' }}>
          {notes.map((note, index) => (
            <div key={index}>· {note}</div>
          ))}
        </div>
      )}
      {status === 'open' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" disabled={disabled} onClick={onApply} style={primaryBtn}>
            Apply
          </button>
          <button type="button" disabled={disabled} onClick={onDiscard} style={textBtn}>
            Discard
          </button>
        </div>
      )}
      {status === 'applied' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#6ee7b7' }}>Applied</span>
          <button type="button" disabled={disabled} onClick={onUndo} style={textBtn}>
            Undo
          </button>
        </div>
      )}
      {status === 'discarded' && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>Discarded</div>
      )}
    </div>
  );
}

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

const iconBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.1)',
  border: 'none',
  borderRadius: 6,
  padding: '4px 5px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
};

const cardStyle: React.CSSProperties = {
  marginTop: 6,
  padding: '8px 10px',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
};

const primaryBtn: React.CSSProperties = {
  background: '#4f46e5',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 11,
  cursor: 'pointer',
};

const textBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'rgba(255,255,255,0.65)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 11,
  cursor: 'pointer',
};
