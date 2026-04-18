# llmtxt Subpath Stability Contract

> This document is the authoritative reference for every subpath exported by the
> `llmtxt` package.  It governs which subpaths are stable, which are
> experimental, and which are deprecated, and it defines the breaking-change
> policy that applies to each tier.

---

## Versioning scheme

`llmtxt` uses **CalVer** (`YYYY.M.PATCH`).

| Change class | Version behaviour |
|---|---|
| Non-breaking addition (new exports on a stable subpath) | Bump `PATCH` only |
| Breaking change to a **stable** subpath | Requires a CalVer **month bump** (e.g., `2026.5.x`) — never silently in a PATCH |
| Breaking change to an **experimental** subpath | Allowed with `PATCH` bump; documented in CHANGELOG |
| Removal of a **deprecated** subpath | Requires at least one release-cycle warning (see `docs/architecture/deprecation-policy.md`) |

A "breaking change" is any modification to a stable subpath that would cause
existing consumers to fail TypeScript compilation or produce different runtime
behaviour without a code change on their part.  This includes:

- Removing or renaming an exported symbol
- Narrowing the type of a parameter (stricter input)
- Widening the type of a return value (looser output)
- Changing the observable runtime behaviour of a function
- Removing an export entry from `package.json` `"exports"`

---

## Stability tiers

| Tier | Meaning |
|---|---|
| **stable** | Fully supported.  Breaking changes require a CalVer month bump and are announced in CHANGELOG at least one release cycle in advance. |
| **experimental** | Under active development.  API may change with only a PATCH bump.  Suitable for early adopters; not recommended for production without pinning. |
| **deprecated** | Scheduled for removal.  See the deprecation notice in this file and in `docs/architecture/deprecation-policy.md` for timeline. |
| **internal** | Not part of the public API.  May be removed at any time.  Do not import in external code. |

---

## Subpath inventory

### `llmtxt` (root export — `"."`)

**Tier**: stable

The main entry point re-exports the high-level `LlmtxtDocument` class plus
core types.  It is intentionally narrow; prefer named subpaths for primitives.

| Export | Kind |
|---|---|
| `LlmtxtDocument` | class |
| `LlmtxtDocumentOptions` | type |
| `CreateVersionOptions` | type |

---

### `llmtxt/sdk`

**Tier**: stable

Full SDK surface for building agents and document-collaborative applications.

| Export | Kind |
|---|---|
| `LlmtxtDocument` | class |
| `LlmtxtDocumentOptions` | type |
| `CreateVersionOptions` | type |
| `StorageAdapter` | type |
| `DocumentState` | type |
| `StateTransition` | type |
| `TransitionResult` | type |
| `DOCUMENT_STATES` | const |
| `isValidTransition` | function |
| `validateTransition` | function |
| `isEditable` | function |
| `isTerminal` | function |
| `VersionEntry` | type |
| `ReconstructionResult` | type |
| `PatchValidationResult` | type |
| `VersionDiffSummary` | type |
| `reconstructVersion` | function |
| `validatePatchApplies` | function |
| `squashPatches` | function |
| `computeReversePatch` | function |
| `diffVersions` | function |
| `VersionAttribution` | type |
| `ContributorSummary` | type |
| `attributeVersion` | function |
| `buildContributorSummary` | function |
| `ApprovalStatus` | type |
| `Review` | type |
| `ApprovalPolicy` | type |
| `ApprovalResult` | type |
| `DEFAULT_APPROVAL_POLICY` | const |
| `evaluateApprovals` | function |
| `markStaleReviews` | function |
| `StorageType` | type |
| `CompressionMethod` | type |
| `ContentRef` | type |
| `StorageMetadata` | type |
| `inlineRef` | function |
| `objectStoreRef` | function |
| `versionStorageKey` | function |
| `shouldUseObjectStore` | function |
| `PlannedSection` | type |
| `RetrievalPlan` | type |
| `RetrievalOptions` | type |
| `planRetrieval` | function |
| `estimateRetrievalCost` | function |
| `BFTApprovalStatus` | type |
| `SignedApprovalEnvelope` | type |
| `BFTApprovalResponse` | type |
| `BFTStatusResponse` | type |
| `ChainVerificationResponse` | type |
| `bftQuorum` | function |
| `buildApprovalCanonicalPayload` | function |
| `signApproval` | function |
| `submitSignedApproval` | function |
| `getBFTStatus` | function |
| `verifyApprovalChain` | function |
| `ScratchpadMessage` | type |
| `SendScratchpadOptions` | type |
| `ReadScratchpadOptions` | type |
| `sendScratchpad` | function |
| `readScratchpad` | function |
| `onScratchpadMessage` | function |
| `A2AEnvelope` | type |
| `BuildA2AOptions` | type |
| `InboxDeliveryResponse` | type |
| `InboxMessage` | type |
| `InboxPollResponse` | type |
| `A2AMessage` | class |
| `buildA2AMessage` | function |
| `sendToInbox` | function |
| `pollInbox` | function |
| `onDirectMessage` | function |
| `ContributionReceipt` | type |
| `AgentSessionOptions` | type |
| `AgentSession` | class |
| `AgentSessionError` | class |
| `AgentSessionState` | type/enum |

