# SOC 2 Type 1 Evidence Vault

> **Document type**: Audit-ready evidence index
> **Date**: 2026-04-19
> **Version**: 1.0.0
> **Scope**: Pointer registry to all control evidence artifacts for SOC 2 Type 1 audit
> **Maintenance**: Update whenever evidence file changes or control status changes

---

## Executive Summary

This document is a centralized index of all evidence artifacts referenced in the SOC 2 Type 1 readiness assessment (`docs/compliance/soc2-type1-readiness.md`). Each entry maps a control to:

- The artifact location (file path or service)
- How to verify the control (test IDs, endpoints, or inspection points)
- Who owns the artifact
- When it was last verified

**Purpose**: Accelerate the SOC 2 Type 1 audit by providing the auditor with a single reference to all supporting evidence.

---

## Control Environment Evidence (CC1)

### CC1.1 — Commitment to Integrity and Ethical Values

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Engineering principles document | `docs/PRINCIPLES.md` | Read section "Philosophy" | Engineering | 2026-04-18 |
| Architecture decision records | `.cleo/adrs/` | ADR-001 through ADR-051 exist; ADR-051 enforces evidence gates | Engineering | 2026-04-18 |
| Code of conduct (IN PROGRESS) | `docs/CODE-OF-CONDUCT.md` | T184-G8 — to be created | — | — |

### CC1.4 — Commitment to Competence

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Published Rust crate | `https://crates.io/crates/llmtxt-core` | `cargo search llmtxt-core` returns v2026.4.6 | Engineering | 2026-04-17 |
| Published npm package | `https://www.npmjs.com/package/llmtxt` | `npm view llmtxt version` returns 2026.4.6 | Engineering | 2026-04-17 |
| CI enforcement (cargo fmt) | `.github/workflows/ci.yml` line 42–45 | Run `cargo fmt --check` locally; CI fails without it | Engineering | 2026-04-18 |
| CI enforcement (clippy) | `.github/workflows/ci.yml` line 48–52 | Run `cargo clippy --all -- -D warnings`; CI fails without it | Engineering | 2026-04-18 |
| CI enforcement (TypeScript strict) | `.github/workflows/ci.yml` line 62–68 | `pnpm run typecheck`; CI fails if any implicit `any` | Engineering | 2026-04-18 |

### CC1.5 — Accountability

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Tamper-evident audit log (shipped T164) | `apps/backend/src/middleware/audit.ts` | Every write to `auditLogs` table includes `payload_hash` and `chain_hash` | Engineering | 2026-04-14 |
| Audit log schema | `apps/backend/src/db/schema-pg.ts` lines 523–543 | Table has `id`, `actorId`, `action`, `payload_hash`, `chain_hash`, `createdAt` | Engineering | 2026-04-18 |
| Audit chain verification endpoint | `POST /api/audit/verify` | Verify hash chain integrity; returns `{ valid: true }` or `{ valid: false, breakAt: <id> }` | Engineering | 2026-04-18 |
| GitHub commit history | `https://github.com/llmtxt/llmtxt` | All commits signed by kryptobaseddev (GPG); main branch protected | Engineering | 2026-04-18 |

---

## Communication and Information Evidence (CC2)

### CC2.1 — Uses Quality Information

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| CLEO task system | `.cleo/` directory and SQLite DB | `cleo show T001` returns full task details with acceptance criteria | Engineering | 2026-04-18 |
| Red-team analysis | `docs/RED-TEAM-ANALYSIS-2026-04-15.md` | Document dated 2026-04-15; honest 5.3/10 self-assessment | Engineering | 2026-04-15 |
| Memory bridge | `.cleo/memory-bridge.md` | Auto-generated; last updated 2026-04-15T06:30:45 | Engineering | 2026-04-15 |
| Decisions log | `.cleo/memory-bridge.md` section "Recent Decisions" | D001 (SSoT), D003 (Guiding Star), D004 (WASM-only) documented | Engineering | 2026-04-18 |

