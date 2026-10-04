'use client';

import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { FlowEdge, FlowNode, RunResult, FlowNodeData } from '@/lib/types';
import { getWebserverStatus, startWebserver, stopWebserver, cancelRun } from '@/lib/api';
import {
  computeExecutionDuration,
  ExecutionStudioHeader,
  ExecutionEndpointsTab,
  ExecutionInputTab,
  ExecutionTraceTab,
  ExecutionStudioFooter,
} from './execution';

export interface RunModalProps {
  isOpen: boolean;
  graphName: string;
  graphId: string | null;
  nodes?: FlowNode[];
  edges?: FlowEdge[];
  isDirty: boolean;
  onClose: () => void;
  onRun: (inputPayload: any, options?: { debugMode?: boolean; useCache?: boolean }) => Promise<RunResult>;
  onRerunNode?: (nodeId: string) => Promise<RunResult>;
  onResumeRun?: (payload: any) => Promise<RunResult>;
  onValidate: () => Promise<{ valid: boolean }>;
  runResult: RunResult | null;
  isExecuting: boolean;
  onRunResult?: (run: RunResult) => void;
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
  onRunResult,
}) => {
  const webserverNode = nodes.find((n) => {
    const type = String(n.data?.definitionType || n.type || '').toLowerCase();
    return type === 'webserver' || n.data?.definitionId === 'webserver';
  });
  const hasWebserver = !!webserverNode;

  const humanInputNode = nodes.find((n) => {
    const type = String(n.data?.definitionType || n.type || '').toLowerCase();
    const cfg = n.data?.config as Record<string, any> | undefined;
    return type === 'trigger' && cfg?.triggerType === 'human-input';
  }) ?? null;

  const routeNodes = nodes.filter((n) => {
    const type = String(n.data?.definitionType || n.type || '').toLowerCase();
    return type === 'route' || n.data?.definitionId === 'route';
  });

  const [activeTab, setActiveTab] = useState<'endpoints' | 'input' | 'output'>('input');
  const [useCache, setUseCache] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('flow_debug_use_cache');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });

  const handleToggleUseCache = (val: boolean) => {
    setUseCache(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem('flow_debug_use_cache', String(val));
    }
  };
  const [serverStatus, setServerStatus] = useState<'running' | 'stopped'>('stopped');
  const [serverPort, setServerPort] = useState<number>(3000);
  const [serverHost, setServerHost] = useState<string>('0.0.0.0');
  const [serverLoading, setServerLoading] = useState<boolean>(false);

  const [inputJson, setInputJson] = useState<string>('{\n  "input": "Hello Flow Studio!"\n}');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [validationStatus, setValidationStatus] = useState<{
    valid?: boolean;
    message?: string;
  } | null>(null);

  // Docking & Sizing states (Chrome inspect / VS Code terminal design)
  const [dockMode, setDockMode] = useState<'bottom' | 'floating'>('bottom');
  const [panelHeight, setPanelHeight] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('flow_execution_studio_height');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 160 && parsed <= window.innerHeight - 80) {
          return parsed;
        }
      }
      return Math.min(380, Math.round(window.innerHeight * 0.42));
    }
    return 380;
  });

  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const [prevHeight, setPrevHeight] = useState<number>(panelHeight);
  const [isDragging, setIsDragging] = useState<boolean>(false);

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

  // Switch to output tab when run completes
  useEffect(() => {
    if (runResult) {
      if (runResult.status === 'listening' && hasWebserver) {
        setActiveTab('endpoints');
      } else {
        setActiveTab('output');
      }
    }
  }, [runResult, hasWebserver]);

  if (!isOpen) return null;

  const durationMs = computeExecutionDuration(runResult);

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
      await onRun(parsedInput, { useCache });
    } catch {
      // Error handled by parent / result display
    }
  };

  const handleDebugExecute = async () => {
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
      await onRun(parsedInput, { debugMode: true, useCache });
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

  // Drag-to-resize handlers (Chrome Inspect / VS Code Terminal)
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startY = e.clientY;
    const startH = panelHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const minH = 160;
      const maxH = window.innerHeight - 80;
      const nextH = Math.min(Math.max(startH + delta, minH), maxH);
      setPanelHeight(nextH);
    };

    const onMouseUp = (upEvent: MouseEvent) => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      const delta = startY - upEvent.clientY;
      const minH = 160;
      const maxH = window.innerHeight - 80;
      const finalH = Math.min(Math.max(startH + delta, minH), maxH);
      setPanelHeight(finalH);
      if (typeof window !== 'undefined') {
        localStorage.setItem('flow_execution_studio_height', String(finalH));
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleToggleMaximize = () => {
    if (isMinimized) {
      setIsMinimized(false);
      return;
    }
    if (isMaximized) {
      setIsMaximized(false);
      setPanelHeight(prevHeight || 380);
    } else {
      setPrevHeight(panelHeight);
      setIsMaximized(true);
      const maxH = Math.round(window.innerHeight * 0.82);
      setPanelHeight(maxH);
    }
  };

  const handleToggleMinimize = () => {
    setIsMinimized((prev) => !prev);
  };

  const handleSetPresetHeight = (h: number) => {
    setIsMinimized(false);
    setIsMaximized(false);
    setPanelHeight(h);
    if (typeof window !== 'undefined') {
      localStorage.setItem('flow_execution_studio_height', String(h));
    }
  };

  return (
    <div
      className={
        dockMode === 'floating'
          ? 'execution-studio-floating-backdrop'
          : `execution-studio-dock run-modal-container ${isDragging ? 'is-resizing' : ''} ${
              isMinimized ? 'is-minimized' : ''
            }`
      }
      onClick={dockMode === 'floating' ? onClose : undefined}
      style={
        dockMode === 'bottom'
          ? {
              height: isMinimized ? 40 : panelHeight,
            }
          : undefined
      }
    >
      <div
        className={dockMode === 'floating' ? 'execution-studio-floating-card run-modal-container' : undefined}
        onClick={dockMode === 'floating' ? (e) => e.stopPropagation() : undefined}
        style={
          dockMode === 'bottom'
            ? { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', position: 'relative' }
            : undefined
        }
      >
        {/* Top Drag Resizer Splitter (Bottom dock mode only) */}
        {dockMode === 'bottom' && !isMinimized && (
          <div
            className="execution-studio-resizer"
            onMouseDown={handleMouseDown}
            onDoubleClick={handleToggleMaximize}
            title="Drag up/down to change height (Double-click to expand/restore)"
          >
            <div className="resizer-handle-pill" />
          </div>
        )}

        {/* Consolidated Toolbar Header */}
        <ExecutionStudioHeader
          graphName={graphName}
          isDirty={isDirty}
          isExecuting={isExecuting}
          runResult={runResult}
          durationMs={durationMs}
          serverStatus={serverStatus}
          serverPort={serverPort}
          hasWebserver={hasWebserver}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          jsonError={jsonError}
          isValidating={isValidating}
          dockMode={dockMode}
          setDockMode={setDockMode}
          isMinimized={isMinimized}
          setIsMinimized={setIsMinimized}
          isMaximized={isMaximized}
          onValidate={handleValidateClick}
          onExecute={handleExecute}
          onDebugExecute={handleDebugExecute}
          useCache={useCache}
          onToggleUseCache={handleToggleUseCache}
          onSetPresetHeight={handleSetPresetHeight}
          onToggleMinimize={handleToggleMinimize}
          onToggleMaximize={handleToggleMaximize}
          onClose={onClose}
        />

        {!isMinimized && (
          <>
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

            {/* Studio Body Tabs */}
            <div className="execution-studio-body" style={{ padding: 20 }}>
              {activeTab === 'endpoints' && hasWebserver && (
                <ExecutionEndpointsTab
                  graphId={graphId}
                  webserverNode={webserverNode}
                  routeNodes={routeNodes}
                  serverStatus={serverStatus}
                  serverPort={serverPort}
                  serverHost={serverHost}
                  serverLoading={serverLoading}
                  onToggleWebserver={handleToggleWebserver}
                  onRunResult={onRunResult}
                  onSelectTab={setActiveTab}
                />
              )}

              {activeTab === 'input' && (
                <ExecutionInputTab
                  inputJson={inputJson}
                  setInputJson={setInputJson}
                  jsonError={jsonError}
                  setJsonError={setJsonError}
                  humanInputNode={humanInputNode}
                />
              )}

              {activeTab === 'output' && (
                <ExecutionTraceTab
                  runResult={runResult}
                  isExecuting={isExecuting}
                  durationMs={durationMs}
                  onExecute={handleExecute}
                  onRerunNode={onRerunNode}
                  onResumeRun={onResumeRun}
                  onCancelRun={
                    runResult?.runId
                      ? async () => {
                          const result = await cancelRun(runResult.runId);
                          if (onRunResult) onRunResult(result);
                          return result;
                        }
                      : undefined
                  }
                  jsonError={jsonError}
                />
              )}
            </div>

            {/* Studio Footer Bar */}
            <ExecutionStudioFooter
              runResult={runResult}
              isExecuting={isExecuting}
              hasWebserver={hasWebserver}
              serverStatus={serverStatus}
              activeTab={activeTab}
              jsonError={jsonError}
              dockMode={dockMode}
              onClose={onClose}
              onExecute={handleExecute}
            />
          </>
        )}
      </div>
    </div>
  );
};
