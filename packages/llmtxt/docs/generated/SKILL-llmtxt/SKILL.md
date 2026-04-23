---
name: SKILL-llmtxt
description: >
  Primitives and SDK for LLM agent content workflows: compression, patching, progressive disclosure, signed URLs, collaborative document lifecycle, and retrieval planning Use when: (1) running llmtxt CLI commands, (2) calling its 173 API functions, (3) configuring llmtxt, (4) understanding its 282 type definitions, (5) working with its 39 classes, (6) user mentions "llm", "agent", "compression", "content", "patch", (7) user mentions "llmtxt" or asks about its API.
---

# llmtxt

Primitives and SDK for LLM agent content workflows: compression, patching, progressive disclosure, signed URLs, collaborative document lifecycle, and retrieval planning

## Quick Start

```bash
npm install -D llmtxt
```

```bash
npx llmtxt --help
```

## API

| Function | Description |
|----------|-------------|
| `setLocalAwarenessState()` | Set the local agent's awareness state on a WebSocket connection. Encodes the state and sends it to the server (which relays to peers). |
| `onAwarenessChange()` | Subscribe to awareness state changes on a WebSocket connection. The callback is invoked with the full current state map whenever a peer's awareness changes. |
| `getAwarenessStates()` | Get the current awareness states for all known clients on a connection. |
| `classifyContent()` | Classify the content of `input` using a three-layer pipeline: magic-byte detection → text/binary gate → heuristic text analysis.  All classification logic runs in Rust WASM (SSoT: `crates/llmtxt-core/src/classify/`). This function is a thin adapter that normalises inputs and maps enum variants. |
| `detectFormatFromClassification()` | Map a `ClassificationResult` to the legacy four-value format string.  Used internally by the `detectDocumentFormat` back-compat reroute (T828). External callers should use `classifyContent` directly for new code. |
| `compress()` | Compress a UTF-8 string using zstd (RFC 8478), level 3.  New writes use zstd. Existing zlib-compressed rows are still readable via `decompress`, which detects the codec by magic bytes.  Delegates to crates/llmtxt-core::compress (Rust WASM). |
| `decompress()` | Decompress bytes back to a UTF-8 string.  Auto-detects codec by magic bytes: - `0xFD 0x2F 0xB5 0x28` → zstd (new writes) - `0x78 __` → zlib/deflate (legacy rows — backward compatible)  Delegates to crates/llmtxt-core::decompress (Rust WASM). |
| `zstdCompressBytes()` | Compress raw bytes using zstd, returning compressed bytes.  Use this for binary payloads (blobs, CRDT snapshots) where the input is not a UTF-8 string. Delegates to crates/llmtxt-core::zstd_compress_bytes. |
| `zstdDecompressBytes()` | Decompress raw zstd bytes back to raw bytes.  Delegates to crates/llmtxt-core::zstd_decompress_bytes. |
| `encodeBase62()` |  |
| `decodeBase62()` |  |
| `generateId()` |  |
| `hashContent()` |  |
| `hashBlob()` | Compute SHA-256 hash of raw binary data. Returns a lowercase hex string (64 characters).  Use this for blob content-addressing — mirrors crates/llmtxt-core::hash_blob. Prefer this over node:crypto createHash (SSOT rule — see docs/SSOT.md). |
| `calculateTokens()` |  |
| ... | 158 more — see API reference |

## Configuration

```typescript
import type { LlmtxtClientConfig } from "llmtxt";

const config: Partial<LlmtxtClientConfig> = {
  apiBase: "...",
  apiKey: "...",
  agentId: "...",
};
```

See [references/CONFIGURATION.md](references/CONFIGURATION.md) for full details.

## Gotchas

- `classifyContent()` throws: Error if the WASM module returns a serialization error (should not occur   in practice — the Rust code catches all errors and returns a valid JSON string).
- `multiWayDiff()` throws: Error if the Rust core returns an error object.
- `cherryPickMerge()` throws: Error if the Rust core returns an error object.
- `threeWayMerge()` throws: Error if the Rust core returns an error object.
- `semanticDiff()` throws: Error if the Rust core returns an error object.
- `semanticConsensus()` throws: Error if the Rust core returns an error object.
- `buildGraph()` throws: Error if the Rust core returns an error.
- `generateOverview()` throws: Error if the Rust core returns an error object.
- `getLineRange()` throws: Error if the Rust core returns an error object.
- `searchContent()` throws: Error if the Rust core returns an error object.
- `queryJsonPath()` throws: Error if path resolution fails.
- `reconstructVersion()` throws: If a patch in the sequence fails to apply.
- `validateTopologyConfig()` throws: `TopologyConfigError`   - `INVALID_TOPOLOGY_MODE` — topology field is not a recognized value.   - `MISSING_HUB_URL` — hub-spoke topology missing `hubUrl`.   - `MISSING_STORAGE_PATH_PERSIST` — hub-spoke with persistLocally=true missing `storagePath`.   - `MISSING_STORAGE_PATH_MESH` — mesh topology missing `storagePath`.
- `serializeDocument()` throws: ExportError with code 'UNSUPPORTED_FORMAT' for unknown formats.
- `writeExportFile()` throws: ExportError on write or sign failure.
- `parseImportFile()` throws: ExportError PARSE_FAILED on I/O or parse errors.
- `parseImportFile()` throws: ExportError HASH_MISMATCH when frontmatter content_hash does not   match the actual body SHA-256.
- `validateBlobName()` throws: `BlobNameInvalidError` on violation
- `createBackend()` throws: `TopologyConfigError` when config is invalid.

## Key Types

- **`AwarenessState`** — Presence state for a single agent.
- **`AwarenessEventType`** — Events emitted when awareness state changes.
- **`AwarenessEvent`**
- **`Unsubscribe`** — Unsubscribe function returned by onAwarenessChange.
- **`CacheStats`** — Snapshot of cache performance statistics.
- **`LRUCacheOptions`** — Configuration options for constructing an `LRUCache` instance.
- **`LRUCache`** — Generic least-recently-used (LRU) cache with time-to-live support.
- **`ClassificationResult`** — Result of `classifyContent`.  Mirrors `ClassificationResult` from `crates/llmtxt-core/src/classify/types.rs`.
- **`Section`** — A logical section identified within a document.
- **`DocumentOverview`** — High-level structural overview of a document.

## References

- [references/CONFIGURATION.md](references/CONFIGURATION.md) — Full config options
- [references/API-REFERENCE.md](references/API-REFERENCE.md) — Signatures, parameters, examples
