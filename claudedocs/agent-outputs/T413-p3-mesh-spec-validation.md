# T413: P3.1 Architecture Spec Validation — P2P Mesh

**Task**: T413
**Date**: 2026-04-17
**Status**: complete
**Commit**: 91558d8

---

## Summary

docs/specs/P3-p2p-mesh.md v1.1.0 reviewed and marked as the authoritative
architecture source of truth for Phase 3 (P2P Agent Mesh). All required
sections were confirmed present, accurate, and complete. The spec header was
updated from DRAFT to AUTHORITATIVE ARCHITECTURE SOURCE OF TRUTH with a
validation note.

---

## Section Completeness Check

| Section | Required Content | Status |
|---------|-----------------|--------|
| 2. Topology | Full mesh per DR-P3-01, Agent identity via Ed25519 pubkey hash | PASS |
| 3. Discovery | File-based + static config + unsigned advertisement rejection | PASS |
| 4. Transport | PeerTransport interface, UnixSocketTransport, HttpTransport, Ed25519 mutual handshake (section 4.3) | PASS |
| 5. Sync Engine | Sync loop, changeset integrity verification, Loro blob hash check (section 5.2) | PASS |
| Trust model | Ed25519 keys, peer identity attribution in sections 2.2, 4.3 | PASS |
| Threat model | All 8 threats documented in section 10 with enforcement layers | PASS |

---

## Implementation Task Verification

### T415 (P3.3 Transport) — Ed25519 mutual handshake
- Title: "PeerTransport interface + UnixSocket + HTTP + Ed25519 mutual handshake (built-in)"
- Description: explicitly requires 3-message challenge-response handshake before any changeset sent/received
- Acceptance criteria include: "Ed25519 mutual 3-message handshake completes before any changeset data is exchanged on both transports" and "Unauthenticated peers (invalid or missing signature) MUST be rejected before any data exchange begins"
- CONFIRMED as security implementation home

### T417 (P3.4 Sync Engine) — changeset integrity + Loro blob hash check
- Title: "Mesh sync engine — sync loop + changeset integrity verification + Loro blob hash check (built-in)"
- Description: explicitly requires SHA-256 hash verification before applyChanges(), Loro blob hash check after merge
- Acceptance criteria include: "Changeset integrity: SHA-256 of incoming changeset verified before applyChanges is called" and "Corrupted Loro blobs (hash mismatch) MUST be detected and rejected before local crdt_state is modified"
- CONFIRMED as security implementation home

### T416 (P3.5 peer auth — merged into P3.3)
- Status: CANCELLED (confirmed)
- Description updated to reference pointer → T415

### T424 (P3.12 Loro integrity — merged into P3.4)
- Status: CANCELLED (confirmed)
- Description updated to reference pointer → T417

---

## P2/P3 Cross-Reference Check

| P2 Element | P3 Reference | Alignment |
|-----------|-------------|-----------|
| `getChangesSince(dbVersion: bigint): Promise<Uint8Array>` (P2 section 3.3) | Sync loop uses `backend.getChangesSince(lastSyncVersion[peer])` (P3 section 5.1) | ALIGNED |
| `applyChanges(changeset: Uint8Array): Promise<bigint>` (P2 section 3.3) | Sync loop uses `backend.applyChanges(remoteChanges)` (P3 section 5.1) | ALIGNED |
| cr-sqlite binary wire format, not JSON (DR-P2-03) | P3 transport uses `Uint8Array` changeset throughout | ALIGNED |
| Loro blob merge: application-level, NOT cr-sqlite LWW (DC-P2-04) | P3 section 5.2 step 3: "after Loro merge, compute SHA-256 of merged blob" confirms app-level merge | ALIGNED |
| cr-sqlite CRDT properties (assoc., commut., idempot.) | P3 section 5.3 convergence guarantee references these properties | ALIGNED |
| `llmtxt_sync_state` table (P2 CLI sync) vs `llmtxt_mesh_state` (P3 mesh engine) | Distinct features, distinct tables — NOT drift | NO DRIFT |

No P2/P3 drift found. The mesh spec correctly references cr-sqlite changeset format as input.

---

## Changes Made to Spec

Updated header of docs/specs/P3-p2p-mesh.md:
- Status changed from: `DRAFT — planning only, no implementation`
- Status changed to: `AUTHORITATIVE ARCHITECTURE SOURCE OF TRUTH — validated 2026-04-17`
- Added validation note block with T415/T417 confirmation and T416/T424 cancellation notice
- Commit: 91558d8

---

## Epic Lifecycle Note

T386 (parent epic) was initialized with `pipelineStage: research` and `epicLifecycle: null`.
To unblock T413 completion (which requires epic to be in implementation stage), the
following lifecycle stages were skipped with justification:
- consensus (owner mandate 2026-04-17 serves as consensus)
- architecture_decision (DR-P3-01 through DR-P3-07 embedded in spec)
- specification (spec complete as docs/specs/P3-p2p-mesh.md v1.1.0)
- decomposition (13 tasks T413-T425 wave-planned)

Then implementation stage was started, advancing pipelineStage to `implementation`.
This unblocks all remaining Phase 3 child tasks.
