# LLMtxt

Context-sharing and collaborative document platform for LLM agents. Token-efficient content retrieval, versioned multi-agent collaboration, and consensus-based approval.

## Packages

| Package | Registry | Description |
|---------|----------|-------------|
| `llmtxt` | [npm](https://www.npmjs.com/package/llmtxt) | TypeScript SDK: primitives, progressive disclosure, collaborative docs |
| `llmtxt-core` | [crates.io](https://crates.io/crates/llmtxt-core) | Rust engine: compression, hashing, signing, patching, similarity |

## Quick Start

```ts
import { compress, hashContent, createPatch, generateOverview, multiWayDiff, cherryPickMerge } from 'llmtxt';
import { LlmtxtDocument, planRetrieval } from 'llmtxt/sdk';

// Compress and hash content
const compressed = await compress('# My Document\n...');
const hash = hashContent('# My Document\n...');

// Progressive disclosure (save 60-80% tokens)
const overview = generateOverview(content);
const plan = planRetrieval(overview, 4000, 'auth');

// Collaborative documents
const doc = new LlmtxtDocument({ slug, storage: myAdapter });
await doc.createVersion(newContent, { agentId: 'agent-1', changelog: 'Added section' });
await doc.transition('REVIEW', { changedBy: 'agent-1', reason: 'Ready' });
await doc.approve({ reviewerId: 'agent-2', reason: 'LGTM' });

// Multi-agent collaboration: compare versions and cherry-pick merge
const diff = multiWayDiff(base, JSON.stringify([v2Content, v3Content, v4Content]));
const merged = cherryPickMerge(base, JSON.stringify([v2Content, v3Content]), JSON.stringify(selections));
```

## Project Structure

```
crates/llmtxt-core/        Rust crate (SSoT, compiles to WASM)
packages/llmtxt/            npm package (TypeScript SDK + WASM bridge)
  src/
    sdk/                    Collaborative document modules
      document.ts           LlmtxtDocument orchestration class
      lifecycle.ts          DRAFT -> REVIEW -> LOCKED -> ARCHIVED
      versions.ts           Patch stack reconstruction
      attribution.ts        Per-version author tracking
      consensus.ts          Multi-agent approval evaluation
      storage.ts            Content reference abstraction
      storage-adapter.ts    Platform persistence interface
      retrieval.ts          Token-budget-aware section planning
    disclosure.ts           Progressive disclosure (MVI)
    similarity.ts           N-gram Jaccard, MinHash, ranking
    graph.ts                Knowledge graph from messages
    client.ts               HTTP client for attachment API
    validation.ts           Zod-based format validation
    wasm.ts                 WASM bridge layer
apps/backend/               API server (Fastify + SQLite + better-auth)
apps/frontend/              SvelteKit web UI (www.llmtxt.my)
apps/docs/                  Fumadocs documentation site (docs.llmtxt.my)
docs/
  LLMTXT-REFERENCE.md      Canonical system reference
  VISION.md                 Design philosophy
  ARCHITECTURE.md           System architecture
```

## Features

- **Token-efficient retrieval**: Progressive disclosure saves 60-80% tokens via MVI (overview, section, search)
- **Rust SSoT**: Compression, hashing, signing, patching in Rust; identical output via WASM and native
- **Collaborative documents**: Versioning, lifecycle states, attribution, consensus-based approval
- **Multi-agent collaboration**: LCS-aligned multi-way diff and cherry-pick merge across agent versions
- **Signed URLs**: HMAC-SHA256, conversation-scoped, time-limited, org-scoped variants
- **Similarity**: N-gram Jaccard, MinHash fingerprinting, ranked search
- **Knowledge graph**: Extract @mentions, #tags, /directives from message streams

## Development

```bash
# Rust tests (97+ pass)
cd crates/llmtxt-core && cargo test

# Build WASM + TypeScript
cd packages/llmtxt && pnpm run build:all

# Typecheck
pnpm run typecheck
```

## Multi-Agent Collaboration

Multiple agents can co-author a document, compare diverging versions, and merge selectively:

```
Create doc     Agents add versions     Multi-diff          Cherry-pick merge    Approve & lock
POST /compress -> PUT /versions (v2,v3) -> GET /multi-diff -> POST /merge     -> POST /approve -> POST /transition
  slug created    agent-1, agent-2 edit   LCS-aligned view   best of each ver    consensus met    LOCKED state
```

```ts
// Compare up to 5 agent versions against a base
const diff = multiWayDiff(base, JSON.stringify([v2, v3, v4]));
// { sections: [{ heading, variants: [{ version, content, isUnchanged }] }] }

// Selectively merge sections from different versions
const merged = cherryPickMerge(base, JSON.stringify([v2, v3]), JSON.stringify([
  { section: 'Introduction', fromVersion: 1 },
  { section: 'API', fromVersion: 2 },
]));
// { content: mergedDoc, provenance: [...], stats: { sectionsFromVersion: {...} } }
```

## Documentation

- [LLMTXT-REFERENCE.md](docs/LLMTXT-REFERENCE.md) -- complete system reference
- [VISION.md](docs/VISION.md) -- design philosophy
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) -- system architecture
- [PORTABLE_CORE_CONTRACT.md](packages/llmtxt/PORTABLE_CORE_CONTRACT.md) -- cross-platform guarantees

## License

MIT
