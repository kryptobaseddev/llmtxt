# llmtxt

[![v2026.4.13](https://img.shields.io/badge/version-2026.4.13-blue)](https://www.npmjs.com/package/llmtxt)

Primitives and SDK for LLM agent content workflows.

`llmtxt` wraps the Rust `llmtxt-core` crate through WASM so TypeScript
consumers use the same single-source-of-truth logic as native Rust consumers.

**New agents start here**: [`https://docs.llmtxt.my/llms-full.txt`](https://docs.llmtxt.my/llms-full.txt) is the one URL to fetch — it covers the whole platform in a single file.

**v2026.4.13**: Multi-modal classification pipeline — `classifyContent()` (TS) and `classify_content()` (Rust) detect 20+ document formats (PDF/PNG/JPEG/JSON/markdown/code/text) via magic-byte + text-gate + heuristic layers. `detectDocumentFormat()` now delegates to the new classifier. WASM binding `classify_content_wasm` exposed.

**v2026.4.12**: `detectDocumentFormat` heading-only short-circuit fix; `multiWayDiff` accepts `string[]` directly (back-compat with JSON-string preserved); `LocalBackend.publishVersion` awaits `indexDocument` so CLI `llmtxt search` returns hits immediately after `llmtxt push-version`. README: new "Choosing the Right Similarity Metric" section disambiguating `contentSimilarity` (char n-gram Jaccard) from `semanticConsensus` (embeddings).

**v2026.4.9**: Shared Primitives Subpath Contract — 7 stable subpaths (`/sdk`, `/crdt`, `/blob`, `/events`, `/identity`, `/transport`, `/similarity`) with contract tests, STABILITY.md, and a CI guard. Also ships: demo harness 8/8, P0 security remediation (10 items), tamper-evident audit log with Merkle chain + RFC 3161, strict release runbook, OpenAPI 3.1, SLO/SLI alerts, CSP/HSTS/COEP, webhook DLQ, PostgreSQL RLS on 21 tenant tables, Ed25519 key rotation + KMS abstraction, anonymous mode threat model, GDPR export/retention/erasure, SOC 2 Type 1 readiness, and monetization foundation (Stripe + Pro tier).

**v2026.4.8** (patch): fixes `import('llmtxt')` triggering `better-sqlite3` / `drizzle-orm` resolution at load time for lightweight consumers (e.g. `generateOverview`).

**v2026.4.7** (patch): bundler-friendly dynamic import of `onnxruntime-node`; `drizzle-orm` / `better-sqlite3` / `postgres` moved from `optionalDependencies` to optional `peerDependencies` so consumers no longer auto-install them. Docs add the required externalize list for esbuild / webpack / vite / rollup.

**v2026.4.6**: Loro CRDT (replaces Yrs — binary-incompatible), AgentSession lifecycle, document export/import (4 formats), binary blob attachments, `createBackend()` topology factory, cr-sqlite changeset sync, P2P mesh, and new CLI commands.

## Install

```bash
npm install llmtxt
```

All database/embedding drivers are **optional peer dependencies** — install only the ones your topology needs:

| Topology / feature | Extra install |
|---|---|
| `standalone` (local SQLite) | `pnpm add better-sqlite3 drizzle-orm` |
| `hub-spoke` (Postgres hub) | `pnpm add postgres drizzle-orm` |
| `mesh` + cr-sqlite CRR | `pnpm add @vlcn.io/crsqlite` |
| Semantic embeddings | `pnpm add onnxruntime-node` |
| RemoteBackend-only consumer (no local DB) | nothing extra |

## Bundling with esbuild / webpack / vite / rollup

`llmtxt` keeps optional peer deps opaque to static bundler analysis where possible, but deep imports inside `LocalBackend` (drizzle-orm) and native addons (onnxruntime-node) must be marked **external** by consumers who bundle. Minimum external list:

```js
// esbuild
esbuild.build({
  bundle: true,
  platform: 'node',
  external: [
    'onnxruntime-node',          // native .node addon
    'better-sqlite3',            // native .node addon
    '@vlcn.io/crsqlite',         // native extension + ESM-only
    'drizzle-orm',               // transitively pulls mssql, @opentelemetry/api
    'drizzle-orm/*',             // subpath imports
    'postgres',
    'mssql',
    '@opentelemetry/api',
  ],
});
```

Same list works as `externals` in webpack/rollup and `build.rollupOptions.external` in vite. If your deployment does NOT use LocalBackend (e.g. RemoteBackend only), you may also externalize `llmtxt/local`.

## Topology Factory

The entry point for all deployments. Returns a `Backend` configured for the chosen topology.

```ts
import { createBackend } from 'llmtxt';

// Standalone — local SQLite, no network
const backend = await createBackend({ topology: 'standalone', storagePath: './.llmtxt' });

// Hub-spoke — ephemeral worker pointing at shared hub
const backend2 = await createBackend({
  topology: 'hub-spoke',
  hubUrl: 'https://api.llmtxt.my',
  apiKey: process.env.LLMTXT_API_KEY,
});

// Mesh — P2P, no server required
const backend3 = await createBackend({
  topology: 'mesh',
  storagePath: './.llmtxt',
});
```

Note: `createBackend` is `async` (returns `Promise<Backend>`). Always `await` it.

See [docs.llmtxt.my/architecture/topology](https://docs.llmtxt.my/architecture/topology) and [docs/specs/ARCH-T429-hub-spoke-topology.md](../../docs/specs/ARCH-T429-hub-spoke-topology.md).

## AgentSession Lifecycle

Gives every agent an explicit, auditable lifecycle with crash recovery and signed contribution receipts.

```ts
import { AgentSession } from 'llmtxt/sdk';
import type { ContributionReceipt } from 'llmtxt/sdk';

const session = new AgentSession({ backend, agentId: 'agent-1' });
await session.open();   // registers presence, allocates temp .db for LocalBackend sessions

// contribute() returns T (whatever fn returns); receipt is from close()
const doc = await session.contribute(async (b) => {
  const created = await b.createDocument({ title: 'Spec', createdBy: 'agent-1' });
  await b.publishVersion({
    documentId: created.id,
    content: '# Spec',
    patchText: '',
    createdBy: 'agent-1',
    changelog: 'Initial',
  });
  return created;
});

const contributionReceipt: ContributionReceipt = await session.close();
// Releases leases, drains inbox, deletes temp .db, emits signed ContributionReceipt
```

`ContributionReceipt` fields: `sessionId`, `agentId`, `documentIds`, `eventCount`, `sessionDurationMs`, `openedAt`, `closedAt`, `signature` (Ed25519 when RemoteBackend).

See [docs.llmtxt.my/multi-agent/session-lifecycle](https://docs.llmtxt.my/multi-agent/session-lifecycle) and [docs/specs/ARCH-T426-ephemeral-agent-lifecycle.md](../../docs/specs/ARCH-T426-ephemeral-agent-lifecycle.md).

## Document Export / Import

```ts
// Export a document to disk
const result = await backend.exportDocument({
  slug: 'my-spec',
  format: 'markdown',   // 'markdown' | 'json' | 'txt' | 'llmtxt'
  outputPath: './exports/my-spec.md',
  sign: true,           // Ed25519-sign the export manifest
});
// result: { filePath, slug, version, fileHash, byteCount, exportedAt, signatureHex }

// Export all documents
const allResult = await backend.exportAll({ format: 'json', outputDir: './exports/' });

// Import from file — creates doc or appends new version if slug exists
const imported = await backend.importDocument({
  filePath: './exports/my-spec.md',
  importedBy: 'agent-1',
  onConflict: 'new_version',  // 'new_version' | 'create'
});
```

Formats: `markdown` (YAML frontmatter + body), `json` (structured), `txt` (body only), `llmtxt` (round-trippable with chain reference). Output is deterministic: same document state always produces identical file bytes.

See [docs.llmtxt.my/sdk/export-import](https://docs.llmtxt.my/sdk/export-import) and [docs/specs/ARCH-T427-document-export-ssot.md](../../docs/specs/ARCH-T427-document-export-ssot.md).

## Binary Blob Attachments

```ts
import * as fs from 'node:fs';

// Attach a binary file to a document
const attachment = await backend.attachBlob({
  docSlug: 'my-spec',
  name: 'diagram.png',
  data: fs.readFileSync('./diagram.png'),
  contentType: 'image/png',
  uploadedBy: 'agent-1',
});

// Read back — hash verified on every read when includeData=true
const blob = await backend.getBlob('my-spec', 'diagram.png', { includeData: true });

// List attachments (metadata only, no bytes)
const blobs = await backend.listBlobs('my-spec');

// Remove
await backend.detachBlob('my-spec', 'diagram.png', 'agent-1');
```

Blobs are content-addressed (SHA-256). Hash verification is mandatory on read — corrupt bytes are never returned. Max default size: 100 MB. Conflict resolution: Last Write Wins per attachment name.

See [docs.llmtxt.my/sdk/blob-attachments](https://docs.llmtxt.my/sdk/blob-attachments) and [docs/specs/ARCH-T428-binary-blob-attachments.md](../../docs/specs/ARCH-T428-binary-blob-attachments.md).

## cr-sqlite LocalBackend (Changeset Sync)

Install the optional peer dependency to enable changeset-based sync between LocalBackend instances:

```bash
npm install @vlcn.io/crsqlite
```

```ts
import { createBackend } from 'llmtxt';

const backend = await createBackend({
  topology: 'standalone',
  storagePath: './.llmtxt',
  crsqlite: true,   // requires @vlcn.io/crsqlite peer dep
});

// Exchange changesets with another agent
const changes = await backend.getChangesSince({ version: lastSyncVersion });
await otherBackend.applyChanges({ changes });
```

Single-tenant only (one agent per `.db`). Loro CRDT state in the `crdt_state` column is merged at the application level (not via cr-sqlite row merge). See [docs/specs/P2-cr-sqlite.md](../../docs/specs/P2-cr-sqlite.md).

## P2P Mesh

```ts
import { createBackend } from 'llmtxt';

const backend = await createBackend({
  topology: 'mesh',
  storagePath: './.llmtxt',
  peers: ['unix:/tmp/agent-b.sock', 'http://192.168.1.5:7642'],
});
await backend.open();
// Sync engine starts; Ed25519 mutual handshake required for each peer connection
```

See [docs.llmtxt.my/mesh](https://docs.llmtxt.my/mesh) and [docs/specs/P3-p2p-mesh.md](../../docs/specs/P3-p2p-mesh.md).

## Loro CRDT (replaces Yrs)

v2026.4.6 replaced `yrs` with `loro` 1.0 in `crates/llmtxt-core`. The six WASM function names are unchanged (`crdt_new_doc`, `crdt_encode_state_as_update`, `crdt_apply_update`, `crdt_merge_updates`, `crdt_state_vector`, `crdt_diff_update`) but their binary format is incompatible with previous versions.

**Wire protocol change**: 1-byte message prefix `0x01`/`0x02`/`0x03`/`0x04` replaces the y-sync `0x00`/`0x01`/`0x02`/`0x03` framing. Legacy Yjs clients will be rejected.

**Migration**: No data migration path. Drop all `section_crdt_states` and `section_crdt_updates` rows on deploy. See [docs/specs/P1-loro-migration.md](../../docs/specs/P1-loro-migration.md).

## Primitives

```ts
import {
  compress, decompress, generateId, hashContent,
  createPatch, applyPatch, generateSignedUrl,
  multiWayDiff, cherryPickMerge,
} from 'llmtxt';

const compressed = await compress('Hello world');
const text = await decompress(compressed);
const slug = generateId();
const hash = hashContent(text);

const patch = createPatch('hello\n', 'hello world\n');
const rebuilt = applyPatch('hello\n', patch);

// LCS-aligned multi-way diff across agent versions
const diff = multiWayDiff(base, JSON.stringify([v2Content, v3Content, v4Content]));

// Selectively merge sections from different versions
const merged = cherryPickMerge(
  base,
  JSON.stringify([v2Content, v3Content]),
  JSON.stringify([
    { section: 'Introduction', fromVersion: 1 },
    { section: 'API Reference', fromVersion: 2 },
  ])
);
```

## Multi-Modal Document Classification (v2026.4.13+)

`classifyContent` detects 20+ document formats across binary media (PDF, PNG, JPEG, WebP, AVIF, SVG, GIF, MP4, WebM, MP3, WAV, OGG, ZIP) and text (markdown, JSON, JavaScript, TypeScript, Python, Rust, Go, plain text).

### Usage

```ts
import { classifyContent } from 'llmtxt';

// From a file (Node)
const pdfBytes = await fs.readFile('doc.pdf');
const r = classifyContent(pdfBytes);
// → { mimeType: 'application/pdf', category: 'binary', format: 'pdf', confidence: 1.0, isExtractable: true }

// From a string
classifyContent('# Title\n\nbody');
// → { mimeType: 'text/markdown', category: 'text', format: 'markdown', confidence: 0.9, isExtractable: true }

classifyContent('{"key": 1}');
// → { mimeType: 'application/json', category: 'structured', format: 'json', confidence: 1.0, isExtractable: true }
```

### Architecture

Layered detection:

1. **Magic-byte layer** (via [infer](https://crates.io/crates/infer)) — recognizes 13 binary formats by file signature. Confidence 1.0 on match.
2. **Text gate** (via [content_inspector](https://crates.io/crates/content_inspector)) — handles UTF-8 / UTF-16 BOMs; separates text from unidentified binary.
3. **Heuristic layer** — parses text for JSON (via `serde_json`), markdown signals (headings, bullets, links, fenced code), and programming-language markers.

All detection logic lives in Rust (`crates/llmtxt-core/src/classify/`) and runs via WASM from both browsers and Node. The legacy `detectDocumentFormat` string API is preserved — it now delegates to `classifyContent` and maps the richer enum back to `"json" | "markdown" | "code" | "text"` for backward compatibility.

### Confidence semantics

| Confidence | Meaning |
|---|---|
| `1.0` | Magic-byte match (binary) or valid JSON parse |
| `0.8–0.9` | Strong heuristic signal (e.g. markdown heading) |
| `0.5–0.7` | Weak heuristic signal |
| `0.2` | Unknown binary (no magic match, not text) |
| `0.0` | Empty input |

### API reference

```ts
function classifyContent(input: string | Uint8Array | Buffer): ClassificationResult;

interface ClassificationResult {
  mimeType: string;                     // e.g. 'application/pdf'
  category: 'binary' | 'text' | 'structured' | 'unknown';
  format: ContentFormat;                // see type export
  confidence: number;                   // 0.0 – 1.0
  isExtractable: boolean;               // true for text formats
}
```

## Choosing the Right Similarity Metric

LLMtxt provides two distinct families of similarity metrics for different use cases:

| Use case | APIs | How it works | When to use |
|---|---|---|---|
| **Near-duplicate detection, chunk dedup, exact text matching** | `contentSimilarity`, `jaccardSimilarity`, `fingerprintSimilarity`, `textSimilarity`, `minHashFingerprint`, `rankBySimilarity` | Character or word n-gram Jaccard distance. Fast, no embeddings required. High scores only when texts share surface strings. | Finding duplicate chunks, dedup within a document version, or ranked search of exact text variants. |
| **Cross-document semantic comparison, consensus merging, topic-level similarity** | `semanticConsensus`, `semanticDiff`, `cosineSimilarity` | Embedding-based (requires `embed()` pass first). Catches paraphrase and reordering. Slower but understands intent. | Finding "two docs about the same thing, worded differently" or evaluating consensus across reviews with different wording. |

**Rule of thumb**: If you want to find duplicate chunks of text or rank candidates by surface similarity, use `contentSimilarity`. If you want to compare documents that may be reworded or paraphrased but cover the same topics, use embeddings + `cosineSimilarity` or `semanticConsensus`.

**Example**: Two versions of an auth spec worded differently will score ~0.03 with `contentSimilarity` (correct — they don't share surface strings) but should score ~0.80+ with `semanticConsensus` (correct — they discuss the same topic).

## Shared Primitives (v2026.4.9 Subpath Contract)

Seven stable subpaths are now exported under a formal contract with semver-guarded
stability guarantees documented in `STABILITY.md`. All subpaths are tree-shakeable
and independently importable.

| Subpath | Description | Import example |
|---|---|---|
| `llmtxt/blob` | Content-addressed binary blob operations — hash, name-validate, filesystem adapter, P2P changeset | `import { hashBlob, blobNameValidate } from 'llmtxt/blob'` |
| `llmtxt/crdt` | Real-time collaborative editing via Loro CRDT — section subscriptions, state vector exchange, merge | `import { crdtNewDoc, crdtApplyUpdate } from 'llmtxt/crdt'` |
| `llmtxt/events` | Document event bus — subscribe, publish, filter, drain; shared by LocalBackend and PostgresBackend | `import { EventBus, createEventBus } from 'llmtxt/events'` |
| `llmtxt/identity` | Ed25519 agent identity — key generation, request signing, signature verification, canonical payload | `import { AgentIdentity, signRequest } from 'llmtxt/identity'` |
| `llmtxt/sdk` | Collaborative document SDK — lifecycle, versions, attribution, consensus, AgentSession, A2A, retrieval | `import { AgentSession, DocumentLifecycle } from 'llmtxt/sdk'` |
| `llmtxt/similarity` | Text similarity — n-gram Jaccard, MinHash fingerprinting, word shingles, ranked search (Rust WASM) | `import { textSimilarity, rankBySimilarity } from 'llmtxt/similarity'` |
| `llmtxt/transport` | PeerTransport abstraction — UnixSocketTransport, HttpTransport, Ed25519 mutual handshake | `import { UnixSocketTransport, HttpTransport } from 'llmtxt/transport'` |

> All 7 subpaths are covered by the contract test suite in `packages/llmtxt/src/__tests__/subpath-contract.test.ts`.
> Breaking changes to any of these exports increment the minor version per T550 STABILITY.md.

## Subpath Exports

```ts
import { AgentSession } from 'llmtxt/sdk';
import { createBackend } from 'llmtxt/topology';
import { LocalBackend } from 'llmtxt/local';
import { RemoteBackend } from 'llmtxt/remote';
import { generateOverview, getSection } from 'llmtxt/disclosure';
import { textSimilarity, rankBySimilarity } from 'llmtxt/similarity';
import { buildGraph } from 'llmtxt/graph';
```

## CLI Reference

```bash
# Core
llmtxt init
llmtxt create-doc "My Specification"
cat spec.md | llmtxt push-version my-spec "First draft"
llmtxt sync --remote https://api.llmtxt.my --api-key $KEY

# Export / Import
llmtxt export <slug> --format md --output ./specs/
llmtxt export <slug> --format json --output ./exports/ --sign
llmtxt export-all --format md --output ./docs/
llmtxt import ./specs/my-doc.md

# Binary blob attachments
llmtxt attach <slug> ./diagram.png --name diagram.png
llmtxt blobs <slug>
llmtxt detach <slug> diagram.png

# Agent session lifecycle
llmtxt session start <agentId>
llmtxt session end <sessionId>

# P2P mesh
llmtxt mesh start
llmtxt mesh stop
llmtxt mesh status
llmtxt mesh peers
llmtxt mesh sync
```

## Security Helpers

### `verifyContentHash(content, expectedHash)` — MITM defense (T-02)

Verify that downloaded content matches the `content_hash` field returned by the API.
Computes `sha256(content)` in Rust (via WASM) and compares it in constant time.

```ts
import { verifyContentHash } from 'llmtxt';

const content = await fetchDocumentContent(slug);
const { content_hash } = await fetchDocumentMeta(slug);

if (!verifyContentHash(content, content_hash)) {
  throw new Error('Content hash mismatch — possible tampering detected');
}
```

### `constantTimeEqHex(a, b)` — timing-safe digest comparison (S-01)

Compare two hex-encoded SHA-256 or HMAC digests without leaking timing information.
Delegates to `crates/llmtxt-core::crypto::constant_time_eq_hex` (the `subtle` crate).
Use this instead of JavaScript `===` whenever comparing any secret-derived value.

```ts
import { constantTimeEqHex } from 'llmtxt';

// Never: if (storedHash === incomingHash)
// Always:
if (constantTimeEqHex(storedHash, incomingHash)) {
  // hashes match — timing-safe
}
```

## What Ships

- Compression, hashing, base62, token estimation (Rust WASM)
- Signed URL generation and verification (HMAC-SHA256, Ed25519)
- `verifyContentHash` + `constantTimeEqHex`: timing-safe content integrity helpers
- Unified diff patch creation, application, version reconstruction
- Loro CRDT via WASM (crdt_new_doc, crdt_apply_update, crdt_merge_updates, crdt_diff_update)
- Multi-way diff across up to 5 agent versions (LCS-aligned, WASM)
- Cherry-pick merge: selectively assemble sections from multiple versions (WASM)
- Progressive disclosure: overview, section extraction, content search
- Collaborative document lifecycle (DRAFT, REVIEW, LOCKED, ARCHIVED)
- AgentSession: open / contribute / close with signed ContributionReceipt
- Document export (4 formats, deterministic, signed) and import
- Binary blob attachments (content-addressed SHA-256, hash-verify-on-read)
- Topology factory: standalone / hub-spoke / mesh via `createBackend()`
- cr-sqlite changeset sync (optional peer dep `@vlcn.io/crsqlite`)
- P2P mesh sync engine (Ed25519 mutual handshake, Unix socket + HTTP transports)
- Version stack management with attribution tracking
- Consensus/approval evaluation with stale review handling
- Token-budget-aware retrieval planning
- Storage content reference abstractions (inline vs object-store)

## Release Model

The npm package includes prebuilt WASM artifacts generated from the Rust crate in
`crates/llmtxt-core`, so TypeScript and Rust consumers stay aligned on behavior.
