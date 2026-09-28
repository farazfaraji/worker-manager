'use client';
import React, { useState, useEffect } from 'react';
import { Node, Edge } from '@xyflow/react';
import { FlowNodeData, VariableItem, ToolActionDefinition, ToolOutput, ToolInput } from '@/lib/types';
import { extractAvailableVariables, extractNodeOutputs, parseSchema } from '@/lib/variable-utils';
import { DynamicFieldRenderer } from './DynamicFieldRenderer';
import { BrowserActionBuilder } from './BrowserActionBuilder';
import { fetchUpstreamVariables, fetchNodeDefinitions } from '@/lib/api';
import { Rnd } from 'react-rnd';
import {
  X,
  Save,
  Sliders,
  Sparkles,
  ArrowRightCircle,
  Tag,
  Layers,
  AlertCircle,
  CheckCircle2,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Terminal,
  Minus,
  Maximize2,
  Minimize2,
  ChevronUp,
} from 'lucide-react';

interface NodeConfigModalProps {
  isOpen: boolean;
  node: Node<FlowNodeData> | null;
  allNodes: Node<FlowNodeData>[];
  edges: Edge[];
  graphId?: string | null;
  onClose: () => void;
  onSaveConfig: (
    nodeId: string,
    updatedData: {
      label: string;
      nodeName: string;
      config: Record<string, any>;
      actionDefinitions?: ToolActionDefinition[];
      definitionOutputs?: ToolOutput[];
      outputs?: ToolOutput[];
    },
  ) => void;
}

