'use client';

import React, { useState, useEffect } from 'react';
import { LLMModel } from '@/lib/types';
import { fetchModels, fetchSettings, revisePrompt } from '@/lib/api';
import {
  Sparkles,
  X,
  Loader2,
  Check,
  Copy,
  ArrowRight,
  RotateCcw,
  Zap,
  Shield,
  FileCode,
  Wand2,
  SlidersHorizontal,
  Bot,
  AlertCircle,
  Clock,
} from 'lucide-react';

interface RevisePromptModalProps {
  isOpen: boolean;
  currentPrompt: string;
  onClose: () => void;
  onApply: (revisedPrompt: string) => void;
  fieldName?: string;
  nodeName?: string;
}

const PRESET_INSTRUCTIONS = [
  {
    id: 'optimize',
    label: '✨ Optimize & Structure',
    description: 'Clear role, numbered steps, guidelines, and constraints',
    instruction: 'Structure this system prompt with a well-defined role, actionable step-by-step instructions, operational guidelines, and error-handling constraints.',
  },
  {
    id: 'concise',
    label: '⚡ Make Concise',
    description: 'Crisp, direct, zero fluff',
    instruction: 'Make this prompt concise, punchy, and direct. Eliminate filler phrases while preserving all rules and mustache variables.',
  },
  {
    id: 'guardrails',
    label: '🛡️ Add Guardrails',
    description: 'Strict validation & anti-hallucination',
    instruction: 'Add strict guardrails, boundary constraints, and safety checks to prevent hallucinations, out-of-scope actions, and invalid outputs.',
  },
  {
    id: 'json_mode',
    label: '🎯 Strict Format & JSON',
    description: 'Precision output schema adherence',
    instruction: 'Reinforce strict output formatting instructions and adherence to structured schemas without conversational chatter.',
  },
];

