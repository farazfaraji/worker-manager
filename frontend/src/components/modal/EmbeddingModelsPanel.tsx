'use client';

import React, { useEffect, useState } from 'react';
import { Check, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { createEmbeddingModel, deleteEmbeddingModel, fetchEmbeddingModels, updateEmbeddingModel } from '@/lib/api';

type EmbeddingModel = {
  _id?: string;
  label: string;
  modelId: string;
  provider: string;
  endpoint: string;
  dimensions?: number;
  maxInputTokens?: number;
  isDefault?: boolean;
  description?: string;
};

const EMPTY: EmbeddingModel = { label: 'New Embedding Model', modelId: '', provider: 'openai', endpoint: '', dimensions: undefined, maxInputTokens: undefined, isDefault: false, description: '' };

export const EmbeddingModelsPanel: React.FC = () => {
  const [models, setModels] = useState<EmbeddingModel[]>([]);
  const [selected, setSelected] = useState<EmbeddingModel | null>(null);
  const [form, setForm] = useState<EmbeddingModel>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchEmbeddingModels();
      setModels(data);
      if (!selected && data[0]) { setSelected(data[0]); setForm(data[0]); }
    } catch (error: any) { setMessage({ text: error.message || 'Failed to load embedding models', error: true }); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const select = (model: EmbeddingModel) => { setSelected(model); setForm({ ...model }); setMessage(null); };
  const set = (key: keyof EmbeddingModel, value: any) => setForm((current) => ({ ...current, [key]: value }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.label.trim() || !form.modelId.trim() || !form.endpoint.trim()) { setMessage({ text: 'Label, Model ID and Endpoint are required', error: true }); return; }
    setSaving(true);
    try {
      const saved = form._id ? await updateEmbeddingModel(form._id, form) : await createEmbeddingModel(form);
      setModels((current) => form._id ? current.map((item) => item._id === saved._id ? saved : item) : [...current, saved]);
      setSelected(saved); setForm(saved); setMessage({ text: 'Embedding model saved' });
    } catch (error: any) { setMessage({ text: error.message || 'Failed to save embedding model', error: true }); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!form._id || !confirm(`Delete embedding model "${form.label}"?`)) return;
    try { await deleteEmbeddingModel(form._id); setSelected(null); setForm(EMPTY); await load(); setMessage({ text: 'Embedding model deleted' }); }
    catch (error: any) { setMessage({ text: error.message || 'Failed to delete embedding model', error: true }); }
  };

  return <div style={{ display: 'flex', flex: 1, overflow: 'hidden', background: '#f8fafc' }}>
    <div style={{ width: 320, borderRight: '1px solid #e2e8f0', padding: 16, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>EMBEDDING MODELS ({models.length})</span>
        <button type="button" onClick={() => { setSelected(null); setForm({ ...EMPTY }); }} style={{ border: 0, background: '#4f46e5', color: '#fff', borderRadius: 6, padding: '6px 9px', cursor: 'pointer' }}><Plus size={14} /></button>
      </div>
      {loading ? <Loader2 size={20} className="animate-spin" /> : models.map((model) => <button type="button" key={model._id || model.modelId} onClick={() => select(model)} style={{ display: 'block', width: '100%', textAlign: 'left', border: `1px solid ${selected?._id === model._id ? '#4f46e5' : '#e2e8f0'}`, background: '#fff', borderRadius: 8, padding: 10, marginBottom: 8, cursor: 'pointer' }}><div style={{ fontWeight: 700, color: '#1e293b', fontSize: 13 }}>{model.label}</div><div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{model.modelId} · {model.provider}</div>{model.isDefault && <div style={{ color: '#059669', fontSize: 10, marginTop: 5, fontWeight: 700 }}>DEFAULT</div>}</button>)}
    </div>
    <form onSubmit={save} style={{ flex: 1, overflowY: 'auto', padding: 28, maxWidth: 720 }}>
      <h3 style={{ margin: '0 0 6px', color: '#0f172a' }}>Embedding provider</h3>
      <p style={{ color: '#64748b', fontSize: 12.5, marginTop: 0 }}>Configure the model used to create vectors for semantic retrieval. API keys stay on the backend environment.</p>
      {message && <div style={{ padding: 10, borderRadius: 8, marginBottom: 16, background: message.error ? '#fef2f2' : '#ecfdf5', color: message.error ? '#991b1b' : '#065f46', fontSize: 13 }}>{message.error ? <X size={14} /> : <Check size={14} />} {message.text}</div>}
      {(['label', 'modelId', 'provider', 'endpoint', 'dimensions', 'maxInputTokens', 'description'] as const).map((key) => <label key={key} style={{ display: 'block', marginBottom: 14, color: '#334155', fontSize: 12.5, fontWeight: 600 }}>{key === 'modelId' ? 'Model ID' : key === 'maxInputTokens' ? 'Max Input Tokens' : key[0].toUpperCase() + key.slice(1)}<input value={(form[key] ?? '') as any} type={key === 'dimensions' || key === 'maxInputTokens' ? 'number' : 'text'} onChange={(event) => set(key, key === 'dimensions' || key === 'maxInputTokens' ? (event.target.value ? Number(event.target.value) : undefined) : event.target.value)} style={{ display: 'block', width: '100%', marginTop: 6, padding: '9px 11px', border: '1px solid #cbd5e1', borderRadius: 7, fontSize: 13 }} /></label>)}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#334155', fontSize: 12.5, marginBottom: 20 }}><input type="checkbox" checked={Boolean(form.isDefault)} onChange={(event) => set('isDefault', event.target.checked)} /> Use as default embedding model</label>
      <div style={{ display: 'flex', gap: 8 }}><button type="submit" disabled={saving} style={{ display: 'flex', gap: 6, alignItems: 'center', border: 0, background: '#4f46e5', color: '#fff', borderRadius: 7, padding: '9px 14px', cursor: 'pointer' }}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save</button>{form._id && <button type="button" onClick={remove} style={{ display: 'flex', gap: 6, alignItems: 'center', border: '1px solid #fecaca', background: '#fff', color: '#b91c1c', borderRadius: 7, padding: '9px 14px', cursor: 'pointer' }}><Trash2 size={14} /> Delete</button>}</div>
    </form>
  </div>;
};