---

### `llmtxt/crdt`

**Tier**: stable

WebSocket-backed collaborative editing — section subscription and text
retrieval using the Loro binary sync protocol.

| Export | Kind |
|---|---|
| `SectionDelta` | interface |
| `Unsubscribe` | type |
| `SubscribeSectionOptions` | interface |
| `subscribeSection` | function |
| `getSectionText` | function |

---

### `llmtxt/crdt-primitives`

**Tier**: stable

Low-level WASM-backed CRDT state manipulation (Loro binary format).  Use
`llmtxt/crdt` for the high-level subscription API; use this subpath when you
need direct control over CRDT state buffers.

| Export | Kind |
|---|---|
| `crdt_new_doc` | function |
| `crdt_encode_state_as_update` | function |
| `crdt_apply_update` | function |
| `crdt_merge_updates` | function |
| `crdt_state_vector` | function |
| `crdt_diff_update` | function |
| `crdt_get_text` | function |
| `crdt_make_state` | function |
| `crdt_make_incremental_update` | function |
| `crdt_apply_to_local_doc` | function |

---

### `llmtxt/similarity`

**Tier**: stable

WASM-backed content-similarity primitives (Jaccard / MinHash / n-gram
fingerprinting).

| Export | Kind |
|---|---|
| `SimilarityRankResult` | type |
| `contentSimilarity` | function |
| `extractNgrams` | function |
| `extractWordShingles` | function |
| `fingerprintSimilarity` | function |
| `jaccardSimilarity` | function |
| `minHashFingerprint` | function |
| `rankBySimilarity` | function |
| `textSimilarity` | function (alias — deprecated alias for `jaccardSimilarity`) |

---

### `llmtxt/blob`

**Tier**: stable

Content-addressed blob primitives extracted from `LocalBackend`.  Provides
portable hash, validate, filesystem adapter, and changeset utilities without
requiring the full backend.

| Export | Kind |
|---|---|
| `AttachBlobParams` | type |
| `BlobAttachment` | type |
| `BlobData` | type |
| `BlobOps` | type |
| `BlobRef` | type |
| `BlobAccessDeniedError` | class |
| `BlobCorruptError` | class |
| `BlobNameInvalidError` | class |
| `BlobNotFoundError` | class |
| `BlobTooLargeError` | class |
| `hashBlob` | function |
| `ApplyBlobChangesetResult` | type |
| `BlobChangeset` | type |
| `BlobRefWithDocSlug` | type |
| `applyBlobChangeset` | function |
| `buildBlobChangeset` | function |
| `incomingWinsLWW` | function |
| `BlobFsAdapter` | class |

---

### `llmtxt/events`

**Tier**: stable

Shared event-streaming primitives used by both `LocalBackend` and
`PostgresBackend`.

| Export | Kind |
|---|---|
| `EventPublisher` | type |
| `EventSubscriber` | type |
| `EventStream` | type |
| `DocumentEvent` | type |
| `CrdtUpdate` | type |
| `EventBus` | class |
| `ExternalBusAdapter` | class |
| `DocumentEventBusLike` | type |
| `makeEventStream` | function |
| `EmitterLike` | type |