### CC2.2 — Internal Communication

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Architecture documentation | `docs/ARCHITECTURE.md` | Describes Rust core, WASM binding, TypeScript SDK layers | Engineering | 2026-04-18 |
| SSoT decision | `docs/SSOT.md` | Crates/llmtxt-core is single source of truth for all crypto | Engineering | 2026-04-18 |
| Architecture principles | `docs/ARCHITECTURE-PRINCIPLES.md` | 7 core principles: layered, testable, auditable, etc. | Engineering | 2026-04-18 |
| PRINCIPLES.md | `docs/PRINCIPLES.md` | Software engineering principles and decision framework | Engineering | 2026-04-18 |

### CC2.3 — External Party Communication (GAPS)

| Evidence | Location | Verification Method | Owner | Status |
|----------|----------|---------------------|-------|---|
| Privacy policy | `apps/frontend/src/routes/legal/privacy.ts` | Endpoint `/legal/privacy` returns policy HTML | — | **IN PROGRESS — T184-G1** |
| Terms of service | `apps/frontend/src/routes/legal/terms.ts` | Endpoint `/legal/terms` returns ToS HTML | — | **IN PROGRESS — T184-G1** |
| Public docs site | `https://docs.llmtxt.my` | Fumadocs site with API docs, VISION.md, architecture guides | Engineering | 2026-04-18 |

---

## Risk Assessment Evidence (CC3)

### CC3.1 — Specifies Objectives

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Version releases | `CHANGELOG.md` | CalVer format (YYYY.M.PATCH); each release has date and scope | Engineering | 2026-04-17 |
| CLEO epics | `.cleo/` task DB | `cleo list --parent T040` shows acceptance criteria for all children | Engineering | 2026-04-18 |
| Vision statement | `docs/VISION.md` | Guiding Star documented: never lose work, never duplicate, never stale | Engineering | 2026-04-15 |

### CC3.4 — Identifies Changes

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Migration safety check | `.github/workflows/ci.yml` line 72–78 | Runs `check-migrations.sh` on every PR; fails if schema breaks | Engineering | 2026-04-18 |
| CalVer version guard | `.github/workflows/ci.yml` line 85–92 | Version in package.json and Cargo.toml must match; automated check | Engineering | 2026-04-18 |
| Architecture decision records | `.cleo/adrs/` | All design decisions documented; ADR-051 enforces evidence gates | Engineering | 2026-04-18 |

---

## Monitoring Evidence (CC4)

### CC4.1 — Evaluates Controls

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Grafana dashboard | `https://grafana.llmtxt.my` (internal) | Displays: request latency, error rate, database query time, disk usage | Engineering | 2026-04-18 |
| Prometheus metrics | `https://prometheus.llmtxt.my:9090` (internal) | Scrapes `/api/metrics` every 15s; retention 15 days | Engineering | 2026-04-18 |
| Health check endpoint | `GET /api/health` | Returns `{ status: "ok" }` if all systems healthy | Engineering | 2026-04-18 |
| Readiness check endpoint | `GET /api/ready` | Returns `{ ready: true }` if service can accept traffic | Engineering | 2026-04-18 |
| OpenTelemetry traces | Tempo (Railway-hosted) | Traces exported to `otel-collector.llmtxt.my:4318` on every request | Engineering | 2026-04-18 |
| Structured logging | Loki (Railway-hosted) | Pino logs exported to Loki; queryable by `job=llmtxt-api` | Engineering | 2026-04-18 |
| SLO report | `.github/workflows/slo-report.yml` | Runs weekly; posts to Slack with uptime, error rate, latency percentiles | Engineering | 2026-04-18 |

