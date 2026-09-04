'use client';

import React, { useState, useEffect } from 'react';
import { LLMModel } from '@/lib/types';
import { fetchModels, createModel, updateModel, deleteModel, fetchSettings, updateSettings } from '@/lib/api';
import { EmbeddingModelsPanel } from './EmbeddingModelsPanel';
import {
  Settings,
  Plus,
  Trash2,
  Check,
  Eye,
  EyeOff,
  Sparkles,
  Bot,
  Cpu,
  Globe,
  Radio,
  FileText,
  Volume2,
  X,
  Loader2,
  Sliders,
  Code2,
  Layers,
  Save,
  HelpCircle,
  Monitor,
  Zap,
  CheckCircle2,
  Compass,
} from 'lucide-react';

interface ModelSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onModelsUpdated?: () => void;
}

const PROVIDER_PRESETS: Record<string, { endpoint: string; defaultModel: string; label: string }> = {
  openai: {
    endpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    label: 'OpenAI',
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-20241022',
    label: 'Anthropic',
  },
  gemini: {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-1.5-pro',
    label: 'Google Gemini',
  },
  ollama: {
    endpoint: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    label: 'Ollama (Local)',
  },
  custom: {
    endpoint: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3-70b-chat-hf',
    label: 'Custom / Proxy',
  },
};

const APP_SETTINGS_STORAGE_KEY = 'flow_studio_app_settings';

