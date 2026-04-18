# LLMtxt

[![v2026.4.6](https://img.shields.io/badge/version-2026.4.6-blue)](https://www.npmjs.com/package/llmtxt)

Context-sharing and collaborative document platform for LLM agents. Token-efficient content retrieval, versioned multi-agent collaboration, and consensus-based approval.

**v2026.4.6**: Loro CRDT (replaces Yrs), AgentSession lifecycle, document export/import, binary blob attachments, hub-spoke/mesh topology factory, cr-sqlite LocalBackend sync, P2P mesh, and `session` + `mesh` CLI commands.

## Packages

| Package | Registry | Description |
|---------|----------|-------------|
| `llmtxt` | [npm](https://www.npmjs.com/package/llmtxt) | TypeScript SDK: primitives, progressive disclosure, collaborative docs |
| `llmtxt-core` | [crates.io](https://crates.io/crates/llmtxt-core) | Rust engine: compression, hashing, signing, patching, CRDT (Loro) |

## Quick Start

```ts
import { createBackend } from 'llmtxt';
import { AgentSession } from 'llmtxt/sdk';

// Choose a topology (standalone / hub-spoke / mesh)
const backend = await createBackend({ topology: 'standalone', storagePath: './.llmtxt' });
await backend.open();

// Structured lifecycle for every agent
const session = new AgentSession({ backend, agentId: 'agent-1' });
await session.open();

// contribute() returns T (whatever fn returns)
const doc = await session.contribute(async (b) => {
  const created = await b.createDocument({ title: 'My Spec', createdBy: 'agent-1' });
  await b.publishVersion({
    documentId: created.id,
    content: '# My Spec\n\nFirst draft.',
    patchText: '',
    createdBy: 'agent-1',
    changelog: 'Initial',
  });
  return created;
});

const contributionReceipt = await session.close();
// { sessionId, agentId, documentIds, eventCount, sessionDurationMs, ... }

await backend.close();
```

**Hub-spoke** (100+ ephemeral workers pointing at a shared API):

```ts
import { createBackend } from 'llmtxt';

const backend = await createBackend({
  topology: 'hub-spoke',
  hubUrl: 'https://api.llmtxt.my',
  apiKey: process.env.LLMTXT_API_KEY,
});
```

**Mesh** (P2P offline-first, no central server):

```ts
const backend = await createBackend({
  topology: 'mesh',
  storagePath: './.llmtxt',
});
```

## Project Structure

```
crates/llmtxt-core/        Rust crate (SSoT, compiles to WASM)
  src/crdt.rs              Loro CRDT (replaces Yrs — binary-incompatible)
packages/llmtxt/            npm package (TypeScript SDK + WASM bridge)
  src/
    topology.ts             createBackend() factory (standalone/hub-spoke/mesh)
    sdk/                    Collaborative document modules
      session.ts            AgentSession: open() / contribute() / close()
      document.ts           LlmtxtDocument orchestration class
      lifecycle.ts          DRAFT -> REVIEW -> LOCKED -> ARCHIVED
      versions.ts           Patch stack reconstruction
      attribution.ts        Per-version author tracking
      consensus.ts          Multi-agent approval evaluation
      storage.ts            Content reference abstraction
      storage-adapter.ts    Platform persistence interface
      retrieval.ts          Token-budget-aware section planning
    local/
      local-backend.ts      SQLite LocalBackend (single-tenant)
      blob-fs-adapter.ts    Binary blob filesystem adapter (.llmtxt/blobs/<hash>)
      cr-sqlite.ts          Optional changeset sync (getChangesSince/applyChanges)
    export/
      formatters.ts         Markdown / JSON / txt / llmtxt format renderers
      export-backend.ts     backend.exportDocument() / exportAll() / importDocument()
    mesh/
      sync-engine.ts        P2P changeset sync (Ed25519 handshake mandatory)
      unix-transport.ts     UnixSocketTransport
      peer-registry.ts      File-based peer discovery
    cli/
      llmtxt.ts             CLI entry point
    disclosure.ts           Progressive disclosure (MVI)
    similarity.ts           N-gram Jaccard, MinHash, ranking
    graph.ts                Knowledge graph from messages
    wasm.ts                 WASM bridge layer
apps/backend/               API server (Fastify + Postgres + better-auth)
apps/frontend/              SvelteKit web UI (www.llmtxt.my)
apps/docs/                  Fumadocs documentation site (docs.llmtxt.my)
docs/
  specs/                    Architecture specs (T384, T426-T429, P1-P3)
  LLMTXT-REFERENCE.md      Canonical system reference
  VISION.md                 Design philosophy
  ARCHITECTURE.md           System architecture
```

## Features

- **Token-efficient retrieval**: Progressive disclosure saves 60-80% tokens via MVI (overview, section, search)
- **Rust SSoT**: Compression, hashing, signing, patching in Rust; identical output via WASM and native
- **Loro CRDT**: Section-level CRDT via Loro 1.0 (richer types, ~30% smaller snapshots, 4-10x faster import than Yrs)
- **AgentSession lifecycle**: Explicit open/contribute/close with ContributionReceipt; crash recovery via TTLs
- **Document export/import**: 4 formats (markdown, json, txt, llmtxt); deterministic, hash-stable, signed export
- **Binary blob attachments**: Content-addressed SHA-256 blobs per document; hash-verify-on-read mandatory
- **Topology factory**: One `createBackend()` call selects standalone, hub-spoke, or mesh deployment
- **cr-sqlite LocalBackend**: Optional changeset-based sync between agents (single-tenant, production-validated)
- **P2P mesh**: Serverless agent collaboration; Ed25519 mutual handshake; no external coordinator
- **Collaborative documents**: Versioning, lifecycle states, attribution, consensus-based approval
- **Multi-agent diff/merge**: LCS-aligned multi-way diff and cherry-pick merge across agent versions
- **Signed URLs**: HMAC-SHA256, conversation-scoped, time-limited, org-scoped variants

## Deployment Topologies

| Topology | When to use | Backend |
|----------|-------------|---------|
| `standalone` | Single developer, local testing, no collaboration | `LocalBackend` |
| `hub-spoke` | CI pipelines, 100+ ephemeral swarm workers, shared production | `RemoteBackend` (spokes) + `PostgresBackend` (hub) |
| `mesh` | Offline-first P2P, air-gapped environments, small teams ≤10 | `LocalBackend` + cr-sqlite on each peer |

Full topology spec: [docs/specs/ARCH-T429-hub-spoke-topology.md](docs/specs/ARCH-T429-hub-spoke-topology.md) | [docs.llmtxt.my/architecture/topology](https://docs.llmtxt.my/architecture/topology)

## CLI Reference

```bash
# Core
llmtxt init                                  # Init local storage + Ed25519 keypair
llmtxt create-doc "My Specification"
cat spec.md | llmtxt push-version my-spec "First draft"
llmtxt sync --remote https://api.llmtxt.my --api-key $KEY

# Export / Import (v2026.4.6)
llmtxt export <slug> --format md --output ./specs/
llmtxt export-all --format json --output ./exports/
llmtxt import ./specs/my-doc.md

# Binary blob attachments (v2026.4.6)
llmtxt attach <slug> ./diagram.png --name diagram.png
llmtxt blobs <slug>
llmtxt detach <slug> diagram.png

# Agent session lifecycle (v2026.4.6)
llmtxt session start <agentId>
llmtxt session end <sessionId>

# P2P mesh (v2026.4.6)
llmtxt mesh start
llmtxt mesh stop
llmtxt mesh status
llmtxt mesh peers
llmtxt mesh sync
```

## Migration Notes: Yrs → Loro (v2026.4.6)

The CRDT layer switched from `yrs` to `loro` 1.0 in commit 414f169. This is a **clean break**:

- Loro binary format is **bitwise incompatible** with lib0/Yrs encoding.
- All rows in `section_crdt_states` and `section_crdt_updates` are dropped on deploy.
- Wire protocol: 1-byte prefix `0x01-0x04` (SyncStep1/SyncStep2/Update/AwarenessRelay) replaces y-sync framing. Legacy Yjs clients connecting will be rejected.
- The six WASM function names (`crdt_new_doc`, `crdt_apply_update`, etc.) are unchanged; semantics are now Loro.
- Full migration spec: [docs/specs/P1-loro-migration.md](docs/specs/P1-loro-migration.md)

## Multi-Agent Collaboration

```
Create doc → Agents contribute (via AgentSession) → Multi-diff → Cherry-pick merge → Approve & lock
                    ↑ receipts signed (Ed25519)    LCS-aligned    best of each        BFT consensus
```

## Development

```bash
# Rust tests
cd crates/llmtxt-core && cargo test

# Build WASM + TypeScript
cd packages/llmtxt && pnpm run build:all

# Typecheck
pnpm run typecheck
```

## Documentation

- [docs.llmtxt.my](https://docs.llmtxt.my) — Fumadocs full reference
- [docs/specs/](docs/specs/) — Architecture specs (Loro, AgentSession, export, blobs, topology, mesh)
- [docs/LLMTXT-REFERENCE.md](docs/LLMTXT-REFERENCE.md) — complete system reference
- [docs/VISION.md](docs/VISION.md) — design philosophy
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture
- [packages/llmtxt/PORTABLE_CORE_CONTRACT.md](packages/llmtxt/PORTABLE_CORE_CONTRACT.md) — cross-platform guarantees

## License

MIT
