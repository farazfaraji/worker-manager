'use client';

import React, { useState, useEffect } from 'react';
import { LLMModel } from '@/lib/types';
import { fetchModels, fetchSettings, generateSchema } from '@/lib/api';
import {
  Sparkles,
  Loader2,
  Check,
  Copy,
  Wand2,
  Bot,
  AlertCircle,
  FileCode,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';

interface SchemaAiGeneratorProps {
  currentSchema: string;
  onApply: (generatedSchema: string) => void;
  onSwitchToCodeTab?: () => void;
  placeholder?: string;
}

const PRESET_EXAMPLES = [
  {
    id: 'summary_findings',
    label: '📋 Summary & Findings',
    description: 'Overview, list of bullet findings, and score',
    text: 'A concise summary string, a list of findings (array of strings), a score number between 1 and 100, and a confidence float between 0 and 1.',
  },
  {
    id: 'analytics_metrics',
    label: '📊 Metrics & Analytics',
    description: 'Status, counts, averages, and timestamp',
    text: 'A status string with enum ("success" | "warning" | "error"), totalProcessed count integer, metrics object containing averageScore (number) and latencyMs (number), and a timestamp string.',
  },
  {
    id: 'extraction_list',
    label: '🔍 Entity Extraction',
    description: 'Entities array with names, categories, and confidence',
    text: 'An array of extracted entities, where each entity has name (string), category ("person" | "organization" | "location" | "date"), mentionCount (number), and confidence (number 0 to 1).',
  },
  {
    id: 'review_verdict',
    label: '✅ Decision & Review',
    description: 'Approval verdict, reason, and action items',
    text: 'A verdict boolean (approved: true/false), riskLevel ("low" | "medium" | "high" | "critical"), detailedReason string, and an array of recommendedActions strings.',
  },
];

export const SchemaAiGenerator: React.FC<SchemaAiGeneratorProps> = ({
  currentSchema,
  onApply,
  onSwitchToCodeTab,
  placeholder,
}) => {
  const [description, setDescription] = useState('');
  const [models, setModels] = useState<LLMModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [strictMode, setStrictMode] = useState<boolean>(true);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generatedSchema, setGeneratedSchema] = useState<string>('');
  const [metaInfo, setMetaInfo] = useState<{ model: string; modelId: string; provider: string; durationMs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [applied, setApplied] = useState<boolean>(false);

  useEffect(() => {
    setIsLoadingModels(true);
    Promise.all([fetchModels(), fetchSettings()])
      .then(([modelsList, settings]) => {
        setModels(modelsList || []);
        if (settings?.typeGeneratorStrictMode !== undefined) {
          setStrictMode(settings.typeGeneratorStrictMode);
        }
        const modelKey = settings?.typeGeneratorModel || settings?.flowHelperModel;
        if (modelKey && (modelsList || []).some((m) => m.modelId === modelKey || m._id === modelKey)) {
          setSelectedModelId(modelKey);
        } else {
          const def = (modelsList || []).find((m) => m.isDefault);
          setSelectedModelId(def?.modelId || modelsList?.[0]?.modelId || 'gpt-4o');
        }
      })
      .catch(() => {
        setSelectedModelId('gpt-4o');
      })
      .finally(() => {
        setIsLoadingModels(false);
      });
  }, []);

  const handleGenerate = async () => {
    if (!description.trim()) {
      setError('Please provide a description of the output structure.');
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);
      setApplied(false);
      const startTime = Date.now();

      const res = await generateSchema({
        description: description.trim(),
        schemaType: 'zod',
        modelId: selectedModelId || undefined,
        strictMode,
      });

      const durationMs = Date.now() - startTime;
      setGeneratedSchema(res.schema);
      setMetaInfo({
        model: res.model,
        modelId: res.modelId,
        provider: res.provider,
        durationMs,
      });

      // Automatically apply to form so downstream immediately updates
      onApply(res.schema);
      setApplied(true);
    } catch (err: any) {
      setError(err.message || 'Failed to generate schema. Please check model configuration.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedSchema);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApplyClick = () => {
    onApply(generatedSchema);
    setApplied(true);
    if (onSwitchToCodeTab) {
      onSwitchToCodeTab();
    }
  };

  const currentModelObj = models.find(
    (m) => m.modelId === selectedModelId || m._id === selectedModelId,
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        backgroundColor: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      {/* Top Model & Strict Mode Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          paddingBottom: 10,
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: '#e0e7ff',
              color: '#4f46e5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Bot size={14} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>
            Model:
          </span>
          {isLoadingModels ? (
            <Loader2 size={13} className="animate-spin text-muted" />
          ) : (
            <select
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              disabled={isGenerating}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                fontSize: 11.5,
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
                  </option>
                ))
              )}
            </select>
          )}
        </div>

        {/* Strict Mode Checkbox */}
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11.5,
            color: '#475569',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          title="Appends .strict() to ensure unrecognized keys are rejected"
        >
          <input
            type="checkbox"
            checked={strictMode}
            onChange={(e) => setStrictMode(e.target.checked)}
            disabled={isGenerating}
            style={{ cursor: 'pointer' }}
          />
          <ShieldCheck size={13} color={strictMode ? '#4f46e5' : '#94a3b8'} />
          <span>Strict Schema (.strict())</span>
        </label>
      </div>

      {/* Description Textarea */}
      <div>
        <label
          style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 600,
            color: '#334155',
            marginBottom: 6,
          }}
        >
          Describe the output fields & structure in plain English:
        </label>
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isGenerating}
          placeholder="e.g. A summary string, an array of findings with title and severity ('low' | 'medium' | 'high'), and an overall score number from 1 to 100"
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #cbd5e1',
            fontSize: 12.5,
            lineHeight: 1.45,
            outline: 'none',
            backgroundColor: '#ffffff',
            boxSizing: 'border-box',
            resize: 'vertical',
          }}
        />
      </div>

      {/* Preset Inspiration Pills */}
      <div>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 5 }}>
          Quick Templates:
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESET_EXAMPLES.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setDescription(preset.text)}
              disabled={isGenerating}
              style={{
                padding: '4px 10px',
                borderRadius: 16,
                fontSize: 11,
                fontWeight: 500,
                cursor: 'pointer',
                border: '1px solid #e2e8f0',
                background: '#ffffff',
                color: '#475569',
                transition: 'all 0.15s ease',
              }}
              title={preset.description}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div
          style={{
            padding: '8px 12px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            color: '#b91c1c',
            fontSize: 11.5,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <AlertCircle size={14} color="#ef4444" style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Generate Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating || !description.trim()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 16px',
            borderRadius: 7,
            border: 'none',
            background: isGenerating || !description.trim()
              ? '#cbd5e1'
              : 'linear-gradient(135deg, #4f46e5, #6366f1)',
            color: '#ffffff',
            fontSize: 12,
            fontWeight: 600,
            cursor: isGenerating || !description.trim() ? 'not-allowed' : 'pointer',
            boxShadow: isGenerating || !description.trim() ? 'none' : '0 2px 6px rgba(79, 70, 229, 0.25)',
            transition: 'all 0.15s ease',
          }}
        >
          {isGenerating ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              Synthesizing Zod Schema...
            </>
          ) : (
            <>
              <Wand2 size={13} />
              Generate Zod Schema
            </>
          )}
        </button>
      </div>

      {/* Generated Result Preview */}
      {generatedSchema && (
        <div
          style={{
            marginTop: 4,
            padding: '12px',
            backgroundColor: '#ffffff',
            border: '1px solid #a7f3d0',
            borderRadius: 8,
            boxShadow: '0 1px 3px rgba(16, 185, 129, 0.08)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: '#059669',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Check size={13} color="#059669" />
                Generated Zod Schema
              </span>
              {metaInfo?.durationMs && (
                <span
                  style={{
                    fontSize: 10,
                    background: '#ecfdf5',
                    color: '#047857',
                    padding: '1px 5px',
                    borderRadius: 4,
                    fontWeight: 600,
                  }}
                >
                  {((metaInfo.durationMs || 0) / 1000).toFixed(1)}s • {metaInfo.model}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={handleCopy}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  fontSize: 11,
                  color: '#475569',
                  cursor: 'pointer',
                }}
              >
                {copied ? <Check size={11} color="#059669" /> : <Copy size={11} />}
                {copied ? 'Copied' : 'Copy'}
              </button>

              {onSwitchToCodeTab && (
                <button
                  type="button"
                  onClick={handleApplyClick}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 10px',
                    borderRadius: 4,
                    border: 'none',
                    background: '#059669',
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#ffffff',
                    cursor: 'pointer',
                  }}
                  title="View and edit generated schema in Code Editor tab"
                >
                  <FileCode size={12} />
                  Edit in Code Tab
                  <ArrowRight size={11} />
                </button>
              )}
            </div>
          </div>

          <pre
            style={{
              margin: 0,
              padding: '10px 12px',
              backgroundColor: '#f0fdf4',
              borderRadius: 6,
              fontSize: 12,
              fontFamily: 'monospace',
              color: '#065f46',
              lineHeight: 1.45,
              overflowX: 'auto',
              maxHeight: 180,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            <code>{generatedSchema}</code>
          </pre>

          {applied && (
            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                color: '#059669',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontWeight: 500,
              }}
            >
              <Check size={12} /> Applied to node output schema. Properties are now exposed as downstream variables.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
