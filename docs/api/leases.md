# Section Leases API Reference

**Version**: 2026.4.7+  
**Related tasks**: T279, T704

---

## Overview

Section leases allow agents to claim exclusive editing rights on a document section.
Leases are **advisory by default** — they signal intent but do not block concurrent writes.

When `STRICT_LEASES=1` is set in the server environment, leases are **enforced** at the
write path. A write to a leased section by a non-holder returns HTTP 409 Conflict.

---

## Endpoints

### POST /api/v1/documents/:slug/sections/:sid/lease

Acquire (or re-acquire) an advisory lease on a section.

**Request body**

```json
{
  "leaseDurationSeconds": 30,
  "reason": "Editing introduction section"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `leaseDurationSeconds` | integer (1–300) | Yes | Lease TTL |
| `reason` | string | No | Human-readable purpose |

**Success (200)**

```json
{
  "leaseId": "01HX9...",
  "holder": "agent-abc",
  "expiresAt": "2026-04-19T05:30:00.000Z"
}
```

**Conflict (409)** — another agent holds the lease

```json
{
  "error": "SECTION_LEASED",
  "holder": "agent-xyz",
  "expiresAt": "2026-04-19T05:28:00.000Z"
}
```

---

### GET /api/v1/documents/:slug/sections/:sid/lease

Get the current active lease for a section.

**Success (200)**

```json
{
  "leaseId": "01HX9...",
  "holder": "agent-abc",
  "expiresAt": "2026-04-19T05:30:00.000Z"
}
```

**Not found (404)**

```json
{ "error": "NO_ACTIVE_LEASE" }
```

---

### DELETE /api/v1/documents/:slug/sections/:sid/lease

Release a held lease. Only the holder can release.

**Success (200)**

```json
{ "released": true }
```

**Forbidden (403)** — caller is not the holder

```json
{
  "error": "FORBIDDEN",
  "message": "Only the lease holder can release it"
}
```

---

### PATCH /api/v1/documents/:slug/sections/:sid/lease

Renew a held lease (extend TTL). Only the holder can renew.

**Request body**

```json
{ "leaseDurationSeconds": 60 }
```

**Success (200)**

```json
{
  "leaseId": "01HX9...",
  "holder": "agent-abc",
  "expiresAt": "2026-04-19T05:31:00.000Z"
}
```

---

## Write-path enforcement (STRICT_LEASES)

### Environment variable

```
STRICT_LEASES=1
```

When set, `POST /documents/:slug/sections/:sid/crdt-update` checks the
`section_leases` table before applying any CRDT update.

| Condition | Outcome |
|---|---|
| No active lease | Write proceeds normally |
| Lease held by requesting agent | Write proceeds normally |
| Lease held by different agent | HTTP 409 — write rejected |

### 409 Conflict response

```json
{
  "error": "lease_held",
  "holder": "<agentId of lease holder>",
  "expiresAt": "<ISO 8601 timestamp>"
}
```

Clients MUST use `expiresAt` to determine when the lease expires and implement
retry-after-expiry logic rather than tight-looping.

**Security**: The lease token (`leaseId`) is **never** included in 409 responses
to prevent token harvesting by non-holders.

---

## If-Match header

The lease-holder may include an `If-Match: <leaseId>` header on CRDT update
requests to assert exclusive ownership. The server validates the token against
the stored lease.

This detects races where the caller's lease was released and re-acquired by
another agent between the lease check and the write.

**Token mismatch (409)**

```json
{
  "error": "lease_token_mismatch",
  "holder": "<current lease holder agentId>",
  "expiresAt": "<ISO 8601 timestamp>"
}
```

### Example: lease-holder write with If-Match

```http
POST /api/v1/documents/my-doc/sections/intro/crdt-update
Authorization: Bearer <api-key>
Content-Type: application/json
If-Match: 01HX9YZABCD

{
  "updateBase64": "<base64-encoded Loro update>"
}
```

---

## Backwards compatibility

Without `STRICT_LEASES=1`, all lease endpoints function as before (advisory
signals only). Clients that do not acquire leases continue to write without
restriction.

`STRICT_LEASES=1` is opt-in and safe to enable incrementally:

1. Deploy with `STRICT_LEASES=1`.
2. Update cooperative agents to acquire leases before writing.
3. Non-cooperative agents are blocked — they receive 409 with retry guidance.

---

## Requirements

- PostgreSQL backend: `section_leases` table is PostgreSQL-only.
  SQLite mode does not support lease enforcement.
- Migrations must have run to create the `section_leases` table.

---

## CHANGELOG

### v2026.4.7

- **T704**: Advisory leases converted to enforced conditional writes when
  `STRICT_LEASES=1` is set. Non-cooperating agents blocked with 409 at the
  `crdt-update` write path.
- **T704**: `If-Match: <leaseId>` header supported on `crdt-update` for
  lease-holder token validation.
- **T704**: 409 responses include `holder` + `expiresAt` for client retry logic.
  Lease tokens are never included in error responses.
