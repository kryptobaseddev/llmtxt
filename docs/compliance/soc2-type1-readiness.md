# SOC 2 Type 1 Readiness — LLMtxt

> **Document type**: Internal compliance readiness assessment
> **Date**: 2026-04-18
> **Version**: 1.0.0
> **Scope**: LLMtxt platform — api.llmtxt.my, www.llmtxt.my, docs.llmtxt.my, packages/llmtxt (npm), crates/llmtxt-core (crates.io)
> **Trust Service Categories**: Security (CC), Availability (A), Confidentiality (C)
>
> **Disclaimer**: This document is an internal readiness self-assessment. It is not a SOC 2 Type 1 report and does not constitute certification. A SOC 2 Type 1 report requires an independent, licensed CPA firm conducting a formal audit. "Readiness" here means: we have mapped our controls, identified gaps, and created a remediation plan — the prerequisites an auditor will ask for on day one.

---

## Executive Summary

LLMtxt is a multi-agent document collaboration platform. As of 2026-04-18, the platform has a solid technical foundation (Rust cryptographic core, tamper-evident audit chain, RBAC, rate limiting, CSP/HSTS) but has not previously performed a formal controls mapping. This document provides that mapping across the three Trust Service Categories most relevant to our enterprise customers.

| Category | Controls mapped | Met | Partial | Gap | Readiness score |
|---|---|---|---|---|---|
| Security (CC1-CC9) | 33 | 18 | 9 | 6 | 55% |
| Availability (A1) | 5 | 2 | 2 | 1 | 40% |
| Confidentiality (C1) | 4 | 2 | 1 | 1 | 50% |
| **Total** | **42** | **22** | **12** | **8** | **52%** |

**Assessment**: LLMtxt is not yet audit-ready. The platform has strong cryptographic and access control foundations but material gaps in organizational controls (security policy documentation, personnel management, vendor management, incident response procedures) and operational controls (monitoring, backup verification, change management). See the remediation plan for a prioritized path to readiness.

---

## Section 1: Trust Services Criteria Controls Inventory

See also: `docs/compliance/controls-inventory.csv` for machine-readable version.

### CC1 — Control Environment

| Control ID | Criterion | LLMtxt Control | Evidence | Status |
|---|---|---|---|---|
| CC1.1 | COSO — demonstrates commitment to integrity and ethical values | Engineering principles documented in `PRINCIPLES.md` (task-first, evidence-based, SOLID). No formal code of conduct or ethics policy. | `PRINCIPLES.md` | **partial** |
| CC1.2 | Board exercises oversight responsibility | Solo founder / small team. No formal board. No audit committee. | — | **gap** |
| CC1.3 | Establishes structure, reporting lines, authorities | GitHub repository is the system of record. PRs require review for main. CLEO orchestrates task hierarchy. No formal org chart or RACI. | `CLAUDE.md`, `.github/` | **partial** |
| CC1.4 | Demonstrates commitment to competence | Engineering team is the author of a published Rust crate + npm package. CI enforces `cargo fmt`, `clippy -D warnings`, TypeScript strict mode. | `.github/workflows/ci.yml` | **met** |
| CC1.5 | Enforces accountability | GitHub commit history, CLEO audit log, tamper-evident audit chain (T164) in `auditLogs` table. API key authentication ties every write to an actor. | `src/middleware/audit.ts`, `schema-pg.ts#auditLogs` | **met** |

### CC2 — Communication and Information

| Control ID | Criterion | LLMtxt Control | Evidence | Status |
|---|---|---|---|---|
| CC2.1 | Uses relevant quality information to support internal control | CLEO task system tracks all work items. `docs/RED-TEAM-ANALYSIS-2026-04-15.md` documents honest self-assessment. Memory bridge surfaces decisions. | `.cleo/`, `docs/` | **met** |
| CC2.2 | Internally communicates objectives and responsibilities | Engineering docs in `docs/` (ARCHITECTURE.md, SSOT.md, ARCHITECTURE-PRINCIPLES.md). PRINCIPLES.md. No formal security policy document published. | `docs/` | **partial** |
| CC2.3 | Communicates with external parties | Public docs at docs.llmtxt.my. OpenAPI spec not yet public (tracked as gap). No privacy policy or terms of service published. | docs.llmtxt.my | **gap** — **T184-G1**: publish privacy policy and ToS |

