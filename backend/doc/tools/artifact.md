# Artifact Tool Documentation & Usage Guide

The **Artifact** node provides durable persistence, versioning, lineage tracking, diffing, and lifecycle management for documents, specifications, PRDs, code files, and human review decisions across your workflows. Every change to an artifact automatically emits type-safe domain events into the **Event Engine**, allowing downstream flows to reactively trigger upon document updates.

---

## Table of Contents
1. [Overview & Architecture](#1-overview--architecture)
2. [Logical Identity & Immutability](#2-logical-identity--immutability)
3. [Typed Bidirectional Relations](#3-typed-bidirectional-relations)
4. [Operations & Configuration](#4-operations--configuration)
5. [Event Engine Integration & Lifecycle Events](#5-event-engine-integration--lifecycle-events)
6. [Binding Upstream Variables](#6-binding-upstream-variables)
7. [Operation-Specific Output Handles & Variables](#7-operation-specific-output-handles--variables)
8. [REST API Reference](#8-rest-api-reference)
9. [Real-World Recipes](#9-real-world-recipes)

---

## 1. Overview & Architecture

Artifacts are versioned deliverables stored directly in MongoDB:
- **Rich Formats**: Stores **Markdown documents**, **plain text**, **code files**, or structured **JSON objects**.
- **Dual Identity System**:
  - `logicalId`: The stable identity across all revisions of the conceptual deliverable (e.g. `customer-portal-prd`).
  - `artifactId`: The unique physical identifier for each specific revision version.
- **Deterministic Content Hashing**: Uses SHA-256 with recursive deterministic JSON key canonicalization to guarantee content integrity and detect no-op updates.
- **No-Op Update Prevention**: If an update does not materially modify content or metadata, version bumping is prevented and `changed: false` is returned without polluting event streams.
- **Typed Bidirectional Relations**: Relationships between artifacts (`refines`, `depends-on`, `has-techspec`, etc.) are maintained in a dedicated `artifact_relations` graph with automated inverse record maintenance.
- **Project Partitioning (`projectId`)**: Every artifact is strictly owned by a parent project (`projectId: string`). Querying, diffing, listing, and relation mapping operate within the project boundary, ensuring strict multi-tenant asset isolation across workspaces.
- **Vector-Ready Indexing**: Automatically synchronizes text chunks (max 400 words, 50-word overlap) with semantic vector stores, defaulting to latest versions.

---

## 2. Logical Identity & Immutability

```
Logical Artifact ("logicalId: auth-spec", "rootArtifactId: doc-1")
 ├── v1: artifactId="doc-1", isLatest=false, contentHash="a1b2..."
 ├── v2: artifactId="doc-2", parent="doc-1", isLatest=false, contentHash="c3d4..."
 └── v3: artifactId="doc-3", parent="doc-2", isLatest=true,  contentHash="e5f6..."
```

- When creating an artifact, if `logicalId` is not explicitly provided, it defaults to the provided `artifactId` or is generated from `${type}-${UUID}`.
- If an existing `logicalId` is used during a `create` operation, a **Conflict** (`409 ConflictException`) is thrown to protect against accidental overwrites.
- Updating an artifact atomically marks older versions as `isLatest: false`, assigns a new unique `artifactId`, bumps the version, and preserves both `logicalId` and `rootArtifactId` inside a MongoDB transaction.

---

## 3. Typed Bidirectional Relations

Relations connect logical artifacts with explicit semantic meaning. Adding a relation automatically creates both directions:

| Relation Type | Inverse Type | Use Case |
| :--- | :--- | :--- |
| `refines` | `refined-by` | High-level PRD to detailed breakdown |
| `has-techspec` | `techspec-for` | Connect PRD to its technical architecture specification |
| `decomposes-to` | `decomposed-from` | Epic or spec decomposing into tasks |
| `depends-on` | `required-by` | Task or service dependency |
| `constrains` | `constrained-by` | Security policy or architectural guideline |
| `derived-from` | `source-of` | Transcribed notes or generated summaries |
| `conflicts-with` | `conflicts-with` | Competing proposals or contradictory constraints |
| `relates-to` | `relates-to` | General cross-link (default legacy bridge) |

---

## 4. Operations & Configuration

| Operation | Purpose | Key Inputs | Output Highlights |
| :--- | :--- | :--- | :--- |
| `create` | Store a new durable artifact | `content`, `logicalId`, `title`, `type`, `format`, `projectId` | `artifactId`, `logicalId`, `rootArtifactId`, `projectId`, `version: 1` |
| `get` | Fetch exact artifact or latest by logicalId / pattern | `artifactId` / `logicalId`, `projectId` | `artifact`, `isLatest`, `contentHash`, `projectId` |
| `getLatest` | Fetch latest version of a logical artifact | `logicalId`, `projectId` | `artifact`, `version`, `isLatest: true`, `projectId` |
| `list` | Query and filter artifacts | `projectId`, `latestOnly`, `type`, `status`, `search` | `artifacts`, `count` |
| `listVersions` | List all historical versions for a logical ID | `logicalId`, `projectId` | `versions`, `count` |
| `update` | Create a new linked version with automatic diff | `artifactId` / `logicalId`, `content`, `projectId` | `changed`, `version`, `diff`, `projectId` |
| `addRelation` | Add typed bidirectional relation or legacy link | `artifactId` / `logicalId`, `targetLogicalId`, `relationType` | `forward`, `reverse`, `relations` |
| `getRelations` | Retrieve relations for a logical artifact | `logicalId`, `relationDirection` (`both`/`outgoing`/`incoming`) | `relations`, `count` |
| `removeRelation` | Delete relation and its inverse atomically | `relationId` | `success`, `removedCount` |
| `diff` | Compare two versions or artifact IDs | `previous`, `next`, `projectId` | `diff`, `changedKeys` |
| `approve` | Change status to approved | `artifactId` / `logicalId`, `metadata`, `projectId` | `artifact`, `status: "approved"` |
| `archive` | Soft-delete / archive | `artifactId` / `logicalId`, `projectId` | `artifact`, `status: "archived"` |

---

## 5. Event Engine Integration & Lifecycle Events

Every lifecycle mutation publishes a structured, CloudEvents-aligned domain event into the **Event Engine**:

| Topic | Event Action | Payload Highlights |
| :--- | :--- | :--- |
| `artifact.create` | `create` | `artifactId`, `logicalId`, `rootArtifactId`, `projectId`, `version: 1`, `contentHash`, `schemaVersion` |
| `artifact.update` | `update` | `artifactId`, `logicalId`, `rootArtifactId`, `projectId`, `version`, `parentArtifactId`, `diff`, `contentHash` |
| `artifact.approve` | `approve` | `artifactId`, `version`, `projectId`, `status: "approved"`, `metadata` |
| `artifact.archive` | `archive` | `artifactId`, `version`, `projectId`, `status: "archived"` |
| `artifact.delete` | `delete` | `artifactId`, `projectId`, `deletedAt` |
| `artifact.relation.added` | `relation.add` | `relationId`, `sourceLogicalId`, `targetLogicalId`, `relationType`, `inverseType` |
| `artifact.relation.removed` | `relation.remove` | `relationId`, `sourceLogicalId`, `targetLogicalId`, `relationType` |

---

## 6. Binding Upstream Variables

To bind content produced by preceding workflow nodes:
1. In the **Content**, **Logical ID**, or **Project ID** field, toggle **"Variable Reference"** mode.
2. Select an upstream node output, e.g. `{{agent_1.result.content}}`, `{{trigger.projectId}}`, or `{{search_node.artifactId}}`.
3. Flow Builder resolves references dynamically at execution time. When executed within a flow, `projectId` automatically defaults to the parent workflow's `projectId`.

---

## 7. Operation-Specific Output Handles & Variables

- **`artifact.artifact`** (`object`): Full artifact document.
- **`artifact.artifactId`** (`string`): Unique physical artifact ID.
- **`artifact.logicalId`** (`string`): Stable logical ID.
- **`artifact.projectId`** (`string`): ID of the project owning this artifact.
- **`artifact.rootArtifactId`** (`string`): Root artifact version ID.
- **`artifact.isLatest`** (`boolean`): Whether this record is the latest version.
- **`artifact.contentHash`** (`string`): SHA-256 content hash.
- **`artifact.changed`** (`boolean`): False if no material change occurred (no-op update).
- **`artifact.versions`** (`array`): Ordered version history for `listVersions`.
- **`artifact.relations`** (`array`): Typed relation records for `getRelations`.

---

## 8. REST API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/artifacts` | `GET` | List artifacts (`?projectId=...&latestOnly=true&type=...&search=...`) |
| `/api/artifacts/:id` | `GET` | Get artifact by version ID or latest by logical ID (`?projectId=...`) |
| `/api/artifacts/:id/versions` | `GET` | List all historical versions for an artifact |
| `/api/artifacts/:id/relations` | `GET` | Get relations (`?direction=both|outgoing|incoming`) |
| `/api/artifacts/:id/relations` | `POST` | Create typed relation or legacy link |
| `/api/artifacts/:id/relations/:relId` | `DELETE` | Delete relation and its inverse |
| `/api/artifacts` | `POST` | Create a new logical artifact (`projectId` required in body) |
| `/api/artifacts/:id` | `PATCH` | Update artifact creating a new immutable version |
| `/api/artifacts/:id/approve` | `POST` | Approve artifact version |
| `/api/artifacts/:id/archive` | `POST` | Archive artifact version |
| `/api/artifacts/:id` | `DELETE` | Permanently delete artifact |

---

## 9. Real-World Recipes

### Recipe 1: Connecting a Tech Spec to a PRD with Typed Relations
- **PRD Node**: Create PRD with `logicalId: "checkout-v2-prd"`.
- **Spec Node**: Create Technical Spec with `logicalId: "checkout-v2-spec"`.
- **Relation Node** (`operation: "addRelation"`):
  - `artifactId`: `"checkout-v2-prd"`
  - `targetLogicalId`: `"checkout-v2-spec"`
  - `relationType`: `"has-techspec"`
  - Result: Creates `"has-techspec"` forward and `"techspec-for"` inverse relation within the same project.

### Recipe 2: Safe No-Op Updates in Scheduled Agent Crawlers
- Agent runs periodic reconciliation comparing code repository specs.
- Node updates artifact with generated markdown.
- If markdown is identical, the system detects `changed: false`, avoids database version explosion, and suppresses noisy `artifact.update` notifications.

### Recipe 3: Multi-Project Asset Isolation
- **Project A** (e.g. `ecommerce-mobile`): Artifacts created here inherit `projectId: "ecommerce-mobile"`.
- **Project B** (e.g. `internal-crm`): Artifacts created here inherit `projectId: "internal-crm"`.
- Document searches (`GET /api/artifacts?projectId=...`) and vector RAG retrieval strictly partition results so Project B agents cannot see or mutate Project A artifacts.
