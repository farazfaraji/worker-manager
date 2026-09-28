'use client';

import React, { useState } from 'react';
import {
  Server,
  Loader2,
  Play,
  Pause,
  Send,
  Sparkles,
  ExternalLink,
  Code2,
  Copy,
  Check,
  Globe,
  ArrowRight,
} from 'lucide-react';
import { Node } from '@xyflow/react';
import { FlowNodeData, RunResult } from '@/lib/types';
import { fetchRuns } from '@/lib/api';
import {
  generateSampleJsonFromRoute,
  generateSampleQueryFromRoute,
  buildFullUrl,
  buildCurlCommand,
} from './execution.utils';

interface ExecutionEndpointsTabProps {
  graphId?: string | null;
  webserverNode?: Node<FlowNodeData>;
  routeNodes: Node<FlowNodeData>[];
  serverStatus: 'running' | 'stopped';
  serverPort: number;
  serverHost: string;
  serverLoading: boolean;
  onToggleWebserver: () => Promise<void>;
  onServerPortChange?: (port: number) => void;
  onServerHostChange?: (host: string) => void;
  onRunResult?: (run: RunResult) => void;
  onSelectTab?: (tab: 'endpoints' | 'input' | 'output') => void;
}

export const ExecutionEndpointsTab: React.FC<ExecutionEndpointsTabProps> = ({
  graphId,
  webserverNode,
  routeNodes,
  serverStatus,
  serverPort,
  serverHost,
  serverLoading,
  onToggleWebserver,
  onRunResult,
  onSelectTab,
}) => {
  const [copiedCurlKey, setCopiedCurlKey] = useState<string | null>(null);
  const [testPayloads, setTestPayloads] = useState<Record<string, string>>({});
  const [testQueryStrings, setTestQueryStrings] = useState<Record<string, string>>({});
  const [testResponse, setTestResponse] = useState<Record<string, any>>({});
  const [isSendingRequest, setIsSendingRequest] = useState<Record<string, boolean>>({});

  const handleCopyCurl = (key: string, curlCmd: string) => {
    navigator.clipboard.writeText(curlCmd);
    setCopiedCurlKey(key);
    setTimeout(() => setCopiedCurlKey(null), 2000);
  };

  const handleSendTestRequest = async (routeNode: Node<FlowNodeData>) => {
    const config = routeNode.data?.config || {};
    const method = String(config.method || 'POST').toUpperCase();
    const endpoint = String(config.endpoint || '/api/example');
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const hostDisplay = serverHost === '0.0.0.0' ? 'localhost' : serverHost;
    const baseUrl = `http://${hostDisplay}:${serverPort}${cleanEndpoint}`;

    const sampleQuery = generateSampleQueryFromRoute(routeNode);
    const currentQuery =
      testQueryStrings[routeNode.id] !== undefined
        ? testQueryStrings[routeNode.id]
        : method === 'GET'
        ? sampleQuery
        : '';

    const url = buildFullUrl(baseUrl, currentQuery);

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

      // Immediately fetch latest execution run from backend so canvas and execution studio update instantly
      if (graphId && onRunResult) {
        try {
          const recentRuns = await fetchRuns(undefined, graphId);
          if (recentRuns && recentRuns.length > 0) {
            onRunResult(recentRuns[0]);
          }
        } catch {
          // Ignore background fetching errors
        }
      }
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

  return (
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
                  Configured on port <strong>{serverPort}</strong> ({serverHost}) — Click Start Server to activate
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-default"
            onClick={onToggleWebserver}
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

      {/* 2. Routes & Live Endpoints */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            Exposed HTTP Endpoints ({routeNodes.length})
          </h4>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Each Route block creates a dedicated live URL endpoint
          </span>
        </div>

        {routeNodes.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: 'var(--text-muted)',
              background: 'var(--bg-subtle)',
              borderRadius: 8,
              border: '1px dashed var(--border-color)',
            }}
          >
            <Globe size={24} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
            <div style={{ fontSize: 13, fontWeight: 600 }}>No Route blocks connected</div>
            <div style={{ fontSize: 11.5, marginTop: 4 }}>
              Add and connect &quot;Route&quot; blocks to your Webserver block to expose API endpoints.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {routeNodes.map((rn) => {
              const cfg = rn.data?.config || {};
              const method = String(cfg.method || 'POST').toUpperCase();
              const endpoint = String(cfg.endpoint || '/api/example');
              const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
              const hostDisplay = serverHost === '0.0.0.0' ? 'localhost' : serverHost;
              const baseUrl = `http://${hostDisplay}:${serverPort}${cleanEndpoint}`;

              const sampleQuery = generateSampleQueryFromRoute(rn);
              const currentQuery =
                testQueryStrings[rn.id] !== undefined
                  ? testQueryStrings[rn.id]
                  : method === 'GET'
                  ? sampleQuery
                  : '';

              const fullUrl = buildFullUrl(baseUrl, currentQuery);

              const sampleJson = generateSampleJsonFromRoute(rn);
              const sampleJsonStr = JSON.stringify(sampleJson, null, 2);
              const currentPayload =
                testPayloads[rn.id] !== undefined ? testPayloads[rn.id] : sampleJsonStr;

              let parsedPayloadObj: any = sampleJson;
              try {
                parsedPayloadObj = JSON.parse(currentPayload);
              } catch {
                // ignore
              }

              const curlCmd = buildCurlCommand(
                method,
                fullUrl,
                method !== 'GET' ? parsedPayloadObj : undefined,
              );

              const isSending = !!isSendingRequest[rn.id];
              const resData = testResponse[rn.id];

              const methodColors: Record<string, { bg: string; color: string; border: string }> = {
                GET: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
                POST: { bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' },
                PUT: { bg: '#fffbeb', color: '#b45309', border: '#fde68a' },
                DELETE: { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
                PATCH: { bg: '#fdf4ff', color: '#a21caf', border: '#f5d0fe' },
              };
              const mc = methodColors[method] || { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' };

              return (
                <div
                  key={rn.id}
                  style={{
                    background: '#ffffff',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  {/* Route Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 800,
                          padding: '3px 8px',
                          borderRadius: 4,
                          background: mc.bg,
                          color: mc.color,
                          border: `1px solid ${mc.border}`,
                          fontFamily: 'monospace',
                        }}
                      >
                        {method}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {cleanEndpoint}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        ({rn.data?.label || rn.data?.nodeName || 'Route'})
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => handleCopyCurl(rn.id, curlCmd)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 8px',
                          borderRadius: 4,
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-subtle)',
                          fontSize: 11,
                          fontWeight: 600,
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                        }}
                        title="Copy cURL command to clipboard"
                      >
                        {copiedCurlKey === rn.id ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                        {copiedCurlKey === rn.id ? 'Copied cURL' : 'Copy cURL'}
                      </button>
                    </div>
                  </div>

                  {/* Endpoint URL Preview */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      background: 'var(--bg-subtle)',
                      padding: '8px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontFamily: 'monospace',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                      overflowX: 'auto',
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>URL:</span>
                    <span style={{ fontWeight: 600 }}>{fullUrl}</span>
                  </div>

                  {/* Query Parameters Input for GET / QuerySchema */}
                  {(method === 'GET' || cfg.querySchema) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
                          URL Query Parameters (e.g. ?q=search&amp;limit=5 or JSON):
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setTestQueryStrings((prev) => ({
                              ...prev,
                              [rn.id]: sampleQuery,
                            }));
                          }}
                          style={{
                            fontSize: 10.5,
                            background: 'none',
                            border: 'none',
                            color: 'var(--accent-primary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 3,
                          }}
                        >
                          <Sparkles size={11} /> Reset Query
                        </button>
                      </div>
                      <input
                        type="text"
                        value={currentQuery}
                        onChange={(e) =>
                          setTestQueryStrings((prev) => ({
                            ...prev,
                            [rn.id]: e.target.value,
                          }))
                        }
                        placeholder="q=test&limit=5"
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          borderRadius: 4,
                          border: '1px solid var(--border-color)',
                          fontFamily: 'monospace',
                          fontSize: 12,
                          background: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </div>
                  )}

                  {/* Request Body Editor for POST, PUT, PATCH */}
                  {method !== 'GET' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
                          JSON Request Body (Test Payload):
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setTestPayloads((prev) => ({
                              ...prev,
                              [rn.id]: sampleJsonStr,
                            }));
                          }}
                          style={{
                            fontSize: 10.5,
                            background: 'none',
                            border: 'none',
                            color: 'var(--accent-primary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 3,
                          }}
                        >
                          <Sparkles size={11} /> Generate Sample Payload
                        </button>
                      </div>

                      <textarea
                        value={currentPayload}
                        onChange={(e) =>
                          setTestPayloads((prev) => ({
                            ...prev,
                            [rn.id]: e.target.value,
                          }))
                        }
                        rows={5}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: 4,
                          border: '1px solid var(--border-color)',
                          fontFamily: 'monospace',
                          fontSize: 11.5,
                          background: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                          resize: 'vertical',
                        }}
                      />
                    </div>
                  )}

                  {/* cURL Snippet Display */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                      cURL Command:
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: '8px 10px',
                        background: '#0f172a',
                        color: '#93c5fd',
                        borderRadius: 4,
                        fontSize: 11,
                        fontFamily: 'monospace',
                        overflowX: 'auto',
                        whiteSpace: 'pre',
                      }}
                    >
                      {curlCmd}
                    </pre>
                  </div>

                  {/* Send Test Request Action & Results */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      borderTop: '1px solid var(--border-color)',
                      paddingTop: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => handleSendTestRequest(rn)}
                        disabled={isSending || serverStatus !== 'running'}
                        style={{
                          fontSize: 12,
                          padding: '6px 14px',
                          background:
                            serverStatus === 'running'
                              ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                              : '#94a3b8',
                        }}
                      >
                        {isSending ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Send size={13} />
                        )}
                        {serverStatus !== 'running'
                          ? 'Start Webserver to Test'
                          : isSending
                          ? 'Sending Request...'
                          : `Send Test ${method} Request`}
                      </button>

                      {serverStatus !== 'running' && (
                        <span style={{ fontSize: 11, color: '#d97706' }}>
                          Start the Webserver listener above before testing
                        </span>
                      )}
                    </div>

                    {/* Test Response Display */}
                    {resData && (
                      <div
                        style={{
                          marginTop: 8,
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
                          {onSelectTab ? (
                            <button
                              type="button"
                              onClick={() => onSelectTab('output')}
                              style={{
                                fontSize: 11.5,
                                fontWeight: 600,
                                color: 'var(--accent-primary)',
                                background: 'rgba(99, 102, 241, 0.08)',
                                border: '1px solid rgba(99, 102, 241, 0.25)',
                                padding: '3px 9px',
                                borderRadius: 4,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              View Execution Trace &amp; Output <ArrowRight size={12} />
                            </button>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                              Check &quot;Execution Trace &amp; Output&quot; tab for full run graph
                            </span>
                          )}
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
                            wordBreak: 'break-word',
                          }}
                        >
                          {typeof resData.data === 'object'
                            ? JSON.stringify(resData.data, null, 2)
                            : resData.data || resData.error || 'No response body'}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