### CC3 — Risk Assessment

| Control ID | Criterion | LLMtxt Control | Evidence | Status |
|---|---|---|---|---|
| CC3.1 | Specifies objectives with sufficient clarity | CalVer releases with CHANGELOG. CLEO epics have acceptance criteria. `docs/VISION.md` documents guiding star. | `CHANGELOG.md`, `docs/VISION.md` | **met** |
| CC3.2 | Identifies and analyzes risk | Red-team analyses (`docs/RED-TEAM-ANALYSIS-2026-04-15.md`) identify risks. No formal risk register. | `docs/RED-TEAM-ANALYSIS-*.md` | **partial** |
| CC3.3 | Assesses fraud risk | API key HMAC hashing, session token revocation, tamper-evident audit chain (T164). No formal fraud risk assessment documented. | `src/utils/api-keys.ts`, `src/middleware/audit.ts` | **partial** |
| CC3.4 | Identifies and assesses changes | Migration safety CI check (`check-migrations.sh`). CalVer version guard. ADRs in `.cleo/adrs/`. | `.github/workflows/ci.yml`, `.cleo/adrs/` | **met** |

### CC4 — Monitoring

| Control ID | Criterion | LLMtxt Control | Evidence | Status |
|---|---|---|---|---|
| CC4.1 | Evaluates and communicates deficiencies | Self-hosted Grafana/Loki/Tempo/Prometheus stack on Railway (shipped v2026.4.5). SLO weekly report workflow (`.github/workflows/slo-report.yml`). OpenTelemetry traces. | `.github/workflows/slo-report.yml`, `src/middleware/observability.ts` | **met** |
| CC4.2 | Evaluates and communicates deficiencies to responsible parties | SLO report posts to Slack webhook. Backup failure issues auto-opened on GitHub. No formal escalation path or on-call rotation. | `.github/workflows/backup-nightly.yml`, `slo-report.yml` | **partial** |

### CC5 — Control Activities

| Control ID | Criterion | LLMtxt Control | Evidence | Status |
|---|---|---|---|---|
| CC5.1 | Selects and develops control activities | Rate limiting (tiered by auth level), content size limits, CSRF protection, CSP/HSTS headers, RBAC authorization. | `src/middleware/rate-limit.ts`, `src/middleware/security.ts`, `src/middleware/rbac.ts` | **met** |
| CC5.2 | Selects technology controls | Rust cryptographic core (`crates/llmtxt-core`) is single source of truth for all crypto operations (D001). WASM-only binding — no native crypto in TypeScript. CI lint rule bans `node:crypto` re-introduction. | `crates/llmtxt-core/`, `.github/workflows/ci.yml` | **met** |
| CC5.3 | Deploys policies and procedures | CLEO enforces ADR-051 evidence-backed gates. Architecture Principles published. No formal written security policy. | `.cleo/adrs/`, `docs/ARCHITECTURE-PRINCIPLES.md` | **partial** |

### CC6 — Logical and Physical Access Controls

