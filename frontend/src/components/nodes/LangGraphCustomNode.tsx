'use client';

import React from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import { FlowNodeData } from '@/lib/types';
import { NodeOutputHandles } from './NodeOutputHandles';
import {
  PlayCircle,
  Bot,
  Globe,
  GitBranch,
  CheckSquare,
  Code2,
  FileCode2,
  Trash2,
  Settings2,
  Network,
  Variable,
  PlusCircle,
  MinusCircle,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Repeat,
  Layers,
  Server,
  Send,
  Play,
  Square,
} from 'lucide-react';
import { getWebserverStatus, startWebserver, stopWebserver } from '@/lib/api';


export const getNodeIcon = (type: string, size = 16) => {
  switch (type.toLowerCase()) {
    case 'trigger':
      return <PlayCircle size={size} color="#10b981" />;
    case 'subgraph':
      return <Network size={size} color="#06b6d4" />;
    case 'agent':
      return <Bot size={size} color="#4f46e5" />;
    case 'app':
    case 'browser':
    case 'brower':
      return <Globe size={size} color="#0284c7" />;
    case 'condition':
      return <GitBranch size={size} color="#8b5cf6" />;
    case 'validator':
      return <CheckSquare size={size} color="#10b981" />;
    case 'transform':
      return <Code2 size={size} color="#f59e0b" />;
    case 'script':
      return <Code2 size={size} color="#eab308" />;
    case 'increment':
    case 'increment-variable':
      return <PlusCircle size={size} color="#10b981" />;
    case 'decrement':
    case 'decrement-variable':
      return <MinusCircle size={size} color="#f43f5e" />;
    case 'variable':
    case 'set-variable':
      return <Variable size={size} color="#ec4899" />;
    case 'foreach':
      return <Repeat size={size} color="#f97316" />;
    case 'aggregate':
      return <Layers size={size} color="#8b5cf6" />;
    case 'webserver':
      return <Server size={size} color="#3b82f6" />;
    case 'route':
      return <Globe size={size} color="#10b981" />;
    case 'http-response':
    case 'httpresponse':
      return <Send size={size} color="#8b5cf6" />;
    case 'function':
    default:
      return <FileCode2 size={size} color="#6366f1" />;
  }
};

