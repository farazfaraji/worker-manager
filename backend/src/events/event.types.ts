export type EventOrigin = 'flow' | 'api' | 'user' | 'system';

export type EventAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'approve'
  | 'archive'
  | 'action'
  | 'relation.add'
  | 'relation.remove';

export interface EventSource {
  origin: EventOrigin;
  runId?: string;
  nodeId?: string;
  userId?: string;
  sourceEventId?: string;
  rootRunId?: string;
  propagationRunId?: string;
  propagationDepth?: number;
  visitedArtifactLogicalIds?: string[];
  metadata?: Record<string, any>;
}

export interface AppEvent<T = any> {
  id: string;
  topic: string;
  entityName: string;
  entityId: string;
  eventType: EventAction;
  timestamp: string;
  projectId?: string;
  source: EventSource;
  data: T;
  sourceEventId?: string;
  rootRunId?: string;
  propagationRunId?: string;
  propagationDepth?: number;
  visitedArtifactLogicalIds?: string[];
}

export interface CreateAppEventInput<T = any> {
  topic: string;
  entityName: string;
  entityId: string;
  eventType: EventAction;
  projectId?: string;
  source?: Partial<EventSource>;
  data: T;
  sourceEventId?: string;
  rootRunId?: string;
  propagationRunId?: string;
  propagationDepth?: number;
  visitedArtifactLogicalIds?: string[];
}

// -------------------------------------------------------------
// Artifact Type-Safe Event Payloads
// -------------------------------------------------------------

export interface ArtifactCreateEventData {
  artifactId: string;
  logicalId: string;
  rootArtifactId: string;
  isLatest: boolean;
  contentHash: string;
  schemaVersion: number;
  title: string;
  type: string;
  format: string;
  version: number;
  content: any;
  keywords: string[];
  status: string;
  projectId?: string;
  parentArtifactId?: string;
  metadata?: Record<string, any>;
}

export interface ArtifactUpdateEventData {
  artifactId: string;
  logicalId: string;
  rootArtifactId: string;
  isLatest: boolean;
  contentHash: string;
  schemaVersion: number;
  version: number;
  parentArtifactId?: string;
  changedKeys: string[];
  previous: {
    version: number;
    title: string;
    content: any;
    status: string;
    keywords?: string[];
  };
  current: {
    version: number;
    title: string;
    content: any;
    status: string;
    keywords?: string[];
  };
  fileChanges?: {
    diff?: any;
    changedKeys?: string[];
  };
}

export interface ArtifactDeleteEventData {
  artifactId: string;
  deletedAt: string;
}

export interface ArtifactApproveEventData {
  artifactId: string;
  version: number;
  status: 'approved';
  metadata?: Record<string, any>;
}

export interface ArtifactArchiveEventData {
  artifactId: string;
  version: number;
  status: 'archived';
}

export interface ArtifactRelationAddedEventData {
  relationId: string;
  projectId?: string;
  sourceLogicalId: string;
  targetLogicalId: string;
  relationType: string;
  inverseType: string;
  metadata?: Record<string, any>;
}

export interface ArtifactRelationRemovedEventData {
  relationId: string;
  projectId?: string;
  sourceLogicalId: string;
  targetLogicalId: string;
  relationType: string;
  inverseType: string;
  metadata?: Record<string, any>;
}

export type ArtifactEvent =
  | (AppEvent<ArtifactCreateEventData> & { topic: 'artifact.create'; eventType: 'create' })
  | (AppEvent<ArtifactUpdateEventData> & { topic: 'artifact.update'; eventType: 'update' })
  | (AppEvent<ArtifactDeleteEventData> & { topic: 'artifact.delete'; eventType: 'delete' })
  | (AppEvent<ArtifactApproveEventData> & { topic: 'artifact.approve'; eventType: 'approve' })
  | (AppEvent<ArtifactArchiveEventData> & { topic: 'artifact.archive'; eventType: 'archive' })
  | (AppEvent<ArtifactRelationAddedEventData> & { topic: 'artifact.relation.added'; eventType: 'relation.add' })
  | (AppEvent<ArtifactRelationRemovedEventData> & { topic: 'artifact.relation.removed'; eventType: 'relation.remove' });
