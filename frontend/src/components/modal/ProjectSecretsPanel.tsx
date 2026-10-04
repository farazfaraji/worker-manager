'use client';

import React, { useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { Project } from '@/lib/types';
import {
  deleteProjectSecret,
  fetchProjectEncryptionKeyStatus,
  fetchProjectSecrets,
  ProjectSecretMeta,
  setProjectEncryptionKey,
  upsertProjectSecret,
} from '@/lib/api';

interface ProjectSecretsPanelProps {
  projects: Project[];
  activeProjectId: string | null;
}

export const ProjectSecretsPanel: React.FC<ProjectSecretsPanelProps> = ({
  projects,
  activeProjectId,
}) => {
  const [projectId, setProjectId] = useState(activeProjectId || projects[0]?._id || '');
  const [secrets, setSecrets] = useState<ProjectSecretMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [encryptionKey, setEncryptionKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  useEffect(() => {
    if (activeProjectId) setProjectId(activeProjectId);
  }, [activeProjectId]);

  useEffect(() => {
    if (!projectId) return;
    let mounted = true;
    setLoading(true);
    setError(null);
    Promise.all([fetchProjectSecrets(projectId), fetchProjectEncryptionKeyStatus(projectId)])
      .then(([list, status]) => {
        if (!mounted) return;
        setSecrets(list);
        setKeyConfigured(Boolean(status?.configured));
      })
      .catch((err: any) => {
        if (mounted) setError(err?.message || 'Failed to load secrets');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [projectId]);

  const handleSaveKey = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId) return;
    try {
      setSavingKey(true);
      setError(null);
      await setProjectEncryptionKey(projectId, encryptionKey);
      setKeyConfigured(true);
      setEncryptionKey('');
    } catch (err: any) {
      setError(err?.message || 'Failed to save encryption key');
    } finally {
      setSavingKey(false);
    }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId) return;
    try {
      setSaving(true);
      setError(null);
      await upsertProjectSecret(projectId, name.trim(), value, description);
      const list = await fetchProjectSecrets(projectId);
      setSecrets(list);
      setName('');
      setValue('');
      setDescription('');
    } catch (err: any) {
      setError(err?.message || 'Failed to save secret');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (secretName: string) => {
    if (!projectId) return;
    if (!window.confirm(`Delete secret ${secretName}? Flows that reference it will fail.`)) return;
    try {
      setError(null);
      await deleteProjectSecret(projectId, secretName);
      setSecrets((current) => current.filter((secret) => secret.name !== secretName));
    } catch (err: any) {
      setError(err?.message || 'Failed to delete secret');
    }
  };

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
        Secrets are encrypted with this project&apos;s key and can be referenced as <code>{'{{secrets.NAME}}'}</code>. Values are never shown again after you save them.
      </p>
      <label style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
        Project
        <select
          className="form-input"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          style={{ marginTop: 4 }}
        >
          {projects.map((project) => (
            <option key={project._id} value={project._id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: 13, display: 'flex', gap: 6, marginBottom: 10 }}>
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      <form onSubmit={handleSaveKey} style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          Encryption key {keyConfigured ? '· set for this project' : '· required'}
        </div>
        <input
          className="form-input"
          type="password"
          placeholder={keyConfigured ? 'Replace encryption key' : 'Encryption key (at least 8 characters)'}
          value={encryptionKey}
          onChange={(event) => setEncryptionKey(event.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
        <button type="submit" className="btn btn-primary" disabled={savingKey} style={{ justifySelf: 'start' }}>
          {savingKey ? <Loader2 size={14} /> : <KeyRound size={14} />}
          {keyConfigured ? 'Update encryption key' : 'Save encryption key'}
        </button>
      </form>

      <form onSubmit={handleSave} style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
        <input
          className="form-input"
          placeholder="NAME (UPPER_SNAKE_CASE)"
          value={name}
          onChange={(event) => setName(event.target.value.toUpperCase())}
          required
        />
        <input
          className="form-input"
          type="password"
          placeholder="Value"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoComplete="new-password"
          required
        />
        <input
          className="form-input"
          placeholder="Description (optional)"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={saving} style={{ justifySelf: 'start' }}>
          {saving ? <Loader2 size={14} /> : <Plus size={14} />}
          Save secret
        </button>
      </form>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading secrets…</div>
      ) : secrets.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 6 }}>
          <KeyRound size={15} />
          No secrets in this project yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {secrets.map((secret) => (
            <div
              key={secret.name}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{secret.name}</div>
                {secret.description ? (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{secret.description}</div>
                ) : null}
              </div>
              <button type="button" className="collapse-btn" title="Delete secret" onClick={() => handleDelete(secret.name)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