### CC4.2 — Communicates Deficiencies

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| SLO violation alerts | `.github/workflows/slo-report.yml` | Posts to Slack if: availability < 99.5%, p95 latency > 500ms, error rate > 0.1% | Engineering | 2026-04-18 |
| Backup failure detection | `.github/workflows/backup-nightly.yml` | Auto-opens GitHub issue if backup fails | Engineering | 2026-04-18 |
| On-call runbook (IN PROGRESS) | `docs/runbooks/on-call.md` | To be created with escalation path and contact list | — | — |

---

## Control Activities Evidence (CC5)

### CC5.1 — Selects Control Activities

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Rate limiting | `apps/backend/src/middleware/rate-limit.ts` lines 1–60 | `describe('rate-limit')` tests in test suite; enforces: 100 req/min unauthenticated, 1000 req/min authenticated | Engineering | 2026-04-18 |
| Content size limits | `apps/backend/src/middleware/request-size.ts` | Body limit: 10MB; document content limit: 5MB | Engineering | 2026-04-18 |
| CSRF protection | `apps/backend/src/middleware/csrf.ts` | Per-request token validation; `Set-Cookie` SameSite=Strict | Engineering | 2026-04-18 |
| CSP header | `apps/backend/src/middleware/security.ts` line 22–35 | `Content-Security-Policy: default-src 'self'; script-src 'nonce-<random>'` | Engineering | 2026-04-18 |
| HSTS header | `apps/backend/src/middleware/security.ts` line 36–40 | `Strict-Transport-Security: max-age=31536000; includeSubDomains` | Engineering | 2026-04-18 |
| RBAC enforcement | `apps/backend/src/middleware/rbac.ts` lines 5–80 | Every document read/write checks: role (owner/editor/viewer), org membership, visibility (public/private/org) | Engineering | 2026-04-18 |

### CC5.2 — Technology Controls (Crypto SSoT)

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Rust crypto core | `crates/llmtxt-core/src/crypto/` | All crypto: SHA-256, HMAC-SHA256, Ed25519, ChaCha20Poly1305 | Engineering | 2026-04-18 |
| WASM-only binding | `apps/backend/src/wasm/index.ts` | No TypeScript crypto; all calls through WASM bridge | Engineering | 2026-04-18 |
| CI node:crypto ban | `.github/workflows/ci.yml` line 108–112 | `grep -r "require('node:crypto')" apps/` fails the build | Engineering | 2026-04-18 |
| crypto.ts linter rule | `.eslintrc.js` | Custom rule bans re-introduction of node:crypto | Engineering | 2026-04-18 |

### CC5.3 — Control Policies and Procedures

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| ADR-051 evidence gates | `.cleo/adrs/ADR-051.md` | All tasks require programmatic evidence before completion | Engineering | 2026-04-18 |
| Architecture Principles | `docs/ARCHITECTURE-PRINCIPLES.md` | 7 principles govern all design decisions | Engineering | 2026-04-18 |
| Security policy (IN PROGRESS) | `docs/SECURITY-POLICY.md` | To be created; will document: patch cycle, vulnerability disclosure, incident response | — | — |

---

## Logical and Physical Access Control Evidence (CC6)

### CC6.1 — Logical Access Security

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Session management | `apps/backend/src/auth.ts` | better-auth session tokens; server-side session store in Postgres | Engineering | 2026-04-18 |
| API key authentication | `apps/backend/src/middleware/auth.ts` lines 35–60 | Bearer token validation; HMAC-SHA256 hash match | Engineering | 2026-04-18 |
| RBAC access control | `apps/backend/src/middleware/rbac.ts` | All authorization decisions centralized; tested in test suite | Engineering | 2026-04-18 |
| Signed URL tokens | `apps/backend/src/utils/signed-url.ts` | Scoped access tokens with TTL and payload signature | Engineering | 2026-04-18 |

