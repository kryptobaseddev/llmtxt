# llmtxt

Primitives and SDK for LLM agent content workflows.

`llmtxt` wraps the Rust `llmtxt-core` crate through WASM so TypeScript
consumers use the same single-source-of-truth logic as native Rust consumers.

## Install

```bash
npm install llmtxt
```

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
```

## Multi-Way Diff and Cherry-Pick Merge

```ts
import { multiWayDiff, cherryPickMerge } from 'llmtxt';

// Compare multiple agent versions against a base using LCS alignment
const diff = multiWayDiff(base, JSON.stringify([v2Content, v3Content, v4Content]));
// Returns MultiDiffResult: { sections, totalVersions, baseTokenCount }

// Selectively merge sections from different versions
const merged = cherryPickMerge(
  base,
  JSON.stringify([v2Content, v3Content]),
  JSON.stringify([
    { section: 'Introduction', fromVersion: 1 },
    { section: 'API Reference', fromVersion: 2 },
  ])
);
// Returns CherryPickResult: { content, provenance, stats }
```

## SDK (Collaborative Documents)

```ts
import {
  isValidTransition, evaluateApprovals, planRetrieval,
  reconstructVersion, attributeVersion, buildContributorSummary,
} from 'llmtxt/sdk';
```

### Subpath Exports

```ts
import { generateOverview, getSection } from 'llmtxt/disclosure';
import { textSimilarity, rankBySimilarity } from 'llmtxt/similarity';
import { buildGraph } from 'llmtxt/graph';
```

## What Ships

- Compression, hashing, base62, token estimation (Rust WASM)
- Signed URL generation and verification
- Unified diff patch creation, application, version reconstruction
- Multi-way diff across up to 5 agent versions (LCS-aligned, WASM)
- Cherry-pick merge: selectively assemble sections from multiple versions (WASM)
- Progressive disclosure: overview, section extraction, content search
- Collaborative document lifecycle (DRAFT, REVIEW, LOCKED, ARCHIVED)
- Version stack management with attribution tracking
- Consensus/approval evaluation with stale review handling
- Token-budget-aware retrieval planning
- Storage content reference abstractions (inline vs object-store)
- Attachment client helpers for upload, fetch, reshare, versioning

## Release Model

The npm package includes prebuilt WASM artifacts generated from the Rust crate in
`crates/llmtxt-core`, so TypeScript and Rust consumers stay aligned on behavior.
