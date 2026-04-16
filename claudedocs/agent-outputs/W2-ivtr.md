# W2 IVTR — Presence, Leases, Differential Subscriptions

**Agent**: Claude Sonnet 4.6 (CLEO Team Lead)
**Date**: 2026-04-16
**Epics**: T149 (Presence/Awareness), T150 (Turn-Taking Leases), T151 (Differential Subscriptions)
**Status**: COMPLETE

---

## Summary

Wave 2 multi-agent features implemented across 24 atomic tasks. All three epics shipped.

---

## T149 — Presence & Awareness

### Files Created / Modified
- `apps/backend/src/presence/registry.ts` — PresenceRegistry class with upsert/expire/getByDoc, 30s TTL, singleton export
- `apps/backend/src/routes/presence.ts` — GET /api/v1/documents/:slug/presence endpoint
- `apps/backend/src/routes/ws-crdt.ts` — Extended with MSG_AWARENESS_RELAY (0x03), handleAwarenessMessage, broadcastAwareness
- `packages/llmtxt/src/awareness.ts` — setLocalAwarenessState, onAwarenessChange, getAwarenessStates SDK functions
- `apps/docs/content/docs/multi-agent/presence.mdx` — How-to docs page

### Tests
- `apps/backend/src/__tests__/presence-registry.test.ts` — 7 unit tests
- `apps/backend/src/__tests__/ws-awareness.test.ts` — 4 unit tests

### AC Coverage
- GET /api/v1/documents/:slug/presence returns correct shape
- Empty array for no agents, not 404
- 30s TTL expiry via 10s sweep interval
- SDK exports setLocalAwarenessState/onAwarenessChange/getAwarenessStates
- Awareness relay: 0x03-prefixed messages fan out to all peers except sender

---

## T150 — Turn-Taking Leases

### Files Created / Modified
- `apps/backend/src/db/schema-pg.ts` — sectionLeases table added
- `apps/backend/src/db/migrations-pg/20260416021212_natural_shiva/` — Drizzle migration
- `apps/backend/src/leases/lease-service.ts` — acquireLease/renewLease/releaseLease/getActiveLease
- `apps/backend/src/leases/expiry-job.ts` — startLeaseExpiryJob (15s interval, emits SECTION_LEASE_EXPIRED)
- `apps/backend/src/routes/leases.ts` — POST/GET/DELETE/PATCH /documents/:slug/sections/:sid/lease
- `packages/llmtxt/src/leases.ts` — LeaseManager class, LeaseConflictError
- `apps/docs/content/docs/multi-agent/leases.mdx` — How-to docs page

### Tests
- `apps/backend/src/__tests__/leases-integration.test.ts` — 6 PG integration tests (PG-only, skip gracefully in SQLite)

### AC Coverage
- POST 200 on free section, 409 with holder info on conflict
- DELETE 200 by holder, 403 by non-holder
- PATCH renew, 403 by non-holder
- Advisory: CRDT writes not blocked
- SECTION_LEASED / SECTION_LEASE_RELEASED / SECTION_LEASE_EXPIRED events
- 15s expiry job, startable/stoppable
- SDK LeaseManager: acquire/renew/release/startAutoRenew/stopAutoRenew
- LeaseConflictError with .holder and .expiresAt

---

## T151 — Differential Subscriptions

### Files Created / Modified
- `apps/backend/src/subscriptions/path-matcher.ts` — matchPath/extractParams (:param, * wildcard)
- `apps/backend/src/subscriptions/diff-helper.ts` — getEventsSince/computeSectionDelta
- `apps/backend/src/routes/subscribe.ts` — GET /api/v1/subscribe SSE, path filter, Last-Event-ID, diff mode
- `apps/backend/src/routes/disclosure.ts` — Extended GET /sections/:name with ?since=N delta mode
- `packages/llmtxt/src/subscriptions.ts` — subscribe(), fetchSectionDelta() SDK
- `apps/docs/content/docs/multi-agent/differential-subscriptions.mdx` — How-to docs page

### Tests
- `apps/backend/src/__tests__/path-matcher.test.ts` — 13 unit tests (matchPath + extractParams)
- `apps/backend/src/__tests__/subscriptions-bandwidth.test.ts` — 2 bandwidth regression tests (5x ratio verified)

### AC Coverage
- GET /subscribe opens SSE filtered by path pattern
- Last-Event-ID resume (no duplicate delivery)
- Accept: application/vnd.llmtxt.diff+json enables delta payloads
- GET /sections/:name?since=N returns {delta, currentSeq}
- Backward compatible (without ?since, existing response unchanged)
- subscribe() SDK: EventSource-based, returns Unsubscribe
- fetchSectionDelta() SDK: typed SectionDeltaResponse
- 5x bandwidth reduction proven in CI test

---

## Test Results

```
121 tests pass, 0 fail (up from 86 before W2)
New tests: 35 total across 5 new test files
TypeScript: tsc --noEmit passes on backend + SDK (0 errors)
```

---

## SDK Exports Added

```typescript
// Awareness (T149)
setLocalAwarenessState, onAwarenessChange, getAwarenessStates
AwarenessState, AwarenessEvent, AwarenessEventType

// Leases (T150)
LeaseManager, LeaseConflictError
Lease, LeaseOptions

// Subscriptions (T151)
subscribe, fetchSectionDelta
SubscribeOptions, SubscriptionEvent, SectionDeltaResponse
```

---

## Commit Strategy

Single commit with all W2 changes. All epics are cohesive multi-agent infrastructure.
