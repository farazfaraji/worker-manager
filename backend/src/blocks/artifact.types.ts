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

export type ArtifactStatus = 'draft' | 'approved' | 'archived' | (string & {});

export type ArtifactContentFormat = 'markdown' | 'text' | 'json' | 'code' | (string & {});

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

export interface ArtifactIdentity {
  logicalId: string;
  rootArtifactId: string;
  artifactId: string;
  version: number;
  isLatest: boolean;
  contentHash: string;
  schemaVersion: number;
}

export interface ArtifactVersion {
  artifactId: string;
  logicalId: string;
  rootArtifactId: string;
  projectId?: string;
  type: ArtifactType;
  format: ArtifactContentFormat;
  title: string;
  content: any;
  status: ArtifactStatus;
  version: number;
  isLatest: boolean;
  contentHash: string;
  schemaVersion: number;
  parentArtifactId?: string;
  keyword?: string[];
  keywords?: string[];
  linkedArtifactIds?: string[];
  sourceEventIds?: string[];
  metadata?: Record<string, any>;
  createdAt?: string | Date;
  updatedAt?: string | Date;
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
  artifactId?: string;
  idPrefix?: string;
  projectId?: string;
  type?: ArtifactType;
  format?: ArtifactContentFormat;
  title?: string;
  content?: any;
  value?: any;
  input?: any;
  keyword?: string | string[];
  keywords?: string | string[];
  status?: ArtifactStatus;
  schemaVersion?: number;
  metadata?: Record<string, any>;
  linkedArtifactIds?: string | string[];
  relations?: string | string[];
  linkedArtifactId?: string | string[];
  parentArtifactId?: string;
  sourceEventIds?: string[];
  source?: any;
  runId?: string;
  nodeId?: string;
}

export interface ArtifactUpdateInput {
  logicalId?: string;
  artifactId?: string;
  projectId?: string;
  type?: ArtifactType;
  format?: ArtifactContentFormat;
  title?: string;
  content?: any;
  value?: any;
  keyword?: string | string[];
  keywords?: string | string[];
  status?: ArtifactStatus;
  schemaVersion?: number;
  metadata?: Record<string, any>;
  linkedArtifactIds?: string | string[];
  relations?: string | string[];
  sourceEventIds?: string[];
  source?: any;
  runId?: string;
  nodeId?: string;
}

export interface ArtifactListQuery {
  projectId?: string;
  type?: string;
  status?: string;
  search?: string;
  keyword?: string;
  artifactId?: string;
  logicalId?: string;
  latestOnly?: boolean;
  limit?: number;
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
  artifact: ArtifactVersion | null;
  artifactId: string;
}