| Control ID | Criterion | LLMtxt Control | Evidence | Status |
|---|---|---|---|---|
| CC6.1 | Implements logical access security measures | better-auth session management, API key authentication (HMAC-SHA256 hashed at rest), RBAC (owner/editor/viewer), signed URL tokens for scoped access. | `src/auth.ts`, `src/middleware/auth.ts`, `src/middleware/rbac.ts` | **met** |
| CC6.2 | Authenticates users before granting access | Session tokens, API key Bearer auth, email verification flow (better-auth). Anonymous users get 24-hour TTL sessions. | `src/auth.ts`, `schema-pg.ts#users.isAnonymous` | **met** |
| CC6.3 | Authorizes access using role-based criteria | RBAC enforces owner/editor/viewer permissions. Document visibility (public/private/org). Org membership controls. | `src/middleware/rbac.ts`, `schema-pg.ts#documentRoles` | **met** |
| CC6.4 | Restricts physical access | Hosted on Railway (cloud PaaS — physical access managed by Railway). No on-premises servers. | Railway ToS | **met** — delegated to Railway |
| CC6.5 | Identifies and authenticates with adequate credentials | API keys are prefixed `llmtxt_`, format-validated, HMAC-SHA256 hashed before storage. Session tokens are server-generated UUIDs. Ed25519 agent signatures for machine identity. | `src/utils/api-keys.ts`, `src/middleware/verify-agent-signature.ts` | **met** |
| CC6.6 | Implements access restriction for provisioning and removal | API key revocation endpoint. Session invalidation on logout. Anonymous user TTL purge. Org member removal. | `src/routes/`, `schema-pg.ts#apiKeys.revoked` | **met** |
| CC6.7 | Restricts transmission of confidential information | TLS enforced (Cloudflare terminates TLS, HSTS `max-age=31536000; includeSubDomains`). Content-Security-Policy with per-request nonce. | `src/middleware/security.ts` | **met** |
| CC6.8 | Prevents unauthorized or malicious software | CI enforces `cargo clippy -D warnings`, `cargo fmt --check`, TypeScript strict mode. No `eval`, no `node:crypto` bypass. DOMPurify sanitization on rendered content. | `.github/workflows/ci.yml`, `src/middleware/sanitize.ts` | **met** |

### CC7 — System Operations

| Control ID | Criterion | LLMtxt Control | Evidence | Status |
|---|---|---|---|---|
| CC7.1 | Detects and monitors for new vulnerabilities | No automated dependency scanning (Dependabot, Snyk) configured. Manual review only. **Gap.** | — | **gap** — **T184-G2**: enable Dependabot or Renovate |
| CC7.2 | Monitors system components | Grafana/Prometheus self-hosted on Railway. `/api/health` and `/api/ready` health check endpoints. OTel trace export. Pino structured logging → Loki. | `src/middleware/observability.ts`, `src/middleware/metrics.ts` | **met** |
| CC7.3 | Evaluates security events | No SIEM or automated alerting on suspicious patterns (e.g., repeated 401s, anomalous API key usage). Audit log exists but no automated analysis. | `src/middleware/audit.ts` | **partial** |
| CC7.4 | Responds to identified security incidents | No formal incident response plan documented. No runbook for security incidents. **Gap.** | — | **gap** — **T184-G3**: write IR runbook |
| CC7.5 | Identifies, develops, and implements security incident response activities | See CC7.4. | — | **gap** — tracked with T184-G3 |

### CC8 — Change Management

| Control ID | Criterion | LLMtxt Control | Evidence | Status |
|---|---|---|---|---|
| CC8.1 | Authorizes, designs, develops, acquires, configures, documents, tests, approves, and implements changes | All changes via GitHub PRs to main branch. Migration safety CI check runs on every PR. CalVer version guard. CHANGELOG required. Pre-commit hooks (biome, tsc). | `.github/workflows/ci.yml`, `CHANGELOG.md` | **met** |

### CC9 — Risk Mitigation (Vendor Management)

| Control ID | Criterion | LLMtxt Control | Evidence | Status |
|---|---|---|---|---|
| CC9.1 | Identifies, selects, and manages risk associated with vendors | Sub-processor list being established (T188). No formal vendor risk assessment process. Railway, Cloudflare, S3/R2 are critical vendors. | `docs/compliance/sub-processors.md` (T188) | **partial** |
| CC9.2 | Assesses and manages risks from business disruption | Nightly/weekly/monthly Postgres backups to S3 (`pg-backup.sh`). Monthly restore drill. No formal BCDR plan. No RTO/RPO targets defined. | `.github/workflows/backup-nightly.yml` | **partial** |

