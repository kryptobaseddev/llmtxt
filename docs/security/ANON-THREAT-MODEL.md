# LLMtxt Anonymous Mode Threat Model

**Version**: 1.0.0  
**Status**: ACTIVE  
**Epic**: T167  
**Date**: 2026-04-18  

---

## 1. Scope

This document defines the formal threat model for anonymous (unauthenticated) users of the LLMtxt API. It enumerates what anonymous users MUST be permitted to do, what they MUST NOT be permitted to do, the attack surface they create, and the mitigations in force.

Anonymous access is preserved because LLM agents frequently read public documents without registering. The threat is that unconstrained anonymous access starves authenticated users and creates a vector for abuse.

---

## 2. Anonymous User Definition

An anonymous user is one who:

- Has no registered account (no email/password), OR
- Has an ephemeral account created via `POST /auth/sign-in/anonymous` (better-auth anonymous plugin)
- Holds a session token with `isAnonymous=true` on the `users` row
- Has no persistent identity between sessions (a fresh anonymous session is a new user)

---

## 3. Capability Matrix

### 3.1 What anonymous users MAY do

| Endpoint | Method | Condition | Rate category |
|----------|--------|-----------|---------------|
| `GET /documents/:slug` | GET | Document `visibility='public'` | read |
| `GET /documents/:slug/overview` | GET | Document `visibility='public'` | read |
| `GET /documents/:slug/sections` | GET | Document `visibility='public'` | read |
| `GET /documents/:slug/toc` | GET | Document `visibility='public'` | read |
| `GET /documents/:slug/lines` | GET | Document `visibility='public'` | read |
| `GET /documents/:slug/search` | GET | Document `visibility='public'` | read |
| `GET /documents/:slug/query` | GET | Document `visibility='public'` | read |
| `POST /compress` | POST | Any (creates anon doc) | write / doc-create |
| `POST /signed-urls` | POST | Requester is anon doc owner | write |
| `POST /auth/sign-in/anonymous` | POST | Always (starts anon session) | auth |
| `POST /auth/sign-up/email` | POST | Always (claim flow) | auth |
| `GET /auth/get-session` | GET | Always | auth |
| `GET /health` | GET | Always | exempt |
| `GET /ready` | GET | Always | exempt |
| `GET /llms.txt` | GET | Always | read |
| `GET /well-known-agents` | GET | Always | read |
| `POST /documents/:slug/lifecycle` | POST | Requester is anon doc owner | write |
| `GET /versions/:slug` | GET | Document `visibility='public'` | read |
| `GET /versions/:slug/:number` | GET | Document `visibility='public'` | read |

### 3.2 What anonymous users MUST NOT do

| Action | Endpoint(s) | Why |
|--------|-------------|-----|
| Create versions on documents they do not own | `POST /versions`, `POST /merge` | Requires `write` permission |
| Approve documents | `POST /documents/:slug/approvals` | Requires `approve` permission — BFT quorum |
| Modify lifecycle of documents they do not own | `POST /documents/:slug/lifecycle` | Requires `manage` permission |
| Access private documents (`visibility='private'` or `'org'`) | Any `/documents/:slug/*` | Returns 404 (not 403) — no existence leak |
| Create API keys | `POST /api-keys` | `requireRegistered` guard |
| Create agent keys | `POST /agent-keys` | `requireRegistered` guard |
| Manage organizations | Any `/organizations/*` | `requireRegistered` guard |
| Access billing | Any `/billing/*` | `requireAuth` + `requireRegistered` guard |
| Access audit log | `GET /audit-verify` | `requireAuth` guard |
| Read CRDT state | `GET /crdt/:slug` | `requireAuth` guard |
| Read blob attachments | `GET /blobs/*` | `requireAuth` guard |
| Access scratchpad | Any `/scratchpad/*` | Falls back to `'anonymous'` agentId — still gated by document ownership |
| Access admin dashboard | Any `/admin/*` | `requireAdmin` guard |

---

## 4. Threat Catalog

