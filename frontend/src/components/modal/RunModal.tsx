'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Play,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Copy,
  Check,
  Code2,
  Terminal,
  Clock,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  FileJson,
  Sparkles,
  RefreshCw,
  UserCheck,
  Send,
  Edit3,
  Sliders,
  Server,
  Globe,
  Radio,
  Pause,
  ExternalLink,
} from 'lucide-react';
import { Node, Edge } from '@xyflow/react';
import { RunResult, RunNodeRecord, FlowNodeData } from '@/lib/types';
import { getWebserverStatus, startWebserver, stopWebserver } from '@/lib/api';
import { getNodeIcon } from '../nodes/LangGraphCustomNode';

function generateSampleJsonFromRoute(routeNode: Node<FlowNodeData>): Record<string, any> {
  const config = routeNode.data?.config || {};
  const typeStr = String(config.type || '').trim();

  if (typeStr) {
    const sample: Record<string, any> = {};
    const regex = /([a-zA-Z0-9_]+)\s*:\s*z\.([a-zA-Z0-9_]+)/g;
    let match;
    while ((match = regex.exec(typeStr)) !== null) {
      const field = match[1];
      const zType = match[2].toLowerCase();
      if (zType.includes('string')) {
        if (field.toLowerCase().includes('title')) sample[field] = 'Architecture Plan v1';
        else if (field.toLowerCase().includes('content')) sample[field] = 'Comprehensive system design for vector search.';
        else if (field.toLowerCase().includes('email')) sample[field] = 'user@example.com';
        else if (field.toLowerCase().includes('name')) sample[field] = 'Alex Flow';
        else sample[field] = `sample_${field}`;
      } else if (zType.includes('number')) {
        sample[field] = 42;
      } else if (zType.includes('boolean')) {
        sample[field] = true;
      } else if (zType.includes('array')) {
        sample[field] = ['keyword1', 'keyword2'];
      } else {
        sample[field] = 'example';
      }
    }
    if (Object.keys(sample).length > 0) {
      return sample;
    }
  }

  return {
    title: 'Architecture Plan v1',
    content: 'Comprehensive system design for microservices and vector search.',
    keywords: ['system', 'vector', 'architecture'],
  };
}

function buildCurlCommand(method: string, url: string, bodyObj?: any): string {
  const isBodyAllowed = method !== 'GET' && method !== 'HEAD';
  if (!isBodyAllowed) {
    return `curl -X ${method} "${url}"`;
  }
  const bodyFormatted = JSON.stringify(bodyObj || {}, null, 2);
  return `curl -X ${method} "${url}" \\\n  -H "Content-Type: application/json" \\\n  -d '${bodyFormatted.replace(/'/g, "'\\''")}'`;
}

interface RunModalProps {
  isOpen: boolean;
  graphName: string;
  graphId: string | null;
  nodes?: Node<FlowNodeData>[];
  edges?: Edge[];
  isDirty: boolean;
  onClose: () => void;
  onRun: (inputPayload: any) => Promise<RunResult>;
  onRerunNode?: (nodeId: string) => Promise<RunResult>;
  onResumeRun?: (payload: any) => Promise<RunResult>;
  onValidate: () => Promise<{ valid: boolean }>;
  runResult: RunResult | null;
  isExecuting: boolean;
}

