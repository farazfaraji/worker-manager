'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FlowEdge, FlowNode, FlowNodeData, NodeDefinition, RunResult, RunNodeRecord, Project } from '@/lib/types';
import { generateUniqueNodeName, extractNodeOutputs } from '@/lib/variable-utils';
import { Header } from '@/components/Header';
import { LeftPanel } from '@/components/LeftPanel';
import { BoardRightToolbar } from '@/components/BoardRightToolbar';
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
  fetchNodeDefinitions,
} from '@/lib/api';
import { FolderOpen, Plus, Workflow, Check, AlertCircle } from 'lucide-react';
import { AppNav } from '@/components/AppNav';
import {
  clearStudioDraft,
  persistStudioSession,
  readStudioDraft,
  rememberFlow,
} from '@/lib/studio-session';
import { BranchPath, FlowListView } from '@/components/list-view/FlowListView';
import { FlowAssistantPanel } from '@/components/list-view/FlowAssistantPanel';
import { FlowOperation } from '@/lib/flow-assistant';
import { applyFlowOperations, previewFlowOperations } from '@/lib/flow-operations';

interface FlowStudioProps {
  initialFlowId?: string;
}

function FlowStudioInner({ initialFlowId }: FlowStudioProps) {
  // Graph state
  const [graphId, setGraphId] = useState<string | null>(initialFlowId || null);
  const [graphName, setGraphName] = useState<string>('Untitled Graph');
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [isDirty, setIsDirty] = useState<boolean>(false);

  // Selected Node & Config Modal state
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null);
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

  const [isAssistantOpen, setIsAssistantOpen] = useState<boolean>(false);
  const [addTarget, setAddTarget] = useState<{
    afterBlockId?: string;
    beforeBlockId?: string;
    output?: string;
  } | null>(null);

  const initialLoadAttempted = useRef<boolean>(false);
  const studioReady = useRef<boolean>(false);

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

      const draft = readStudioDraft();
      const sameBoard = !!draft && (draft.graphId || null) === (flowIdToLoad || null);
      if (draft?.isDirty && sameBoard) {
        setGraphId(draft.graphId);
        setGraphName(draft.graphName || 'Untitled Graph');
        setNodes(draft.nodes);
        setEdges(draft.edges);
        setIsDirty(true);
        setShowInitialWelcome(false);
        if (draft.graphId) rememberFlow(draft.graphId);
        studioReady.current = true;
        return;
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
      studioReady.current = true;
    }

    initializeFlow();
  }, [initialFlowId, handleSelectGraph, setNodes, setEdges]);

  // Handle browser Back / Forward buttons (popstate)
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const path = window.location.pathname;
      const flowMatch = path.match(/^\/flow\/([^/]+)/);
      if (flowMatch && flowMatch[1]) {
        const draft = readStudioDraft();
        if (draft?.isDirty && draft.graphId === flowMatch[1]) {
          setGraphId(draft.graphId);
          setGraphName(draft.graphName || 'Untitled Graph');
          setNodes(draft.nodes);
          setEdges(draft.edges);
          setIsDirty(true);
          setActiveRunResult(null);
        } else {
          handleSelectGraph(flowMatch[1], false);
        }
      } else if (path === '/') {
        const draft = readStudioDraft();
        if (draft?.isDirty && !draft.graphId) {
          setGraphId(null);
          setGraphName(draft.graphName || 'Untitled Graph');
          setNodes(draft.nodes);
          setEdges(draft.edges);
          setIsDirty(true);
          setActiveRunResult(null);
          setShowInitialWelcome(false);
        } else {
          setGraphId(null);
          setGraphName('Untitled Graph');
          setNodes([]);
          setEdges([]);
          setActiveRunResult(null);
          setIsDirty(false);
        }
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, [handleSelectGraph, setNodes, setEdges]);

  useEffect(() => {
    if (!studioReady.current) return;
    persistStudioSession({ graphId, graphName, nodes, edges, isDirty });
  }, [graphId, graphName, nodes, edges, isDirty]);

  const handleAddNode = useCallback(
    (definition: NodeDefinition) => {
      const uniqueName = generateUniqueNodeName(definition.id || definition.name, nodes);
      const initialConfig: Record<string, any> = {};
      for (const input of definition.inputs || []) {
        if (input.defaultValue !== undefined) {
          initialConfig[input.name] = input.defaultValue;
        }
      }
      const outputs = extractNodeOutputs({
        definitionType: definition.type,
        outputs: definition.outputs || [],
        config: initialConfig,
        inputs: definition.inputs || [],
      });
      const newNode: FlowNode = {
        id: `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        type: 'langgraphNode',
        position: { x: 0, y: nodes.length * 32 },
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
          outputs,
          actionDefinitions: definition.actionDefinitions || [],
        },
      };
      setNodes((currentNodes) => [...currentNodes, newNode]);

      if (addTarget?.afterBlockId) {
        const afterId = addTarget.afterBlockId;
        const beforeId = addTarget.beforeBlockId;
        const explicitOutput = addTarget.output;
        setEdges((currentEdges) => {
          const source = nodes.find((node) => node.id === afterId);
          const primary = source?.data?.outputs?.[0]?.name || 'done';
          const outgoing = currentEdges.filter(
            (edge) =>
              edge.source === afterId &&
              (!beforeId || edge.target === beforeId) &&
              (!explicitOutput || (edge.sourceHandle || 'done') === explicitOutput),
          );
          const handle = explicitOutput || outgoing[0]?.sourceHandle || primary;
          const newEdge: FlowEdge = {
            id: `e-${afterId}-${newNode.id}-${handle}`,
            source: afterId,
            target: newNode.id,
            sourceHandle: handle,
            targetHandle: 'in',
            type: 'default',
          };
          if (outgoing.length === 1) {
            const nextPrimary = newNode.data.outputs?.[0]?.name || 'done';
            return [
              ...currentEdges.map((edge) =>
                edge.id === outgoing[0].id
                  ? { ...edge, source: newNode.id, sourceHandle: nextPrimary }
                  : edge,
              ),
              newEdge,
            ];
          }
          return [...currentEdges, newEdge];
        });
      }

      setAddTarget(null);
      setIsDirty(true);
    },
    [nodes, addTarget],
  );

  const handleRequestAddStep = (
    afterBlockId?: string,
    branchPath?: BranchPath[],
    beforeBlockId?: string,
  ) => {
    const branch = branchPath?.[branchPath.length - 1];
    const output = branch && branch.blockId === afterBlockId ? branch.output : undefined;
    setAddTarget({ afterBlockId, beforeBlockId, output });
  };

  // Open Node Configuration Modal on node click
  const handleNodeSelect = (node: FlowNode) => {
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
    clearStudioDraft();
    rememberFlow(null);
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

      const savable = stripAssistantOverlay(nodes, edges);

      if (!graphId || isSaveAs) {
        // Create new graph record
        const created = await createGraph({
          name: targetName,
          projectId: finalProjectId,
          nodes: savable.nodes,
          edges: savable.edges,
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
          nodes: savable.nodes,
          edges: savable.edges,
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

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const [nodeDefinitions, setNodeDefinitions] = useState<NodeDefinition[]>([]);
  const definitionsRef = useRef(nodeDefinitions);
  definitionsRef.current = nodeDefinitions;
  const previewBaseRef = useRef<{ nodes: FlowNode[]; edges: FlowEdge[] } | null>(null);
  const assistantUndoRef = useRef<{ nodes: FlowNode[]; edges: FlowEdge[] } | null>(null);
  const highlightTokenRef = useRef(0);

  useEffect(() => {
    fetchNodeDefinitions().then(setNodeDefinitions).catch(() => {});
  }, []);

  const stripAssistantOverlay = (sourceNodes: FlowNode[], sourceEdges: FlowEdge[]) => ({
    nodes: sourceNodes
      .filter((node) => !node.data?.assistantGhost)
      .map((node) => ({
        ...node,
        data: {
          ...node.data,
          assistantHighlight: undefined,
          assistantDiff: undefined,
          assistantGhost: undefined,
        },
      })),
    edges: sourceEdges.filter((edge) => !(edge.data as any)?.assistantPreview),
  });

  const resolveOutputs = (source: FlowNode[]): FlowNode[] =>
    source.map((node) => ({
      ...node,
      data: {
        ...node.data,
        outputs: extractNodeOutputs({
          definitionType: node.data?.definitionType,
          outputs: node.data?.definitionOutputs?.length
            ? node.data.definitionOutputs
            : node.data?.outputs || [],
          config: node.data?.config || {},
          inputs: node.data?.inputs || [],
        }),
      },
    }));

  const handleFocusBlock = (ids: string[], opts?: { pan?: boolean }) => {
    const present = ids.filter((id) => nodesRef.current.some((node) => node.id === id));
    if (present.length === 0) return;
    const token = ++highlightTokenRef.current;
    setNodes((prev) =>
      prev.map((node) => ({
        ...node,
        selected: opts?.pan === false ? node.selected : present.includes(node.id),
        data: {
          ...node.data,
          assistantHighlight: present.includes(node.id)
            ? true
            : opts?.pan === false
              ? node.data?.assistantHighlight
              : undefined,
        },
      })),
    );
    window.setTimeout(() => {
      if (highlightTokenRef.current !== token) return;
      setNodes((prev) =>
        prev.map((node) => ({
          ...node,
          data: { ...node.data, assistantHighlight: undefined },
        })),
      );
    }, 4000);
  };

  const handlePreviewOperations = (ops: FlowOperation[] | null) => {
    if (!ops) {
      const base = previewBaseRef.current;
      if (!base) return;
      previewBaseRef.current = null;
      nodesRef.current = base.nodes;
      edgesRef.current = base.edges;
      setNodes(base.nodes);
      setEdges(base.edges);
      return;
    }

    if (!previewBaseRef.current) {
      previewBaseRef.current = stripAssistantOverlay(nodesRef.current, edgesRef.current);
    }
    const base = previewBaseRef.current;
    const preview = previewFlowOperations(base.nodes, base.edges, ops, definitionsRef.current);
    nodesRef.current = preview.nodes as FlowNode[];
    edgesRef.current = preview.edges as FlowEdge[];
    setNodes(preview.nodes as FlowNode[]);
    setEdges(preview.edges as FlowEdge[]);
  };

  const handleApplyOperations = (ops: FlowOperation[]) => {
    const base = previewBaseRef.current || stripAssistantOverlay(nodesRef.current, edgesRef.current);
    assistantUndoRef.current = base;
    previewBaseRef.current = null;
    const applied = applyFlowOperations(base.nodes, base.edges, ops, definitionsRef.current);
    const resolved = resolveOutputs(applied.nodes as FlowNode[]);
    nodesRef.current = resolved;
    edgesRef.current = applied.edges as FlowEdge[];
    setNodes(resolved);
    setEdges(applied.edges as FlowEdge[]);
    setIsDirty(true);
    showToast('Applied the assistant edit', 'success');
  };

  const handleUndoAssistant = () => {
    const snap = assistantUndoRef.current;
    if (!snap) return;
    assistantUndoRef.current = null;
    previewBaseRef.current = null;
    nodesRef.current = snap.nodes;
    edgesRef.current = snap.edges;
    setNodes(snap.nodes);
    setEdges(snap.edges);
    setIsDirty(true);
    showToast('Undid the assistant change');
  };

  const handleApplyAssistantGraph = (newGraph: { blocks: any[]; connections: any[] }) => {
    if (!newGraph.blocks || newGraph.blocks.length === 0) return;
    const base = stripAssistantOverlay(nodesRef.current, edgesRef.current);
    assistantUndoRef.current = base;
    previewBaseRef.current = null;

    const updatedNodes: FlowNode[] = newGraph.blocks.map((block, idx) => {
      const existing = base.nodes.find((node) => node.id === block.id);
      const definition = definitionsRef.current.find((item) => item.type === block.kind);
      const definitionOutputs = definition?.outputs?.length
        ? definition.outputs
        : block.kind === 'condition'
          ? [
              { name: 'true', label: 'True', type: 'branch' },
              { name: 'false', label: 'False', type: 'branch' },
            ]
          : [{ name: 'done', label: 'Done', type: 'default' }];

      return {
        id: block.id,
        type: 'langgraphNode',
        position: existing?.position || { x: 320, y: 100 + idx * 160 },
        data: {
          ...(existing?.data || {}),
          name: block.name || existing?.data?.name || block.id,
          label: block.label || block.name || existing?.data?.label || block.id,
          nodeName: block.name || existing?.data?.nodeName || block.id,
          definitionId: definition?.id || block.kind,
          definitionType: block.kind,
          definitionName: definition?.name || block.name || block.kind,
          config: block.config || {},
          inputs: definition?.inputs || existing?.data?.inputs || [],
          definitionOutputs,
          outputs: definitionOutputs,
          actionDefinitions: definition?.actionDefinitions || existing?.data?.actionDefinitions || [],
          assistantHighlight: undefined,
          assistantDiff: undefined,
          assistantGhost: undefined,
        },
      };
    });

    const updatedEdges: FlowEdge[] = (newGraph.connections || []).map((connection, idx) => ({
      id: connection.id || `e-${connection.from}-${connection.to}-${idx}`,
      source: connection.from,
      target: connection.to,
      sourceHandle: connection.output || 'done',
      targetHandle: connection.input || 'in',
      type: 'default',
    }));

    const resolved = resolveOutputs(updatedNodes);
    nodesRef.current = resolved;
    edgesRef.current = updatedEdges;
    setNodes(resolved);
    setEdges(updatedEdges);
    setIsDirty(true);
    showToast('Assistant updated the flow!', 'success');
  };

  return (
    <div className="app-container">
      <AppNav boardHref={graphId ? `/flow/${encodeURIComponent(graphId)}` : '/'} />
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
        assistantOpen={isAssistantOpen}
        onToggleAssistant={() => setIsAssistantOpen((open) => !open)}
        onNameChange={(name) => {
          setGraphName(name);
          setIsDirty(true);
        }}
      />

      <main className="main-content" style={{ position: 'relative', display: 'flex' }}>
        {addTarget && <LeftPanel onAddNode={handleAddNode} />}
        {(() => {
          const listFlow = {
            version: 1,
            blocks: nodes
              .filter((node) => !node.data?.assistantGhost)
              .map((n) => ({
                id: n.id,
                kind: n.data?.definitionType || n.type || 'unknown',
                name: n.data?.name || n.id,
                label: n.data?.label || n.data?.name || n.id,
                config: n.data?.config || {},
                events: (n.data?.outputs || []).filter((output) => output.type === 'branch'),
              })),
            connections: edges
              .filter((edge) => !(edge.data as any)?.assistantPreview)
              .map((e) => ({
                id: e.id,
                from: e.source,
                to: e.target,
                output: e.sourceHandle || undefined,
                input: e.targetHandle || undefined,
              })),
          };
          const listRunStatuses: Record<string, any> = {};
          if (activeRunResult?.nodes) {
            for (const rn of activeRunResult.nodes) {
              listRunStatuses[rn.nodeId] = rn.status;
            }
          }
          return (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
              <FlowListView
                flow={listFlow}
                graphName={graphName}
                runStatuses={listRunStatuses}
                onNodeClick={(blockId) => {
                  const node = nodes.find((n) => n.id === blockId);
                  if (node) handleNodeSelect(node);
                }}
                onAddStep={handleRequestAddStep}
                onDeleteStep={(blockId) => {
                  setNodes((prev) => prev.filter((n) => n.id !== blockId));
                  setEdges((prev) => prev.filter((e) => e.source !== blockId && e.target !== blockId));
                  setIsDirty(true);
                }}
                onDuplicateStep={(blockId) => {
                  const node = nodes.find((n) => n.id === blockId);
                  if (!node) return;
                  const newId = `${blockId}-copy-${Date.now()}`;
                  setNodes((prev) => [...prev, { ...node, id: newId, selected: false }]);
                  setIsDirty(true);
                }}
              />
              <BoardRightToolbar nodes={nodes} graphId={graphId} />
            </div>
          );
        })()}

        <style>{`
          @keyframes assistantPulse {
            0%, 100% { box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.55); }
            50% { box-shadow: 0 0 0 10px rgba(129, 140, 248, 0.08); }
          }
        `}</style>

        {/* ── Flow Assistant chatbot panel ── */}
        {isAssistantOpen && (
          <FlowAssistantPanel
            graphName={graphName}
            activeProjectId={activeProjectId}
            onOpenSettings={() => setIsSettingsModalOpen(true)}
            selectedBlockIds={nodes
              .filter((node) => node.selected && !node.data?.assistantGhost)
              .map((node) => node.id)}
            currentGraph={{
              blocks: nodes
                .filter((node) => !node.data?.assistantGhost)
                .map((n) => ({
                  id: n.id,
                  kind: n.data?.definitionType || n.type || 'unknown',
                  name: n.data?.name || n.id,
                  label: n.data?.label || n.data?.name || n.id,
                  config: n.data?.config || {},
                  events: (n.data?.outputs || []).filter((output) => output.type === 'branch'),
                })),
              connections: edges
                .filter((edge) => !(edge.data as any)?.assistantPreview)
                .map((e) => ({
                  id: e.id,
                  from: e.source,
                  to: e.target,
                  output: e.sourceHandle || undefined,
                  input: e.targetHandle || undefined,
                })),
            }}
            onApplyGraph={handleApplyAssistantGraph}
            onFocusBlock={handleFocusBlock}
            onPreviewOperations={handlePreviewOperations}
            onApplyOperations={handleApplyOperations}
            onUndoAssistant={handleUndoAssistant}
            onClose={() => setIsAssistantOpen(false)}
          />
        )}

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
        projectId={activeProjectId}
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
  return <FlowStudioInner initialFlowId={initialFlowId} />;
}