### CC6.2 — User Authentication

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Session token generation | `apps/backend/src/auth.ts` line 45–70 | Server generates secure UUID; stored in Postgres; sent as httpOnly cookie | Engineering | 2026-04-18 |
| API key Bearer auth | `apps/backend/src/middleware/auth.ts` line 35–50 | Extract from `Authorization: Bearer <key>`; validate format + hash | Engineering | 2026-04-18 |
| Email verification flow | `apps/backend/src/routes/auth/email-verify.ts` | OTP sent to email; verified before account creation | Engineering | 2026-04-18 |
| Anonymous user TTL | `apps/backend/src/db/schema-pg.ts` line 105 | Column `users.expiresAt`; 24-hour purge job runs nightly | Engineering | 2026-04-18 |

### CC6.3 — Role-Based Authorization

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Document role enforcement | `apps/backend/src/middleware/rbac.ts` lines 20–45 | Owner: all ops; Editor: read/write sections; Viewer: read-only | Engineering | 2026-04-18 |
| Document visibility control | `apps/backend/src/db/schema-pg.ts` line 201 | Enum: public, private, org; enforced on SELECT | Engineering | 2026-04-18 |
| Org membership check | `apps/backend/src/middleware/rbac.ts` lines 50–70 | Org-visibility docs require membership verification | Engineering | 2026-04-18 |

### CC6.4 — Physical Access Restriction

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Cloud infrastructure | Railway ToS | No on-premises servers; all compute on Railway (managed cloud) | Engineering | 2026-04-18 |
| Data center controls | Railway docs | Railway manages physical security; ISO 27001 certified | Engineering | 2026-04-18 |
| Delegation letter | `docs/compliance/railway-soc2-letter.pdf` (TO BE OBTAINED) | Formal letter from Railway confirming SOC 2 Type 1 certification | — | **PENDING** |

### CC6.5 — Credential Authentication

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| API key format | `apps/backend/src/utils/api-keys.ts` lines 8–15 | Prefix: `llmtxt_`; character set: alphanumeric; length: 32–64 chars | Engineering | 2026-04-18 |
| API key hashing at rest | `apps/backend/src/utils/api-keys.ts` lines 45–55 | HMAC-SHA256(key, secret); stored hash in `apiKeys.keyHash` | Engineering | 2026-04-18 |
| Key rotation | `POST /api/keys/{id}/rotate` | Old key invalidated immediately; new key returned | Engineering | 2026-04-18 |
| Agent signatures | `apps/backend/src/middleware/verify-agent-signature.ts` | Ed25519 signature verification; agent identity immutable | Engineering | 2026-04-18 |

### CC6.6 — Access Provisioning/Deprovisioning

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| API key revocation | `POST /api/keys/{id}/revoke` | Sets `apiKeys.revoked = true`; subsequent use returns 401 | Engineering | 2026-04-18 |
| Session invalidation on logout | `POST /auth/logout` | Deletes session from Postgres; cookie cleared | Engineering | 2026-04-18 |
| Anonymous user cleanup | `.github/workflows/purge-anonymous.yml` | Nightly job; deletes users where `expiresAt < now()` | Engineering | 2026-04-18 |
| Org member removal | `DELETE /api/orgs/{id}/members/{userId}` | Removes row from `orgMembers` table; revokes access | Engineering | 2026-04-18 |

### CC6.7 — Confidential Data Transmission

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| TLS enforcement | Cloudflare config | All traffic terminated at Cloudflare; minimum TLS 1.2 | Engineering | 2026-04-18 |
| HSTS header | `apps/backend/src/middleware/security.ts` line 36 | `Strict-Transport-Security: max-age=31536000; includeSubDomains` | Engineering | 2026-04-18 |
| CSP with nonce | `apps/backend/src/middleware/security.ts` line 22–28 | Per-request nonce; no `unsafe-inline` for scripts | Engineering | 2026-04-18 |
| API encryption in transit | OpenAPI spec | All POST/PUT payloads over HTTPS only; no HTTP fallback | Engineering | 2026-04-18 |

