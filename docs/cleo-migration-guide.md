# CLEO Migration Guide: Monolithic to Subpath Imports (v2026.4.9)

This guide shows CLEO consumers (orchestrators, subagents, skill scripts) how to migrate
from monolithic `llmtxt` root imports to the scoped subpaths introduced in v2026.4.9.

## Why migrate?

The monolithic `import { ... } from 'llmtxt'` root barrel still works — it is not removed.
However, subpath imports are preferred because:

1. **Load-time safety**: the root barrel has historically triggered unexpected `better-sqlite3`
   / `drizzle-orm` resolution at load time for lightweight consumers. Subpath imports avoid
   this entirely (each subpath is a separate module graph entry).
2. **Tree-shaking**: bundlers can eliminate unused subpaths. CLEO skill scripts bundled with
   esbuild or rollup will be smaller.
3. **Stability contract**: the 7 subpaths have explicit stability guarantees in `STABILITY.md`.
   Breaking changes to a subpath surface will appear in the CHANGELOG and bump the minor
   version. You can pin safely.
4. **CLEO `cleo docs generate` compatibility**: `cleo docs generate --for <taskId>` calls
   `generateOverview` from the `llmtxt` root. In v2026.4.7 this hit
   `ERR_MODULE_NOT_FOUND: Cannot find package 'better-sqlite3'` when the
   optional peer was absent. Subpath imports eliminate the failure mode at the source.

---

## Subpath map

| v2026.4.8 (root import) | v2026.4.9+ (subpath) |
|---|---|
| `import { AgentSession } from 'llmtxt'` | `import { AgentSession } from 'llmtxt/sdk'` |
| `import { AgentIdentity } from 'llmtxt'` | `import { AgentIdentity } from 'llmtxt/identity'` |
| `import { signRequest } from 'llmtxt'` | `import { signRequest } from 'llmtxt/identity'` |
| `import { verifyRequestSignature } from 'llmtxt'` | `import { verifyRequestSignature } from 'llmtxt/identity'` |
| `import { hashBlob, blobNameValidate } from 'llmtxt'` | `import { hashBlob, blobNameValidate } from 'llmtxt/blob'` |
| `import { EventBus, createEventBus } from 'llmtxt'` | `import { EventBus, createEventBus } from 'llmtxt/events'` |
| `import { crdtNewDoc, crdtApplyUpdate } from 'llmtxt'` | `import { crdtNewDoc, crdtApplyUpdate } from 'llmtxt/crdt'` |
| `import { crdtMergeUpdates } from 'llmtxt'` | `import { crdtMergeUpdates } from 'llmtxt/crdt'` |
| `import { UnixSocketTransport } from 'llmtxt'` | `import { UnixSocketTransport } from 'llmtxt/transport'` |
| `import { HttpTransport } from 'llmtxt'` | `import { HttpTransport } from 'llmtxt/transport'` |
| `import { textSimilarity } from 'llmtxt'` | `import { textSimilarity } from 'llmtxt/similarity'` |
| `import { rankBySimilarity } from 'llmtxt'` | `import { rankBySimilarity } from 'llmtxt/similarity'` |
| `import { minhashFingerprint } from 'llmtxt'` | `import { minhashFingerprint } from 'llmtxt/similarity'` |

Exports **not** in a subpath (remain on the root):

| Export | Still on root? | Notes |
|---|---|---|
| `compress` / `decompress` | Yes | Core WASM primitive |
| `generateId` | Yes | Core WASM primitive |
| `hashContent` | Yes | Core WASM primitive |
| `createPatch` / `applyPatch` | Yes | Core diff/patch |
| `multiWayDiff` / `cherryPickMerge` | Yes | Core WASM diff |
| `generateSignedUrl` / `verifySignedUrl` | Yes | HMAC-SHA256 URLs |
| `verifyContentHash` | Yes | Security helper |
| `constantTimeEqHex` | Yes | Security helper |
| `createBackend` | Yes | Topology factory |

---

## Before / After: common CLEO patterns

### Pattern 1: AgentSession in a CLEO subagent