---

### `llmtxt/identity`

**Tier**: stable

Ed25519 agent identity — key generation, request signing, and signature
verification.  All cryptographic operations are compatible with the Rust
SSoT in `crates/llmtxt-core/src/identity.rs`.

| Export | Kind |
|---|---|
| `AgentIdentity` | class |
| `bodyHashHex` | function |
| `buildCanonicalPayload` | function |
| `randomNonceHex` | function |
| `createIdentity` | function |
| `loadIdentity` | function |
| `identityFromSeed` | function |
| `signRequest` | function |
| `verifySignature` | function |
| `SignatureHeaders` | type |
| `CanonicalPayloadOptions` | type |

---

### `llmtxt/transport`

**Tier**: stable

`PeerTransport` abstraction with `UnixSocketTransport`, `HttpTransport`, and
Ed25519 mutual handshake.

| Export | Kind |
|---|---|
| `MAX_CHANGESET_BYTES` | const |
| `MAX_RETRIES` | const |
| `RETRY_BASE_MS` | const |
| `HandshakeFailedError` | class |
| `PeerUnreachableError` | class |
| `ChangesetTooLargeError` | class |
| `PeerTransport` | interface |
| `TransportIdentity` | interface |
| `UnixSocketTransport` | class |
| `HttpTransport` | class |

---

### `llmtxt/local`

**Tier**: stable

`LocalBackend` — SQLite-backed backend for single-process / single-tenant use.

| Export | Kind |
|---|---|
| `LocalBackend` | class |
| (all types re-exported from `llmtxt/sdk` that LocalBackend implements) | types |

---

### `llmtxt/remote`

**Tier**: stable

`RemoteBackend` — HTTP/WebSocket client backend for connecting to a running
LLMtxt server.

| Export | Kind |
|---|---|
| `RemoteBackend` | class |

---

### `llmtxt/pg`

**Tier**: stable

`PostgresBackend` — Postgres-backed backend for multi-tenant server deployments.

| Export | Kind |
|---|---|
| `PostgresBackend` | class |

---

### `llmtxt/disclosure`

**Tier**: stable

Progressive-disclosure retrieval helpers — parse structure, plan section
retrieval, estimate token cost.

| Export | Kind |
|---|---|
| (see `src/disclosure.ts`) | functions + types |

---

### `llmtxt/graph`

**Tier**: experimental

Cross-document graph traversal and relationship discovery.  API may change
before 2026.6.

| Export | Kind |
|---|---|
| (see `src/graph.ts`) | functions + types |

---

### `llmtxt/embeddings`

**Tier**: experimental

Vector embedding utilities (pgvector integration, cosine similarity).
API stabilisation target: 2026.6.

| Export | Kind |
|---|---|
| (see `src/embeddings.ts`) | functions + types |

---

### `llmtxt/export-backend`

**Tier**: experimental

Server-side document export (used by the backend service).  Not intended for
SDK consumers in its current form; stabilisation target: 2026.7.

| Export | Kind |
|---|---|
| (see `src/export/backend-export.ts`) | functions + types |

---

### `llmtxt/cli`

**Tier**: internal

CLI entry-point.  Not a stable public API.  Do not import in application code.

---

## CI enforcement

A dedicated GitHub Actions workflow (`.github/workflows/subpath-contract.yml`)
compares the TypeScript declaration files for every **stable** subpath against
snapshots stored in `packages/llmtxt/.dts-snapshots/`.  Any structural
difference causes the PR check to fail.

Snapshot baseline is regenerated by running:

```bash
./scripts/snapshot-subpath-types.sh
```

See `docs/architecture/subpath-contract.md` for the full user-facing explainer.

---

## Deprecation policy

See `docs/architecture/deprecation-policy.md` for the complete deprecation
process, timeline rules, and migration guidance template.

---

## Currently deprecated exports

| Symbol / Subpath | Deprecated in | Removal target | Replacement |
|---|---|---|---|
| `textSimilarity` (in `llmtxt/similarity`) | 2026.4.6 | 2026.7 | `jaccardSimilarity` |

---

_Last updated: 2026-04-18_