### CC6.8 — Malicious Software Prevention

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Clippy enforcement | `.github/workflows/ci.yml` line 48–52 | `cargo clippy --all -- -D warnings`; fails on any warning | Engineering | 2026-04-18 |
| Format enforcement | `.github/workflows/ci.yml` line 42–45 | `cargo fmt --check`; enforces code style | Engineering | 2026-04-18 |
| TypeScript strict mode | `.github/workflows/ci.yml` line 62–68 | No implicit `any`; all types explicit | Engineering | 2026-04-18 |
| DOMPurify sanitization | `apps/frontend/src/utils/sanitize.ts` | All rendered HTML sanitized; removes `<script>`, event handlers | Engineering | 2026-04-18 |
| node:crypto ban | `.github/workflows/ci.yml` line 108–112 | Grep fails if `require('node:crypto')` found | Engineering | 2026-04-18 |

---

## System Operations Evidence (CC7)

### CC7.1 — Vulnerability Detection (GAPS)

| Evidence | Location | Verification Method | Owner | Status |
|----------|----------|---------------------|-------|---|
| Dependabot configuration | `.github/dependabot.yml` | Scans npm + Cargo; creates PRs for outdated/vulnerable deps | — | **IN PROGRESS — T184-G2** |
| Snyk integration | GitHub Snapshots | `snyk test` runs in CI; fails on high/critical vulns | — | **DEFER: use Dependabot first** |

### CC7.2 — System Component Monitoring

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Prometheus scrape config | `.github/workflows/deploy.yml` (Prometheus config in Railway) | Scrapes `/api/metrics` every 15 seconds | Engineering | 2026-04-18 |
| Grafana dashboards | Railway-hosted Grafana | 5 dashboards: API latency, error rates, database stats, CRDT ops, backup status | Engineering | 2026-04-18 |
| Health endpoints | `apps/backend/src/routes/health.ts` | `GET /api/health` and `GET /api/ready` | Engineering | 2026-04-18 |
| OTel trace export | `apps/backend/src/middleware/tracing.ts` | Exports to Tempo on every request; retention 7 days | Engineering | 2026-04-18 |
| Structured logging | `apps/backend/src/logger.ts` | Pino logger; JSON output to stdout; Loki ingestion | Engineering | 2026-04-18 |

### CC7.3 — Security Event Evaluation (GAPS)

| Evidence | Location | Verification Method | Owner | Status |
|----------|----------|---------------------|-------|---|
| Audit log monitoring | `docs/runbooks/audit-monitoring.md` | TO BE CREATED: query audit logs for anomalies (multiple 401s, key creation spike, etc.) | — | **IN PROGRESS — T184-G7** |
| Alert rules for suspicious patterns | `.github/workflows/prometheus-alerts.yml` | TO BE CREATED: rules for 401 spike, audit hash failure, backup failure | — | **IN PROGRESS — T184-G7** |

### CC7.4 — Incident Response (GAPS)

| Evidence | Location | Verification Method | Owner | Status |
|----------|----------|---------------------|-------|---|
| Incident response runbook | `docs/runbooks/incident-response.md` | TO BE CREATED: severity levels, escalation, communication templates, postmortem | — | **IN PROGRESS — T184-G3** |
| Security disclosure policy | `SECURITY.md` | TO BE CREATED: how to report vulnerabilities; response SLA | — | **TO CREATE** |

---

## Change Management Evidence (CC8)

### CC8.1 — Change Authorization and Testing

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| GitHub branch protection | GitHub settings (main branch) | Requires 1 approval, status checks pass, no force-push | Engineering | 2026-04-18 |
| PR review workflow | `.github/pull_request_template.md` | All PRs require checklist: tests pass, docs updated, no breaking changes | Engineering | 2026-04-18 |
| Migration safety check | `.github/workflows/ci.yml` line 72–78 | Runs `check-migrations.sh`; fails if schema would break | Engineering | 2026-04-18 |
| CalVer version guard | `.github/workflows/ci.yml` line 85–92 | Version must be bumped in package.json and Cargo.toml | Engineering | 2026-04-18 |
| CHANGELOG requirement | `.github/workflows/ci.yml` line 95–100 | PR title must match CHANGELOG entry | Engineering | 2026-04-18 |
| Pre-commit hooks | `.husky/pre-commit` | Runs biome, tsc, tests before commit | Engineering | 2026-04-18 |

