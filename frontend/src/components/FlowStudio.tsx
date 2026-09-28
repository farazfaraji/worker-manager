'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  addEdge,
  Connection,
  NodeChange,
  EdgeChange,
} from '@xyflow/react';
import { FlowNodeData, NodeDefinition, RunResult, RunNodeRecord, Project } from '@/lib/types';
import { generateUniqueNodeName, extractNodeOutputs } from '@/lib/variable-utils';
import { Header } from '@/components/Header';
import { LeftPanel } from '@/components/LeftPanel';
import { FlowBoard } from '@/components/FlowBoard';
import { SaveModal } from '@/components/SaveModal';
import { LoadModal } from '@/components/LoadModal';
import { NodeConfigModal } from '@/components/modal/NodeConfigModal';
import { RunModal } from '@/components/modal/RunModal';
import { ModelSettingsModal } from '@/components/modal/ModelSettingsModal';
import { CreateProjectModal } from '@/components/modal/CreateProjectModal';
import { ManageProjectsModal } from '@/components/modal/ManageProjectsModal';
import {
  fetchProjects,
  fetchGraphs,
  fetchGraphById,
  createGraph,
  updateGraph,
  runGraph,
  rerunFromNode,
  resumeRun,
  validateGraph,
  validateGraphById,
  fetchRuns,
} from '@/lib/api';
import { FolderOpen, Plus, Workflow, Check, AlertCircle } from 'lucide-react';

interface FlowStudioProps {
  initialFlowId?: string;
}