### A1 — Availability

| Control ID | Criterion | LLMtxt Control | Evidence | Status |
|---|---|---|---|---|
| A1.1 | Current processing capacity meets availability commitments | Railway autoscaling on API. Postgres on Railway managed service. No formal capacity plan or load test results. | Railway deploy | **partial** |
| A1.2 | Environmental protections support availability | Railway handles datacenter environmental controls. No on-premises infrastructure. | Railway ToS | **met** — delegated |
| A1.3 | Backs up data and recovers data | Nightly Postgres backup to S3, encrypted with `age`. Monthly restore drill. Retention policy: 7 daily, 4 weekly, 12 monthly. | `.github/workflows/backup-nightly.yml`, `.github/workflows/restore-drill-monthly.yml` | **met** |
| A1.4 | Tests BCDR | Monthly restore drill exists. No formal DR test plan with documented RTO/RPO targets. | `.github/workflows/restore-drill-monthly.yml` | **partial** |
| A1.5 | Communicates processing commitments | No published SLA or uptime commitment. SLO targets defined in `slo-report.yml` comments but not contractually committed. | `.github/workflows/slo-report.yml` | **gap** — **T184-G4**: publish SLA |

### C1 — Confidentiality

| Control ID | Criterion | LLMtxt Control | Evidence | Status |
|---|---|---|---|---|
| C1.1 | Identifies and maintains confidential information | Documents have visibility field (public/private/org). Private documents require auth. API keys hashed at rest. Passwords managed by better-auth (bcrypt). | `schema-pg.ts#documents.visibility`, `src/utils/api-keys.ts` | **met** |
| C1.2 | Disposes of confidential information | Anonymous user purge (24hr TTL). Document expiry (`expiresAt`). No formal data retention policy or secure deletion verification. | `schema-pg.ts#users.expiresAt`, `documents.expiresAt` | **partial** |
| C1.3 | Protects confidential information | TLS in transit, encrypted backups (age), database at rest encryption delegated to Railway managed Postgres. No field-level encryption for document content. | `apps/backend/scripts/pg-backup.sh` | **met** |
| C1.4 | Informs external parties of processing and data handling | No published privacy policy. No data processing agreement template (T188 pending). | — | **gap** — **T184-G5**: privacy policy + DPA (T188) |

---

## Section 2: Gap Analysis

| Gap ID | Description | Severity | Criteria | Remediation | Owner |
|---|---|---|---|---|---|
| T184-G1 | No published privacy policy or terms of service | High | CC2.3, C1.4 | Draft and publish at llmtxt.my/legal/privacy and /legal/terms. Part of T188 DPA work. | Engineering |
| T184-G2 | No automated dependency vulnerability scanning | High | CC7.1 | Enable GitHub Dependabot for npm and Cargo dependencies. | Engineering |
| T184-G3 | No incident response plan or security runbook | High | CC7.4, CC7.5 | Write `docs/runbooks/incident-response.md` with severity levels, escalation path, communication templates. | Engineering |
| T184-G4 | No published SLA or uptime commitment | Medium | A1.5 | Publish SLA at docs.llmtxt.my with 99.5% monthly uptime target and escalation path. | Product |
| T184-G5 | No privacy policy or DPA template | High | C1.4 | See T188. DPA template and sub-processor list to be published. | Engineering + Legal |
| T184-G6 | No formal vendor risk assessment | Medium | CC9.1 | Document risk rating for each critical vendor (Railway, Cloudflare, S3/R2). Use sub-processor register (T188) as foundation. | Engineering |
| T184-G7 | No automated security event alerting | Medium | CC7.3 | Add alert rules to Prometheus/Grafana for: repeated 401s, API key creation spikes, audit chain hash failures. | Engineering |
| T184-G8 | No formal code of conduct or ethics policy | Low | CC1.1 | Draft engineering code of conduct. Can be a single-page document. | Leadership |

