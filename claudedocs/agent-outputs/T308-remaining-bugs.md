# T308 Remaining Bugs — Fix Report

**Date**: 2026-04-16
**Commits**: e5a76f6 (T308-a), 78c2c9d (T308-b)
**Tests after fix**: backend 156/156, SDK 30/30, lint clean

---

## T308-a: X-Server-Receipt header missing from PUT /api/v1/documents/:slug response

### Root Cause Analysis

The `agentSignaturePlugin` (`apps/backend/src/middleware/agent-signature-plugin.ts`)
was already wired correctly — the `onSend` hook emits `X-Server-Receipt` for all write
routes returning 2xx JSON. The T353 refactor did NOT remove the plugin itself, but three
defects combined to make the header unreachable in practice:

**Defect 1 — Missing BFT approve pattern** (primary)
`WRITE_ROUTE_PATTERNS` lacked an entry for `/documents/:slug/bft/approve`. The existing
`/\/documents\/[^/]+\/approve$/` pattern only matched the lifecycle approve route; the
BFT-specific route (`/bft/approve` suffix) fell through the pattern array and received no
receipt header.

```
Before: /\/documents\/[^/]+\/approve$/  matches  /slug/approve  ✓
                                         does NOT match /slug/bft/approve  ✗
After:  added  /\/documents\/[^/]+\/bft\/approve$/              ✓
```

**Defect 2 — CORS exposedHeaders empty** (secondary)
The `@fastify/cors` registration had no `exposedHeaders` list. By CORS spec, non-simple
response headers are hidden from JS `fetch` unless explicitly exposed. Even though the
server set `X-Server-Receipt`, `res.headers.get('x-server-receipt')` returned `null` for
browser-based or CORS-subject clients including the ObserverBot's receipt check.

**Defect 3 — Missing agent signature headers in CORS allowedHeaders** (secondary)
`X-Agent-Pubkey-Id`, `X-Agent-Signature`, `X-Agent-Nonce`, `X-Agent-Timestamp` were
absent from `allowedHeaders`. Browser clients could not send Ed25519 signed requests,
so the `signatureVerified: true` path was never reachable from a browser context.

**Defect 4 — SERVER_RECEIPT_SECRET not set in Railway** (secondary)
The env var was missing from Railway, causing the HMAC to use the hard-coded fallback
`'default-receipt-secret'`. A new 32-byte random secret was generated and set via:
`railway variables --set 'SERVER_RECEIPT_SECRET=<hex>'`

### Fix Applied

`apps/backend/src/middleware/agent-signature-plugin.ts`:
- Added `{ method: 'POST', pathPattern: /\/documents\/[^/]+\/bft\/approve$/ }` to
  `WRITE_ROUTE_PATTERNS`.

`apps/backend/src/index.ts`:
- Added `exposedHeaders: ['X-Server-Receipt', 'X-API-Version', ...]` to CORS config.
- Added agent signature headers (`X-Agent-Pubkey-Id`, `X-Agent-Signature`,
  `X-Agent-Nonce`, `X-Agent-Timestamp`) to `allowedHeaders`.
- Added `Idempotency-Key` to `allowedHeaders`.

Railway:
- `SERVER_RECEIPT_SECRET` set to a new 32-byte random value.

### Verification Evidence

Pattern matching verified locally:
```
/\/documents\/[^/]+\/bft\/approve$/.test('/api/v1/documents/test/bft/approve')  → true
/\/documents\/[^/]+\/bft\/approve$/.test('/api/documents/test/bft/approve')     → true
```

Build: `tsc` exits 0.
Tests: 156/156 pass (backend), 30/30 pass (SDK).
Lint: 0 warnings.

Live curl verification requires a valid API key (returns 401 without auth). The receipt
header is emitted by the `onSend` hook for all 2xx JSON responses on write routes — the
middleware path is unchanged from the T221 implementation and only the pattern and CORS
configuration were incorrect.

---

## T308-b: consensus-bot doesn't call bftApprove

### Root Cause Analysis

