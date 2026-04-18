# Data Residency — LLMtxt

> **Document type**: Technical and legal compliance documentation
> **Date**: 2026-04-18
> **Version**: 1.0.0
> **Scope**: LLMtxt platform — api.llmtxt.my backend, Postgres database, S3/R2 blob storage, Cloudflare CDN
>
> **Audience**: Enterprise customers, data protection officers, compliance teams, engineering.

---

## 1. Current State (as of 2026-04-18)

LLMtxt currently operates in a **single-region configuration**. All data is stored and processed in the United States.

| Data category | Storage location | Region | Hosting provider |
|---|---|---|---|
| Documents (content, metadata) | PostgreSQL managed by Railway | US (Railway default) | Railway (Railway, Inc.) |
| Version history and patches | PostgreSQL | US (Railway default) | Railway |
| Audit logs (tamper-evident hash chain) | PostgreSQL | US (Railway default) | Railway |
| Binary blob attachments | S3-compatible object store | US (configured) | AWS S3 or Cloudflare R2 |
| Sessions and API keys | PostgreSQL | US (Railway default) | Railway |
| Agent presence and CRDT state | PostgreSQL | US (Railway default) | Railway |
| Embeddings (pgvector) | PostgreSQL | US (Railway default) | Railway |
| Real-time events (in-transit) | WebSocket connections through Cloudflare | Global CDN edge | Cloudflare |
| Application logs | Loki (Railway-hosted) | US (Railway default) | Railway |
| Metrics and traces | Prometheus/Tempo (Railway-hosted) | US (Railway default) | Railway |

**Important limitation**: LLMtxt does not currently support tenant-level data residency selection. All tenants share the same Postgres instance in the same Railway region. Customers who require EU data residency cannot be served today without manual operational steps.

---

## 2. Data Categories and Classification

### 2.1 Customer Data (highest sensitivity)

| Data | Tables | Contains PII? | Retention |
|---|---|---|---|
| Document content | `documents.compressed_data` | Possibly (user-authored text) | Until `expires_at` or manual deletion |
| Version history | `versions.patch_text` | Possibly | Linked to document lifetime |
| User email addresses | `users.email` | Yes | Until account deletion |
| User names | `users.name` | Yes | Until account deletion |
| IP addresses (sessions) | `sessions.ip_address` | Yes | Session duration |
| User agent strings | `sessions.user_agent` | Indirect | Session duration |
| Agent public keys | `agent_pubkeys.public_key` | No (cryptographic material) | Until agent deregistration |

### 2.2 Operational Data (medium sensitivity)

| Data | Tables | Contains PII? | Retention |
|---|---|---|---|
| Audit log actor IDs | `audit_logs.actor_id` | Indirect (userId) | 90 days minimum (SOC 2) |
| API key hashes | `api_keys.key_hash` | No (hashed) | Until revocation |
| Organization names | `organizations.name` | Possibly | Until org deletion |
| Webhook URLs | `webhooks.url` | Possibly (if URL contains PII) | Until webhook deletion |

### 2.3 System Data (low sensitivity)

| Data | Tables | Contains PII? | Retention |
|---|---|---|---|
| Backup files (S3) | N/A | Encrypted (age) | 7 daily, 4 weekly, 12 monthly |
| Prometheus metrics | N/A | No | 30 days |
| Loki logs | N/A | Possibly (request logs) | 30 days |

---

## 3. Planned Multi-Region Architecture

### 3.1 Target Regions

LLMtxt plans to support the following regions in 2026:

| Region | Target deployment | GDPR compliant storage? | Notes |
|---|---|---|---|
| US (us-west2) | Current — LIVE | No (outside EU) | Default region |
| EU (eu-west) | Planned — Q3 2026 | Yes | Awaiting Railway EU region GA |
| APAC (ap-southeast) | Planned — Q4 2026 | N/A | Regional compliance TBD |

**Railway region availability**: As of 2026-04-18, Railway supports the following regions:
- `us-west2` (Oregon) — generally available
- `us-east4` (Virginia) — generally available
- `eu-west4` (Netherlands) — **generally available** — this is the EU residency target
- `ap-southeast1` (Singapore) — generally available

**EU target**: `eu-west4` (Netherlands, Google Cloud underlying) satisfies GDPR Article 44 requirements for EU data localization. Railway is a US company; a Data Transfer Impact Assessment (DTIA) is required for EU customers under GDPR Article 46 SCCs (Standard Contractual Clauses).

### 3.2 Multi-Region Deployment Model

The planned architecture separates tenants by region at the Postgres and S3 layer. Each region runs an independent Railway environment with its own Postgres instance and S3 bucket.

```
┌──────────────────────────────────────────────────────────┐
│                    Cloudflare (Global CDN)                │
│    api.llmtxt.my ─── routes by region header/config     │
└──────────────┬──────────────────┬───────────────────────┘
               │                  │
    ┌──────────▼──────┐  ┌────────▼──────────┐
    │  US region      │  │  EU region         │
    │  (us-west2)     │  │  (eu-west4)        │
    │                 │  │                   │
    │  ┌───────────┐  │  │  ┌─────────────┐  │
    │  │ PostgreSQL│  │  │  │ PostgreSQL  │  │
    │  │ (Railway) │  │  │  │ (Railway)   │  │
    │  └───────────┘  │  │  └─────────────┘  │
    │  ┌───────────┐  │  │  ┌─────────────┐  │
    │  │ S3/R2     │  │  │  │ S3 eu-west1 │  │
    │  │ us-east-1 │  │  │  │ or R2 EU    │  │
    │  └───────────┘  │  │  └─────────────┘  │
    └─────────────────┘  └───────────────────┘
```

