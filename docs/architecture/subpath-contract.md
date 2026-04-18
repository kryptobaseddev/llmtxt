# Subpath Export Contract

> User-facing explainer for the `llmtxt` subpath export system, the stability
> guarantees each subpath provides, and how breaking changes are prevented.

---

## What is a subpath export?

The `llmtxt` package uses the `package.json` `"exports"` map to expose
multiple entry points ("subpaths") under a single package name.  Each subpath
is an independently importable surface with its own stability guarantee.

```ts
// Root entry — high-level document API
import { LlmtxtDocument } from 'llmtxt';

// Identity subpath — Ed25519 agent signing
import { AgentIdentity, signRequest } from 'llmtxt/identity';

// CRDT subpath — collaborative editing
import { subscribeSection } from 'llmtxt/crdt';

// Blob subpath — content-addressed attachments
import { hashBlob, BlobFsAdapter } from 'llmtxt/blob';
```

Subpath imports do not drag in the entire package.  They are tree-shaken by
bundlers and load only what they declare.

---

## Stability tiers

Every subpath is assigned one of four tiers in
`packages/llmtxt/STABILITY.md`:

| Tier | What it means for you |
|---|---|
| **stable** | We will not break your code without advance notice. Breaking changes require a CalVer month bump and a CHANGELOG entry at least one release cycle in advance. |
| **experimental** | The API may change in a PATCH release. Suitable for exploration; pin the version if using in production. |
| **deprecated** | The subpath or symbol is scheduled for removal. A `@deprecated` JSDoc tag and a CHANGELOG entry will tell you the removal target and the replacement. |
| **internal** | Not for external use. May change or disappear at any time. |

The current tier for every subpath is listed in
`packages/llmtxt/STABILITY.md`.

---

## Currently stable subpaths

| Subpath | Purpose |
|---|---|
| `llmtxt` | High-level document class |
| `llmtxt/sdk` | Full SDK (lifecycle, versions, consensus, BFT, A2A, sessions) |
| `llmtxt/crdt` | WebSocket collaborative editing (Loro binary protocol) |
| `llmtxt/crdt-primitives` | Low-level WASM CRDT state manipulation |
| `llmtxt/similarity` | N-gram / Jaccard / MinHash content similarity |
| `llmtxt/blob` | Content-addressed blob primitives + filesystem adapter |
| `llmtxt/events` | Event streaming (EventBus, subscriptions) |
| `llmtxt/identity` | Ed25519 agent identity (signing + verification) |
| `llmtxt/transport` | PeerTransport interface + Unix/HTTP transports |
| `llmtxt/local` | SQLite `LocalBackend` |
| `llmtxt/remote` | HTTP/WS `RemoteBackend` |
| `llmtxt/pg` | Postgres `PostgresBackend` |
| `llmtxt/disclosure` | Progressive-disclosure retrieval helpers |

---

## How breaking changes are prevented

### TypeScript declaration snapshots

Every stable subpath has a `.d.ts` snapshot stored in
`packages/llmtxt/.dts-snapshots/`.  The snapshot represents the last known
good public API surface.

When you open a pull request, the **Subpath Contract** CI job:

1. Rebuilds all TypeScript declarations (`tsc --declaration`) from the PR branch.
2. Runs `./scripts/snapshot-subpath-types.sh --check`.
3. `diff`s each rebuilt `.d.ts` against its committed snapshot.
4. **Fails the PR check** if any stable subpath differs from its snapshot.

### What triggers a failure

- Removing or renaming an exported symbol.
- Changing a function signature (parameter types, return type).
- Adding a required parameter to an exported function.
- Removing an entry from `package.json` `"exports"`.

### What does NOT trigger a failure

- Adding new optional exports (new symbols appear in the rebuilt `.d.ts` but
  not in the snapshot — the diff is additive-only and the script allows this
  for non-breaking additions).
- Changes to experimental or internal subpaths (not in the guarded list).
- Pure comment / JSDoc changes (these do not appear in `.d.ts` output).

> **Note:** The current script uses a strict `diff` comparison.  If you add a
> new export to a stable subpath on your PR, update the snapshot by running
> `./scripts/snapshot-subpath-types.sh` and committing the result.  The PR
> check will then pass because the snapshot matches.

---

## Updating the snapshot

Whenever you intentionally change the public API of a stable subpath (adding
new exports is fine; removing or changing existing ones requires a CalVer month
bump), regenerate the snapshot baseline:

```bash
# From the repo root — must run AFTER a successful build
pnpm --filter llmtxt run build:all
./scripts/snapshot-subpath-types.sh
git add packages/llmtxt/.dts-snapshots/
git commit -m "chore(subpath): update .dts-snapshots after <change summary>"
```

If you are removing or changing a stable export, also:

1. Follow the deprecation policy in `docs/architecture/deprecation-policy.md`.
2. Add a `### Deprecated` or `### Removed` entry to `CHANGELOG.md`.
3. Update `packages/llmtxt/STABILITY.md`.

---

## Adding a new subpath

1. Create the source directory and `index.ts` under `packages/llmtxt/src/`.
2. Add the entry to `package.json` `"exports"`.
3. Add the subpath to `packages/llmtxt/STABILITY.md` with tier **experimental**.
4. Add the subpath key and `.d.ts` path to
   `scripts/snapshot-subpath-types.sh` only after promoting it to **stable**.
5. Run `./scripts/snapshot-subpath-types.sh` and commit the initial snapshot
   at the same time as the promotion to stable.

---

## Questions?

- Stability tiers: `packages/llmtxt/STABILITY.md`
- Deprecation timelines: `docs/architecture/deprecation-policy.md`
- CI workflow source: `.github/workflows/subpath-contract.yml`
- Snapshot script: `scripts/snapshot-subpath-types.sh`