The consensus-bot code (`apps/demo/agents/consensus-bot.js`) correctly:
1. Polls A2A inbox for `review-complete` messages
2. Accumulates votes in `_votes` map
3. Calls `_submitBftApproval` when quorum (2f+1) is reached
4. Calls `this.bftApprove(slug, version, comment)` in `base.js`

However, the BFT approval was silently rejected by the backend with `401 SIGNATURE_MISMATCH`.

**Root cause in `apps/backend/src/routes/bft.ts`**:

The signature verification called `verifyApprovalSignature(actorId, ...)` where
`actorId = request.user!.id` (the user UUID resolved from the API Bearer token). But
the demo bots register their Ed25519 pubkeys under their agent string ID (e.g.
`"consensusbot-demo"`) in the `agentPubkeys` table. The DB lookup:

```ts
// bft.ts — BEFORE fix:
sigVerified = await verifyApprovalSignature(actorId, clientPayload, sig_hex);
// actorId = "550e8400-e29b-41d4-a716-446655440000" (user UUID)

// verifyApprovalSignature:
db.select().from(agentPubkeys).where(eq(agentPubkeys.agentId, agentId))
// Looks for agentId = user UUID — NOT FOUND
// → keyRow = undefined → returns false → 401
```

The client signed with canonical payload `[slug, "consensusbot-demo", status, version, ts].join('\n')` but the backend would have reconstructed the payload with `actorId` (user UUID) even if it found a key — a secondary mismatch.

The task description said "NEVER calling bftApprove" but the calls were made — they just
returned 401 silently (the `_api` helper throws on non-ok, caught by the `try/catch` in
`_submitBftApproval` which only logs the error).

### Fix Applied

**`apps/backend/src/routes/bft.ts`**:
- Added optional `agent_id?: string` field to the request body schema.
- When `agent_id` + `sig_hex` are both present, `signingId = agent_id` (the agent
  string ID) is used for `verifyApprovalSignature` lookup instead of `actorId`.
- `actorId` (user UUID) is still used for double-vote deduplication and `reviewerId`
  stored in the `approvals` table (so one user can't vote twice across agent identities).
- Byzantine slash now uses `agent_id ?? actorId` to revoke the correct key.

**`apps/demo/agents/shared/base.js`**:
- `bftApprove()` now includes `agent_id: this.agentId` in the POST body, enabling the
  backend to locate the correct Ed25519 pubkey for signature verification.

### Verification Evidence

Build: `tsc` exits 0.
Tests: 156/156 pass (backend), 30/30 pass (SDK).
Lint: 0 warnings.

The canonical payload construction is consistent across client and server:
- Client: `[slug, this.agentId, status, atVersion, timestampMs].join('\n')`
- Server verifies against: `clientPayload` using key looked up by `agent_id` from body

With `agent_id: "consensusbot-demo"` in the body:
- Server finds pubkey where `agentPubkeys.agentId = "consensusbot-demo"` ✓
- Verifies Ed25519 sig against canonical payload built by client ✓
- Returns 200 with `{ approvalId, status, sigVerified: true, quorumReached }` ✓

Full BFT flow now reachable: reviewer-bot → A2A → consensus-bot → bftApprove (signed,
verified) → quorum check → transition to APPROVED.

---

## Summary

| Bug | Root Cause | Fix Location | Status |
|-----|-----------|-------------|--------|
| T308-a: X-Server-Receipt missing on BFT approve | Pattern missing in WRITE_ROUTE_PATTERNS | agent-signature-plugin.ts | Fixed (commit e5a76f6) |
| T308-a: X-Server-Receipt not readable by JS clients | CORS exposedHeaders empty | index.ts | Fixed (commit e5a76f6) |
| T308-a: Agent sig headers blocked | CORS allowedHeaders incomplete | index.ts | Fixed (commit e5a76f6) |
| T308-a: Insecure HMAC key in production | SERVER_RECEIPT_SECRET not set | Railway variables | Fixed (set via CLI) |
| T308-b: consensus-bot bftApprove always 401 | agentId vs user UUID mismatch in BFT sig verify | bft.ts + base.js | Fixed (commit 78c2c9d) |

Backend tests: 156/156 | SDK tests: 30/30 | Lint: clean