function FlowStudioInner({ initialFlowId }: FlowStudioProps) {
  const reactFlow = useReactFlow();

  // Graph state
  const [graphId, setGraphId] = useState<string | null>(initialFlowId || null);
  const [graphName, setGraphName] = useState<string>('Untitled Graph');
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isDirty, setIsDirty] = useState<boolean>(false);

  // Selected Node & Config Modal state
  const [selectedNode, setSelectedNode] = useState<Node<FlowNodeData> | null>(null);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);

  // Projects state
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState<boolean>(false);
  const [isManageProjectsModalOpen, setIsManageProjectsModalOpen] = useState<boolean>(false);
  const [projectToEdit, setProjectToEdit] = useState<Project | null>(null);

  // Modals & UI state
  const [isSaveModalOpen, setIsSaveModalOpen] = useState<boolean>(false);
  const [isSaveAs, setIsSaveAs] = useState<boolean>(false);
  const [isLoadModalOpen, setIsLoadModalOpen] = useState<boolean>(false);
  const [isRunModalOpen, setIsRunModalOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [showInitialWelcome, setShowInitialWelcome] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [activeRunResult, setActiveRunResult] = useState<RunResult | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type?: 'success' | 'error' } | null>(null);

  const initialLoadAttempted = useRef<boolean>(false);

  const loadProjects = useCallback(async () => {
    try {
      const list = await fetchProjects();
      setProjects(list);
      if (list.length > 0) {
        const savedPid = typeof window !== 'undefined' ? localStorage.getItem('flow_builder_active_project_id') : null;
        const match = list.find((p) => p._id === savedPid);
        const initialPid = match ? match._id : list[0]._id;
        setActiveProjectId((prev) => prev || initialPid);
      }
    } catch (err: any) {
      console.error('Failed to load projects:', err);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleSelectProject = (projectId: string) => {
    setActiveProjectId(projectId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('flow_builder_active_project_id', projectId);
    }
    const selected = projects.find((p) => p._id === projectId);
    if (selected) {
      showToast(`Switched to "${selected.name}"`);
    }
  };

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text: msg, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  // Helper to update the browser URL smoothly without full page reload
  const updateUrl = (targetId: string | null) => {
    if (typeof window === 'undefined') return;
    const currentPath = window.location.pathname;
    const targetPath = targetId ? `/flow/${targetId}` : '/';
    if (currentPath !== targetPath) {
      window.history.pushState({ graphId: targetId }, '', targetPath);
    }
  };

  // Load a graph from DB by ID
  const handleSelectGraph = useCallback(
    async (id: string, syncUrl: boolean = true) => {
      try {
        const loaded = await fetchGraphById(id);
        const resolvedId = loaded._id || id;
        setGraphId(resolvedId);
        setGraphName(loaded.name || 'Untitled Graph');
        const enrichedLoadedNodes = (loaded.nodes || []).map((n: any) => {
          const dynamicOutputs = extractNodeOutputs({
            definitionType: n.data?.definitionType || n.type,
            outputs: n.data?.definitionOutputs?.length ? n.data.definitionOutputs : (n.data?.outputs || []),
            config: n.data?.config,
            inputs: n.data?.inputs,
          });
          return {
            ...n,
            data: {
              ...n.data,
              outputs: dynamicOutputs.length > 0 ? dynamicOutputs : (n.data?.outputs || []),
            },
          };
        });
        setNodes(enrichedLoadedNodes);
        setEdges(loaded.edges || []);
        setActiveRunResult(null);
        setIsDirty(false);
        setIsLoadModalOpen(false);
        setShowInitialWelcome(false);

        if (loaded.projectId) {
          setActiveProjectId(loaded.projectId);
          if (typeof window !== 'undefined') {
            localStorage.setItem('flow_builder_active_project_id', loaded.projectId);
          }
        }

        if (syncUrl) {
          updateUrl(resolvedId);
        }

        showToast(`Loaded "${loaded.name}"`);
      } catch (err: any) {
        showToast(`Failed to load graph: ${err.message || 'Unknown error'}`, 'error');
        // If the graph in URL failed to load, revert URL to root
        updateUrl(null);
        setGraphId(null);
      }
    },
    [setNodes, setEdges],
  );

  // Initial load effect: inspect initialFlowId, URL pathname, or search params
  useEffect(() => {
    if (initialLoadAttempted.current) return;
    initialLoadAttempted.current = true;

    async function initializeFlow() {
      let flowIdToLoad = initialFlowId;

      if (!flowIdToLoad && typeof window !== 'undefined') {
        const path = window.location.pathname;
        const flowMatch = path.match(/^\/flow\/([^/]+)/);
        if (flowMatch && flowMatch[1]) {
          flowIdToLoad = flowMatch[1];
        } else {
          // Also check query param ?flowId=... or ?id=...
          const searchParams = new URLSearchParams(window.location.search);
          const paramId = searchParams.get('flowId') || searchParams.get('id');
          if (paramId) {
            flowIdToLoad = paramId;
          }
        }
      }

      if (flowIdToLoad) {
        await handleSelectGraph(flowIdToLoad, true);
      } else {
        // If on root with no ID, check if any graphs exist to show initial welcome
        try {
          const list = await fetchGraphs();
          if (list && list.length > 0) {
            setShowInitialWelcome(true);
          }
        } catch {
          // Backend not ready yet or empty, start fresh
        }
      }
    }

    initializeFlow();
  }, [initialFlowId, handleSelectGraph]);

  // Handle browser Back / Forward buttons (popstate)
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const path = window.location.pathname;
      const flowMatch = path.match(/^\/flow\/([^/]+)/);
      if (flowMatch && flowMatch[1]) {
        handleSelectGraph(flowMatch[1], false);
      } else if (path === '/') {
        setGraphId(null);
        setGraphName('Untitled Graph');
        setNodes([]);
        setEdges([]);
        setActiveRunResult(null);
        setIsDirty(false);
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, [handleSelectGraph, setNodes, setEdges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<FlowNodeData>>[]) => {
      onNodesChange(changes);
      setIsDirty(true);
    },
    [onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes);
      setIsDirty(true);
    },
    [onEdgesChange],
  );

  const handleConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => {
        const sourceNode = nodes.find((n) => n.id === params.source);
        const defType = String(
          (sourceNode?.data as any)?.definitionType || sourceNode?.type || '',
        ).toLowerCase();
        const isBranching = defType === 'condition' || defType === 'router';

        // For non-branching nodes, replace any existing edge between same source and target
        const cleanedEdges = isBranching
          ? eds.filter(
              (e) =>
                !(
                  e.source === params.source &&
                  e.target === params.target &&
                  (e.sourceHandle || 'default') === (params.sourceHandle || 'default')
                ),
            )
          : eds.filter((e) => !(e.source === params.source && e.target === params.target));

        return addEdge(
          {
            ...params,
            type: 'straight',
            animated: true,
            style: { stroke: 'var(--accent-primary)', strokeWidth: 2 },
          },
          cleanedEdges,
        );
      });
      setIsDirty(true);
    },
    [nodes, setEdges],
  );

  // Add node handler for both palette click and drag-drop onto canvas
  const handleAddNode = useCallback(
    (definition: NodeDefinition, position?: { x: number; y: number }) => {
      setNodes((currentNodes) => {
        const uniqueName = generateUniqueNodeName(definition.id || definition.name, currentNodes);

        // Pre-fill initial config with default values
        const initialConfig: Record<string, any> = {};
        for (const input of definition.inputs || []) {
          if (input.defaultValue !== undefined) {
            initialConfig[input.name] = input.defaultValue;
          }
        }

        // If no explicit position is provided (i.e. the node was clicked from
        // the left palette rather than drag-dropped), place it at the center of
        // the currently visible viewport so it always appears in view.
        const pos = position || (() => {
          const { x: vx, y: vy, zoom } = reactFlow.getViewport();
          const boardEl = document.querySelector('.flow-board-wrapper') as HTMLElement | null;
          const boardWidth = boardEl ? boardEl.offsetWidth : window.innerWidth;
          const boardHeight = boardEl ? boardEl.offsetHeight : window.innerHeight;
          // Convert screen center → flow coordinates
          const centerX = (boardWidth / 2 - vx) / zoom;
          const centerY = (boardHeight / 2 - vy) / zoom;
          return {
            x: centerX + (Math.random() - 0.5) * 40,
            y: centerY + (Math.random() - 0.5) * 40,
          };
        })();

        const outputs = extractNodeOutputs({
          definitionType: definition.type,
          outputs: definition.outputs || [],
          config: initialConfig,
          inputs: definition.inputs || [],
        });

        const newNode: Node<FlowNodeData> = {
          id: `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          type: 'langgraphNode',
          position: pos,
          data: {
            name: uniqueName,
            definitionId: definition.id,
            definitionType: definition.type,
            definitionName: definition.name,
            label: definition.name,
            nodeName: uniqueName,
            config: initialConfig,
            inputs: definition.inputs || [],
            definitionOutputs: definition.outputs || [],
            outputs: outputs,
            actionDefinitions: definition.actionDefinitions || [],
          },
        };

        return [...currentNodes, newNode];
      });
      setIsDirty(true);
    },
    [setNodes],
  );

  // Open Node Configuration Modal on node click
  const handleNodeSelect = (node: Node<FlowNodeData>) => {
    const latestNode = nodes.find((n) => n.id === node.id) || node;
    setSelectedNode(latestNode);
    setIsConfigModalOpen(true);
  };

  // Save Node Configuration from Modal
  const handleSaveNodeConfig = (
    nodeId: string,
    updatedData: {
      label: string;
      nodeName: string;
      config: Record<string, any>;
      actionDefinitions?: any[];
      definitionOutputs?: any[];
      outputs?: any[];
    },
  ) => {
    setNodes((prevNodes) =>
      prevNodes.map((n) => {
        if (n.id === nodeId) {
          const baseOutputs =
            updatedData.definitionOutputs?.length
              ? updatedData.definitionOutputs
              : (n.data?.definitionOutputs?.length ? n.data.definitionOutputs : (n.data.outputs || []));

          const updatedOutputs = updatedData.outputs || extractNodeOutputs({
            definitionType: n.data?.definitionType,
            outputs: baseOutputs,
            config: updatedData.config,
          });

          return {
            ...n,
            data: {
              ...n.data,
              name: updatedData.nodeName,
              label: updatedData.label,
              nodeName: updatedData.nodeName,
              config: updatedData.config,
              definitionOutputs: baseOutputs,
              outputs: updatedOutputs,
              ...(updatedData.actionDefinitions?.length ? { actionDefinitions: updatedData.actionDefinitions } : {}),
            },
          };
        }
        return n;
      }),
    );
    setIsDirty(true);
    showToast(`Updated "${updatedData.label}" configuration`);
  };

  // Start a fresh new graph
  const handleNewBoard = () => {
    if (isDirty) {
      const confirmDiscard = window.confirm(
        'You have unsaved changes. Are you sure you want to create a new board?',
      );
      if (!confirmDiscard) return;
    }
    setGraphId(null);
    setGraphName('Untitled Graph');
    setNodes([]);
    setEdges([]);
    setActiveRunResult(null);
    setIsDirty(false);
    setShowInitialWelcome(false);
    updateUrl(null);
    showToast('Created new blank board');
  };

  // Save handler: if untitled or no ID, ask for name; otherwise update directly
  const handleSaveClick = () => {
    if (!graphId || graphName === 'Untitled Graph') {
      setIsSaveAs(false);
      setIsSaveModalOpen(true);
    } else {
      performSave(graphName);
    }
  };

  // Save As handler: always ask for a new name
  const handleSaveAsClick = () => {
    setIsSaveAs(true);
    setIsSaveModalOpen(true);
  };

  // Share handler: copies link to clipboard
  const handleShareClick = () => {
    if (!graphId) {
      showToast('Save flow first to generate a shareable link', 'error');
      return;
    }
    const shareUrl = `${window.location.origin}/flow/${graphId}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        showToast('Flow link copied to clipboard!');
      }).catch(() => {
        prompt('Copy flow link:', shareUrl);
      });
    } else {
      prompt('Copy flow link:', shareUrl);
    }
  };

  // Execute create or update API call and return the graph ID
  const performSave = async (targetName: string, saveProjectId?: string): Promise<string> => {
    try {
      setIsSaving(true);
      const finalProjectId = saveProjectId || activeProjectId || projects[0]?._id || '';

      if (!graphId || isSaveAs) {
        // Create new graph record
        const created = await createGraph({
          name: targetName,
          projectId: finalProjectId,
          nodes,
          edges,
        });
        const newId = created._id || '';
        setGraphId(newId);
        setGraphName(created.name);
        setIsDirty(false);
        setIsSaveModalOpen(false);
        setIsSaveAs(false);
        updateUrl(newId);
        showToast(`Saved "${created.name}" to MongoDB`);
        await loadProjects();
        return newId;
      } else {
        // Update existing record
        const updated = await updateGraph(graphId, {
          name: targetName,
          projectId: saveProjectId || activeProjectId || undefined,
          nodes,
          edges,
        });
        setGraphName(updated.name);
        setIsDirty(false);
        setIsSaveModalOpen(false);
        updateUrl(graphId);
        showToast(`Updated "${updated.name}"`);
        await loadProjects();
        return graphId;
      }
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error');

      // Highlight offending nodes on the canvas if the error names them
      const errData = err?.data;
      if (errData) {
        const badNodeIds = new Set<string>();
        if (errData.source) badNodeIds.add(errData.source);
        if (errData.target) badNodeIds.add(errData.target);
        // Also try top-level blockId (variable-ref errors)
        if (errData.blockId) badNodeIds.add(errData.blockId);

        if (badNodeIds.size > 0) {
          const tip = err.message;
          setNodes((prev) =>
            prev.map((n) => ({
              ...n,
              data: {
                ...n.data,
                saveError: badNodeIds.has(n.id) ? tip : (n.data as any).saveError,
              },
            })),
          );
          // Auto-clear the highlight after 8 s
          setTimeout(() => {
            setNodes((prev) =>
              prev.map((n) => ({
                ...n,
                data: { ...n.data, saveError: undefined },
              })),
            );
          }, 8000);
        }
      }

      throw err;

    } finally {
      setIsSaving(false);
    }
  };

  // Execute graph using backend POST /graphs/:id/run
  const handleRunGraph = async (inputPayload: any, options?: { debugMode?: boolean; useCache?: boolean }): Promise<RunResult> => {
    if (nodes.length === 0) {
      alert('Cannot run an empty graph. Please add nodes first.');
      throw new Error('Graph has no nodes');
    }

    try {
      setIsExecuting(true);

      // Ensure graph is saved/synced with DB before executing
      let targetGraphId = graphId;
      if (!targetGraphId || isDirty) {
        targetGraphId = await performSave(graphName);
      }

      // Mark nodes on canvas as running
      setNodes((prev) =>
        prev.map((n) => ({
          ...n,
          data: {
            ...n.data,
            runStatus: 'running',
            runOutput: undefined,
            runError: undefined,
            runErrorDetails: undefined,
          },
        })),
      );

      const result = await runGraph(targetGraphId, inputPayload, {
        debugMode: options?.debugMode,
        useCache: options?.useCache,
      });
      setActiveRunResult(result);

      // Annotate canvas nodes with execution results
      const nodeStatusMap = new Map<string, any>();
      (result.nodes || []).forEach((rec) => {
        nodeStatusMap.set(rec.nodeId, rec);
      });

      setNodes((prev) =>
        prev.map((n) => {
          const rec = nodeStatusMap.get(n.id);
          if (rec) {
            return {
              ...n,
              data: {
                ...n.data,
                runStatus: rec.status,
                runOutput: rec.output,
                runError: rec.error?.message,
                runErrorDetails: rec.error,
              },
            };
          }
          return {
            ...n,
            data: {
              ...n.data,
              runStatus:
                result.status === 'listening'
                  ? undefined
                  : result.status === 'failed'
                  ? (n.data.runStatus === 'running' ? 'skipped' : undefined)
                  : n.data.runStatus,
            },
          };
        }),
      );

      // Update selected node if open
      setSelectedNode((prevSelected) => {
        if (!prevSelected) return null;
        const rec = nodeStatusMap.get(prevSelected.id);
        if (rec) {
          return {
            ...prevSelected,
            data: {
              ...prevSelected.data,
              runStatus: rec.status,
              runOutput: rec.output,
              runError: rec.error?.message,
              runErrorDetails: rec.error,
            },
          };
        }
        return prevSelected;
      });

      if (result.status === 'completed') {
        showToast('Flow completed successfully!');
      } else if (result.status === 'listening') {
        const port = result.output?.port || result.output?.server?.port || 3000;
        showToast(result.output?.message || `Webserver listening on :${port}! Waiting for HTTP requests...`);
      } else if (result.status === 'waiting' && result.waitingDescriptor?.debugBreakpoint) {
        showToast(`Debug: paused after "${result.waitingDescriptor.nodeName}"`);
      } else {
        showToast(`Flow failed: ${result.error?.message || 'Check failed node logs'}`, 'error');
      }

      return result;
    } catch (err: any) {
      // In case of immediate validation/runner network error
      setNodes((prev) =>
        prev.map((n) => ({
          ...n,
          data: {
            ...n.data,
            runStatus: undefined,
          },
        })),
      );
      throw err;
    } finally {
      setIsExecuting(false);
    }
  };

  // Validate graph variables and topology using POST /graphs/:id/validate
  const handleValidateGraph = async (): Promise<{ valid: boolean }> => {
    if (nodes.length === 0) {
      return { valid: true };
    }

    if (graphId && !isDirty) {
      return await validateGraphById(graphId, { nodes, edges });
    } else {
      return await validateGraph({ name: graphName, nodes, edges });
    }
  };

  const handleRerunNode = async (nodeId: string): Promise<RunResult> => {
    if (!activeRunResult) throw new Error('No run selected');
    try {
      setIsExecuting(true);
      const result = await rerunFromNode(activeRunResult.runId, nodeId);
      setActiveRunResult(result);
      showToast(result.status === 'completed' ? 'Partial flow rerun completed!' : 'Rerun failed');
      return result;
    } catch (err: any) {
      alert(`Rerun error: ${err.message}`);
      throw err;
    } finally {
      setIsExecuting(false);
    }
  };

  const handleResumeRun = async (payload: any): Promise<RunResult> => {
    if (!activeRunResult) throw new Error('No active run to resume');
    try {
      setIsExecuting(true);
      const result = await resumeRun(activeRunResult.runId, payload);
      setActiveRunResult(result);

      const nodeStatusMap = new Map<string, RunNodeRecord>();
      (result.nodes || []).forEach((rec) => {
        nodeStatusMap.set(rec.nodeId, rec);
      });

      setNodes((prev) =>
        prev.map((n) => {
          const rec = nodeStatusMap.get(n.id);
          if (!rec) return n;
          return {
            ...n,
            data: {
              ...n.data,
              runStatus: rec.status,
              runOutput: rec.output,
              runError: rec.error?.message,
              runErrorDetails: rec.error,
            },
          };
        }),
      );

      if (result.status === 'completed') {
        showToast('Flow resumed and completed successfully!');
      } else if (result.status === 'waiting' && result.waitingDescriptor?.debugBreakpoint) {
        showToast(`Debug: paused after "${result.waitingDescriptor.nodeName}"`);
      } else if (result.status === 'waiting') {
        showToast('Flow paused: waiting for next human review.');
      } else {
        showToast(`Flow failed: ${result.error?.message || 'Check logs'}`, 'error');
      }

      return result;
    } catch (err: any) {
      alert(`Resume error: ${err.message}`);
      throw err;
    } finally {
      setIsExecuting(false);
    }
  };

  // Check if graph has webserver
  const hasWebserver = nodes.some((n) => {
    const type = String(n.data?.definitionType || n.type || '').toLowerCase();
    return type === 'webserver' || n.data?.definitionId === 'webserver';
  });

  const lastKnownRunIdRef = useRef<string | null>(null);
  const activeRunResultRef = useRef<RunResult | null>(activeRunResult);

  useEffect(() => {
    activeRunResultRef.current = activeRunResult;
    if (activeRunResult?.runId) {
      lastKnownRunIdRef.current = activeRunResult.runId;
    }
  }, [activeRunResult]);

  // Centralized helper to apply run results to active state, canvas nodes, and selected drawer
  const applyRunResult = useCallback((result: RunResult) => {
    setActiveRunResult(result);
    activeRunResultRef.current = result;
    lastKnownRunIdRef.current = result.runId;

    const nodeStatusMap = new Map<string, any>();
    (result.nodes || []).forEach((rec) => {
      nodeStatusMap.set(rec.nodeId, rec);
    });

    setNodes((prev) =>
      prev.map((n) => {
        const rec = nodeStatusMap.get(n.id);
        if (rec) {
          return {
            ...n,
            data: {
              ...n.data,
              runStatus: rec.status,
              runOutput: rec.output,
              runError: rec.error?.message,
              runErrorDetails: rec.error,
            },
          };
        }
        return {
          ...n,
          data: {
            ...n.data,
            runStatus:
              result.status === 'listening'
                ? undefined
                : result.status === 'failed'
                ? (n.data.runStatus === 'running' ? 'skipped' : undefined)
                : n.data.runStatus,
          },
        };
      }),
    );

    setSelectedNode((prevSelected) => {
      if (!prevSelected) return null;
      const rec = nodeStatusMap.get(prevSelected.id);
      if (rec) {
        return {
          ...prevSelected,
          data: {
            ...prevSelected.data,
            runStatus: rec.status,
            runOutput: rec.output,
            runError: rec.error?.message,
            runErrorDetails: rec.error,
          },
        };
      }
      return prevSelected;
    });
  }, [setNodes, setSelectedNode]);

  // Live polling for webserver runs
  useEffect(() => {
    if (!hasWebserver || !graphId) return;

    const interval = setInterval(async () => {
      try {
        const recentRuns = await fetchRuns(undefined, graphId);
        if (recentRuns && recentRuns.length > 0) {
          const latest = recentRuns[0];
          const current = activeRunResultRef.current;
          const isNewRun = latest.runId !== lastKnownRunIdRef.current;
          const isRunUpdated =
            current?.runId === latest.runId &&
            (latest.status !== current.status ||
              (latest.nodes?.length || 0) > (current.nodes?.length || 0) ||
              (latest.checkpointSequence || 0) > (current.checkpointSequence || 0));

          if ((isNewRun || isRunUpdated) && latest.status !== 'listening') {
            applyRunResult(latest);

            if (isNewRun) {
              showToast(
                latest.status === 'completed'
                  ? 'HTTP Request processed successfully!'
                  : `HTTP Request execution failed: ${latest.error?.message || 'Check logs'}`,
                latest.status === 'completed' ? 'success' : 'error',
              );
            }
          }
        }
      } catch {
        // Ignore background polling errors
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [hasWebserver, graphId, applyRunResult]);

  return (
    <div className="app-container">
      {/* Top Navigation Header */}
      <Header
        graphName={graphName}
        graphId={graphId}
        isDirty={isDirty}
        isSaving={isSaving}
        isExecuting={isExecuting}
        projects={projects}
        activeProject={projects.find((p) => p._id === activeProjectId) || null}
        onSelectProject={handleSelectProject}
        onOpenCreateProject={() => {
          setProjectToEdit(null);
          setIsCreateProjectModalOpen(true);
        }}
        onOpenManageProjects={() => setIsManageProjectsModalOpen(true)}
        onSave={handleSaveClick}
        onSaveAs={handleSaveAsClick}
        onShare={handleShareClick}
        onOpenLoadModal={() => setIsLoadModalOpen(true)}
        onOpenRunModal={() => setIsRunModalOpen(true)}
        onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
        onNewBoard={handleNewBoard}
        onNameChange={(name) => {
          setGraphName(name);
          setIsDirty(true);
        }}
      />

      {/* Main Workspace */}
      <main className="main-content">
        {/* Dynamic Left Panel Node Palette */}
        <LeftPanel onAddNode={handleAddNode} />

        {/* Center React Flow Board */}
        <FlowBoard
          nodes={nodes}
          edges={edges}
          graphId={graphId}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onNodeSelect={handleNodeSelect}
          onAddNode={handleAddNode}
          onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
        />

        {/* Initial First-Page Prompt to Load or Start New */}
        {showInitialWelcome && (
          <div className="welcome-overlay">
            <div className="welcome-card">
              <div className="welcome-icon-box">
                <Workflow size={28} />
              </div>
              <div>
                <h2 className="welcome-title">LangGraph Flow Builder</h2>
                <p className="welcome-desc" style={{ marginTop: 6 }}>
                  Welcome! You can load an existing flow from MongoDB or create a
                  new blank graph to start building your agent workflow.
                </p>
              </div>

              <div className="welcome-actions">
                <button
                  type="button"
                  className="btn btn-default"
                  onClick={() => {
                    setShowInitialWelcome(false);
                    setIsLoadModalOpen(true);
                  }}
                >
                  <FolderOpen size={16} />
                  Load Graph
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowInitialWelcome(false)}
                >
                  <Plus size={16} />
                  Create Blank Flow
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Dynamic Node Configuration Modal */}
      <NodeConfigModal
        isOpen={isConfigModalOpen}
        node={selectedNode}
        allNodes={nodes}
        edges={edges}
        graphId={graphId}
        onClose={() => setIsConfigModalOpen(false)}
        onSaveConfig={handleSaveNodeConfig}
      />

      {/* Save / Save As Modal */}
      <SaveModal
        isOpen={isSaveModalOpen}
        isSaveAs={isSaveAs}
        initialName={graphName}
        onClose={() => setIsSaveModalOpen(false)}
        onConfirm={performSave}
        isSaving={isSaving}
        projects={projects}
        activeProjectId={activeProjectId}
      />

      {/* Load Graphs Modal */}
      <LoadModal
        isOpen={isLoadModalOpen}
        onClose={() => setIsLoadModalOpen(false)}
        onSelectGraph={(id) => handleSelectGraph(id, true)}
        onNewGraph={handleNewBoard}
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
      />

      {/* Create Project Modal */}
      <CreateProjectModal
        isOpen={isCreateProjectModalOpen}
        onClose={() => setIsCreateProjectModalOpen(false)}
        onProjectCreated={async (newProj) => {
          await loadProjects();
          handleSelectProject(newProj._id);
        }}
        projectToEdit={projectToEdit}
      />

      {/* Manage Projects Modal */}
      <ManageProjectsModal
        isOpen={isManageProjectsModalOpen}
        projects={projects}
        activeProjectId={activeProjectId}
        onClose={() => setIsManageProjectsModalOpen(false)}
        onSelectProject={handleSelectProject}
        onOpenCreateProject={() => {
          setIsManageProjectsModalOpen(false);
          setProjectToEdit(null);
          setIsCreateProjectModalOpen(true);
        }}
        onOpenEditProject={(p) => {
          setIsManageProjectsModalOpen(false);
          setProjectToEdit(p);
          setIsCreateProjectModalOpen(true);
        }}
        onRefreshProjects={loadProjects}
      />

      {/* Flow Execution & Results Modal */}
      <RunModal
        isOpen={isRunModalOpen}
        graphName={graphName}
        graphId={graphId}
        nodes={nodes}
        edges={edges}
        isDirty={isDirty}
        onClose={() => setIsRunModalOpen(false)}
        onRun={handleRunGraph}
        onRerunNode={handleRerunNode}
        onResumeRun={handleResumeRun}
        onValidate={handleValidateGraph}
        runResult={activeRunResult}
        isExecuting={isExecuting}
        onRunResult={applyRunResult}
      />

      {/* LLM Models & App Settings Modal */}
      <ModelSettingsModal
        isOpen={isSettingsModalOpen}
        activeProjectId={activeProjectId}
        onClose={() => setIsSettingsModalOpen(false)}
        onModelsUpdated={() => {
          showToast('Model settings updated');
        }}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast" style={{ borderColor: toastMessage.type === 'error' ? 'var(--danger, #ef4444)' : undefined }}>
          {toastMessage.type === 'error' ? (
            <AlertCircle size={16} color="var(--danger, #ef4444)" />
          ) : (
            <Check size={16} color="#10b981" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}
    </div>
  );
}

export function FlowStudio({ initialFlowId }: FlowStudioProps) {
  return (
    <ReactFlowProvider>
      <FlowStudioInner initialFlowId={initialFlowId} />
    </ReactFlowProvider>
  );
}