export const RunModal: React.FC<RunModalProps> = ({
  isOpen,
  graphName,
  graphId,
  nodes = [],
  edges = [],
  isDirty,
  onClose,
  onRun,
  onRerunNode,
  onResumeRun,
  onValidate,
  runResult,
  isExecuting,
}) => {
  const webserverNode = nodes.find((n) => {
    const type = String(n.data?.definitionType || n.type || '').toLowerCase();
    return type === 'webserver' || n.data?.definitionId === 'webserver';
  });
  const hasWebserver = !!webserverNode;

  const routeNodes = nodes.filter((n) => {
    const type = String(n.data?.definitionType || n.type || '').toLowerCase();
    return type === 'route' || n.data?.definitionId === 'route';
  });

  const [activeTab, setActiveTab] = useState<'endpoints' | 'input' | 'output'>('input');
  const [serverStatus, setServerStatus] = useState<'running' | 'stopped'>('stopped');
  const [serverPort, setServerPort] = useState<number>(3000);
  const [serverHost, setServerHost] = useState<string>('0.0.0.0');
  const [serverLoading, setServerLoading] = useState<boolean>(false);
  const [copiedCurlKey, setCopiedCurlKey] = useState<string | null>(null);
  const [testPayloads, setTestPayloads] = useState<Record<string, string>>({});
  const [testResponse, setTestResponse] = useState<Record<string, any>>({});
  const [isSendingRequest, setIsSendingRequest] = useState<Record<string, boolean>>({});

  const [inputJson, setInputJson] = useState<string>('{\n  "input": "Hello Flow Studio!"\n}');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<boolean>(false);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [validationStatus, setValidationStatus] = useState<{
    valid?: boolean;
    message?: string;
  } | null>(null);

  // Human Gate review state
  const [gateInputValues, setGateInputValues] = useState<Record<string, any>>({});
  const [gateDraftText, setGateDraftText] = useState<string>('');
  const [gateFeedback, setGateFeedback] = useState<string>('');
  const [isSubmittingGate, setIsSubmittingGate] = useState<boolean>(false);

  // Identify waiting node in runResult
  const waitingNodeRecord = runResult?.status === 'waiting'
    ? (runResult.nodes || []).find((n) => n.status === 'waiting')
    : null;

  const gateData = waitingNodeRecord?.output?.result || waitingNodeRecord?.output || {};
  const gateQuestion = gateData.question || 'Please review this request and provide your response.';
  const gateInputType = gateData.inputType || 'approval';
  const gateOptions: string[] = Array.isArray(gateData.options) ? gateData.options : [];
  const gateFormFields: any[] = Array.isArray(gateData.formFields) ? gateData.formFields : [];
  const gateDraft = gateData.draft;
  const allowDraftEdit = Boolean(gateData.allowDraftEdit);

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
    } catch (err: any) {
      alert(`Failed to submit review: ${err.message}`);
    } finally {
      setIsSubmittingGate(false);
    }
  };

  // Sync default port/host from webserverNode config
  useEffect(() => {
    if (webserverNode) {
      const cfg = webserverNode.data?.config || {};
      if (cfg.port) setServerPort(Number(cfg.port));
      if (cfg.host) setServerHost(cfg.host);
    }
  }, [webserverNode]);

  // Check server status when modal opens
  useEffect(() => {
    if (!isOpen || !hasWebserver || !graphId) return;

    let isMounted = true;
    getWebserverStatus(graphId, webserverNode?.id)
      .then((res) => {
        if (!isMounted) return;
        if (res?.status) {
          setServerStatus(res.status);
          if (res.port) setServerPort(res.port);
          if (res.host) setServerHost(res.host);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [isOpen, hasWebserver, graphId, webserverNode?.id]);

  // Default tab when opening
  useEffect(() => {
    if (isOpen) {
      if (hasWebserver && (!runResult || runResult.status === 'listening')) {
        setActiveTab('endpoints');
      } else if (runResult) {
        setActiveTab('output');
      } else {
        setActiveTab('input');
      }
    }
  }, [isOpen, hasWebserver]);

  // When runResult updates: if listening, set serverStatus running
  useEffect(() => {
    if (runResult?.status === 'listening') {
      setServerStatus('running');
      if (runResult.output?.port) setServerPort(runResult.output.port);
      if (runResult.output?.host) setServerHost(runResult.output.host);
    }
  }, [runResult]);

  const handleCopyCurl = (key: string, curlCmd: string) => {
    navigator.clipboard.writeText(curlCmd);
    setCopiedCurlKey(key);
    setTimeout(() => setCopiedCurlKey(null), 2000);
  };

  const handleToggleWebserver = async () => {
    if (!graphId || !webserverNode) return;
    setServerLoading(true);
    try {
      if (serverStatus === 'running') {
        await stopWebserver(graphId, webserverNode.id);
        setServerStatus('stopped');
      } else {
        const res = await startWebserver(graphId, webserverNode.id);
        setServerStatus('running');
        if (res.port) setServerPort(res.port);
        if (res.host) setServerHost(res.host);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to toggle webserver');
    } finally {
      setServerLoading(false);
    }
  };

  const handleSendTestRequest = async (routeNode: Node<FlowNodeData>) => {
    const config = routeNode.data?.config || {};
    const method = String(config.method || 'POST').toUpperCase();
    const endpoint = String(config.endpoint || '/api/example');
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const hostDisplay = serverHost === '0.0.0.0' ? 'localhost' : serverHost;
    const url = `http://${hostDisplay}:${serverPort}${cleanEndpoint}`;

    const currentPayloadStr =
      testPayloads[routeNode.id] !== undefined
        ? testPayloads[routeNode.id]
        : JSON.stringify(generateSampleJsonFromRoute(routeNode), null, 2);

    let parsedBody: any = null;
    if (method !== 'GET') {
      try {
        parsedBody = JSON.parse(currentPayloadStr);
      } catch (err: any) {
        alert(`Invalid JSON in request payload: ${err.message}`);
        return;
      }
    }

    setIsSendingRequest((prev) => ({ ...prev, [routeNode.id]: true }));
    setTestResponse((prev) => ({ ...prev, [routeNode.id]: null }));

    const start = Date.now();
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: method !== 'GET' ? JSON.stringify(parsedBody) : undefined,
      });

      let resData: any = null;
      const text = await res.text();
      try {
        resData = JSON.parse(text);
      } catch {
        resData = text;
      }

      setTestResponse((prev) => ({
        ...prev,
        [routeNode.id]: {
          status: res.status,
          statusText: res.statusText,
          timeMs: Date.now() - start,
          data: resData,
        },
      }));
    } catch (err: any) {
      setTestResponse((prev) => ({
        ...prev,
        [routeNode.id]: {
          status: 0,
          statusText: 'Network Error',
          timeMs: Date.now() - start,
          error: err.message || 'Failed to connect to webserver. Is the webserver started?',
        },
      }));
    } finally {
      setIsSendingRequest((prev) => ({ ...prev, [routeNode.id]: false }));
    }
  };

  // Switch to output tab when run completes
  useEffect(() => {
    if (runResult) {
      if (runResult.status === 'listening' && hasWebserver) {
        setActiveTab('endpoints');
      } else {
        setActiveTab('output');
      }
      // Auto expand failed or waiting nodes or last node
      if (runResult.nodes && runResult.nodes.length > 0) {
        const expanded: Record<string, boolean> = {};
        runResult.nodes.forEach((node, idx) => {
          if (node.status === 'failed' || node.status === 'waiting' || idx === runResult.nodes!.length - 1) {
            expanded[node.nodeId] = true;
          }
        });
        setExpandedNodes(expanded);
      }
    }
  }, [runResult, hasWebserver]);

  if (!isOpen) return null;

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

  const handleExecute = async () => {
    let parsedInput: any = {};
    if (inputJson.trim() !== '') {
      try {
        parsedInput = JSON.parse(inputJson);
      } catch (e: any) {
        setJsonError(`Invalid JSON: ${e.message}`);
        setActiveTab('input');
        return;
      }
    }

    setValidationStatus(null);
    try {
      await onRun(parsedInput);
    } catch {
      // Error handled by parent / result display
    }
  };

  const handleValidateClick = async () => {
    setIsValidating(true);
    setValidationStatus(null);
    try {
      const res = await onValidate();
      if (res.valid) {
        setValidationStatus({ valid: true, message: 'All node variables and flow topology are valid!' });
      }
    } catch (err: any) {
      setValidationStatus({ valid: false, message: err.message || 'Validation failed' });
    } finally {
      setIsValidating(false);
    }
  };

  const toggleNodeExpand = (nodeId: string) => {
    setExpandedNodes((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const setSampleInput = (sample: string) => {
    setInputJson(sample);
    setJsonError(null);
  };

  // Compute execution duration
  let durationMs: number | null = null;
  if (runResult?.createdAt && runResult?.updatedAt) {
    const start = new Date(runResult.createdAt).getTime();
    const end = new Date(runResult.updatedAt).getTime();
    if (!isNaN(start) && !isNaN(end) && end >= start) {
      durationMs = end - start;
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content run-modal-container"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 840, width: '92vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Modal Header */}
        <div className="modal-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                background: 'var(--accent-subtle)',
                color: 'var(--accent-primary)',
                padding: 7,
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
              }}
            >
              <Terminal size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Flow Execution Studio
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                Executing: <strong style={{ color: 'var(--text-primary)' }}>{graphName}</strong>
                {isDirty && <span style={{ color: '#d97706', marginLeft: 6 }}>(Unsaved changes will be synced)</span>}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Status indicator */}
            {isExecuting ? (
              <span className="status-badge" style={{ background: '#e0e7ff', color: '#4338ca' }}>
                <Loader2 size={13} className="animate-spin" />
                Executing Flow...
              </span>
            ) : runResult ? (
              runResult.status === 'listening' ? (
                <span className="status-badge" style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
                  <Server size={13} />
                  Live &amp; Listening (:{runResult.output?.port || serverPort})
                </span>
              ) : runResult.status === 'completed' ? (
                <span className="status-badge status-saved">
                  <CheckCircle2 size={13} />
                  Completed {durationMs !== null ? `(${durationMs}ms)` : ''}
                </span>
              ) : runResult.status === 'waiting' ? (
                <span className="status-badge" style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' }}>
                  <Clock size={13} />
                  Waiting for Review
                </span>
              ) : (
                <span className="status-badge" style={{ background: '#fef2f2', color: '#dc2626' }}>
                  <AlertCircle size={13} />
                  Execution Failed
                </span>
              )
            ) : (
              <span className="status-badge" style={{ background: '#f1f5f9', color: '#64748b' }}>
                Ready
              </span>
            )}

            <button type="button" className="modal-close-btn" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Navigation Tabs & Actions Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 20px',
            background: 'var(--bg-subtle)',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            {hasWebserver && (
              <button
                type="button"
                className={`tab-btn ${activeTab === 'endpoints' ? 'active' : ''}`}
                onClick={() => setActiveTab('endpoints')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  fontWeight: 600,
                  border: '1px solid',
                  borderColor: activeTab === 'endpoints' ? 'var(--accent-primary)' : 'transparent',
                  background: activeTab === 'endpoints' ? '#ffffff' : 'transparent',
                  color: activeTab === 'endpoints' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <Server size={15} />
                Webserver &amp; Endpoints
                <span
                  style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 10,
                    background: serverStatus === 'running' ? '#d1fae5' : '#f3f4f6',
                    color: serverStatus === 'running' ? '#065f46' : '#6b7280',
                    fontWeight: 700,
                  }}
                >
                  {serverStatus === 'running' ? 'Live' : 'Stopped'}
                </span>
              </button>
            )}

            <button
              type="button"
              className={`tab-btn ${activeTab === 'input' ? 'active' : ''}`}
              onClick={() => setActiveTab('input')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 13,
                fontWeight: 600,
                border: '1px solid',
                borderColor: activeTab === 'input' ? 'var(--accent-primary)' : 'transparent',
                background: activeTab === 'input' ? '#ffffff' : 'transparent',
                color: activeTab === 'input' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <FileJson size={15} />
              Input Payload
            </button>

            <button
              type="button"
              className={`tab-btn ${activeTab === 'output' ? 'active' : ''}`}
              onClick={() => setActiveTab('output')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 13,
                fontWeight: 600,
                border: '1px solid',
                borderColor: activeTab === 'output' ? 'var(--accent-primary)' : 'transparent',
                background: activeTab === 'output' ? '#ffffff' : 'transparent',
                color: activeTab === 'output' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <Terminal size={15} />
              Execution Trace &amp; Output
              {runResult && (
                <span
                  style={{
                    fontSize: 10,
                    padding: '1px 5px',
                    borderRadius: 10,
                    background:
                      runResult.status === 'completed' || runResult.status === 'listening'
                        ? '#d1fae5'
                        : runResult.status === 'waiting'
                        ? '#fef3c7'
                        : '#fee2e2',
                    color:
                      runResult.status === 'completed' || runResult.status === 'listening'
                        ? '#065f46'
                        : runResult.status === 'waiting'
                        ? '#b45309'
                        : '#991b1b',
                    fontWeight: 700,
                  }}
                >
                  {runResult.status}
                </span>
              )}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="btn btn-default"
              onClick={handleValidateClick}
              disabled={isValidating || isExecuting}
              style={{ fontSize: 12, padding: '5px 10px', height: 32 }}
              title="Validate graph variables and node connections"
            >
              {isValidating ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <ShieldCheck size={14} color="var(--accent-primary)" />
              )}
              Validate Graph
            </button>

            <button
              type="button"
              className="btn btn-primary"
              onClick={handleExecute}
              disabled={isExecuting || (activeTab === 'input' && !!jsonError)}
              style={{
                fontSize: 13,
                padding: '6px 16px',
                height: 32,
                background:
                  serverStatus === 'running' && hasWebserver
                    ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                    : 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
                color: '#ffffff',
                fontWeight: 600,
                boxShadow: '0 2px 4px rgba(79, 70, 229, 0.25)',
              }}
            >
              {isExecuting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : hasWebserver ? (
                serverStatus === 'running' ? (
                  <RefreshCw size={14} />
                ) : (
                  <Play size={14} fill="#ffffff" />
                )
              ) : (
                <Play size={14} fill="#ffffff" />
              )}
              {isExecuting
                ? hasWebserver
                  ? 'Starting Server...'
                  : 'Running...'
                : hasWebserver
                ? serverStatus === 'running'
                  ? 'Restart Server'
                  : 'Start Server & Listen'
                : 'Run Flow'}
            </button>
          </div>
        </div>

        {/* Validation Status Notification */}
        {validationStatus && (
          <div
            style={{
              padding: '8px 20px',
              fontSize: 12.5,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: validationStatus.valid ? '#ecfdf5' : '#fef2f2',
              color: validationStatus.valid ? '#065f46' : '#991b1b',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            {validationStatus.valid ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <span>{validationStatus.message}</span>
          </div>
        )}

        {/* Modal Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {activeTab === 'endpoints' && hasWebserver && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* 1. Server Status Banner */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                  borderRadius: 8,
                  background: serverStatus === 'running' ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-subtle)',
                  border: `1px solid ${serverStatus === 'running' ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-color)'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: serverStatus === 'running' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(100, 116, 139, 0.12)',
                      color: serverStatus === 'running' ? '#10b981' : '#64748b',
                    }}
                  >
                    <Server size={20} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                        Webserver Listener
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 12,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          background: serverStatus === 'running' ? '#d1fae5' : '#f1f5f9',
                          color: serverStatus === 'running' ? '#047857' : '#64748b',
                          border: `1px solid ${serverStatus === 'running' ? '#a7f3d0' : '#e2e8f0'}`,
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: serverStatus === 'running' ? '#10b981' : '#94a3b8',
                          }}
                        />
                        {serverStatus === 'running' ? 'Live & Listening' : 'Stopped'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                      {serverStatus === 'running' ? (
                        <span>
                          Listening on{' '}
                          <strong style={{ color: 'var(--text-primary)' }}>
                            http://{serverHost === '0.0.0.0' ? 'localhost' : serverHost}:{serverPort}
                          </strong>{' '}
                          ({routeNodes.length} active {routeNodes.length === 1 ? 'route' : 'routes'})
                        </span>
                      ) : (
                        <span>
                          Configured on port <strong>{serverPort}</strong> ({serverHost}) — Click Start Server or &quot;Start Server &amp; Listen&quot; to activate
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-default"
                    onClick={handleToggleWebserver}
                    disabled={serverLoading}
                    style={{
                      fontSize: 12,
                      padding: '6px 14px',
                      borderColor: serverStatus === 'running' ? '#ef4444' : undefined,
                      color: serverStatus === 'running' ? '#ef4444' : undefined,
                    }}
                  >
                    {serverLoading ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : serverStatus === 'running' ? (
                      <Pause size={13} />
                    ) : (
                      <Play size={13} />
                    )}
                    {serverStatus === 'running' ? 'Stop Server' : 'Start Server'}
                  </button>
                </div>
              </div>

              {/* 2. Live Request Listening Notice */}
              {serverStatus === 'running' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 16px',
                    background: 'rgba(79, 70, 229, 0.06)',
                    border: '1px solid rgba(79, 70, 229, 0.2)',
                    borderRadius: 8,
                    fontSize: 12.5,
                    color: 'var(--text-primary)',
                  }}
                >
                  <Radio size={18} color="#4f46e5" />
                  <div style={{ flex: 1 }}>
                    <strong>Ready for HTTP Requests:</strong> When an external client sends a request to any mounted endpoint below, the flow executes the connected pipeline with real request headers and payload.
                  </div>
                </div>
              )}

              {/* 3. Mounted Routes Hub */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                    Mounted Route Endpoints ({routeNodes.length})
                  </h4>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Run cURL or test in-place to trigger execution
                  </span>
                </div>

                {routeNodes.length === 0 ? (
                  <div
                    style={{
                      padding: 30,
                      textAlign: 'center',
                      border: '1px dashed var(--border-color)',
                      borderRadius: 8,
                      color: 'var(--text-muted)',
                      fontSize: 13,
                    }}
                  >
                    No Route blocks connected to this Webserver. Add a <strong>Route</strong> block from the left palette and connect it to the Webserver to expose HTTP endpoints.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {routeNodes.map((routeNode) => {
                      const cfg = routeNode.data?.config || {};
                      const method = String(cfg.method || 'POST').toUpperCase();
                      const endpoint = String(cfg.endpoint || '/api/example');
                      const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
                      const hostDisplay = serverHost === '0.0.0.0' ? 'localhost' : serverHost;
                      const fullUrl = `http://${hostDisplay}:${serverPort}${cleanEndpoint}`;
                      const sampleObj = generateSampleJsonFromRoute(routeNode);
                      const currentPayload =
                        testPayloads[routeNode.id] !== undefined
                          ? testPayloads[routeNode.id]
                          : JSON.stringify(sampleObj, null, 2);
                      const curlCmd = buildCurlCommand(method, fullUrl, sampleObj);
                      const isCopied = copiedCurlKey === routeNode.id;
                      const resData = testResponse[routeNode.id];
                      const isSending = Boolean(isSendingRequest[routeNode.id]);

                      const methodColor =
                        method === 'POST'
                          ? { bg: '#e0e7ff', color: '#3730a3', border: '#c7d2fe' }
                          : method === 'GET'
                          ? { bg: '#d1fae5', color: '#065f46', border: '#a7f3d0' }
                          : method === 'DELETE'
                          ? { bg: '#fee2e2', color: '#991b1b', border: '#fecaca' }
                          : { bg: '#fef3c7', color: '#92400e', border: '#fde68a' };

                      return (
                        <div
                          key={routeNode.id}
                          style={{
                            border: '1px solid var(--border-color)',
                            borderRadius: 8,
                            background: '#ffffff',
                            overflow: 'hidden',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                          }}
                        >
                          {/* Route Header */}
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '10px 16px',
                              background: 'var(--bg-subtle)',
                              borderBottom: '1px solid var(--border-color)',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span
                                style={{
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  fontSize: 11,
                                  fontWeight: 800,
                                  background: methodColor.bg,
                                  color: methodColor.color,
                                  border: `1px solid ${methodColor.border}`,
                                }}
                              >
                                {method}
                              </span>
                              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                                {cleanEndpoint}
                              </span>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                &rarr; Node: {routeNode.data?.nodeName || routeNode.data?.name || routeNode.id}
                              </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span
                                style={{
                                  fontSize: 10,
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  background: '#f1f5f9',
                                  color: '#475569',
                                }}
                              >
                                Mode: {cfg.responseMode || 'sync'}
                              </span>
                              <button
                                type="button"
                                className="btn btn-default"
                                onClick={() => handleCopyCurl(routeNode.id, curlCmd)}
                                style={{ fontSize: 11, padding: '3px 8px', height: 26 }}
                                title="Copy cURL command"
                              >
                                {isCopied ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                                {isCopied ? 'Copied!' : 'Copy cURL'}
                              </button>
                            </div>
                          </div>

                          {/* Route Content: cURL & Quick Test */}
                          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {/* cURL Display */}
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                                cURL Command:
                              </div>
                              <pre
                                style={{
                                  margin: 0,
                                  padding: '10px 14px',
                                  background: '#1e293b',
                                  color: '#f8fafc',
                                  borderRadius: 6,
                                  fontSize: 11.5,
                                  fontFamily: 'monospace',
                                  overflowX: 'auto',
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-all',
                                }}
                              >
                                {curlCmd}
                              </pre>
                            </div>

                            {/* Interactive In-Modal Test Runner */}
                            <div
                              style={{
                                borderTop: '1px solid var(--border-color)',
                                paddingTop: 12,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                                  Test Payload (JSON):
                                </span>
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  onClick={() => handleSendTestRequest(routeNode)}
                                  disabled={isSending || serverStatus !== 'running'}
                                  style={{
                                    fontSize: 11,
                                    padding: '4px 12px',
                                    height: 28,
                                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                    boxShadow: 'none',
                                  }}
                                >
                                  {isSending ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <Send size={12} />
                                  )}
                                  {serverStatus !== 'running' ? 'Start Server to Test' : isSending ? 'Sending...' : 'Send Request'}
                                </button>
                              </div>

                              {method !== 'GET' && (
                                <textarea
                                  value={currentPayload}
                                  onChange={(e) =>
                                    setTestPayloads((prev) => ({ ...prev, [routeNode.id]: e.target.value }))
                                  }
                                  rows={4}
                                  style={{
                                    width: '100%',
                                    fontFamily: 'monospace',
                                    fontSize: 11.5,
                                    padding: '8px 10px',
                                    borderRadius: 6,
                                    border: '1px solid var(--border-color)',
                                    background: 'var(--bg-canvas)',
                                    color: 'var(--text-primary)',
                                    resize: 'vertical',
                                  }}
                                />
                              )}

                              {/* Test Response Display */}
                              {resData && (
                                <div
                                  style={{
                                    marginTop: 10,
                                    padding: 12,
                                    borderRadius: 6,
                                    background: resData.status >= 200 && resData.status < 300 ? '#ecfdf5' : '#fef2f2',
                                    border: `1px solid ${resData.status >= 200 && resData.status < 300 ? '#a7f3d0' : '#fecaca'}`,
                                    fontSize: 12,
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <span
                                        style={{
                                          fontWeight: 700,
                                          color: resData.status >= 200 && resData.status < 300 ? '#065f46' : '#991b1b',
                                        }}
                                      >
                                        HTTP {resData.status} {resData.statusText}
                                      </span>
                                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                        ({resData.timeMs}ms)
                                      </span>
                                    </div>
                                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                      Check &quot;Execution Trace &amp; Output&quot; tab for full run graph
                                    </span>
                                  </div>
                                  <pre
                                    style={{
                                      margin: 0,
                                      padding: '8px 10px',
                                      background: '#ffffff',
                                      borderRadius: 4,
                                      border: '1px solid rgba(0,0,0,0.06)',
                                      fontSize: 11,
                                      fontFamily: 'monospace',
                                      maxHeight: 180,
                                      overflowY: 'auto',
                                      whiteSpace: 'pre-wrap',
                                    }}
                                  >
                                    {typeof resData.data === 'object'
                                      ? JSON.stringify(resData.data, null, 2)
                                      : resData.data || resData.error}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'input' && (
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
                      Empty {}
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
          )}

          {activeTab === 'output' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {!runResult && !isExecuting && (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '40px 20px',
                    color: 'var(--text-muted)',
                    background: 'var(--bg-subtle)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px dashed var(--border-color)',
                  }}
                >
                  <Terminal size={32} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                    No Execution Data Yet
                  </h4>
                  <p style={{ fontSize: 12, maxWidth: 360, margin: '0 auto 16px' }}>
                    Click &ldquo;Run Flow&rdquo; to execute this workflow and inspect step-by-step traces.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleExecute}
                    disabled={isExecuting || !!jsonError}
                    style={{ margin: '0 auto' }}
                  >
                    <Play size={13} fill="#ffffff" />
                    Run Flow Now
                  </button>
                </div>
              )}

              {isExecuting && (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '40px 20px',
                    background: 'var(--bg-surface)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <Loader2 size={32} className="animate-spin" color="var(--accent-primary)" style={{ margin: '0 auto 12px' }} />
                  <h4 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                    Executing Graph Workflow...
                  </h4>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Resolving node dependencies and computing outputs
                  </p>
                </div>
              )}

              {runResult && (
                <>
                  {/* Overall Error Banner if run failed */}
                  {runResult.status === 'failed' && (
                    <div
                      style={{
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: 'var(--radius-md)',
                        padding: '14px 16px',
                        color: '#991b1b',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
                        <AlertCircle size={17} color="#dc2626" />
                        <span>Execution Error</span>
                      </div>
                      <div style={{ fontSize: 13, marginTop: 6, fontFamily: 'monospace' }}>
                        {runResult.error?.message || 'Graph execution encountered an error'}
                      </div>
                    </div>
                  )}

                  {/* n8n-Style Human Gate Interactive Review & Form Card */}
                  {waitingNodeRecord && (
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
                              Human Review & Input Required
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
                                Approve & Continue
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
                                Reject & Continue
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
                                Submit & Resume Flow
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
                                Submit & Resume Flow
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
                                Submit & Resume Flow
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
                                Submit & Resume Flow
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
                                Submit & Resume Flow
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Final Output Summary */}
                  {runResult.output !== undefined && runResult.status !== 'waiting' && (
                    <div
                      style={{
                        background: '#0f172a',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid #334155',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          background: '#1e293b',
                          borderBottom: '1px solid #334155',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <CheckCircle2 size={15} color="#10b981" />
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                            Final Flow Output
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(JSON.stringify(runResult.output, null, 2))}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            fontSize: 11,
                            background: '#334155',
                            color: '#f8fafc',
                            border: 'none',
                            padding: '4px 8px',
                            borderRadius: 4,
                            cursor: 'pointer',
                          }}
                        >
                          {copied ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                          {copied ? 'Copied' : 'Copy JSON'}
                        </button>
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          padding: 14,
                          fontSize: 12.5,
                          fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          color: '#38bdf8',
                          overflowX: 'auto',
                          maxHeight: 220,
                        }}
                      >
                        {JSON.stringify(runResult.output, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Step-by-Step Node Execution Timeline */}
                  <div>
                    <h4
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: 'var(--text-primary)',
                        marginBottom: 10,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>Execution Trace ({runResult.nodes?.length || 0} nodes executed)</span>
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)' }}>
                        Run ID: {runResult.runId ? runResult.runId.substring(0, 8) : 'N/A'}
                      </span>
                    </h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {(runResult.nodes || []).map((nodeRecord: RunNodeRecord, idx: number) => {
                        const isExpanded = !!expandedNodes[nodeRecord.nodeId];
                        const isFailed = nodeRecord.status === 'failed';
                        const isDone = nodeRecord.status === 'completed';
                        const isWaiting = nodeRecord.status === 'waiting';

                        let nodeDuration: number | null = null;
                        if (nodeRecord.startedAt && nodeRecord.finishedAt) {
                          const s = new Date(nodeRecord.startedAt).getTime();
                          const f = new Date(nodeRecord.finishedAt).getTime();
                          if (!isNaN(s) && !isNaN(f)) nodeDuration = f - s;
                        }

                        return (
                          <div
                            key={nodeRecord.nodeId || idx}
                            style={{
                              border: `1px solid ${isFailed ? '#fecaca' : 'var(--border-color)'}`,
                              borderRadius: 'var(--radius-md)',
                              background: isFailed ? '#fff5f5' : 'var(--bg-surface)',
                              overflow: 'hidden',
                              boxShadow: 'var(--shadow-sm)',
                            }}
                          >
                            {/* Step Header */}
                            <div
                              onClick={() => toggleNodeExpand(nodeRecord.nodeId)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '10px 14px',
                                cursor: 'pointer',
                                background: isFailed ? '#fef2f2' : 'transparent',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: 'var(--text-muted)',
                                    width: 18,
                                  }}
                                >
                                  #{idx + 1}
                                </span>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {getNodeIcon(nodeRecord.nodeType || 'function', 16)}
                                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                                    {nodeRecord.nodeName}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 10,
                                      background: 'var(--bg-subtle)',
                                      padding: '1px 6px',
                                      borderRadius: 4,
                                      color: 'var(--text-secondary)',
                                      fontFamily: 'monospace',
                                    }}
                                  >
                                    {nodeRecord.nodeType}
                                  </span>
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                {nodeDuration !== null && (
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: 'var(--text-muted)',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 3,
                                    }}
                                  >
                                    <Clock size={11} />
                                    {nodeDuration}ms
                                  </span>
                                )}

                                {isDone && (
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: '#059669',
                                      background: '#ecfdf5',
                                      padding: '2px 8px',
                                      borderRadius: 9999,
                                      fontWeight: 600,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 4,
                                    }}
                                  >
                                    <Check size={12} />
                                    Success
                                  </span>
                                )}

                                {isFailed && (
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: '#dc2626',
                                      background: '#fee2e2',
                                      padding: '2px 8px',
                                      borderRadius: 9999,
                                      fontWeight: 600,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 4,
                                    }}
                                  >
                                    <AlertCircle size={12} />
                                    Failed
                                  </span>
                                )}

                                {isWaiting && (
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: '#b45309',
                                      background: '#fef3c7',
                                      border: '1px solid #fde68a',
                                      padding: '2px 8px',
                                      borderRadius: 9999,
                                      fontWeight: 600,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 4,
                                    }}
                                  >
                                    <Clock size={12} />
                                    Waiting for Input
                                  </span>
                                )}

                                {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                              </div>
                            </div>

                            {onRerunNode && (
                              <div style={{ padding: '0 14px 10px', display: 'flex', justifyContent: 'flex-end' }}>
                                <button
                                  type="button"
                                  className="btn btn-default"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void onRerunNode(nodeRecord.nodeId);
                                  }}
                                  disabled={isExecuting}
                                  style={{ fontSize: 11, padding: '4px 9px', display: 'flex', alignItems: 'center', gap: 5 }}
                                  title="Run the flow again from this node"
                                >
                                  <RefreshCw size={12} />
                                  Rerun from here
                                </button>
                              </div>
                            )}

                            {/* Step Expanded Content: Input & Output */}
                            {isExpanded && (
                              <div
                                style={{
                                  padding: 12,
                                  borderTop: '1px solid var(--border-color)',
                                  background: '#fafbfc',
                                  fontSize: 12,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 10,
                                }}
                              >
                                {isFailed && nodeRecord.error && (
                                  <div
                                    style={{
                                      padding: '10px 12px',
                                      background: '#fee2e2',
                                      border: '1px solid #fecaca',
                                      borderRadius: 6,
                                      color: '#991b1b',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 6,
                                    }}
                                  >
                                    <div style={{ fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <AlertCircle size={14} color="#dc2626" />
                                      <span>Error: {nodeRecord.error.message || JSON.stringify(nodeRecord.error)}</span>
                                    </div>
                                    {nodeRecord.error.stack && (
                                      <pre
                                        style={{
                                          margin: '4px 0 0 0',
                                          padding: 8,
                                          background: '#0f172a',
                                          color: '#f87171',
                                          fontSize: 11,
                                          fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                          borderRadius: 4,
                                          overflowX: 'auto',
                                          maxHeight: 140,
                                          lineHeight: 1.4,
                                          whiteSpace: 'pre-wrap',
                                          wordBreak: 'break-all',
                                        }}
                                      >
                                        {nodeRecord.error.stack}
                                      </pre>
                                    )}
                                  </div>
                                )}

                                <div>
                                  <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                                    Resolved Node Input:
                                  </div>
                                  <pre
                                    style={{
                                      background: '#0f172a',
                                      color: '#94a3b8',
                                      padding: 10,
                                      borderRadius: 6,
                                      margin: 0,
                                      maxHeight: 140,
                                      overflowY: 'auto',
                                      fontFamily: 'monospace',
                                      fontSize: 11.5,
                                    }}
                                  >
                                    {JSON.stringify(nodeRecord.input, null, 2) || '{}'}
                                  </pre>
                                </div>

                                {nodeRecord.output !== undefined && (
                                  <div>
                                    <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                                      Node Output:
                                    </div>
                                    <pre
                                      style={{
                                        background: '#0f172a',
                                        color: '#34d399',
                                        padding: 10,
                                        borderRadius: 6,
                                        margin: 0,
                                        maxHeight: 160,
                                        overflowY: 'auto',
                                        fontFamily: 'monospace',
                                        fontSize: 11.5,
                                      }}
                                    >
                                      {JSON.stringify(nodeRecord.output, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          className="modal-footer"
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#ffffff',
          }}
        >
          <button type="button" className="btn btn-default" onClick={onClose}>
            Close
          </button>

          <div style={{ display: 'flex', gap: 10 }}>
            {runResult && (
              <button
                type="button"
                className="btn btn-default"
                onClick={handleExecute}
                disabled={isExecuting}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <RefreshCw size={13} />
                Re-run
              </button>
            )}

            <button
              type="button"
              className="btn btn-primary"
              onClick={handleExecute}
              disabled={isExecuting || (activeTab === 'input' && !!jsonError)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background:
                  serverStatus === 'running' && hasWebserver
                    ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                    : 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
                boxShadow: '0 2px 4px rgba(79, 70, 229, 0.25)',
              }}
            >
              {isExecuting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : hasWebserver ? (
                serverStatus === 'running' ? (
                  <RefreshCw size={14} />
                ) : (
                  <Play size={14} fill="#ffffff" />
                )
              ) : (
                <Play size={14} fill="#ffffff" />
              )}
              {isExecuting
                ? hasWebserver
                  ? 'Starting Server...'
                  : 'Running Flow...'
                : hasWebserver
                ? serverStatus === 'running'
                  ? 'Restart Server'
                  : 'Start Server & Listen'
                : 'Run Flow'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
