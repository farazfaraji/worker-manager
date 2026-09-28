'use client';

import React, { useState, useEffect } from 'react';
import {
  UserCheck,
  Clock,
  Edit3,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Send,
} from 'lucide-react';
import { RunNodeRecord, RunResult } from '@/lib/types';

interface ExecutionGateReviewProps {
  waitingNodeRecord: RunNodeRecord;
  onResumeRun?: (payload: any) => Promise<RunResult>;
}

export const ExecutionGateReview: React.FC<ExecutionGateReviewProps> = ({
  waitingNodeRecord,
  onResumeRun,
}) => {
  const gateData = waitingNodeRecord?.output?.result || waitingNodeRecord?.output || {};
  const gateQuestion = gateData.question || 'Please review this request and provide your response.';
  const gateInputType = gateData.inputType || 'approval';
  const gateOptions: string[] = Array.isArray(gateData.options) ? gateData.options : [];
  const gateFormFields: any[] = Array.isArray(gateData.formFields) ? gateData.formFields : [];
  const gateDraft = gateData.draft;
  const allowDraftEdit = Boolean(gateData.allowDraftEdit);

  const [gateInputValues, setGateInputValues] = useState<Record<string, any>>({});
  const [gateDraftText, setGateDraftText] = useState<string>('');
  const [gateFeedback, setGateFeedback] = useState<string>('');
  const [isSubmittingGate, setIsSubmittingGate] = useState<boolean>(false);

  useEffect(() => {
    if (waitingNodeRecord) {
      if (gateDraft !== undefined && gateDraft !== null) {
        setGateDraftText(typeof gateDraft === 'object' ? JSON.stringify(gateDraft, null, 2) : String(gateDraft));
      }
      if (gateInputType === 'form' && gateFormFields.length > 0) {
        const initial: Record<string, any> = {};
        gateFormFields.forEach((f: any) => {
          initial[f.name] = f.defaultValue !== undefined ? f.defaultValue : (f.options?.[0] || '');
        });
        setGateInputValues(initial);
      } else if (gateInputType === 'select' || gateInputType === 'radio') {
        setGateInputValues({ value: gateOptions[0] || '' });
      } else {
        setGateInputValues({});
      }
      setGateFeedback('');
    }
  }, [waitingNodeRecord?.nodeId]);

  const handleGateSubmit = async (customDecision?: boolean) => {
    if (!onResumeRun) return;
    setIsSubmittingGate(true);
    try {
      const decision = customDecision !== undefined ? customDecision : true;
      const isApproval = gateInputType === 'approval';
      const mainVal = isApproval ? decision : (gateInputValues.value !== undefined ? gateInputValues.value : gateInputValues);

      const payload: any = {
        approved: decision,
        decision,
        value: mainVal,
        formValues: gateInputType === 'form' ? gateInputValues : undefined,
        feedback: gateFeedback,
        draft: allowDraftEdit ? gateDraftText : gateDraft,
        __resumed: true,
      };

      await onResumeRun(payload);
    } catch {
      // Handled by parent
    } finally {
      setIsSubmittingGate(false);
    }
  };

  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 'var(--radius-lg)',
        border: '1.5px solid #6366f1',
        padding: '20px 22px',
        boxShadow: '0 10px 25px -5px rgba(99, 102, 241, 0.12), 0 8px 10px -6px rgba(99, 102, 241, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* Card Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              background: '#e0e7ff',
              color: '#4f46e5',
              padding: 8,
              borderRadius: 'var(--radius-md)',
              display: 'flex',
            }}
          >
            <UserCheck size={20} />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              Human Review &amp; Input Required
            </h4>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              Node: <strong>{waitingNodeRecord.nodeName}</strong> &bull; Paused waiting for your response
            </p>
          </div>
        </div>

        <span
          style={{
            background: '#fef3c7',
            color: '#b45309',
            border: '1px solid #fde68a',
            fontSize: 11,
            fontWeight: 700,
            padding: '3px 10px',
            borderRadius: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Clock size={12} />
          Action Required
        </span>
      </div>

      {/* Question / Prompt Box */}
      <div
        style={{
          background: 'var(--bg-subtle)',
          borderLeft: '4px solid #6366f1',
          padding: '12px 16px',
          borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
          fontSize: 13.5,
          fontWeight: 600,
          color: 'var(--text-primary)',
          lineHeight: 1.5,
        }}
      >
        {gateQuestion}
      </div>

      {/* Upstream Draft Preview / Editor */}
      {gateDraft !== undefined && gateDraft !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
              {allowDraftEdit ? 'Draft Payload (Editable):' : 'Draft Payload to Review:'}
            </label>
            {allowDraftEdit && (
              <span style={{ fontSize: 11, color: '#6366f1', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Edit3 size={12} /> Modifications will pass downstream
              </span>
            )}
          </div>

          {allowDraftEdit ? (
            <textarea
              value={gateDraftText}
              onChange={(e) => setGateDraftText(e.target.value)}
              rows={5}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: 12.5,
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                resize: 'vertical',
              }}
            />
          ) : (
            <pre
              style={{
                margin: 0,
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                background: '#0f172a',
                color: '#38bdf8',
                fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: 12,
                maxHeight: 180,
                overflowY: 'auto',
              }}
            >
              {typeof gateDraft === 'object' ? JSON.stringify(gateDraft, null, 2) : String(gateDraft)}
            </pre>
          )}
        </div>
      )}

      {/* Dynamic Form Control Area based on inputType */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {gateInputType === 'approval' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                Optional Feedback / Review Notes:
              </label>
              <textarea
                value={gateFeedback}
                onChange={(e) => setGateFeedback(e.target.value)}
                placeholder="Enter any notes or critique..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  fontSize: 13,
                  background: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  resize: 'vertical',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={isSubmittingGate}
                onClick={() => handleGateSubmit(true)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '12px 18px',
                  borderRadius: 'var(--radius-md)',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: isSubmittingGate ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.25)',
                }}
              >
                {isSubmittingGate ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Approve &amp; Continue
              </button>

              <button
                type="button"
                disabled={isSubmittingGate}
                onClick={() => handleGateSubmit(false)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '12px 18px',
                  borderRadius: 'var(--radius-md)',
                  background: '#ffffff',
                  color: '#dc2626',
                  border: '1.5px solid #f87171',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: isSubmittingGate ? 'not-allowed' : 'pointer',
                }}
              >
                {isSubmittingGate ? <Loader2 size={16} className="animate-spin" /> : <AlertCircle size={16} />}
                Reject &amp; Continue
              </button>
            </div>
          </div>
        )}

        {gateInputType === 'textarea' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                Your Response:
              </label>
              <textarea
                value={gateInputValues.value || ''}
                onChange={(e) => setGateInputValues({ ...gateInputValues, value: e.target.value })}
                placeholder="Type your response or instructions..."
                rows={4}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  fontSize: 13,
                  background: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  resize: 'vertical',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={isSubmittingGate}
                onClick={() => handleGateSubmit(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 18px',
                  borderRadius: 'var(--radius-md)',
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: 13.5,
                  cursor: isSubmittingGate ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 6px -1px rgba(99, 102, 241, 0.25)',
                }}
              >
                {isSubmittingGate ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Submit &amp; Resume Flow
              </button>
            </div>
          </div>
        )}

        {gateInputType === 'text' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                Your Input:
              </label>
              <input
                type="text"
                value={gateInputValues.value || ''}
                onChange={(e) => setGateInputValues({ ...gateInputValues, value: e.target.value })}
                placeholder="Enter text..."
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  fontSize: 13,
                  background: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={isSubmittingGate}
                onClick={() => handleGateSubmit(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 18px',
                  borderRadius: 'var(--radius-md)',
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: 13.5,
                  cursor: isSubmittingGate ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 6px -1px rgba(99, 102, 241, 0.25)',
                }}
              >
                {isSubmittingGate ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Submit &amp; Resume Flow
              </button>
            </div>
          </div>
        )}

        {gateInputType === 'select' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                Select Option:
              </label>
              <select
                value={gateInputValues.value || gateOptions[0] || ''}
                onChange={(e) => setGateInputValues({ ...gateInputValues, value: e.target.value })}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  fontSize: 13,
                  background: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                {gateOptions.map((opt, i) => (
                  <option key={i} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={isSubmittingGate}
                onClick={() => handleGateSubmit(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 18px',
                  borderRadius: 'var(--radius-md)',
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: 13.5,
                  cursor: isSubmittingGate ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 6px -1px rgba(99, 102, 241, 0.25)',
                }}
              >
                {isSubmittingGate ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Submit &amp; Resume Flow
              </button>
            </div>
          </div>
        )}

        {gateInputType === 'radio' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
                Choose an Option:
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {gateOptions.map((opt, i) => {
                  const isSelected = (gateInputValues.value || gateOptions[0]) === opt;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setGateInputValues({ ...gateInputValues, value: opt })}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 9999,
                        fontSize: 13,
                        fontWeight: 600,
                        border: isSelected ? '1.5px solid #6366f1' : '1px solid var(--border-color)',
                        background: isSelected ? '#e0e7ff' : 'var(--bg-surface)',
                        color: isSelected ? '#4338ca' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="button"
                disabled={isSubmittingGate}
                onClick={() => handleGateSubmit(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 18px',
                  borderRadius: 'var(--radius-md)',
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: 13.5,
                  cursor: isSubmittingGate ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 6px -1px rgba(99, 102, 241, 0.25)',
                }}
              >
                {isSubmittingGate ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Submit &amp; Resume Flow
              </button>
            </div>
          </div>
        )}

        {gateInputType === 'form' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {gateFormFields.map((field: any, idx: number) => (
              <div key={field.name || idx}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>
                  {field.label || field.name} {field.required && <span style={{ color: '#dc2626' }}>*</span>}
                </label>
                {field.type === 'textarea' ? (
                  <textarea
                    value={gateInputValues[field.name] || ''}
                    onChange={(e) => setGateInputValues({ ...gateInputValues, [field.name]: e.target.value })}
                    placeholder={field.placeholder || ''}
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: 13,
                      background: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                    }}
                  />
                ) : field.type === 'select' && Array.isArray(field.options) ? (
                  <select
                    value={gateInputValues[field.name] || field.options[0] || ''}
                    onChange={(e) => setGateInputValues({ ...gateInputValues, [field.name]: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: 13,
                      background: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {field.options.map((opt: string, optIdx: number) => (
                      <option key={optIdx} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={gateInputValues[field.name] !== undefined ? gateInputValues[field.name] : ''}
                    onChange={(e) => setGateInputValues({ ...gateInputValues, [field.name]: e.target.value })}
                    placeholder={field.placeholder || ''}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: 13,
                      background: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                    }}
                  />
                )}
              </div>
            ))}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="button"
                disabled={isSubmittingGate}
                onClick={() => handleGateSubmit(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 18px',
                  borderRadius: 'var(--radius-md)',
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: 13.5,
                  cursor: isSubmittingGate ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 6px -1px rgba(99, 102, 241, 0.25)',
                }}
              >
                {isSubmittingGate ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Submit &amp; Resume Flow
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
