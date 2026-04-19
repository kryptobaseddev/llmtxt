# T735 Audit: Advisory-Only Lease Implementation

**Task**: T735 — Audit `apps/backend/src/routes/leases.ts` + section write handlers  
**Date**: 2026-04-19  
**Author**: T704 Lead Agent

---

## 1. Current advisory-only flow

### 1.1 Lease acquisition path (`routes/leases.ts`)

File: `apps/backend/src/routes/leases.ts`

The lease POST/GET/DELETE/PATCH handlers manage the `section_leases` table via
`app.backendCore.acquireLease()`, `getLease()`, `releaseLease()`, `renewLease()`.

Key comment at line 11:
```
// Leases are ADVISORY — CRDT writes from non-holders are not blocked.
// 409 is a cooperative signal only.
```

The `acquireLease` handler at lines 32-77 returns 409 on conflict, but this is
a cooperative signal: it only fires when a second agent *also calls POST /lease*.
A non-cooperating agent that skips the lease endpoint entirely encounters zero
enforcement.

### 1.2 Section write path — `routes/crdt.ts`

File: `apps/backend/src/routes/crdt.ts`

The CRDT write endpoint is `POST /documents/:slug/sections/:sid/crdt-update`
(lines 72-133).

**Current checks (lines 86-112)**:
1. `getDocumentBySlug` — 404 if document not found
2. `doc.ownerId === request.user!.id` — 403 if not document owner (RBAC)
3. `getCrdtState` — 503 if section not yet initialized

**Gap**: There is NO check for an active section lease before applying
the CRDT update. A non-cooperating agent that has editor role can call
`POST .../crdt-update` without acquiring a lease and overwrite the
lease-holder's work. This is the #1 "Never duplicate work" gap.

### 1.3 Lease service (`leases/lease-service.ts`)

File: `apps/backend/src/leases/lease-service.ts`

Implements:
- `acquireLease(db, docId, sectionId, agentId, ttlMs)` — inserts into `section_leases`; returns null on conflict
- `renewLease(db, leaseId, agentId, ttlMs)` — extends TTL
- `releaseLease(db, leaseId, agentId)` — deletes row
- `getActiveLease(db, docId, sectionId)` — SELECT with `expiresAt > now`

The service has all the primitives needed to support enforcement but none of
the routes call it at write time.

### 1.4 BackendCore `LeaseOps` interface

Interface `LeaseOps` in `packages/llmtxt/src/core/backend.ts` (line 618):
- `acquireLease(params)` — resource = `"${slug}:${sid}"`
- `getLease(resource)` — used in `leases.ts` for GET status
- `releaseLease(resource, holder)`
- `renewLease(resource, holder, ttlMs)`

The lease resource key is composite: `"${slug}:${sid}"` (same pattern as route).

---

## 2. Gap summary

| Write endpoint | Lease check? | Enforcement mode |
|---|---|---|
| `POST /documents/:slug/sections/:sid/crdt-update` | No | Advisory only — any editor can write |
| `WS /documents/:slug/sections/:sid/collab` | No | Advisory only — WS CRDT update not gated |

---

## 3. Proposed enforcement point

Add lease check in `routes/crdt.ts` at the `POST .../crdt-update` handler,
**after** RBAC check and **before** `getCrdtState` / `applyCrdtUpdate`:

```typescript
if (process.env.STRICT_LEASES === '1') {
  const resource = `${slug}:${sid}`;
  const lease = await request.server.backendCore.getLease(resource);
  if (lease && lease.holder !== agentId) {
    return reply.status(409).send({
      error: 'lease_held',
      holder: lease.holder,
      expiresAt: new Date(lease.expiresAt).toISOString(),
    });
  }
  // If-Match validation: if header present, must match stored lease id
  const ifMatch = request.headers['if-match'];
  if (ifMatch && lease && ifMatch !== lease.id) {
    return reply.status(409).send({
      error: 'lease_token_mismatch',
      holder: lease.holder,
      expiresAt: new Date(lease.expiresAt).toISOString(),
    });
  }
}
```

**Backwards compatibility**: The check is gated by `STRICT_LEASES=1`.
Without the env var, behavior is completely unchanged.

---

## 4. Files to change for T736

| File | Change |
|---|---|
| `apps/backend/src/routes/crdt.ts` | Add lease enforcement block after RBAC check |
| `apps/backend/.env.example` | Add `STRICT_LEASES` comment block |

## 5. Files to create for T737/T738

| File | Purpose |
|---|---|
| `apps/backend/src/__tests__/lease-enforcement.test.ts` | Non-cooperating agent + 2-agent race tests |

## 6. Files to create for T739

| File | Purpose |
|---|---|
| `docs/api/leases.md` | API reference for If-Match + STRICT_LEASES |
