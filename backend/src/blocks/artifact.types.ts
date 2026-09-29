/**
 * Canonical Artifact Types and Interfaces for Flow Builder Artifact Foundation
 */

export type CanonicalArtifactType =
  | 'high-level'
  | 'prd'
  | 'tech-spec'
  | 'task'
  | 'decision'
  | 'change'
  | 'document'
  | 'code';

export type ArtifactType = CanonicalArtifactType | (string & {});

export type ArtifactStatus = 'draft' | 'in-review' | 'approved' | 'rejected' | 'archived';

export type ArtifactContentFormat = 'markdown' | 'text' | 'json' | 'code' | (string & {});

export type ArtifactIfExists = 'error' | 'return' | 'update';

export type ArtifactRelationType =
  | 'refines'
  | 'refined-by'
  | 'has-techspec'
  | 'techspec-for'
  | 'decomposes-to'
  | 'decomposed-from'
  | 'depends-on'
  | 'required-by'
  | 'constrains'
  | 'constrained-by'
  | 'derived-from'
  | 'source-of'
  | 'conflicts-with'
  | 'relates-to';

export type ArtifactRelationStatus = 'active' | 'archived' | (string & {});

export const RELATION_INVERSE_MAP: Record<ArtifactRelationType, ArtifactRelationType> = {
  'refines': 'refined-by',
  'refined-by': 'refines',
  'has-techspec': 'techspec-for',
  'techspec-for': 'has-techspec',
  'decomposes-to': 'decomposed-from',
  'decomposed-from': 'decomposes-to',
  'depends-on': 'required-by',
  'required-by': 'depends-on',
  'constrains': 'constrained-by',
  'constrained-by': 'constrains',
  'derived-from': 'source-of',
  'source-of': 'derived-from',
  'conflicts-with': 'conflicts-with',
  'relates-to': 'relates-to',
};

export interface ArtifactVersion {
  artifactId: string;
  logicalId: string;
  rootArtifactId: string;
  projectId?: string;
  type: ArtifactType;
  category: string;
  tags: string[];
  format: ArtifactContentFormat;
  language?: string;
  title: string;
  content: any;
  status: ArtifactStatus;
  version: number;
  isLatest: boolean;
  contentHash: string;
  schemaVersion: number;
  parentArtifactId?: string;
  author?: string;
  changeSummary?: string;
  idempotencyKey?: string;
  sourceEventIds?: string[];
  metadata?: Record<string, any>;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  changed?: boolean;
  created?: boolean;
}

export interface ArtifactRelation {
  relationId: string;
  projectId?: string;
  sourceLogicalId: string;
  targetLogicalId: string;
  type: ArtifactRelationType;
  inverseType: ArtifactRelationType;
  status: ArtifactRelationStatus;
  metadata?: Record<string, any>;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface ArtifactCreateInput {
  logicalId?: string;
  projectId?: string;
  type?: ArtifactType;
  category?: string;
  tags?: string | string[];
  format?: ArtifactContentFormat;
  language?: string;
  title?: string;
  content?: any;
  value?: any;
  input?: any;
  schemaVersion?: number;
  metadata?: Record<string, any>;
  author?: string;
  changeSummary?: string;
  idempotencyKey?: string;
  ifExists?: ArtifactIfExists;
  sourceEventIds?: string[];
  source?: any;
  runId?: string;
  nodeId?: string;
}

export interface ArtifactUpdateInput {
  logicalId?: string;
  projectId?: string;
  type?: ArtifactType;
  category?: string;
  tags?: string | string[];
  format?: ArtifactContentFormat;
  language?: string;
  title?: string;
  content?: any;
  value?: any;
  schemaVersion?: number;
  metadata?: Record<string, any>;
  author?: string;
  changeSummary?: string;
  expectedVersion?: number;
  idempotencyKey?: string;
  sourceEventIds?: string[];
  source?: any;
  runId?: string;
  nodeId?: string;
}

export interface ArtifactListQuery {
  projectId?: string;
  type?: string;
  filterType?: string;
  category?: string;
  filterCategory?: string;
  status?: string;
  filterStatus?: string;
  tags?: string | string[];
  filterTags?: string | string[];
  query?: string;
  search?: string;
  logicalId?: string;
  latestOnly?: boolean;
  includeContent?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: 'updatedAt' | 'createdAt' | 'title' | 'version';
  sortOrder?: 'asc' | 'desc';
  createdAfter?: string;
  updatedAfter?: string;
}

export interface ArtifactRelationInput {
  targetLogicalId: string;
  relationType: ArtifactRelationType;
  projectId?: string;
  metadata?: Record<string, any>;
  source?: any;
}

export interface ArtifactListResult {
  artifacts: ArtifactVersion[];
  count: number;
  total: number;
}