export const LangGraphCustomNode: React.FC<NodeProps> = ({
  id,
  data,
  selected,
}) => {
  const nodeData = data as FlowNodeData;
  const { deleteElements } = useReactFlow();

  const defType = nodeData?.definitionType || 'function';
  const label = nodeData?.label || nodeData?.definitionName || 'Node';
  const nodeName = nodeData?.nodeName || 'node';
  const isTrigger = defType === 'trigger' || defType === 'webserver';
  const isWebserver = defType === 'webserver';
  const isRoute = defType === 'route';
  const isHttpResponse = defType === 'http-response' || defType === 'httpresponse';

  const [serverStatus, setServerStatus] = React.useState<'running' | 'stopped'>('stopped');
  const [serverLoading, setServerLoading] = React.useState(false);

  const getGraphId = () => {
    if (typeof window === 'undefined') return null;
    return (nodeData as any)?.graphId || new URLSearchParams(window.location.search).get('flow');
  };

  React.useEffect(() => {
    if (!isWebserver) return;
    const graphId = getGraphId();
    if (!graphId) return;

    let mounted = true;
    getWebserverStatus(graphId, id)
      .then((res) => {
        if (mounted && res?.status) {
          setServerStatus(res.status);
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [isWebserver, id]);

  const handleToggleServer = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const graphId = getGraphId();
    if (!graphId) {
      alert('Please save the flow first before starting the webserver.');
      return;
    }

    setServerLoading(true);
    try {
      if (serverStatus === 'running') {
        await stopWebserver(graphId, id);
        setServerStatus('stopped');
      } else {
        await startWebserver(graphId, id);
        setServerStatus('running');
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to toggle webserver');
    } finally {
      setServerLoading(false);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };

  const configCount = Object.keys(nodeData?.config || {}).filter(
    (k) => nodeData.config[k] !== undefined && nodeData.config[k] !== '',
  ).length;

  const runStatus = nodeData?.runStatus;

  let statusBorder = '';
  if (runStatus === 'completed') {
    statusBorder = '2px solid #10b981';
  } else if (runStatus === 'failed') {
    statusBorder = '2px solid #ef4444';
  } else if (runStatus === 'waiting') {
    statusBorder = '2px solid #f59e0b';
  } else if (runStatus === 'running') {
    statusBorder = '2px solid #6366f1';
  }

  const isRouter = String(defType).toLowerCase() === 'router';
  const outputCount = nodeData?.outputs?.length || 0;
  const dynamicMinWidth = isRouter && outputCount > 2 ? Math.max(190, outputCount * 68) : (isWebserver ? 220 : 190);
  const dynamicMaxWidth = isRouter && outputCount > 2 ? Math.max(260, outputCount * 88) : (isWebserver ? 270 : 260);

  return (
    <div
      className={`langgraph-node ${selected ? 'selected' : ''} ${runStatus ? `node-run-${runStatus}` : ''}`}
      style={{
        minWidth: dynamicMinWidth,
        maxWidth: dynamicMaxWidth,
        padding: '12px 14px',
        cursor: 'pointer',
        border: statusBorder || undefined,
        boxShadow:
          runStatus === 'completed'
            ? '0 0 0 3px rgba(16, 185, 129, 0.18), var(--shadow-md)'
            : runStatus === 'failed'
            ? '0 0 0 3px rgba(239, 68, 68, 0.18), var(--shadow-md)'
            : runStatus === 'waiting'
            ? '0 0 0 3px rgba(245, 158, 11, 0.3), var(--shadow-md)'
            : runStatus === 'running'
            ? '0 0 0 3px rgba(99, 102, 241, 0.25), var(--shadow-md)'
            : undefined,
      }}
    >

      {/* Target input handle at top (except for trigger/route/webserver node) */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          style={{
            background: 'var(--accent-primary)',
            width: 9,
            height: 9,
            top: -5,
            border: '2px solid #ffffff',
          }}
        />
      )}

      {/* Node Header */}
      <div className="langgraph-node-header" style={{ marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 }}>
          {getNodeIcon(defType, 17)}
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span
              className="langgraph-node-title"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {label}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {runStatus === 'completed' && (
            <span title="Executed successfully" style={{ display: 'flex', color: '#10b981' }}>
              <CheckCircle2 size={13} />
            </span>
          )}
          {runStatus === 'failed' && (
            <span title={nodeData?.runError || 'Execution failed'} style={{ display: 'flex', color: '#ef4444' }}>
              <AlertCircle size={13} />
            </span>
          )}
          {runStatus === 'waiting' && (
            <span title="Waiting for human review" style={{ display: 'flex', color: '#f59e0b' }}>
              <Clock size={13} />
            </span>
          )}
          {runStatus === 'running' && (
            <span title="Running..." style={{ display: 'flex', color: '#6366f1' }}>
              <Loader2 size={13} className="animate-spin" />
            </span>
          )}

          <button
            type="button"
            onClick={handleDelete}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: 2,
              display: 'flex',
              borderRadius: 4,
            }}
            title="Delete node"
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--danger)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--text-muted)')}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Webserver Interactive Controller Card */}
      {isWebserver && (
        <div
          style={{
            marginTop: 4,
            marginBottom: 6,
            padding: '6px 8px',
            borderRadius: 6,
            background: 'var(--bg-secondary, #1e293b)',
            border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                backgroundColor: serverStatus === 'running' ? '#10b981' : '#94a3b8',
                boxShadow: serverStatus === 'running' ? '0 0 6px #10b981' : 'none',
              }}
            />
            <span style={{ fontWeight: 600, color: serverStatus === 'running' ? '#10b981' : 'var(--text-secondary)' }}>
              :{nodeData?.config?.port || 3000}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {serverStatus === 'running' ? 'Live' : 'Off'}
            </span>
          </div>

          <button
            type="button"
            disabled={serverLoading}
            onClick={handleToggleServer}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              fontSize: 10.5,
              fontWeight: 600,
              borderRadius: 4,
              cursor: serverLoading ? 'wait' : 'pointer',
              border: 'none',
              background: serverStatus === 'running' ? '#ef4444' : '#10b981',
              color: '#ffffff',
              transition: 'opacity 0.2s',
            }}
            title={serverStatus === 'running' ? 'Stop Webserver' : 'Start Webserver'}
          >
            {serverLoading ? (
              <Loader2 size={10} className="animate-spin" />
            ) : serverStatus === 'running' ? (
              <>
                <Square size={8} fill="#fff" /> Stop
              </>
            ) : (
              <>
                <Play size={8} fill="#fff" /> Start
              </>
            )}
          </button>
        </div>
      )}

      {/* Route Info Badge */}
      {isRoute && (
        <div
          style={{
            marginTop: 4,
            marginBottom: 6,
            padding: '4px 7px',
            borderRadius: 6,
            background: 'var(--bg-secondary, #1e293b)',
            border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
          }}
        >
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: 3,
              backgroundColor:
                (nodeData?.config?.method || 'POST') === 'GET'
                  ? 'rgba(16, 185, 129, 0.2)'
                  : (nodeData?.config?.method || 'POST') === 'POST'
                  ? 'rgba(59, 130, 246, 0.2)'
                  : 'rgba(245, 158, 11, 0.2)',
              color:
                (nodeData?.config?.method || 'POST') === 'GET'
                  ? '#10b981'
                  : (nodeData?.config?.method || 'POST') === 'POST'
                  ? '#3b82f6'
                  : '#f59e0b',
            }}
          >
            {nodeData?.config?.method || 'POST'}
          </span>
          <span
            style={{
              fontFamily: 'monospace',
              color: 'var(--text-primary)',
              fontSize: 11,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={nodeData?.config?.endpoint || '/api/example'}
          >
            {nodeData?.config?.endpoint || '/api/example'}
          </span>
        </div>
      )}

      {/* HTTP Response Info Badge */}
      {isHttpResponse && (
        <div
          style={{
            marginTop: 4,
            marginBottom: 6,
            padding: '3px 7px',
            borderRadius: 5,
            background: 'var(--bg-secondary, #1e293b)',
            border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 10.5,
          }}
        >
          <span style={{ fontWeight: 700, color: '#10b981' }}>
            {nodeData?.config?.statusCode || '200'}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>Response</span>
        </div>
      )}

      {/* Node Variable Identifier & Config status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          fontSize: 11,
          marginTop: 4,
        }}
      >
        <span
          style={{
            fontFamily: 'monospace',
            color: 'var(--accent-primary)',
            background: 'var(--accent-subtle)',
            padding: '1px 6px',
            borderRadius: 4,
            fontWeight: 600,
          }}
          title="Variable identifier for referencing outputs"
        >
          ${nodeName}
        </span>

        <span
          style={{
            fontSize: 10.5,
            color: configCount > 0 ? 'var(--text-secondary)' : 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <Settings2 size={11} />
          {configCount > 0 ? `${configCount} set` : 'config'}
        </span>
      </div>

      {/* Dynamic Output Handles */}
      <NodeOutputHandles outputs={nodeData?.outputs || []} />
    </div>
  );
};