**No cross-region data replication** — each tenant's data stays within their chosen region. A EU tenant's Postgres rows are never copied to US Postgres.

### 3.3 Tenant Region Selection

When multi-region support ships, tenants will select their region at organization creation time. The selection is permanent (data migration between regions requires a manual operational procedure and customer consent).

The `region` column added to `users` and `organizations` tables (see Section 4) records the tenant's selected region.

---

## 4. Database Schema Change

A Drizzle migration adds a `region` column to `users` and `organizations`. This is additive and backward-compatible.

**Migration file**: `apps/backend/src/db/migrations-pg/20260418100000_data_residency_region/`

See `apps/backend/src/db/migrations-pg/20260418100000_data_residency_region/migration.sql` for the raw SQL.

The `region` values are:
- `us` — United States (default, current)
- `eu` — European Union (eu-west4, Netherlands)
- `apac` — Asia-Pacific (ap-southeast1, Singapore)

When a new user registers, `region` defaults to `us`. When multi-region routing is live, users will select their region at signup and the routing layer will direct their requests to the correct regional backend.

---

## 5. API Request Routing for Region Enforcement

### 5.1 Current state

All requests route to the single US backend. No region enforcement exists today.

### 5.2 Planned enforcement

When regional backends are live:

1. **User signup** — tenant selects region. Stored in `users.region` and `organizations.region`.
2. **Every authenticated request** — API gateway (Cloudflare Worker or Railway routing) reads `X-LLMtxt-Region` hint from the auth token claim or a per-tenant routing table, and forwards to the correct regional backend.
3. **Cross-region guard** — Each regional backend validates that the requesting user's `region` matches the backend's own region environment variable (`LLMTXT_REGION`). If mismatched, the request returns `403 Wrong Region` with a redirect hint.
4. **Blob storage** — S3/R2 bucket is configured per-region. Blobs written by EU tenants go to the EU bucket; the `BLOB_S3_BUCKET` env var is set per-region deployment.

### 5.3 Interim controls (today)

Until multi-region is live, LLMtxt cannot offer EU data residency guarantees. Customers requiring GDPR Article 44 compliance should:
1. Self-host LLMtxt on EU infrastructure using the open-source packages (`llmtxt` npm, `llmtxt-core` crate).
2. Sign a DPA with LLMtxt acknowledging US data processing until EU region is live.
3. Review the Standard Contractual Clauses (SCCs) incorporated into the LLMtxt DPA template.

---

## 6. GDPR Considerations

### 6.1 Data subjects and lawful basis

| Processing activity | Lawful basis (GDPR Art. 6) | Notes |
|---|---|---|
| Account registration (email, name) | Contractual necessity (6.1.b) | Required to provide service |
| Document storage and collaboration | Contractual necessity (6.1.b) | Core service delivery |
| Audit logging | Legitimate interest (6.1.f) | Security and compliance requirement |
| Anonymous user session (24hr TTL) | Contractual necessity (6.1.b) | Service feature, minimal data |
| Marketing communications | Consent (6.1.a) | Not currently implemented; requires explicit opt-in when implemented |

### 6.2 Data Subject Rights

LLMtxt supports the following DSR operations today:

| Right | Mechanism | Status |
|---|---|---|
| Right of access (Art. 15) | API: `GET /api/v1/users/me` returns user record | Partial — does not export all associated documents |
| Right to rectification (Art. 16) | API: `PUT /api/v1/users/me` updates name | Met |
| Right to erasure (Art. 17) | Account deletion removes user row; cascade deletes sessions, API keys | Partial — document content with other contributors is not deleted |
| Right to portability (Art. 20) | SDK `exportAll()` command | Met — JSON/Markdown/plaintext export |
| Right to object (Art. 21) | Not implemented | Gap — tracked as T184-G9 |
| Right to restriction of processing (Art. 18) | Not implemented | Gap — tracked as T184-G9 |

**Gap T184-G9**: Implement full DSR request handling workflow (data export package, account deletion with content orphaning, restriction flags).

### 6.3 Data Transfers Outside EU

When a EU tenant's data is stored in the EU region:
- Postgres is on Railway's `eu-west4` deployment (Netherlands, Google Cloud)
- Railway, Inc. is a US company — a DTIA is required
- Standard Contractual Clauses (SCCs, 2021 EU Commission decision) are incorporated in the LLMtxt DPA template
- Cloudflare processes request metadata globally at edge nodes (cannot be restricted to EU PoPs on current plan)

---

## 7. Data Residency Roadmap

| Milestone | Target | Dependencies |
|---|---|---|
| Privacy policy published | 2026-05-15 | T188 DPA work |
| `region` column migration deployed | 2026-05-01 | This document + migration |
| EU region provisioned on Railway | 2026-07-01 | Railway eu-west4 availability confirmed |
| Multi-region routing in Cloudflare | 2026-07-15 | EU region live |
| EU tenants can select EU residency | 2026-08-01 | Routing + region column |
| APAC region | 2026-10-01 | Post-EU learnings |
| Full DSR workflow (T184-G9) | 2026-06-01 | Engineering sprint |

---

*Last updated: 2026-04-18 | Maintainer: Engineering | Next review: 2026-07-18*
