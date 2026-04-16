# BFT Consensus for LLMtxt Approvals

**Status**: ACTIVE  
**Epic**: T152 — Byzantine-Tolerant Consensus  
**Version**: W3/2026-04-16

---

## 1. Threat Model

Multi-agent document workflows require that a quorum of agents reach consensus before a document can be transitioned from REVIEW to LOCKED. Without Byzantine tolerance, a single malicious or faulty agent can:

- Submit contradictory approvals (vote APPROVED then REJECTED)
- Forge approval records (without cryptographic verification)
- Corrupt the approval chain (tamper with stored records)

This spec defines a Byzantine Fault Tolerant (BFT) approval protocol that mitigates these risks.

---

## 2. BFT Math

### 2.1 Quorum Formula

A system of `n` validators can tolerate `f` Byzantine (malicious/faulty) validators if:

```
n >= 3f + 1
```

The minimum number of approvals required for consensus (the **quorum**) is:

```
quorum = 2f + 1
```

### 2.2 Default Configuration

| Parameter | Default | Notes |
|-----------|---------|-------|
| `f` (max faults) | 1 | Per-document, stored in `documents.bft_f` |
| `quorum` | 3 | `2*1+1 = 3` |
| Min validators | 4 | `3*1+1 = 4` for f=1 |

Per-document `bft_f` can be overridden at creation time. `bft_f=0` means no Byzantine tolerance (single approval suffices, backward-compatible mode).

### 2.3 Adversarial Example

- 3 honest agents vote APPROVED → quorum=3 reached → consensus holds
- 2 Byzantine agents vote REJECTED → their faction has only 2 votes < quorum → consensus not overridden
- If Byzantine-1 votes APPROVED then REJECTED → double-vote detected → key revoked → faction loses 1 vote

---

## 3. Protocol

### 3.1 Signing Approvals

Each approval MUST be signed with the agent's registered Ed25519 key (see T147).

**Canonical payload** (UTF-8 bytes):

```
{document_slug}\n{reviewer_id}\n{status}\n{at_version}\n{timestamp_ms}
```

Example:
```
my-spec-doc\nagent-alice\nAPPROVED\n3\n1700000000000
```

The 64-byte Ed25519 signature is sent as `sig_hex` (128-char lowercase hex).

### 3.2 Submission

```http
POST /api/v1/documents/:slug/bft/approve
Content-Type: application/json

{
  "status": "APPROVED",
  "sig_hex": "<128-char hex>",
  "canonical_payload": "<the payload string that was signed>",
  "comment": "Optional human-readable reason"
}
```

**Response (200 OK)**:
```json
{
  "slug": "my-doc",
  "approvalId": "abc12345",
  "status": "APPROVED",
  "sigVerified": true,
  "chainHash": "<64-char hex>",
  "bftF": 1,
  "quorum": 3,
  "currentApprovals": 2,
  "quorumReached": false
}
```

### 3.3 Byzantine Conflict Detector

If an agent submits contradictory votes (APPROVED and REJECTED for the same document), the server:

1. Detects the contradiction in the approval ledger
2. Revokes the agent's Ed25519 key (`agent_pubkeys.revoked_at = NOW()`)
3. Emits a `bft.byzantine_slash` event to the document event log
4. Returns `403 BYZANTINE_DETECTED`

### 3.4 Self-Approval Prevention

An agent MUST NOT approve its own submission. The backend enforces this via the `approval.self_approval_forbidden` check.

---

## 4. Tamper-Evident Chain

Every approval is chained to the previous via SHA-256:

```
chain_hash = SHA-256(prev_chain_hash || approval_json)
```

Where `approval_json` is:
```json
{"documentId":"...","reviewerId":"...","status":"APPROVED","atVersion":3,"timestamp":1700000000000}
```

The genesis approval uses `prev_chain_hash = 0x0000...0000` (64 zeros).

### 4.1 Chain Verification

```http
GET /api/v1/documents/:slug/chain
```

**Response**:
```json
{
  "valid": true,
  "length": 5,
  "firstInvalidAt": null,
  "slug": "my-doc"
}
```

If a stored record has been tampered:
```json
{
  "valid": false,
  "length": 5,
  "firstInvalidAt": 2,
  "slug": "my-doc"
}
```

---

## 5. Rust Core

The BFT primitives live in `crates/llmtxt-core/src/bft.rs`:

```rust
pub fn bft_quorum(_n: u32, f: u32) -> u32   // 2f+1
pub fn bft_max_faults(n: u32) -> u32         // (n-1)/3
pub fn bft_check(votes: u32, f: u32) -> bool // votes >= 2f+1
pub fn hash_chain_extend(prev: &[u8; 32], event: &[u8]) -> [u8; 32]
pub fn verify_chain(events: &[ChainedEvent]) -> bool
```

---

## 6. SDK

```ts
import {
  signApproval,
  submitSignedApproval,
  getBFTStatus,
  verifyApprovalChain,
} from 'llmtxt/sdk';

// Sign and submit an approval
const envelope = await signApproval(identity, slug, agentId, 'APPROVED', atVersion);
const result = await submitSignedApproval(baseUrl, slug, envelope, authHeaders);

// Check quorum status
const status = await getBFTStatus(baseUrl, slug, authHeaders);
console.log(`Quorum: ${status.currentApprovals}/${status.quorum}`);

// Verify chain integrity
const chain = await verifyApprovalChain(baseUrl, slug, authHeaders);
assert(chain.valid);
```

---

## 7. Database Schema Changes (T251)

New columns on `approvals` table:

| Column | Type | Description |
|--------|------|-------------|
| `sig_hex` | text | Ed25519 signature (128 hex chars) |
| `canonical_payload` | text | The exact string that was signed |
| `chain_hash` | text | SHA-256 hash extending the chain |
| `prev_chain_hash` | text | Previous approval's chain hash |
| `bft_f` | integer | BFT f value at time of approval |

New column on `documents` table:

| Column | Type | Description |
|--------|------|-------------|
| `bft_f` | integer | Max Byzantine faults tolerated (default 1) |

---

## 8. Acceptance Criteria

- [x] `bft_quorum(f=1) = 3`
- [x] 3 distinct signed approvals → quorum reached
- [x] 2 Byzantine votes do NOT reach quorum
- [x] Double-vote (APPROVED + REJECTED by same agent) → key revoked + audit event
- [x] Tampered chain entry → `GET /chain` returns `{ valid: false, firstInvalidAt: N }`
- [x] 10-event chain verifies; tamper at index 5 detected
- [x] SDK `signApproval()` + `submitSignedApproval()` work end-to-end
- [x] Rust core: `bft_quorum()`, `hash_chain_extend()`, `verify_chain()` all pass unit tests