### THREAT-ANON-01: Unauthenticated Read Amplification

**Description**: An attacker issues high-volume read requests to public document endpoints to probe for sensitive content or to exhaust API capacity for legitimate users.

**Impact**: Denial of service against authenticated users; information enumeration.

**Mitigations**:
- Per-IP rate limit: 60 read requests per minute (configurable: `ANON_READ_LIMIT_PER_MIN`)
- Per-session token: 300 requests per hour
- Both limits are independent — rotating IPs does not defeat the session limit; rotating session tokens does not defeat the IP limit
- Standard rate-limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) on every response
- 429 response includes `Retry-After` header

### THREAT-ANON-02: Anonymous Document Create Flood

**Description**: An attacker calls `POST /compress` repeatedly to fill the document store with garbage, exhausting storage and polluting search indexes.

**Impact**: Storage exhaustion; search quality degradation; DoS for legitimate users.

**Mitigations**:
- Per-IP document create rate limit: 1 document per hour (configurable: `ANON_CREATE_LIMIT_PER_HOUR`)
- Per-IP write rate limit: 10 mutations per minute (configurable: `ANON_WRITE_LIMIT_PER_MIN`)
- `enforceDocumentLimit` middleware checks per-account document quota
- Anonymous documents auto-archive after 30 days unless claimed by a registered user
- Anonymous session expires 24h after last activity; expired sessions cannot own new documents

### THREAT-ANON-03: Anonymous Write Abuse

**Description**: An attacker with an anonymous session token modifies documents they own to inject malicious content into public document stores, or performs lifecycle state manipulation.

**Impact**: Content injection; workflow disruption.

**Mitigations**:
- Per-IP write rate limit: 10 mutations per minute
- Per-session write rate limit: counted within the 300 req/hour session quota
- All write endpoints check document ownership before mutating
- Lifecycle transitions gated by `requireOwnerAllowAnonParams` — must be the document's `ownerId`
- Anonymous users MUST NOT approve documents — `canApprove` requires `approve` permission not granted to non-owners

### THREAT-ANON-04: Rate-Limit Evasion via IP Rotation

**Description**: An attacker rotates source IPs (VPN, proxy, botnet) to defeat per-IP rate limits.

**Impact**: Rate limit bypass for high-volume attacks.

**Mitigations**:
- Per-session token limit (300 req/hour) is independent of IP — IP rotation does not help once the session token is exhausted
- `X-Anonymous-Id` derived from IP + User-Agent + Accept-Language hash (salted per rotation epoch) — provides a second rate-limit axis that correlates requests from the same browser fingerprint even across IP changes
- Anonymous sessions expire after 24h — attacker must obtain a new token, which itself is rate-limited at the auth tier (10 sign-in attempts per minute per IP)
- No mechanism exists to generate large numbers of session tokens quickly while rotating IPs — `POST /auth/sign-in/anonymous` is at the `authRateLimit` tier

### THREAT-ANON-05: Identity Spoofing via X-Agent-Id Header

**Description**: An attacker sets `X-Agent-Id` to impersonate a known agent and bypass per-agent rate limiting or audit attribution.

**Impact**: Rate-limit bypass; audit log poisoning.

**Mitigations**:
- `X-Agent-Id` is an unverified hint used only as a best-effort rate-limit key fallback when `verifyAgentSignature` has not run
- For write operations, agent identity is derived from `request.user.id` (authenticated session), not from the header
- Signing is required for agent identity claims to be trusted in BFT, audit, and versioning contexts (`verifyAgentSignature` middleware on relevant routes)
- Anonymous users cannot register agent pubkeys — `POST /agent-keys` requires `requireAuth` + `requireRegistered`

### THREAT-ANON-06: Anonymous Approval Injection

**Description**: An attacker uses an anonymous session to call approval endpoints (`POST /documents/:slug/approvals`) to manipulate BFT consensus.

**Impact**: Fraudulent document approvals; BFT quorum manipulation.