---

## Section 3: Remediation Plan

Prioritized by severity and implementation effort.

### Wave 1 — High-priority, low-effort (target: 2 weeks)

| Item | Task | Effort | Output |
|---|---|---|---|
| Enable Dependabot | Add `.github/dependabot.yml` for npm + Cargo | Small | Automated PRs for outdated/vulnerable deps |
| Privacy Policy | Draft privacy policy (GDPR + CCPA compliant) | Small | `apps/frontend/src/routes/legal/privacy.ts` |
| Terms of Service | Draft terms of service | Small | `apps/frontend/src/routes/legal/terms.ts` |
| IR Runbook | Write incident response runbook | Small | `docs/runbooks/incident-response.md` |

### Wave 2 — High-priority, medium-effort (target: 4 weeks)

| Item | Task | Effort | Output |
|---|---|---|---|
| Security alert rules | Add Prometheus alert rules for 401 spikes, audit failures | Medium | Grafana alert definitions |
| DPA template | Data Processing Agreement template (T188) | Medium | `docs/compliance/dpa-template.md` |
| Sub-processor register | Public sub-processor list (T188) | Small | `docs/compliance/sub-processors.md` |
| SLA publication | Draft and publish SLA | Small | docs.llmtxt.my/legal/sla |

### Wave 3 — Medium-priority (target: 6 weeks)

| Item | Task | Effort | Output |
|---|---|---|---|
| Vendor risk ratings | Rate Railway, Cloudflare, S3/R2 risk | Small | `docs/compliance/vendor-risk.md` |
| BCDR formal plan | Document RTO/RPO targets, DR procedures | Medium | `docs/runbooks/bcdr.md` |
| Code of conduct | Engineering ethics document | Small | `docs/CODE-OF-CONDUCT.md` |
| Data retention policy | Formal policy for document and log retention | Small | `docs/compliance/data-retention.md` |

---

## Section 4: What is Already Strong

These controls are implementation-complete and audit-defensible today:

- **Cryptographic core** (crates/llmtxt-core): All crypto operations in a single Rust crate. WASM-only bridge — no `node:crypto` allowed in TypeScript (CI enforced). SHA-256 content hashing, HMAC-SHA256 signed URLs, Ed25519 agent signatures.
- **Tamper-evident audit log** (T164): Hash chain on `auditLogs` table. Every write carries `payload_hash` and `chain_hash`. Chain integrity verifiable by external parties.
- **RBAC**: Owner/editor/viewer document roles. Org membership. Per-document visibility. All authorization decisions are centralized in `src/middleware/rbac.ts`.
- **Session security**: Server-side sessions, API key revocation, per-request CSRF tokens, session TTL enforcement.
- **HTTP security headers**: CSP with per-request nonce (no `unsafe-inline` for scripts), HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy.
- **Rate limiting**: Tiered by auth level (IP/user/API key). Write-path and auth-path limits separate from global.
- **Backup and restore**: Nightly Postgres backup to S3 (age-encrypted). Monthly restore drill. Backup failure auto-issues on GitHub.
- **Change management**: All changes via GitHub PR. Migration safety CI. CalVer versioning with CHANGELOG enforcement.

---

## Section 5: SOC 2 Type 1 vs Type 2

This document targets **Type 1** (point-in-time design effectiveness). A **Type 2** report requires 6-12 months of continuous operation evidence. To prepare for Type 2:

1. Complete Wave 1 and Wave 2 remediation (above).
2. Begin a 6-month observation period.
3. Maintain continuous evidence: audit logs, backup run logs, incident records, change tickets.
4. Engage a licensed auditor (AICPA member firm).

**Estimated path to Type 1 audit**: 2-3 months post-remediation completion.
**Estimated path to Type 2 audit**: 12-15 months from today.

---

*Last updated: 2026-04-18 | Maintainer: Engineering | Next review: 2026-07-18*