export const ModelSettingsModal: React.FC<ModelSettingsModalProps> = ({
  isOpen,
  onClose,
  onModelsUpdated,
}) => {
  // Tab State
  const [activeTab, setActiveTab] = useState<'general' | 'models' | 'embeddings'>('general');

  // Models State
  const [models, setModels] = useState<LLMModel[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedModel, setSelectedModel] = useState<LLMModel | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Model Form fields
  const [formLabel, setFormLabel] = useState('');
  const [formModelId, setFormModelId] = useState('');
  const [formProvider, setFormProvider] = useState<string>('openai');
  const [formEndpoint, setFormEndpoint] = useState('https://api.openai.com/v1');
  const [formApiKey, setFormApiKey] = useState('');
  const [formSupportsVision, setFormSupportsVision] = useState(true);
  const [formSupportsAudio, setFormSupportsAudio] = useState(false);
  const [formSupportsDocuments, setFormSupportsDocuments] = useState(true);
  const [formSupportsJson, setFormSupportsJson] = useState(true);
  const [formDefaultTemperature, setFormDefaultTemperature] = useState(0.7);
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [formReasoningEffort, setFormReasoningEffort] = useState<string>('default');
  const [formReasoningFormat, setFormReasoningFormat] = useState<string>('hidden');
  const [formDescription, setFormDescription] = useState('');

  // General Settings State
  const [typeGeneratorModel, setTypeGeneratorModel] = useState<string>('gpt-4o');
  const [typeGeneratorStrictMode, setTypeGeneratorStrictMode] = useState<boolean>(true);
  const [autoSaveInterval, setAutoSaveInterval] = useState<number>(30);
  const [enableSnapToGrid, setEnableSnapToGrid] = useState<boolean>(true);
  const [autoPanOnRun, setAutoPanOnRun] = useState<boolean>(true);
  const [logVerbosity, setLogVerbosity] = useState<'standard' | 'verbose' | 'debug'>('standard');
  const [nodeTimeout, setNodeTimeout] = useState<number>(60);
  const [isSavingGeneral, setIsSavingGeneral] = useState<boolean>(false);
  const [generalStatusMessage, setGeneralStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Load General Settings from DB (with localStorage fallback)
  const loadGeneralSettings = async () => {
    try {
      const dbSettings = await fetchSettings();
      if (dbSettings) {
        if (dbSettings.typeGeneratorModel) setTypeGeneratorModel(dbSettings.typeGeneratorModel);
        if (dbSettings.typeGeneratorStrictMode !== undefined) setTypeGeneratorStrictMode(dbSettings.typeGeneratorStrictMode);
        if (dbSettings.autoSaveInterval !== undefined) setAutoSaveInterval(dbSettings.autoSaveInterval);
        if (dbSettings.enableSnapToGrid !== undefined) setEnableSnapToGrid(dbSettings.enableSnapToGrid);
        if (dbSettings.autoPanOnRun !== undefined) setAutoPanOnRun(dbSettings.autoPanOnRun);
        if (dbSettings.logVerbosity) setLogVerbosity(dbSettings.logVerbosity);
        if (dbSettings.nodeTimeout !== undefined) setNodeTimeout(dbSettings.nodeTimeout);
        return;
      }

      // Fallback to localStorage if DB response is empty
      const saved = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.typeGeneratorModel) setTypeGeneratorModel(parsed.typeGeneratorModel);
        if (parsed.typeGeneratorStrictMode !== undefined) setTypeGeneratorStrictMode(parsed.typeGeneratorStrictMode);
        if (parsed.autoSaveInterval !== undefined) setAutoSaveInterval(parsed.autoSaveInterval);
        if (parsed.enableSnapToGrid !== undefined) setEnableSnapToGrid(parsed.enableSnapToGrid);
        if (parsed.autoPanOnRun !== undefined) setAutoPanOnRun(parsed.autoPanOnRun);
        if (parsed.logVerbosity) setLogVerbosity(parsed.logVerbosity);
        if (parsed.nodeTimeout !== undefined) setNodeTimeout(parsed.nodeTimeout);
      }
    } catch {
      // Ignore parse errors
    }
  };

  const handleSaveGeneralSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      setIsSavingGeneral(true);
      const payload = {
        typeGeneratorModel,
        typeGeneratorStrictMode,
        autoSaveInterval,
        enableSnapToGrid,
        autoPanOnRun,
        logVerbosity,
        nodeTimeout,
      };

      // Save to MongoDB setting collection
      await updateSettings(payload);

      // Also sync localStorage for cache
      localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(payload));

      setGeneralStatusMessage({ text: 'Settings saved to database successfully!', type: 'success' });
      setTimeout(() => {
        setGeneralStatusMessage(null);
      }, 3000);
    } catch (err: any) {
      setGeneralStatusMessage({ text: err.message || 'Failed to save settings to database', type: 'error' });
    } finally {
      setIsSavingGeneral(false);
    }
  };

  const loadModels = async () => {
    try {
      setIsLoading(true);
      const list = await fetchModels();
      setModels(list);
      if (list.length > 0) {
        if (!selectedModel && !isCreatingNew) {
          selectModelForEdit(list[0]);
        }
        // If typeGeneratorModel isn't set yet, pick default model or first model
        setTypeGeneratorModel((prev) => {
          if (prev && list.some((m) => m.modelId === prev || m._id === prev)) {
            return prev;
          }
          const defaultModel = list.find((m) => m.isDefault);
          return defaultModel?.modelId || list[0]?.modelId || 'gpt-4o';
        });
      }
    } catch {
      // Backend error or offline
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadModels();
      loadGeneralSettings();
    }
  }, [isOpen]);

  const selectModelForEdit = (model: LLMModel) => {
    setIsCreatingNew(false);
    setSelectedModel(model);
    setFormLabel(model.label || '');
    setFormModelId(model.modelId || '');
    setFormProvider(model.provider || 'openai');
    setFormEndpoint(model.endpoint || 'https://api.openai.com/v1');
    setFormApiKey(model.apiKey || '');
    setFormSupportsVision(model.capabilities?.supportsVision ?? true);
    setFormSupportsAudio(model.capabilities?.supportsAudio ?? false);
    setFormSupportsDocuments(model.capabilities?.supportsDocuments ?? true);
    setFormSupportsJson(model.capabilities?.supportsJson ?? true);
    setFormDefaultTemperature(model.defaultTemperature ?? 0.7);
    setFormIsDefault(model.isDefault ?? false);
    setFormReasoningEffort(model.reasoningEffort || 'default');
    setFormReasoningFormat(model.reasoningFormat || 'hidden');
    setFormDescription(model.description || '');
    setStatusMessage(null);
  };

  const handleStartCreateNew = () => {
    setIsCreatingNew(true);
    setSelectedModel(null);
    setFormLabel('New LLM Model');
    setFormModelId('gpt-4o');
    setFormProvider('openai');
    setFormEndpoint('https://api.openai.com/v1');
    setFormApiKey('');
    setFormSupportsVision(true);
    setFormSupportsAudio(false);
    setFormSupportsDocuments(true);
    setFormSupportsJson(true);
    setFormDefaultTemperature(0.7);
    setFormIsDefault(false);
    setFormReasoningEffort('default');
    setFormReasoningFormat('hidden');
    setFormDescription('');
    setStatusMessage(null);
  };

  const handleProviderChange = (newProvider: string) => {
    setFormProvider(newProvider);
    const preset = PROVIDER_PRESETS[newProvider];
    if (preset) {
      setFormEndpoint(preset.endpoint);
      if (isCreatingNew) {
        setFormModelId(preset.defaultModel);
      }
    }
  };

  const handleSaveModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formLabel.trim() || !formModelId.trim() || !formEndpoint.trim()) {
      setStatusMessage({ text: 'Please fill out required fields (Label, Model ID, Endpoint)', type: 'error' });
      return;
    }

    try {
      setIsSaving(true);
      const payload: Partial<LLMModel> = {
        label: formLabel.trim(),
        modelId: formModelId.trim(),
        provider: formProvider,
        endpoint: formEndpoint.trim(),
        apiKey: formApiKey.trim(),
        capabilities: {
          supportsVision: formSupportsVision,
          supportsAudio: formSupportsAudio,
          supportsDocuments: formSupportsDocuments,
          supportsJson: formSupportsJson,
        },
        defaultTemperature: Number(formDefaultTemperature),
        isDefault: formIsDefault,
        reasoningEffort: formReasoningEffort,
        reasoningFormat: formReasoningFormat,
        description: formDescription.trim(),
      };

      let saved: LLMModel;
      if (isCreatingNew || !selectedModel?._id) {
        saved = await createModel(payload);
        setStatusMessage({ text: 'Model created successfully!', type: 'success' });
      } else {
        saved = await updateModel(selectedModel._id, payload);
        setStatusMessage({ text: 'Model updated successfully!', type: 'success' });
      }

      await loadModels();
      selectModelForEdit(saved);
      onModelsUpdated?.();
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Failed to save model', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteModel = async () => {
    if (!selectedModel?._id) return;
    if (!confirm(`Are you sure you want to delete model "${selectedModel.label}"?`)) return;

    try {
      setIsDeleting(true);
      await deleteModel(selectedModel._id);
      setStatusMessage({ text: 'Model deleted successfully', type: 'success' });
      setSelectedModel(null);
      await loadModels();
      onModelsUpdated?.();
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Failed to delete model', type: 'error' });
    } finally {
      setIsDeleting(false);
    }
  };

  const currentTypeModel = models.find((m) => m.modelId === typeGeneratorModel || m._id === typeGeneratorModel);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '960px',
          height: '88vh',
          maxHeight: '780px',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid #e2e8f0',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(to right, #f8fafc, #ffffff)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                boxShadow: '0 4px 10px rgba(79, 70, 229, 0.3)',
              }}
            >
              <Settings size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                App Settings
              </h2>
              <p style={{ fontSize: 12.5, color: '#64748b', margin: 0, marginTop: 2 }}>
                Manage workspace defaults, Type Generator model, and LLM provider credentials.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              padding: 6,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={20} />
          </button>

        </div>

        {/* Tab Switcher Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 24px',
            borderBottom: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 16px',
              fontSize: 13.5,
              fontWeight: activeTab === 'general' ? 700 : 500,
              color: activeTab === 'general' ? '#4f46e5' : '#64748b',
              background: 'transparent',
              border: 'none',
              borderBottom: `2.5px solid ${activeTab === 'general' ? '#4f46e5' : 'transparent'}`,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              marginBottom: '-1px',
            }}
          >
            <Sliders size={16} />
            <span>General</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('models')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 16px',
              fontSize: 13.5,
              fontWeight: activeTab === 'models' ? 700 : 500,
              color: activeTab === 'models' ? '#4f46e5' : '#64748b',
              background: 'transparent',
              border: 'none',
              borderBottom: `2.5px solid ${activeTab === 'models' ? '#4f46e5' : 'transparent'}`,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              marginBottom: '-1px',
            }}
          >
            <Cpu size={16} />
            <span>Models</span>
            <span
              style={{
                fontSize: 11,
                background: activeTab === 'models' ? '#e0e7ff' : '#e2e8f0',
                color: activeTab === 'models' ? '#4338ca' : '#64748b',
                padding: '2px 7px',
                borderRadius: 999,
                fontWeight: 700,
              }}
            >
              {models.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('embeddings')}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', fontSize: 13.5,
              fontWeight: activeTab === 'embeddings' ? 700 : 500,
              color: activeTab === 'embeddings' ? '#4f46e5' : '#64748b', background: 'transparent', border: 'none',
              borderBottom: `2.5px solid ${activeTab === 'embeddings' ? '#4f46e5' : 'transparent'}`, cursor: 'pointer', marginBottom: '-1px',
            }}
          >
            <Layers size={16} />
            <span>Embeddings</span>
          </button>
        </div>

        {/* TAB CONTENT */}
        {activeTab === 'general' ? (
          /* ================= GENERAL TAB ================= */
          <div style={{ flex: 1, overflowY: 'auto', backgroundColor: '#f8fafc', padding: '24px' }}>
            <div style={{ maxWidth: '820px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
              {generalStatusMessage && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: generalStatusMessage.type === 'success' ? '#ecfdf5' : '#fef2f2',
                    color: generalStatusMessage.type === 'success' ? '#065f46' : '#991b1b',
                    border: `1px solid ${generalStatusMessage.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
                  }}
                >
                  {generalStatusMessage.type === 'success' ? <Check size={16} /> : <X size={16} />}
                  <span>{generalStatusMessage.text}</span>
                </div>
              )}

              {/* Section 1: Type Generator */}
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'linear-gradient(to right, #fcfdff, #ffffff)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: '#e0e7ff',
                        color: '#4f46e5',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Code2 size={18} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                        Type Generator
                      </h3>
                      <p style={{ fontSize: 12, color: '#64748b', margin: 0, marginTop: 1 }}>
                        Configure the LLM model and schema synthesis behavior for type inference & generator tools.
                      </p>
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      background: '#f1f5f9',
                      color: '#475569',
                      padding: '3px 8px',
                      borderRadius: 6,
                    }}
                  >
                    AI Engine
                  </span>
                </div>

                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Dropdown for Type Generator Model */}
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 6 }}>
                      Type Generator Model <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <p style={{ fontSize: 12, color: '#64748b', margin: 0, marginBottom: 8 }}>
                      Select which AI model will be used when synthesizing TypeScript types, JSON Schemas, or inferred interfaces.
                    </p>
                    {isLoading ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13 }}>
                        <Loader2 size={16} className="animate-spin" /> Loading models...
                      </div>
                    ) : (
                      <select
                        value={typeGeneratorModel}
                        onChange={(e) => setTypeGeneratorModel(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px 14px',
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          fontSize: 13.5,
                          backgroundColor: '#ffffff',
                          color: '#0f172a',
                          fontWeight: 500,
                          cursor: 'pointer',
                          outline: 'none',
                        }}
                      >
                        {models.length === 0 ? (
                          <option value="gpt-4o">gpt-4o (Default Fallback)</option>
                        ) : (
                          models.map((m) => (
                            <option key={m._id || m.modelId} value={m.modelId}>
                              {m.label} — {m.provider.toUpperCase()} ({m.modelId})
                              {m.isDefault ? ' [System Default]' : ''}
                            </option>
                          ))
                        )}
                      </select>
                    )}
                  </div>

                  {/* Selected Model Preview Card */}
                  {currentTypeModel && (
                    <div
                      style={{
                        padding: '12px 14px',
                        borderRadius: 8,
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>
                            {currentTypeModel.label}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              fontFamily: 'monospace',
                              background: '#e2e8f0',
                              color: '#475569',
                              padding: '1px 6px',
                              borderRadius: 4,
                            }}
                          >
                            {currentTypeModel.modelId}
                          </span>
                        </div>
                        <p style={{ fontSize: 11.5, color: '#64748b', margin: 0, marginTop: 3 }}>
                          Endpoint: {currentTypeModel.endpoint}
                        </p>
                      </div>

                      <div style={{ display: 'flex', gap: 6 }}>
                        {currentTypeModel.capabilities?.supportsJson && (
                          <span style={{ fontSize: 10.5, background: '#f3e8ff', color: '#7e22ce', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>
                            JSON Schema
                          </span>
                        )}
                        {currentTypeModel.capabilities?.supportsVision && (
                          <span style={{ fontSize: 10.5, background: '#e0e7ff', color: '#4338ca', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>
                            Vision
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Strict Mode */}
                  <div style={{ paddingTop: 4 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={typeGeneratorStrictMode}
                        onChange={(e) => setTypeGeneratorStrictMode(e.target.checked)}
                      />
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                        Strict Mode (Require exact keys & schema validation)
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Section 2: Canvas & Workspace */}
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: '#f0fdf4',
                      color: '#16a34a',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Monitor size={18} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                      Canvas & Workflow Preferences
                    </h3>
                    <p style={{ fontSize: 12, color: '#64748b', margin: 0, marginTop: 1 }}>
                      Configure node editor snapping, auto-save timers, and execution tracking.
                    </p>
                  </div>
                </div>

                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                        Auto-Save Interval
                      </label>
                      <select
                        value={autoSaveInterval}
                        onChange={(e) => setAutoSaveInterval(Number(e.target.value))}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          fontSize: 13,
                          backgroundColor: '#ffffff',
                        }}
                      >
                        <option value={15}>Every 15 seconds</option>
                        <option value={30}>Every 30 seconds (Recommended)</option>
                        <option value={60}>Every 1 minute</option>
                        <option value={0}>Disabled (Manual save only)</option>
                      </select>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={enableSnapToGrid}
                          onChange={(e) => setEnableSnapToGrid(e.target.checked)}
                        />
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                          Snap Nodes to Grid (15px)
                        </span>
                      </label>

                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={autoPanOnRun}
                          onChange={(e) => setAutoPanOnRun(e.target.checked)}
                        />
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                          Auto-focus Active Node during Execution
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 3: Execution & Diagnostics */}
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: '#fef3c7',
                      color: '#d97706',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Zap size={18} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                      Execution & Diagnostics
                    </h3>
                    <p style={{ fontSize: 12, color: '#64748b', margin: 0, marginTop: 1 }}>
                      Adjust runner execution timeouts and log verbosity.
                    </p>
                  </div>
                </div>

                <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                      Node Timeout (Seconds)
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={300}
                      value={nodeTimeout}
                      onChange={(e) => setNodeTimeout(Number(e.target.value))}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: 13,
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                      Runner Log Verbosity
                    </label>
                    <select
                      value={logVerbosity}
                      onChange={(e) => setLogVerbosity(e.target.value as any)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: 13,
                        backgroundColor: '#ffffff',
                      }}
                    >
                      <option value="standard">Standard (Inputs, Outputs & Errors)</option>
                      <option value="verbose">Verbose (Includes Token Counts & Headers)</option>
                      <option value="debug">Debug (Full Payload Dumps)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Bottom Save Action */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 12,
                  padding: '8px 0 20px 0',
                }}
              >
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: '9px 18px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#475569',
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>

                <button
                  type="button"
                  onClick={handleSaveGeneralSettings}
                  disabled={isSavingGeneral}
                  style={{
                    padding: '9px 20px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    border: 'none',
                    background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                    color: '#ffffff',
                    cursor: isSavingGeneral ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)',
                    opacity: isSavingGeneral ? 0.8 : 1,
                  }}
                >
                  {isSavingGeneral ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  <span>{isSavingGeneral ? 'Saving to Database...' : 'Save General Settings'}</span>
                </button>
              </div>
            </div>
          </div>
        ) : activeTab === 'embeddings' ? (
          <EmbeddingModelsPanel />
        ) : (
          /* ================= MODELS TAB ================= */
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Left List */}
            <div
              style={{
                width: '320px',
                borderRight: '1px solid #e2e8f0',
                backgroundColor: '#f8fafc',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Models ({models.length})
                </span>
                <button
                  type="button"
                  onClick={handleStartCreateNew}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#ffffff',
                    background: '#4f46e5',
                    border: 'none',
                    borderRadius: 6,
                    padding: '5px 10px',
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={14} /> Add Model
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
                {isLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: '#64748b' }}>
                    <Loader2 size={20} className="animate-spin" />
                  </div>
                ) : models.length === 0 ? (
                  <div style={{ padding: '24px 16px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                    No models configured. Click "Add Model" to register one.
                  </div>
                ) : (
                  models.map((m) => {
                    const isSelected = !isCreatingNew && selectedModel?._id === m._id;
                    return (
                      <div
                        key={m._id || m.modelId}
                        onClick={() => selectModelForEdit(m)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 8,
                          marginBottom: 6,
                          cursor: 'pointer',
                          backgroundColor: isSelected ? '#ffffff' : 'transparent',
                          border: `1px solid ${isSelected ? '#4f46e5' : 'transparent'}`,
                          boxShadow: isSelected ? '0 2px 8px rgba(79, 70, 229, 0.12)' : 'none',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 13.5, fontWeight: isSelected ? 700 : 600, color: isSelected ? '#4f46e5' : '#1e293b' }}>
                            {m.label}
                          </span>
                          {m.isDefault && (
                            <span
                              style={{
                                fontSize: 10,
                                background: '#ecfdf5',
                                color: '#059669',
                                padding: '2px 6px',
                                borderRadius: 4,
                                fontWeight: 700,
                              }}
                            >
                              DEFAULT
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <span
                            style={{
                              fontSize: 11,
                              fontFamily: 'monospace',
                              color: '#64748b',
                              background: '#e2e8f0',
                              padding: '1px 5px',
                              borderRadius: 4,
                            }}
                          >
                            {m.modelId}
                          </span>
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>•</span>
                          <span style={{ fontSize: 11, color: '#64748b', textTransform: 'capitalize' }}>
                            {m.provider}
                          </span>
                        </div>

                        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                          {m.capabilities?.supportsVision && (
                            <span title="Supports Vision" style={{ fontSize: 10, background: '#e0e7ff', color: '#4338ca', padding: '1px 5px', borderRadius: 4 }}>
                              👁️ Vision
                            </span>
                          )}
                          {m.capabilities?.supportsAudio && (
                            <span title="Supports Audio" style={{ fontSize: 10, background: '#fef3c7', color: '#d97706', padding: '1px 5px', borderRadius: 4 }}>
                              🎙️ Audio
                            </span>
                          )}
                          {m.capabilities?.supportsJson && (
                            <span title="Supports JSON" style={{ fontSize: 10, background: '#f3e8ff', color: '#7e22ce', padding: '1px 5px', borderRadius: 4 }}>
                              JSON
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Editor Form */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff', overflowY: 'auto' }}>
              <form onSubmit={handleSaveModel} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                {statusMessage && (
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 8,
                      fontSize: 13,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      background: statusMessage.type === 'success' ? '#ecfdf5' : '#fef2f2',
                      color: statusMessage.type === 'success' ? '#065f46' : '#991b1b',
                      border: `1px solid ${statusMessage.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
                    }}
                  >
                    {statusMessage.type === 'success' ? <Check size={16} /> : <X size={16} />}
                    <span>{statusMessage.text}</span>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                      {isCreatingNew ? 'Add New Model Configuration' : `Edit: ${formLabel || 'Model'}`}
                    </h3>
                    <p style={{ fontSize: 12, color: '#64748b', margin: 0, marginTop: 2 }}>
                      Configure credentials and capabilities for agent workflows.
                    </p>
                  </div>

                  {!isCreatingNew && selectedModel && (
                    <button
                      type="button"
                      onClick={handleDeleteModel}
                      disabled={isDeleting}
                      style={{
                        background: '#fff1f2',
                        color: '#e11d48',
                        border: '1px solid #ffe4e6',
                        borderRadius: 6,
                        padding: '6px 12px',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  )}
                </div>

                {/* Provider Selector */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    Provider / Schema Format
                  </label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => {
                      const isSelected = formProvider === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => handleProviderChange(key)}
                          style={{
                            padding: '7px 14px',
                            borderRadius: 8,
                            fontSize: 12.5,
                            fontWeight: isSelected ? 700 : 500,
                            cursor: 'pointer',
                            border: `1.5px solid ${isSelected ? '#4f46e5' : '#e2e8f0'}`,
                            background: isSelected ? '#eef2ff' : '#ffffff',
                            color: isSelected ? '#4f46e5' : '#475569',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Label and Model ID */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                      Display Label <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={formLabel}
                      onChange={(e) => setFormLabel(e.target.value)}
                      placeholder="e.g. GPT-4o (Vision & Audio)"
                      required
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: 13.5,
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                      Model ID <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={formModelId}
                      onChange={(e) => setFormModelId(e.target.value)}
                      placeholder="e.g. gpt-4o, claude-3-5-sonnet-20241022, llama3.2"
                      required
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: 13.5,
                        fontFamily: 'monospace',
                      }}
                    />
                  </div>
                </div>

                {/* Endpoint & API Key */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    API Endpoint / Base URL <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={formEndpoint}
                    onChange={(e) => setFormEndpoint(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    required
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      fontFamily: 'monospace',
                    }}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <label style={{ fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                      API Key / Secret Token
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      {showApiKey ? <EyeOff size={13} /> : <Eye size={13} />}
                      {showApiKey ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={formApiKey}
                    onChange={(e) => setFormApiKey(e.target.value)}
                    placeholder="sk-... (Leave empty if using local Ollama or env variable)"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      fontFamily: 'monospace',
                    }}
                  />
                </div>

                {/* Capabilities Checkboxes */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 8 }}>
                    Modalities & Capabilities
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                        cursor: 'pointer',
                        background: formSupportsVision ? '#f0fdf4' : '#ffffff',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={formSupportsVision}
                        onChange={(e) => setFormSupportsVision(e.target.checked)}
                      />
                      <span style={{ fontSize: 13, color: '#1e293b' }}>👁️ Supports Vision / Images</span>
                    </label>

                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                        cursor: 'pointer',
                        background: formSupportsAudio ? '#f0fdf4' : '#ffffff',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={formSupportsAudio}
                        onChange={(e) => setFormSupportsAudio(e.target.checked)}
                      />
                      <span style={{ fontSize: 13, color: '#1e293b' }}>🎙️ Supports Audio / Speech</span>
                    </label>

                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                        cursor: 'pointer',
                        background: formSupportsDocuments ? '#f0fdf4' : '#ffffff',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={formSupportsDocuments}
                        onChange={(e) => setFormSupportsDocuments(e.target.checked)}
                      />
                      <span style={{ fontSize: 13, color: '#1e293b' }}>📄 Supports Documents / PDFs</span>
                    </label>

                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                        cursor: 'pointer',
                        background: formSupportsJson ? '#f0fdf4' : '#ffffff',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={formSupportsJson}
                        onChange={(e) => setFormSupportsJson(e.target.checked)}
                      />
                      <span style={{ fontSize: 13, color: '#1e293b' }}>⚡ Structured JSON Schema</span>
                    </label>
                  </div>
                </div>

                {/* Default Temperature & Is Default Model */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'center' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                      Default Temperature ({formDefaultTemperature})
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={formDefaultTemperature}
                      onChange={(e) => setFormDefaultTemperature(parseFloat(e.target.value))}
                      style={{ width: '100%', cursor: 'pointer' }}
                    />
                  </div>

                  <div style={{ paddingTop: 14 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={formIsDefault}
                        onChange={(e) => setFormIsDefault(e.target.checked)}
                      />
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                        Set as Default Model for Agents
                      </span>
                    </label>
                  </div>
                </div>

                {/* Reasoning & Thinking Configuration (Groq / Qwen / DeepSeek / o1) */}
                <div style={{ padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 2 }}>
                    🧠 Reasoning &amp; Thinking Settings (Groq / Qwen / o1 / DeepSeek)
                  </div>
                  <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 12 }}>
                    Control reasoning tokens and output formatting to prevent prompt pollution and JSON validation errors.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                        Reasoning Effort
                      </label>
                      <select
                        value={formReasoningEffort}
                        onChange={(e) => setFormReasoningEffort(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          borderRadius: 6,
                          border: '1px solid #cbd5e1',
                          fontSize: 13,
                          background: '#fff',
                        }}
                      >
                        <option value="default">Default (Model standard)</option>
                        <option value="none">Disable Thinking (none - ultra fast)</option>
                        <option value="low">Low Effort</option>
                        <option value="medium">Medium Effort</option>
                        <option value="high">High Effort</option>
                      </select>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                        Use &quot;Disable Thinking&quot; for fast responses without &lt;think&gt; tokens.
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                        Reasoning Format
                      </label>
                      <select
                        value={formReasoningFormat}
                        onChange={(e) => setFormReasoningFormat(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          borderRadius: 6,
                          border: '1px solid #cbd5e1',
                          fontSize: 13,
                          background: '#fff',
                        }}
                      >
                        <option value="hidden">Hidden (Recommended - clean output)</option>
                        <option value="parsed">Parsed (Separate reasoning field)</option>
                        <option value="raw">Raw (Keep &lt;think&gt; tags)</option>
                      </select>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                        &quot;Hidden&quot; prevents downstream prompts from getting flooded.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
                  <button
                    type="button"
                    onClick={onClose}
                    style={{
                      padding: '9px 18px',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#475569',
                      cursor: 'pointer',
                    }}
                  >
                    Close
                  </button>

                  <button
                    type="submit"
                    disabled={isSaving}
                    style={{
                      padding: '9px 20px',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      border: 'none',
                      background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                      color: '#ffffff',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)',
                    }}
                  >
                    {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                    <span>{isSaving ? 'Saving...' : 'Save Configuration'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