**Mitigations**:
- `canApprove` RBAC middleware runs before the approval handler
- Anonymous users have no `approve` permission unless they are the document owner AND the document's `approvalAllowedReviewers` explicitly includes them (which is only possible if a registered owner granted that)
- In practice: anonymous users MUST NOT be listed as BFT reviewers — the approval handler rejects non-listed reviewers with 403
- Session expiry (24h) limits the window during which a stolen anonymous token can be used for approval injection

---

## 5. Rate Limit Contract

All limits are configurable via environment variables. Defaults are shown.

| Category | Scope | Default | Env var |
|----------|-------|---------|---------|
| Read | Per IP | 60 req/min | `ANON_READ_LIMIT_PER_MIN` |
| Write | Per IP | 10 req/min | `ANON_WRITE_LIMIT_PER_MIN` |
| Document create | Per IP | 1 doc/hour | `ANON_CREATE_LIMIT_PER_HOUR` |
| Session total | Per session token | 300 req/hour | `ANON_SESSION_LIMIT_PER_HOUR` |
| Auth (sign-in/sign-up) | Per IP | 10 req/min | (existing `authRateLimit`) |

**Dual enforcement**: The per-IP and per-session limits are evaluated independently. A request is accepted only if BOTH the IP limit AND the session limit have remaining capacity.

**Non-negotiable**: IP rotation MUST NOT defeat session limits. Session rotation MUST NOT defeat IP limits.

---

## 6. Session Expiry Contract

| Event | Deadline |
|-------|----------|
| Anonymous session last-activity expiry | 24 hours after last request |
| Anonymous-created document auto-archive | 30 days after creation (unless claimed) |
| Session token rotation | New token issued every 12 hours (refresh dance) |
| Expired session token response | `401 SESSION_EXPIRED` |

**Contract**: The API MUST NOT extend an anonymous session beyond its documented deadline. No implicit extension occurs. Clients that need persistence MUST claim the session via `POST /auth/claim-anonymous`.

---

## 7. X-Anonymous-Id Header

The `X-Anonymous-Id` response header provides a non-persistent, non-PII identifier for rate-limit isolation.

**Derivation**:
```
epoch    = floor(unix_ms / 43_200_000)         // 12-hour epoch
salt     = HMAC-SHA256(ANON_ID_SALT, str(epoch))
anon_id  = HMAC-SHA256(salt, IP + "|" + UA + "|" + AcceptLang)[0:16] (hex)
```

**Properties**:
- No PII: IP is only used as input to a keyed hash; it is not stored or transmitted
- Non-persistent: Changes every 12 hours — cannot be used as a persistent tracker
- Rate-limit isolation: Two anonymous requests with the same `X-Anonymous-Id` within a 12-hour epoch are treated as the same rate-limit subject
- Not an authentication mechanism: MUST NOT be used to grant or deny access

---

## 8. Claim Flow

Anonymous users MAY claim their session to transfer document ownership to a registered account:

1. Anonymous user creates documents during their session
2. User registers via `POST /auth/sign-up/email` with `anonToken` body field set to their current session token
3. Server validates the anonymous session token
4. Server transfers all documents where `ownerId = anonUserId` to the new registered user's ID
5. Anonymous session is terminated; new registered session begins

**Invariants**:
- A claimed anonymous session MUST NOT remain active after the claim
- All document ownership MUST transfer atomically (single transaction)
- If the email is already registered, the server returns 409 — claim is rejected

---

## 9. What is Out of Scope

- Removing anonymous access entirely (would break public document reads by LLM agents)
- KYC or identity verification for anonymous users
- Rate limiting based on device fingerprinting or JavaScript challenges (API is consumed by headless agents)
- WebSocket anonymous access — WebSocket endpoints (`/ws-crdt`, `/ws`) use their own authentication

---

## 10. Review

This document was produced as part of Epic T167 (Security: Anonymous mode threat model). It supersedes any implicit threat model that previously existed in code comments. Changes to anonymous access capabilities or rate limits MUST update this document.