export const NodeConfigModal: React.FC<NodeConfigModalProps> = ({
  isOpen,
  node,
  allNodes,
  edges,
  graphId,
  onClose,
  onSaveConfig,
}) => {
  const [label, setLabel] = useState('');
  const [nodeName, setNodeName] = useState('');
  const [formConfig, setFormConfig] = useState<Record<string, any>>({});
  const [definitionOutputs, setDefinitionOutputs] = useState<ToolOutput[]>([]);
  const [definitionInputs, setDefinitionInputs] = useState<ToolInput[]>([]);
  const [availableVariables, setAvailableVariables] = useState<VariableItem[]>([]);
  const [actionDefinitions, setActionDefinitions] = useState<ToolActionDefinition[]>([]);
  const [copiedLog, setCopiedLog] = useState(false);
  const [showStack, setShowStack] = useState(true);
  const [showInputPayload, setShowInputPayload] = useState(false);

  // Floating & Resizable Window State
  const [mounted, setMounted] = useState(false);
  const [windowPosition, setWindowPosition] = useState<{ x: number; y: number }>({ x: 200, y: 70 });
  const [windowSize, setWindowSize] = useState<{ width: number; height: number }>({ width: 680, height: 620 });
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const [prevBounds, setPrevBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      const defaultWidth = Math.min(680, window.innerWidth - 40);
      const defaultHeight = Math.min(620, window.innerHeight - 90);
      const defaultX = Math.max(20, Math.round((window.innerWidth - defaultWidth) / 2));
      const defaultY = Math.max(60, Math.round((window.innerHeight - defaultHeight) / 2));
      setWindowSize({ width: defaultWidth, height: defaultHeight });
      setWindowPosition({ x: defaultX, y: defaultY });
    }
  }, []);

  useEffect(() => {
    if (isOpen && node) {
      if (isMinimized) {
        setIsMinimized(false);
      }
      setLabel(node.data?.label || node.data?.definitionName || 'Node');
      setNodeName(node.data?.nodeName || 'node');
      setActionDefinitions(node.data?.actionDefinitions || []);
      setDefinitionOutputs(node.data?.definitionOutputs || node.data?.outputs || []);
      setDefinitionInputs(node.data?.inputs || []);

      // Initialize config with existing node config and field defaultValues
      const initialConfig: Record<string, any> = { ...(node.data?.config || {}) };
      const inputs = node.data?.inputs || [];

      for (const input of inputs) {
        if (initialConfig[input.name] === undefined && input.defaultValue !== undefined) {
          initialConfig[input.name] = input.defaultValue;
        }
      }
      if (initialConfig.operation === undefined && node.data?.definitionType === 'artifact') {
        initialConfig.operation = 'create';
      }

      setFormConfig(initialConfig);

      // Always fetch latest tool definitions from backend to ensure new inputs/actions appear
      const defType = String(node.data?.definitionType || '').toLowerCase();
      const defName = String(node.data?.definitionName || node.data?.label || '').toLowerCase();
      const defId = String(node.data?.definitionId || '').toLowerCase();

      fetchNodeDefinitions()
        .then((defs) => {
          const matched =
            defs.find((d) => defId && d.id.toLowerCase() === defId) ||
            defs.find((d) => defName && d.name.toLowerCase() === defName) ||
            defs.find((d) => defName && d.id.toLowerCase() === defName.replace(/\s+/g, '-')) ||
            defs.find((d) => d.id.toLowerCase() === defType) ||
            defs.find((d) => d.name.toLowerCase() === defType) ||
            defs.find((d) => d.type.toLowerCase() === defType);

          if (matched?.inputs && matched.inputs.length > 0) {
            setDefinitionInputs(matched.inputs);
            setFormConfig((prevConfig) => {
              const updated = { ...prevConfig };
              matched.inputs.forEach((inp: any) => {
                if (updated[inp.name] === undefined && inp.defaultValue !== undefined) {
                  updated[inp.name] = inp.defaultValue;
                }
              });
              if (updated.operation === undefined && node.data?.definitionType === 'artifact') {
                updated.operation = 'create';
              }
              return updated;
            });
          }
          if (matched?.actionDefinitions && matched.actionDefinitions.length > 0) {
            setActionDefinitions(matched.actionDefinitions);
          }
          if (matched?.outputs && matched.outputs.length > 0) {
            setDefinitionOutputs(matched.outputs);
          }
        })
        .catch(() => {});

      // Extract live variables immediately from all canvas nodes
      const clientVars = extractAvailableVariables(allNodes, edges, node.id);
      setAvailableVariables(clientVars);

      // If saved graph exists, query backend for topological ancestor variables and merge
      if (graphId) {
        fetchUpstreamVariables(graphId, node.id)
          .then((res) => {
            if (res && Array.isArray(res.variables) && res.variables.length > 0) {
              const mappedVars: VariableItem[] = res.variables.map((v: any) => ({
                name: v.outputName,
                label: v.path,
                path: v.path,
                sourceNodeId: v.nodeId,
                sourceNodeName: v.nodeName,
                sourceNodeType: v.type,
                type: v.type,
              }));

              // Merge backend variables with live client variables (live client state takes priority)
              const combinedMap = new Map<string, VariableItem>();
              mappedVars.forEach((v) => combinedMap.set(v.path, v));
              clientVars.forEach((v) => combinedMap.set(v.path, v));
              setAvailableVariables(Array.from(combinedMap.values()));
            }
          })
          .catch(() => {
            // Already initialized with clientVars
          });
      }
    }
  }, [isOpen, node, allNodes, edges, graphId]);

  if (!isOpen || !node || !mounted) return null;

  const inputs = definitionInputs.length > 0 ? definitionInputs : (node.data?.inputs || []);
  let baseOutputs = (definitionOutputs.length > 0 ? definitionOutputs : (node.data?.definitionOutputs || node.data?.outputs || [])) as ToolOutput[];
  const defType = String(node.data?.definitionType || '').toLowerCase();

  if (
    (defType === 'app' || defType === 'browser' || defType === 'brower') &&
    (baseOutputs.length === 0 || baseOutputs.some((o) => o.name === 'result'))
  ) {
    baseOutputs = [
      { name: 'path', label: 'Screenshot / File Path', type: 'string' },
      { name: 'screenshot', label: 'Screenshot Image', type: 'image' },
      { name: 'url', label: 'Current URL', type: 'string' },
      { name: 'title', label: 'Page Title', type: 'string' },
      { name: 'text', label: 'Extracted Text', type: 'string' },
      { name: 'html', label: 'Page / Element HTML', type: 'string' },
      { name: 'css', label: 'Extracted CSS', type: 'string' },
      { name: 'standaloneHtml', label: 'Standalone Inlined HTML', type: 'string' },
      { name: 'actions', label: 'Actions', type: 'array' },
    ];
  }

  // Filter outputs dynamically by dependsOn against the live formConfig, and extract dynamic router outputs
  const liveOutputs = extractNodeOutputs({
    definitionType: defType,
    outputs: baseOutputs,
    config: formConfig,
  });

  let outputs = liveOutputs;
  if (formConfig && outputs.some((o: any) => o.dependsOn)) {
    outputs = outputs.filter((out: any) => {
      if (!out.dependsOn) return true;
      const targetVal = formConfig[out.dependsOn.field];
      if (Array.isArray(out.dependsOn.in)) {
        return out.dependsOn.in.some((item: any) => String(item).toLowerCase() === String(targetVal ?? '').toLowerCase());
      }
      if (out.dependsOn.equals !== undefined) {
        return String(targetVal ?? '').toLowerCase() === String(out.dependsOn.equals).toLowerCase();
      }
      if (out.dependsOn.notEquals !== undefined) {
        return String(targetVal ?? '').toLowerCase() !== String(out.dependsOn.notEquals).toLowerCase();
      }
      return true;
    });
  }

  const browserActions = Array.isArray(formConfig.actions) ? formConfig.actions : [];

  const runStatus = node.data?.runStatus;
  const isFailed = runStatus === 'failed';
  const isCompleted = runStatus === 'completed';
  const runError = node.data?.runError || node.data?.runErrorDetails?.message;
  const runErrorStack = node.data?.runErrorDetails?.stack;
  const runErrorInput = node.data?.runErrorDetails?.input;

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormConfig((prev) => ({
      ...prev,
      [fieldName]: value,
    }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveConfig(node.id, {
      label: label.trim() || node.data?.definitionName || 'Node',
      nodeName: nodeName.trim().replace(/\s+/g, '_') || 'node',
      config: formConfig,
      actionDefinitions: actionDefinitions,
      definitionOutputs: baseOutputs,
      outputs: outputs,
    });
    onClose();
  };

  const copyErrorLog = () => {
    const parts = [
      `Node: ${nodeName} (${node.data?.definitionName || 'Node'})`,
      `Status: Failed`,
      `Error Message: ${runError || 'Runtime error'}`,
      runErrorStack ? `\nStack Trace:\n${runErrorStack}` : '',
      runErrorInput !== undefined ? `\nInput Payload:\n${typeof runErrorInput === 'string' ? runErrorInput : JSON.stringify(runErrorInput, null, 2)}` : '',
    ];
    navigator.clipboard.writeText(parts.filter(Boolean).join('\n'));
    setCopiedLog(true);
    setTimeout(() => setCopiedLog(false), 2000);
  };

  const toggleMaximize = () => {
    if (isMinimized) {
      setIsMinimized(false);
    }
    if (!isMaximized) {
      setPrevBounds({
        x: windowPosition.x,
        y: windowPosition.y,
        width: windowSize.width,
        height: windowSize.height,
      });
      setWindowPosition({ x: 16, y: 60 });
      setWindowSize({
        width: window.innerWidth - 32,
        height: window.innerHeight - 76,
      });
      setIsMaximized(true);
    } else {
      if (prevBounds) {
        setWindowPosition({ x: prevBounds.x, y: prevBounds.y });
        setWindowSize({ width: prevBounds.width, height: prevBounds.height });
      } else {
        const defaultWidth = Math.min(680, window.innerWidth - 40);
        const defaultHeight = Math.min(620, window.innerHeight - 90);
        setWindowPosition({ x: Math.max(20, Math.round((window.innerWidth - defaultWidth) / 2)), y: 70 });
        setWindowSize({ width: defaultWidth, height: defaultHeight });
      }
      setIsMaximized(false);
    }
  };

  const toggleMinimize = () => {
    if (!isMinimized) {
      setPrevBounds({
        x: windowPosition.x,
        y: windowPosition.y,
        width: windowSize.width,
        height: windowSize.height,
      });
      setIsMinimized(true);
      setIsMaximized(false);
    } else {
      setIsMinimized(false);
      if (prevBounds) {
        setWindowPosition({ x: prevBounds.x, y: prevBounds.y });
        setWindowSize({ width: prevBounds.width, height: prevBounds.height });
      }
    }
  };

  const handleHeaderDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    if (isMinimized) {
      toggleMinimize();
    } else {
      toggleMaximize();
    }
  };

  return (
    <>
      <Rnd
        size={
          isMinimized
            ? { width: Math.min(windowSize.width, 460), height: 52 }
            : isMaximized
            ? { width: window.innerWidth - 32, height: window.innerHeight - 76 }
            : { width: windowSize.width, height: windowSize.height }
        }
        position={
          isMaximized
            ? { x: 16, y: 60 }
            : { x: windowPosition.x, y: windowPosition.y }
        }
        onDragStop={(e, d) => {
          if (!isMaximized) {
            setWindowPosition({ x: d.x, y: d.y });
          }
        }}
        onResizeStop={(e, direction, ref, delta, position) => {
          if (!isMaximized && !isMinimized) {
            setWindowSize({
              width: ref.offsetWidth,
              height: ref.offsetHeight,
            });
            setWindowPosition(position);
          }
        }}
        minWidth={isMinimized ? 320 : 460}
        minHeight={isMinimized ? 52 : 280}
        maxWidth={typeof window !== 'undefined' ? window.innerWidth - 20 : undefined}
        maxHeight={typeof window !== 'undefined' ? window.innerHeight - 40 : undefined}
        bounds="window"
        dragHandleClassName="window-drag-handle"
        cancel=".no-drag, button, input, select, textarea"
        enableResizing={!isMinimized && !isMaximized}
        style={{
          zIndex: 1000,
          position: 'fixed',
        }}
        className="floating-node-window-wrapper"
      >
        <div
          className={`floating-node-window ${isFailed ? 'failed-node-window' : ''} ${isMinimized ? 'minimized' : ''}`}
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header / Window Titlebar */}
          <div
            className="modal-header window-drag-handle"
            onDoubleClick={handleHeaderDoubleClick}
            style={{
              background: isFailed ? '#fff5f5' : '#ffffff',
              borderBottom: isMinimized ? 'none' : isFailed ? '1px solid #fecaca' : '1px solid var(--border-color)',
              borderRadius: isMinimized ? 'var(--radius-lg)' : undefined,
              padding: '12px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'grab',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden', minWidth: 0 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  flexShrink: 0,
                  borderRadius: 'var(--radius-md)',
                  background: isFailed
                    ? '#fee2e2'
                    : isCompleted
                    ? '#ecfdf5'
                    : 'var(--accent-subtle)',
                  color: isFailed
                    ? '#dc2626'
                    : isCompleted
                    ? '#059669'
                    : 'var(--accent-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isFailed ? (
                  <AlertCircle size={17} />
                ) : isCompleted ? (
                  <CheckCircle2 size={17} />
                ) : (
                  <Sliders size={17} />
                )}
              </div>
              <div style={{ minWidth: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }}>
                  <h3
                    className="modal-title"
                    style={{
                      fontSize: 15,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {node.data?.definitionName || 'Node Configuration'}
                  </h3>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      padding: '2px 8px',
                      borderRadius: 9999,
                      background: 'var(--accent-subtle)',
                      color: 'var(--accent-primary)',
                      flexShrink: 0,
                    }}
                  >
                    {node.data?.definitionType}
                  </span>

                  {isFailed && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '2px 8px',
                        borderRadius: 9999,
                        background: '#fee2e2',
                        color: '#dc2626',
                        border: '1px solid #fecaca',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        flexShrink: 0,
                      }}
                    >
                      <AlertCircle size={11} />
                      Failed
                    </span>
                  )}

                  {isCompleted && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '2px 8px',
                        borderRadius: 9999,
                        background: '#ecfdf5',
                        color: '#059669',
                        border: '1px solid #a7f3d0',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        flexShrink: 0,
                      }}
                    >
                      <CheckCircle2 size={11} />
                      Completed
                    </span>
                  )}
                </div>
                {!isMinimized && (
                  <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    Configure inputs, variable references, and execution parameters.
                  </p>
                )}
              </div>
            </div>

            {/* Window Controls (Minimize, Maximize, Close) */}
            <div className="window-controls no-drag" style={{ flexShrink: 0 }}>
              <button
                type="button"
                className="window-control-btn minimize-btn"
                onClick={toggleMinimize}
                title={isMinimized ? 'Restore window' : 'Minimize window'}
                aria-label="Minimize"
              >
                {isMinimized ? <ChevronUp size={15} /> : <Minus size={15} />}
              </button>

              {!isMinimized && (
                <button
                  type="button"
                  className="window-control-btn maximize-btn"
                  onClick={toggleMaximize}
                  title={isMaximized ? 'Restore size' : 'Maximize window'}
                  aria-label="Maximize"
                >
                  {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                </button>
              )}

              <button
                type="button"
                className="window-control-btn close-btn"
                onClick={onClose}
                title="Close window"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Modal Form Body & Footer (hidden when minimized) */}
          {!isMinimized && (
            <form
              onSubmit={handleSave}
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              <div
                className="modal-body window-body"
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  maxHeight: 'none',
                  padding: '20px 22px',
                }}
              >
            {/* Execution Error Banner & Logs */}
            {isFailed && (
              <div
                style={{
                  padding: '14px 16px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 14,
                  boxShadow: '0 2px 8px rgba(239, 68, 68, 0.08)',
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
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      fontWeight: 700,
                      fontSize: 13.5,
                      color: '#991b1b',
                    }}
                  >
                    <AlertCircle size={16} color="#dc2626" />
                    <span>Execution Error Detected</span>
                  </div>

                  <button
                    type="button"
                    onClick={copyErrorLog}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      background: '#ffffff',
                      border: '1px solid #fca5a5',
                      borderRadius: 4,
                      padding: '3px 8px',
                      color: '#991b1b',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    {copiedLog ? <Check size={12} color="#059669" /> : <Copy size={12} />}
                    {copiedLog ? 'Copied Log' : 'Copy Error Log'}
                  </button>
                </div>

                {/* Error Message */}
                <div
                  style={{
                    fontSize: 13,
                    fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontWeight: 600,
                    color: '#b91c1c',
                    background: '#ffffff',
                    padding: '9px 12px',
                    borderRadius: 6,
                    border: '1px solid #fecaca',
                    wordBreak: 'break-word',
                  }}
                >
                  {runError || 'Unknown node runtime error'}
                </div>

                {/* Stack Trace */}
                {runErrorStack && (
                  <div style={{ marginTop: 10 }}>
                    <div
                      onClick={() => setShowStack(!showStack)}
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: '#991b1b',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        marginBottom: 4,
                        userSelect: 'none',
                      }}
                    >
                      {showStack ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span>Stack Trace</span>
                    </div>
                    {showStack && (
                      <pre
                        style={{
                          margin: 0,
                          padding: 10,
                          background: '#0f172a',
                          color: '#f87171',
                          fontSize: 11.5,
                          fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          borderRadius: 6,
                          overflowX: 'auto',
                          maxHeight: 180,
                          lineHeight: 1.45,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}
                      >
                        {runErrorStack}
                      </pre>
                    )}
                  </div>
                )}

                {/* Input Payload that caused failure */}
                {runErrorInput !== undefined && (
                  <div style={{ marginTop: 10 }}>
                    <div
                      onClick={() => setShowInputPayload(!showInputPayload)}
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: '#991b1b',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        marginBottom: 4,
                        userSelect: 'none',
                      }}
                    >
                      {showInputPayload ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span>Input Payload at Failure</span>
                    </div>
                    {showInputPayload && (
                      <pre
                        style={{
                          margin: 0,
                          padding: 10,
                          background: '#0f172a',
                          color: '#94a3b8',
                          fontSize: 11.5,
                          fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          borderRadius: 6,
                          overflowX: 'auto',
                          maxHeight: 160,
                          lineHeight: 1.45,
                        }}
                      >
                        {typeof runErrorInput === 'string' ? runErrorInput : JSON.stringify(runErrorInput, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* General Node Identifiers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                padding: '12px 14px',
                background: 'var(--bg-primary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                marginBottom: 8,
              }}
            >
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Tag size={12} />
                  Display Label
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. User Profile Reviewer"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Sparkles size={12} color="var(--accent-primary)" />
                  Variable Identifier
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={{ fontFamily: 'monospace' }}
                  value={nodeName}
                  onChange={(e) => setNodeName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="e.g. reviewer"
                  title="Unique identifier used when referencing this node outputs (e.g. reviewer.findings)"
                  required
                />
              </div>
            </div>

            {/* Dynamic Inputs Form */}
            <div>
              <h4
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Layers size={14} />
                Node Inputs & Parameters ({inputs.length})
              </h4>

              {inputs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>
                  No configurable inputs for this node type.
                </div>
              ) : (
                inputs.map((input, idx) => (
                  <DynamicFieldRenderer
                    key={`${input.name}-${idx}`}
                    input={input}
                    value={formConfig[input.name]}
                    onChange={(val) => handleFieldChange(input.name, val)}
                    formValues={formConfig}
                    availableVariables={availableVariables}
                  />
                ))
              )}
            </div>

            {actionDefinitions.length > 0 && (
              <BrowserActionBuilder
                definitions={actionDefinitions}
                actions={browserActions}
                availableVariables={availableVariables}
                onChange={(actions) => handleFieldChange('actions', actions)}
              />
            )}

            {/* Outputs Inspection */}
            {outputs.length > 0 && (
              <div
                style={{
                  marginTop: 10,
                  padding: '12px 14px',
                  background: 'var(--bg-subtle)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <h4
                  style={{
                    fontSize: 12,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <ArrowRightCircle size={14} color="var(--accent-primary)" />
                  Produced Output Handles & Variables
                </h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(() => {
                    const defType = String(node.data?.definitionType || '').toLowerCase();
                    if (defType === 'variable' || defType === 'set-variable') {
                      const keyName = formConfig.key && String(formConfig.key).trim() ? String(formConfig.key).trim() : '<key>';
                      return (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '4px 10px',
                            background: 'rgba(16, 185, 129, 0.08)',
                            border: '1px solid rgba(16, 185, 129, 0.4)',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 12,
                          }}
                        >
                          <strong style={{ color: '#059669', fontFamily: 'monospace' }}>
                            {nodeName}.{keyName}
                          </strong>
                          <span
                            style={{
                              fontSize: 10.5,
                              padding: '1px 5px',
                              background: '#ffffff',
                              borderRadius: 3,
                              color: '#059669',
                              fontWeight: 600,
                            }}
                          >
                            variable
                          </span>
                        </div>
                      );
                    }

                    // Check if node has a single output with an output schema (e.g. script, agent, transform)
                    const isSingleWithSchema = outputs.length === 1 && (outputs[0].schemaFrom || formConfig.outputType || formConfig.inputSchema);
                    const schemaField = isSingleWithSchema ? (outputs[0].schemaFrom || 'outputType') : undefined;
                    const rawSchema = schemaField ? (formConfig[schemaField] || formConfig.outputType || formConfig.inputSchema) : undefined;
                    if (rawSchema) {
                      const parsed = parseSchema(rawSchema);
                      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                        return Object.entries(parsed).map(([propName, propType]) => (
                          <div
                            key={propName}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '4px 10px',
                              background: '#ffffff',
                              border: '1px solid var(--border-color)',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: 12,
                            }}
                          >
                            <strong style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                              {nodeName}.{propName}
                            </strong>
                            <span
                              style={{
                                fontSize: 10.5,
                                padding: '1px 5px',
                                background: 'var(--bg-subtle)',
                                borderRadius: 3,
                                color: 'var(--text-muted)',
                              }}
                            >
                              {typeof propType === 'string' ? propType : 'property'}
                            </span>
                          </div>
                        ));
                      }
                    }

                    return outputs.flatMap((out: any) => {
                      const schemaField = out.schemaFrom;
                      const raw =
                        schemaField && formConfig[schemaField]
                          ? formConfig[schemaField]
                          : out.name === 'query'
                          ? formConfig.querySchema || (String(formConfig.method).toUpperCase() === 'GET' ? formConfig.type : undefined)
                          : out.name === 'params'
                          ? formConfig.paramsSchema
                          : out.name === 'body'
                          ? formConfig.type
                          : undefined;
                      const parsed = out.schema || (raw ? parseSchema(raw) : undefined);
                      const items = [
                        <div
                          key={out.name}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '4px 10px',
                            background: '#ffffff',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 12,
                          }}
                        >
                          <strong style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                            {nodeName}.{out.name}
                          </strong>
                          <span
                            style={{
                              fontSize: 10.5,
                              padding: '1px 5px',
                              background: 'var(--bg-subtle)',
                              borderRadius: 3,
                              color: 'var(--text-muted)',
                            }}
                          >
                            {out.type}
                          </span>
                        </div>,
                      ];
                      if (parsed && typeof parsed === 'object') {
                        Object.entries(parsed).forEach(([subProp, subType]) => {
                          items.push(
                            <div
                              key={`${out.name}.${subProp}`}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '4px 10px',
                                background: '#f8fafc',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: 12,
                              }}
                            >
                              <strong style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                                {nodeName}.{out.name}.{subProp}
                              </strong>
                              <span
                                style={{
                                  fontSize: 10.5,
                                  padding: '1px 5px',
                                  background: '#e0e7ff',
                                  borderRadius: 3,
                                  color: '#3730a3',
                                  fontWeight: 600,
                                }}
                              >
                                {typeof subType === 'string' ? subType : 'property'}
                              </span>
                            </div>,
                          );
                        });
                      }
                      return items;
                    });
                  })()}
                </div>
              </div>
            )}

            {/* Latest Execution Output Display */}
            {(node.data?.runOutput !== undefined || node.data?.runStatus) && (
              <div
                style={{
                  marginTop: 10,
                  padding: '12px 14px',
                  background: 'var(--bg-subtle)',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${
                    node.data?.runStatus === 'completed'
                      ? '#a7f3d0'
                      : node.data?.runStatus === 'failed'
                      ? '#fecaca'
                      : 'var(--border-color)'
                  }`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <h4
                    style={{
                      margin: 0,
                      fontSize: 12,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Terminal size={14} color="var(--accent-primary)" />
                    Latest Execution Output
                  </h4>
                  {node.data?.runStatus && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background:
                          node.data.runStatus === 'completed'
                            ? '#d1fae5'
                            : node.data.runStatus === 'failed'
                            ? '#fee2e2'
                            : '#f1f5f9',
                        color:
                          node.data.runStatus === 'completed'
                            ? '#065f46'
                            : node.data.runStatus === 'failed'
                            ? '#991b1b'
                            : '#475569',
                      }}
                    >
                      {node.data.runStatus}
                    </span>
                  )}
                </div>

                {node.data?.runOutput !== undefined ? (
                  <pre
                    style={{
                      margin: 0,
                      padding: 10,
                      background: '#0f172a',
                      color: '#34d399',
                      borderRadius: 6,
                      fontSize: 11.5,
                      fontFamily: 'monospace',
                      maxHeight: 180,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {JSON.stringify(node.data.runOutput, null, 2)}
                  </pre>
                ) : (
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    No output data produced for this node.
                  </div>
                )}
              </div>
            )}
          </div>

            {/* Modal Footer */}
            <div className="modal-footer" style={{ flexShrink: 0 }}>
              <button type="button" className="btn btn-default" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                <Save size={15} />
                Save Configuration
              </button>
            </div>
          </form>
        )}
      </div>
    </Rnd>

    {/* Docked Pill when minimized for quick restore */}
    {isMinimized && (
      <div
        className="docked-minimized-pill"
        onClick={toggleMinimize}
        title="Click to restore block configuration window"
      >
        <Sliders size={14} color="var(--accent-primary, #6366f1)" />
        <span>Configuring: <strong>{node.data?.label || node.data?.definitionName || 'Node'}</strong></span>
        <button
          type="button"
          className="docked-restore-btn"
          onClick={(e) => {
            e.stopPropagation();
            toggleMinimize();
          }}
        >
          Restore
        </button>
      </div>
    )}
  </>
  );
};