export const RevisePromptModal: React.FC<RevisePromptModalProps> = ({
  isOpen,
  currentPrompt,
  onClose,
  onApply,
  fieldName = 'System Prompt',
  nodeName,
}) => {
  const [promptText, setPromptText] = useState(currentPrompt);
  const [instruction, setInstruction] = useState('');
  const [models, setModels] = useState<LLMModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [flowHelperDefaultModel, setFlowHelperDefaultModel] = useState<string>('');
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(false);
  const [isRevising, setIsRevising] = useState<boolean>(false);
  const [revisedPrompt, setRevisedPrompt] = useState<string>('');
  const [revisedMeta, setRevisedMeta] = useState<{ model: string; modelId: string; provider: string; durationMs?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  // Load models & settings on mount / open
  useEffect(() => {
    if (isOpen) {
      setPromptText(currentPrompt);
      setRevisedPrompt('');
      setRevisedMeta(null);
      setError(null);
      setInstruction('');
      setSelectedPresetId(null);
      setIsLoadingModels(true);

      Promise.all([fetchModels(), fetchSettings()])
        .then(([modelsList, settings]) => {
          setModels(modelsList || []);
          const helperModel = settings?.flowHelperModel;
          if (helperModel) {
            setFlowHelperDefaultModel(helperModel);
            setSelectedModelId(helperModel);
          } else {
            const def = (modelsList || []).find((m) => m.isDefault);
            const fallback = def?.modelId || modelsList?.[0]?.modelId || 'gpt-4o';
            setFlowHelperDefaultModel(fallback);
            setSelectedModelId(fallback);
          }
        })
        .catch(() => {
          setSelectedModelId('gpt-4o');
        })
        .finally(() => {
          setIsLoadingModels(false);
        });
    }
  }, [isOpen, currentPrompt]);

  if (!isOpen) return null;

  const handlePresetClick = (preset: typeof PRESET_INSTRUCTIONS[0]) => {
    if (selectedPresetId === preset.id) {
      setSelectedPresetId(null);
      setInstruction('');
    } else {
      setSelectedPresetId(preset.id);
      setInstruction(preset.instruction);
    }
  };

  const handleRevise = async () => {
    try {
      setIsRevising(true);
      setError(null);
      const startTime = Date.now();

      const res = await revisePrompt({
        prompt: promptText,
        instruction: instruction.trim() || undefined,
        modelId: selectedModelId || undefined,
      });

      const durationMs = Date.now() - startTime;
      setRevisedPrompt(res.revisedPrompt);
      setRevisedMeta({
        model: res.model,
        modelId: res.modelId,
        provider: res.provider,
        durationMs,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to revise prompt. Please check your model configuration.');
    } finally {
      setIsRevising(false);
    }
  };

  const handleCopy = () => {
    const textToCopy = revisedPrompt || promptText;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApply = () => {
    if (revisedPrompt) {
      onApply(revisedPrompt);
    } else {
      onApply(promptText);
    }
    onClose();
  };

  const currentHelperModelObj = models.find(
    (m) => m.modelId === selectedModelId || m._id === selectedModelId,
  );

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(5px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isRevising) {
          onClose();
        }
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 820,
          maxHeight: '92vh',
          backgroundColor: '#ffffff',
          borderRadius: 16,
          boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0,0,0,0.06)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'fadeInScale 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(to right, #f8faff, #ffffff)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                boxShadow: '0 4px 10px rgba(99, 102, 241, 0.3)',
              }}
            >
              <Sparkles size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                  Revise {fieldName}
                </h3>
                {nodeName && (
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: 'monospace',
                      padding: '2px 7px',
                      borderRadius: 4,
                      background: '#f1f5f9',
                      color: '#475569',
                      fontWeight: 600,
                    }}
                  >
                    ${nodeName}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 12, color: '#64748b', margin: 0, marginTop: 2 }}>
                Refine, structure, and optimize your system prompt using the Flow Helper LLM.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isRevising}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                padding: '6px',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Top Bar: Model Selector & Flow Helper LLM Info */}
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#f8fafc',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: '#e0e7ff',
                  color: '#4f46e5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Bot size={16} />
              </div>
              <div>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1e293b' }}>
                  Flow Helper LLM:
                </span>
                <span style={{ fontSize: 12, color: '#64748b', marginLeft: 6 }}>
                  {currentHelperModelObj?.label || selectedModelId || 'Default Model'}
                  {currentHelperModelObj?.provider && ` (${currentHelperModelObj.provider.toUpperCase()})`}
                </span>
              </div>
            </div>

            {/* Switch Model Dropdown */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11.5, color: '#64748b' }}>Model:</span>
              {isLoadingModels ? (
                <Loader2 size={14} className="animate-spin text-muted" />
              ) : (
                <select
                  value={selectedModelId}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                  disabled={isRevising}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    fontSize: 12,
                    backgroundColor: '#ffffff',
                    color: '#1e293b',
                    fontWeight: 500,
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {models.length === 0 ? (
                    <option value="gpt-4o">gpt-4o (Default)</option>
                  ) : (
                    models.map((m) => (
                      <option key={m._id || m.modelId} value={m.modelId}>
                        {m.label} ({m.modelId})
                        {m.modelId === flowHelperDefaultModel ? ' [Default Helper]' : ''}
                      </option>
                    ))
                  )}
                </select>
              )}
            </div>
          </div>

          {/* Quick Preset Buttons */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 8 }}>
              Quick Revision Goals:
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {PRESET_INSTRUCTIONS.map((preset) => {
                const isSelected = selectedPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handlePresetClick(preset)}
                    disabled={isRevising}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      border: isSelected
                        ? '1px solid #6366f1'
                        : '1px solid #e2e8f0',
                      background: isSelected ? '#eef2ff' : '#ffffff',
                      color: isSelected ? '#4338ca' : '#475569',
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 1px 3px rgba(99, 102, 241, 0.2)' : 'none',
                    }}
                    title={preset.description}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional Revision Instructions Input */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
              Custom Revision Instructions (Optional):
            </label>
            <input
              type="text"
              value={instruction}
              onChange={(e) => {
                setInstruction(e.target.value);
                setSelectedPresetId(null);
              }}
              placeholder="e.g. Make it more concise, emphasize JSON output, or act as a security analyst..."
              disabled={isRevising}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Error Message */}
          {error && (
            <div
              style={{
                padding: '10px 14px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                color: '#b91c1c',
                fontSize: 12.5,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <AlertCircle size={16} color="#ef4444" style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* Prompts Section: Side-by-side or Single View */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: revisedPrompt ? '1fr 1fr' : '1fr',
              gap: 16,
              minHeight: 220,
            }}
          >
            {/* Original Prompt */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
                  Current System Prompt
                </span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  {promptText.length} chars • {promptText.trim() ? promptText.trim().split(/\s+/).length : 0} words
                </span>
              </div>
              <textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                disabled={isRevising}
                placeholder="Enter or paste system prompt to revise..."
                rows={10}
                style={{
                  width: '100%',
                  flex: 1,
                  padding: '12px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  fontSize: 12.5,
                  fontFamily: 'monospace',
                  lineHeight: 1.45,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  backgroundColor: '#fafbfc',
                  outline: 'none',
                }}
              />
            </div>

            {/* Revised Prompt (When generated) */}
            {revisedPrompt && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Check size={14} color="#10b981" />
                      Revised System Prompt
                    </span>
                    {revisedMeta?.durationMs && (
                      <span
                        style={{
                          fontSize: 10.5,
                          background: '#ecfdf5',
                          color: '#047857',
                          padding: '1px 6px',
                          borderRadius: 4,
                          fontWeight: 600,
                        }}
                      >
                        {((revisedMeta.durationMs || 0) / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {revisedPrompt.length} chars • {revisedPrompt.trim().split(/\s+/).length} words
                  </span>
                </div>
                <textarea
                  value={revisedPrompt}
                  onChange={(e) => setRevisedPrompt(e.target.value)}
                  disabled={isRevising}
                  rows={10}
                  style={{
                    width: '100%',
                    flex: 1,
                    padding: '12px',
                    borderRadius: 8,
                    border: '1px solid #a7f3d0',
                    fontSize: 12.5,
                    fontFamily: 'monospace',
                    lineHeight: 1.45,
                    resize: 'vertical',
                    boxSizing: 'border-box',
                    backgroundColor: '#f0fdf4',
                    outline: 'none',
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            {revisedPrompt && (
              <button
                type="button"
                onClick={handleCopy}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 12px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: '#475569',
                  cursor: 'pointer',
                }}
              >
                {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy Revised'}
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isRevising}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                fontSize: 13,
                fontWeight: 500,
                color: '#475569',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>

            {/* Revise Button */}
            <button
              type="button"
              onClick={handleRevise}
              disabled={isRevising}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 18px',
                borderRadius: 8,
                border: 'none',
                background: isRevising
                  ? '#94a3b8'
                  : 'linear-gradient(135deg, #4f46e5, #6366f1)',
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 600,
                cursor: isRevising ? 'not-allowed' : 'pointer',
                boxShadow: '0 2px 8px rgba(79, 70, 229, 0.25)',
                transition: 'all 0.15s ease',
              }}
            >
              {isRevising ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Revising with {currentHelperModelObj?.label || selectedModelId}...
                </>
              ) : (
                <>
                  <Wand2 size={15} />
                  {revisedPrompt ? 'Re-revise Prompt' : 'Revise Prompt'}
                </>
              )}
            </button>

            {/* Apply Button */}
            {revisedPrompt && (
              <button
                type="button"
                onClick={handleApply}
                disabled={isRevising}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 18px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'linear-gradient(135deg, #059669, #10b981)',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
                  transition: 'all 0.15s ease',
                }}
              >
                <Check size={15} />
                Apply to System Prompt
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