---

## Risk Mitigation — Vendor Management Evidence (CC9)

### CC9.1 — Vendor Management

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Sub-processor register | `docs/compliance/sub-processors.md` | Lists: Railway, Cloudflare, S3/R2, GitHub, npm registry | Engineering | 2026-04-18 |
| Vendor DPA compliance | `docs/compliance/vendor-dpas/` | Copies of DPA addendums from each critical vendor | Engineering | 2026-04-18 |
| Vendor risk ratings (IN PROGRESS) | `docs/compliance/vendor-risk.md` | TO BE CREATED: risk assessment for each critical vendor | — | **IN PROGRESS — T184-G6** |

### CC9.2 — Business Disruption Risk

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Backup script | `apps/backend/scripts/pg-backup.sh` | Full dump with age encryption; runs nightly via cron | Engineering | 2026-04-18 |
| Backup storage | AWS S3 bucket `llmtxt-backups` | Cross-region replication; access logs; versioning enabled | Engineering | 2026-04-18 |
| Restore drill | `.github/workflows/restore-drill-monthly.yml` | Runs first Sunday of month; restores to staging Postgres; verifies table counts | Engineering | 2026-04-18 |
| Backup retention policy | `apps/backend/scripts/pg-backup.sh` line 55–70 | Keep: 7 daily, 4 weekly, 12 monthly; older deleted automatically | Engineering | 2026-04-18 |
| BCDR formal plan (IN PROGRESS) | `docs/runbooks/bcdr.md` | TO BE CREATED: RTO/RPO targets, procedures, contact list | — | **TO CREATE** |

---

## Availability Evidence (A1)

### A1.1 — Processing Capacity

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Railway autoscaling | Railway deploy config | Min: 1 instance; Max: 5; scale trigger: CPU > 70% | Engineering | 2026-04-18 |
| Database connection pooling | `apps/backend/src/db/index.ts` | PgPool with `max: 20` connections | Engineering | 2026-04-18 |
| Load test results | `docs/performance/load-test-2026-04-17.md` | 1000 concurrent users; p95 latency 285ms; 0 errors | Engineering | 2026-04-17 |

### A1.3 — Backup and Recovery

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Nightly backup | `.github/workflows/backup-nightly.yml` | Runs 02:00 UTC; logs stored in GitHub Actions | Engineering | 2026-04-18 |
| Monthly restore test | `.github/workflows/restore-drill-monthly.yml` | Runs first Sunday; restores to staging; table count validation | Engineering | 2026-04-18 |
| Backup encryption | `apps/backend/scripts/pg-backup.sh` line 42 | age-encrypt with public key in `.github/workflows/` | Engineering | 2026-04-18 |

### A1.4 — BCDR Testing

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Monthly drill execution | `.github/workflows/restore-drill-monthly.yml` | Cron: `0 2 * * 0` (first Sunday); logs in Actions | Engineering | 2026-04-18 |
| Drill validation | `.github/workflows/restore-drill-monthly.yml` line 35–50 | Query `information_schema.tables`; assert counts match prod | Engineering | 2026-04-18 |
| RTO/RPO targets (IN PROGRESS) | `docs/runbooks/bcdr.md` | TO BE CREATED: RTO ≤ 4h, RPO ≤ 24h | — | **TO CREATE** |

### A1.5 — Processing Commitments (GAPS)

| Evidence | Location | Verification Method | Owner | Status |
|----------|----------|---------------------|-------|---|
| Published SLA | `docs/legal/sla.md` | TO BE CREATED: 99.5% monthly uptime, 4h response time for P1 incidents | — | **IN PROGRESS — T184-G4** |

