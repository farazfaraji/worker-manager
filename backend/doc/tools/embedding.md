# Embedding Tool Documentation & Usage Guide

The **Embedding** node converts raw text into dense, high-dimensional vector representations using configured OpenAI-compatible embedding models. These vectors power semantic search, nearest-neighbor matching, document deduplication, and RAG knowledge retrieval.

---

## Table of Contents
1. [Overview & Architecture](#1-overview--architecture)
2. [Node Inputs & Configuration](#2-node-inputs--configuration)
3. [Single Text vs Batch Mode](#3-single-text-vs-batch-mode)
4. [Outputs & Schema](#4-outputs--schema)
5. [Downstream Integration with Retrieval & Memory](#5-downstream-integration-with-retrieval--memory)
6. [Real-World Recipes](#6-real-world-recipes)
7. [Environment & Security Settings](#7-environment--security-settings)

---

## 1. Overview & Architecture

Vector embeddings transform unstructured textual semantics into numerical float arrays where conceptual similarity corresponds to spatial proximity (cosine similarity):
- **Provider Agnostic**: Connects to any OpenAI-compatible `/v1/embeddings` endpoint (OpenAI, Azure, Ollama, vLLM, FastChat).
- **Polymorphic Input**: Seamlessly accepts a single string OR an array of strings in one field. Arrays are automatically vectorized in a single batch network round-trip.
- **Dedicated Output Sockets**: Emits a `result` metadata object, a 1D `embedding` socket (for single query vector), and a 2D `embeddings` socket (for batch vectors).

```mermaid
graph LR
    TextInput[Input Text(s) / Upstream Variable] --> EmbeddingNode[Embedding Node]
    ModelEndpoint[OpenAI-Compatible Embeddings API] <--> EmbeddingNode
    EmbeddingNode --> ResultObj[embedding.result]
    EmbeddingNode --> VectorArray[embedding.embedding - 1D]
    EmbeddingNode --> BatchVectors[embedding.embeddings - 2D]
    VectorArray --> RetrievalNode[Retrieval / Vector Store]
```

---

## 2. Node Inputs & Configuration

| Input Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `text` | `valueOrVariable` | No | `null` | Primary text string or array of strings. If omitted, text is loaded directly from the linked `artifactId`. |
| `artifactId` | `valueOrVariable` | No | `null` | Optional Artifact ID. When supplied, vectors are persisted out-of-band directly to the vector store. |
| `logicalId` | `valueOrVariable` | No | `null` | Optional stable logical artifact ID to track vectors across versions. |
| `embeddingModel` | `select` | Yes | `null` | Target model selected from registered system models (`/api/embedding-models`). |
| `namespace` | `text` | No | `"default"` | Vector namespace for storage and retrieval scoping. |
| `includeRawVectors` | `boolean` | No | `false` | When linked to an artifact, defaults to `false` to prevent graph state bloat. Set `true` if downstream nodes need raw float arrays. |

> [!TIP]
> **State-Bloat Prevention**: Embedding 100 document chunks produces over 1.2 MB of raw float arrays. When `artifactId` or `logicalId` is linked, vectors are stored **out-of-band** in MongoDB `VectorRecord`, and the graph state only retains lightweight metadata (`artifactId`, `logicalId`, `indexedChunks`, `stored: true`).

---

## 3. Single Text vs Batch Mode

The node automatically determines whether to operate in single or batch mode based on the resolved value of `text`:

### Single Text Mode
When `text` resolves to a string (e.g., `"What is quantum computing?"` or `{{trigger.input.userQuery}}`):
- Vectorizes the single string.
- Populates `result.embedding` and the direct Canvas output socket `embedding` with the 1D numeric vector.
- Populates `result.embeddings` with `[ [ ... ] ]`.

```json
{
  "text": "{{trigger.input.userQuery}}",
  "embeddingModel": "text-embedding-3-small"
}
```

### Batch Mode
When `text` resolves to an array of strings (e.g., `{{nodes.textSplitter.chunks}}` or a JSON string array):
- Dispatches all texts in a single batch API request.
- Preserves input order in `result.embeddings` and the Canvas socket `embeddings`.
- Ideal for chunked documents, scraped web pages, or bulk indexing.

```json
{
  "text": "{{nodes.doc_chunker.chunks}}",
  "embeddingModel": "text-embedding-3-small"
}
```

---

## 4. Outputs & Schema

The node provides three output handles:

### 1. `result` (`object`)
Contains full metadata including model name, embedding dimensionality, and all generated vectors:

```json
{
  "status": "completed",
  "result": {
    "model": "text-embedding-3-small",
    "dimensions": 1536,
    "embeddings": [
      [-0.0124, 0.0482, -0.0091, 0.0135, "..."]
    ],
    "embedding": [-0.0124, 0.0482, -0.0091, 0.0135, "..."]
  }
}
```

### 2. `embedding` (`array`)
1D array of floating-point numbers for single input text (e.g. `[ -0.0124, 0.0482, ... ]`), wired directly to the Query Embedding socket of a **Retrieval** node.

### 3. `embeddings` (`array`)
2D array of vectors (`[ [ ... ], [ ... ] ]`) containing embeddings for each item in batch inputs, wired directly to bulk indexing nodes or vector storage.

---

## 5. Downstream Integration with Retrieval & Memory

To implement a Retrieval-Augmented Generation (RAG) pipeline:
1. **Trigger / User Input**: Receives raw search question.
2. **Embedding Node**: Transforms query string into dense vector.
3. **Retrieval Node**: Takes `{{nodes.embedding_1.embedding}}` as input and performs cosine similarity search against indexed vector records.
4. **Agent Node**: Injects top retrieved records as context into prompt.

---

## 6. Real-World Recipes

### Recipe: Vectorizing User Search Query for Vector Store Lookup
Wire user search input through embedding into knowledge search:

```json
{
  "text": "{{trigger.input.searchQuery}}",
  "embeddingModel": "text-embedding-3-small"
}
```

In the downstream Retrieval node:
```json
{
  "operation": "search",
  "embedding": "{{nodes.embedding_1.embedding}}",
  "namespace": "knowledge-base",
  "limit": 5
}
```

---

## 7. Environment & Security Settings

The embedding service uses the following server configurations:
- `EMBEDDING_ENDPOINT`: Base URL of the embedding API (defaults to OpenAI `/v1/embeddings`).
- `EMBEDDING_API_KEY`: Authentication Bearer token.
- `EMBEDDING_ALLOW_EXTERNAL`: Set to `"true"` to permit outbound embedding requests to external hosts; if set to `"false"`, only local endpoints (`localhost`, `127.0.0.1`) are allowed.