**Before (v2026.4.8 and earlier)**

```ts
import { AgentSession, AgentIdentity } from 'llmtxt';
import type { ContributionReceipt } from 'llmtxt';
```

**After (v2026.4.9+)**

```ts
import { AgentSession } from 'llmtxt/sdk';
import { AgentIdentity } from 'llmtxt/identity';
import type { ContributionReceipt } from 'llmtxt/sdk';
```

### Pattern 2: Signing a CLEO A2A envelope

**Before**

```ts
import { signRequest, verifyRequestSignature, canonicalPayload } from 'llmtxt';
```

**After**

```ts
import { signRequest, verifyRequestSignature, canonicalPayload } from 'llmtxt/identity';
```

### Pattern 3: Blob attachment in a CLEO task worker

**Before**

```ts
import { hashBlob, blobNameValidate } from 'llmtxt';
```

**After**

```ts
import { hashBlob, blobNameValidate } from 'llmtxt/blob';
```

### Pattern 4: Event bus in a CLEO orchestrator

**Before**

```ts
import { EventBus, createEventBus } from 'llmtxt';
```

**After**

```ts
import { EventBus, createEventBus } from 'llmtxt/events';
```

### Pattern 5: CRDT section merge in a CLEO merge worker

**Before**

```ts
import { crdtNewDoc, crdtApplyUpdate, crdtMergeUpdates } from 'llmtxt';
```

**After**

```ts
import { crdtNewDoc, crdtApplyUpdate, crdtMergeUpdates } from 'llmtxt/crdt';
```

### Pattern 6: Transport in a CLEO mesh agent

**Before**

```ts
import { UnixSocketTransport, HttpTransport } from 'llmtxt';
```

**After**

```ts
import { UnixSocketTransport, HttpTransport } from 'llmtxt/transport';
```

### Pattern 7: Similarity ranking in a CLEO retrieval worker

**Before**

```ts
import { textSimilarity, rankBySimilarity } from 'llmtxt';
```

**After**

```ts
import { textSimilarity, rankBySimilarity } from 'llmtxt/similarity';
```

---

## CLEO skill scripts: esbuild externalize list update

If your CLEO skill script bundles with esbuild and uses the new subpaths, the existing
externalize list in `packages/llmtxt/README.md` covers all cases. No new entries are needed
for the subpaths themselves — they are pure TypeScript with no new native addon dependencies.

```js
// esbuild — unchanged from v2026.4.7
esbuild.build({
  bundle: true,
  platform: 'node',
  external: [
    'onnxruntime-node',
    'better-sqlite3',
    '@vlcn.io/crsqlite',
    'drizzle-orm',
    'drizzle-orm/*',
    'postgres',
    'mssql',
    '@opentelemetry/api',
  ],
});
```

---

## Rollout strategy for CLEO skill scripts

The monolithic root barrel is not deprecated and will not be removed in v2026.4.x.
You can migrate skill scripts incrementally:

1. **Immediate**: migrate any script that was hitting `ERR_MODULE_NOT_FOUND` on `better-sqlite3`
   — use `llmtxt/sdk` or `llmtxt/identity` as appropriate.
2. **Next sprint**: migrate remaining scripts to subpath imports for tree-shaking and
   stability-contract benefits.
3. **Verify**: run `pnpm --filter llmtxt test` after any migration. The contract test suite
   (`subpath-contract.test.ts`) will catch regressions.

---

## Checking your migration

After updating imports, verify with:

```bash
# Run the contract test suite
pnpm --filter llmtxt test

# Confirm no root-barrel load-time side-effects (install no optional peers)
node -e "require('llmtxt')" 2>&1 | grep -i "not found" && echo "FAIL" || echo "OK"
```

---

## Questions

- Subpath stability guarantees: `packages/llmtxt/STABILITY.md`
- Full subpath API reference: `docs.llmtxt.my/primitives`
- CLEO integration patterns: `apps/examples/cleo-integration/index.ts`
- Open a task: `cleo create "Migration issue: <description>" --parent T606`