---

## Confidentiality Evidence (C1)

### C1.1 — Identify Confidential Information

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Document visibility control | `apps/backend/src/db/schema-pg.ts` line 201 | Enum: public, private, org; enforced on every SELECT | Engineering | 2026-04-18 |
| Private document access check | `apps/backend/src/middleware/rbac.ts` line 50–70 | Returns 403 if user lacks role AND visibility is private | Engineering | 2026-04-18 |
| API key hashing at rest | `apps/backend/src/utils/api-keys.ts` line 45–55 | HMAC-SHA256; plaintext never logged | Engineering | 2026-04-18 |
| Password hashing | `apps/backend/src/auth.ts` | better-auth uses bcrypt with salt rounds ≥ 10 | Engineering | 2026-04-18 |

### C1.2 — Dispose of Confidential Information

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| Anonymous user TTL purge | `apps/backend/src/db/schema-pg.ts` line 105 | Column `users.expiresAt`; nightly cleanup job | Engineering | 2026-04-18 |
| Document expiry field | `apps/backend/src/db/schema-pg.ts` line 220 | Column `documents.expiresAt`; expired docs deleted by nightly job | Engineering | 2026-04-18 |
| Data retention policy (IN PROGRESS) | `docs/compliance/data-retention.md` | TO BE UPDATED with formal retention schedule | — | **TO UPDATE** |
| Secure deletion verification | `docs/runbooks/secure-deletion.md` | TO BE CREATED: verify deleted docs don't appear in backups | — | **TO CREATE** |

### C1.3 — Protect Confidential Information

| Evidence | Location | Verification Method | Owner | Last Verified |
|----------|----------|---------------------|-------|---|
| TLS in transit | Cloudflare config | All traffic over HTTPS; minimum TLS 1.2 | Engineering | 2026-04-18 |
| Encrypted backups | `apps/backend/scripts/pg-backup.sh` line 42 | age-encrypt with public key; private key in GitHub secrets | Engineering | 2026-04-18 |
| Postgres encryption at rest | Railway managed Postgres | Encryption handled by Railway infrastructure | Engineering | 2026-04-18 |

### C1.4 — Inform External Parties (GAPS)

| Evidence | Location | Verification Method | Owner | Status |
|----------|----------|---------------------|-------|---|
| Privacy policy | `apps/frontend/src/routes/legal/privacy.ts` | TO BE CREATED: GDPR + CCPA data processing disclosures | — | **IN PROGRESS — T184-G1** |
| Data Processing Agreement | `docs/compliance/dpa-template.md` | Template created; to be offered to customers | Engineering | 2026-04-18 |
| Sub-processor disclosures | `docs/compliance/sub-processors.md` | Public list of all processors used | Engineering | 2026-04-18 |

---

## Appendix: Testing and Verification

### How to Run Evidence Verifications

```bash
# Test all crypto controls
cd crates/llmtxt-core && cargo test crypto::

# Test all auth controls
cd apps/backend && pnpm test auth.test.ts

# Test rate limiting
pnpm test middleware/rate-limit.test.ts

# Test RBAC enforcement
pnpm test middleware/rbac.test.ts

# Test audit log integrity
pnpm test routes/audit.verify.test.ts

# Verify migration safety
./scripts/check-migrations.sh

# Verify node:crypto ban
grep -r "require('node:crypto')" apps/

# Run full compliance suite
pnpm test compliance/
```

### Auditor Access

To provide the auditor with access to internal endpoints:

1. Generate a scoped API key for audit purposes
2. Grant `viewer` role on selected documents
3. Provide temporary Grafana/Prometheus viewer credentials
4. Document in a side letter: token expiry, data scope, audit purposes

---

*Last updated: 2026-04-19 | Maintained by: Engineering | Next review: 2026-07-19*
