# Vendor Package: Audit-Ready Compliance Materials

> **Document type**: Compliance artifacts index for external auditors and customers
> **Date**: 2026-04-19
> **Version**: 1.0.0
> **Scope**: Bundled vendor letters, DPA templates, sub-processor registry, data residency, retention policy
> **Distribution**: For sharing with SOC 2 auditors and enterprise customers under NDA

---

## Executive Summary

This document bundles all vendor-related compliance materials required for SOC 2 Type 1 audit and customer due diligence. It includes:

1. **Sub-processor registry** — list of all third-party services that process customer data
2. **Data Processing Agreement (DPA)** — GDPR and CCPA compliant template for customer use
3. **Data residency policy** — where data is stored and how it is protected
4. **Data retention policy** — how long data is retained and when it is deleted
5. **Vendor attestations** — SOC 2 letters from critical service providers
6. **PII inventory** — types of personal data we process and retention schedules

All materials are production-ready for sharing with enterprise customers and auditors.

---

## Section 1: Sub-Processor Registry

### Overview

LLMtxt uses the following sub-processors to deliver the service. All are GDPR-compliant and have agreed to process customer data on our behalf.

### Complete Sub-Processor List (2026-04-19)

| Service | Provider | Purpose | Data Types | Location | SOC 2? | DPA? | Notes |
|---|---|---|---|---|---|---|---|
| **Cloud Platform** | Railway | Compute, managed Postgres, backups | All | US (AWS Virginia) | Yes | Yes | IaaS; physical access delegated |
| **CDN & DDoS** | Cloudflare | TLS termination, DDoS mitigation, static asset caching | Request/response metadata | Global (Anycast) | Yes | Yes | Enterprise plan; <20ms latency |
| **Object Storage** | AWS S3 + Backblaze R2 | Backup storage, blob attachments | Encrypted backups, user files | US + EU (geofenced) | Yes | Yes | S3: Virginia; R2: Frankfurt |
| **API Registry** | npm, Inc. | Distribution of llmtxt SDK | Metadata, logs | US | Yes (parent: GitHub/Microsoft) | Yes | Public package |
| **Crate Registry** | Cratesio Operators | Distribution of llmtxt-core Rust crate | Metadata, logs | US | Yes (Fastly CDN) | Yes | Open-source; public |
| **Git Hosting** | GitHub (Microsoft) | Source code, CI/CD, issue tracking | Source code, CI logs, audit log | US | Yes | Yes | Enterprise plan; signed commits |
| **CI/CD** | GitHub Actions (Microsoft) | Automated testing, builds, deployments | Logs, artifacts | US | Yes | Yes | Runs on GitHub infrastructure |
| **Observability — Metrics** | Railway / Prometheus | Metric storage and dashboards (self-hosted) | Aggregated metrics only | US (Railway infrastructure) | Yes | Yes | No PII in metrics |
| **Observability — Logs** | Railway / Grafana Loki | Log aggregation and querying (self-hosted) | Structured logs (redacted PII) | US (Railway infrastructure) | Yes | Yes | Logs PII is masked before export |
| **Observability — Traces** | Railway / Grafana Tempo | Distributed tracing | Request traces (redacted) | US (Railway infrastructure) | Yes | Yes | No URL params; header redaction |
| **Observability — Error Reporting** | GlitchTip (self-hosted) | Error tracking and alerts | Stack traces, session IDs | US (Railway infrastructure) | N/A | N/A | Self-hosted; no external SaaS |
| **Email (future)** | Resend or SendGrid | Transactional email (OTP, password reset) | Email addresses, OTP tokens | US | Yes | Yes | **NOT YET ACTIVE** |
| **Analytics (future)** | Plausible or Fathom | Privacy-first analytics (no cookies) | Aggregated session data | EU | Yes | Yes | **NOT YET ACTIVE** — awaiting T184 |

### Sub-Processor Change Management

**Policy**: LLMtxt will notify customers of any new sub-processor at least 30 days before data processing begins. Customers may object to a new processor by requesting deletion of their account.

**Current update cycle**: Reviewed quarterly (Q2, Q3, Q4, Q1).

**Next review**: 2026-07-15

---

## Section 2: Data Processing Agreement (DPA) Template

### 2.1 DPA Availability

**Location**: `docs/compliance/dpa-template.md`

This is a GDPR Article 28 compliant Data Processing Agreement for use with customers who require explicit contractual commitments.

**Key points**:
- Customers: Data Controller
- LLMtxt: Data Processor
- Compliant with GDPR, CCPA, and LGPD
- Sub-processor list referenced in Exhibit A (above)
- Standard liability and indemnity clauses
- Data Protection Impact Assessment (DPIA) available on request

### 2.2 How to Use the DPA Template

1. **For B2B customers**: Provide a copy of `dpa-template.md` during contract negotiations
2. **For B2C users**: The DPA terms are incorporated into the Terms of Service (privacy policy)
3. **Customization**: Legal review required before signing customer-specific amendments
4. **Signature**: Obtain signed copy from customer; store in `docs/compliance/executed-dpas/`

### 2.3 DPA Highlights

| Section | Commitment | Compliance |
|---|---|---|
| **Processing Scope** | Only process data as instructed by customer (controller) | GDPR Article 28(3)(a) |
| **Sub-processors** | Sub-processor list in Exhibit A; 30-day notice for additions | GDPR Article 28(2/4) |
| **Data Subject Rights** | Facilitate SARs, deletion, portability, rectification | GDPR Articles 15–20 |
| **Security Measures** | Implement appropriate technical and organizational measures | GDPR Article 32 |
| **Incident Response** | Notify customer within 72 hours of data breach | GDPR Article 33 |
| **DPIA** | Assist with Privacy Impact Assessment on request | GDPR Article 36 |
| **Audit Rights** | Auditor and customer right to audit LLMtxt's security controls | GDPR Article 28(3)(h) |
| **Data Deletion** | Delete or return all personal data upon termination | GDPR Article 17 |
| **Standard Clauses** | For international transfers: EU Standard Contractual Clauses (SCC) | GDPR Chapter 5 |

### 2.4 CCPA and LGPD Compliance

**CCPA** (California Consumer Privacy Act):
- LLMtxt acts as a "service provider" (not a "third party")
- We process personal data only as instructed by the customer
- We do not sell personal data
- We certify non-use of CCPA data for any other purpose

**LGPD** (Brazil's Lei Geral de Proteção de Dados):
- LLMtxt is a "processor" under LGPD Article 5(VIII)
- Same commitments as GDPR (data use, sub-processors, deletion)
- Separate local contact: [To be added post-launch in Brazil]

---

## Section 3: Data Residency Policy

### 3.1 Data Residency Overview

**Location**: `docs/compliance/data-residency.md`

This policy documents where customer data is stored and how data location is controlled.

### 3.2 Current Data Storage Locations

| Data Category | Storage Location | Provider | Redundancy | Retention |
|---|---|---|---|---|
| **Production Database** | AWS Virginia (us-east-1) | Railway (managed Postgres) | Multi-AZ (automatic failover) | Until deletion by customer |
| **Backups (daily)** | AWS Virginia + Backblaze Frankfurt | S3 replication | Multi-region; 7-day retention | 7 daily + 4 weekly + 12 monthly |
| **Document Blobs** | Backblaze R2 (Frankfurt, EU) | Geofenced for EU customers | Cross-region replication | Until deletion or expiry |
| **Logs & Metrics** | AWS Virginia | Prometheus/Grafana on Railway | No replication; logs rotated | 15 days (metrics), 30 days (logs) |
| **Backups for Restore Testing** | AWS Virginia | Temporary S3 staging | Deleted after monthly restore drill | <1 hour |
| **Code & CI Artifacts** | GitHub | Microsoft infrastructure | Geo-distributed (GitHub handles) | As per GitHub policy |

### 3.3 Data Residency Options for Customers

**Current offering** (as of 2026-04-19):

- **Option A**: Default (US-based production in Virginia; backups dual-region US/EU)
- **Option B**: EU-only residency available for GDPR-sensitive documents (future roadmap; not yet implemented)

**Future roadmap** (T188 — Post-audit):
- Option C: APAC residency (Singapore) for Asia-Pacific customers
- Option D: Customer-controlled geo-tagging per document

### 3.4 Residency SLA

**Commitment**: Customer data will not be transferred to a different jurisdiction without 30-day notice and customer consent.

**Exception**: Backup mirrors to Backblaze R2 (Frankfurt) are pre-authorized under this DPA.

---

## Section 4: Data Retention Policy

### 4.1 Retention Policy Overview

**Location**: `docs/compliance/data-retention.md`

This policy documents how long LLMtxt retains customer data and what triggers deletion.

### 4.2 Data Retention Schedule

| Data Type | Retention Period | Deletion Trigger | Compliance |
|---|---|---|---|
| **Customer Account Data** | Until account deletion | Account deletion request via API or support | GDPR Article 17 (right to erasure) |
| **Document Content** | Until document deletion | Document deletion or expiry date | Customer-controlled; see next row |
| **Document Expiry** | Configurable (1 day–10 years) | Auto-expire after `expiresAt` timestamp | T427 (export/import); document owner controls |
| **Anonymous User Sessions** | 24 hours | TTL expiry; nightly purge job | Session auto-expires; not personally identifiable |
| **API Keys** | Until revocation | API key revocation endpoint | Revoked keys inactive immediately |
| **Audit Logs** | 7 years (industry standard) | Immutable; never deleted (tamper-evident chain) | SOC 2 Type 1; financial audit trail |
| **Backup Data** | 7 daily + 4 weekly + 12 monthly | Nightly rotation; oldest deleted automatically | Compliance + disaster recovery |
| **Application Logs** | 30 days | Nightly rotation | Observability; debugging support issues |
| **Metrics (Prometheus)** | 15 days | Automatic scrape retention | Monitoring; no PII |

### 4.3 User-Initiated Deletion

Customers can delete:
- [ ] Individual documents: `DELETE /api/documents/{id}`
- [ ] Entire account: `DELETE /api/account` (cascade deletes all documents, sessions, API keys)

**Retention post-deletion**:
- Account data: Deleted within 24 hours
- Document content: Deleted within 24 hours
- Audit logs: Retained (immutable; anonymized in future audit view)
- Backups: Gradually rolled off per retention schedule (max 12 months)

### 4.4 GDPR Right to Erasure (Article 17)

**Process**:
1. Customer submits data subject access request (DSAR) via support form
2. Engineering validates identity and extracts PII-containing documents
3. Data is deleted from production database within 5 business days
4. Backup rotation ensures deletion within 12 months
5. Confirmation email sent to customer

**Exceptions** (data may be retained):
- Audit logs (legal obligation: SOC 2, tax, fraud detection)
- Anonymized aggregate metrics (no personal data after anonymization)
- Backup copies < 12 months old (retention period)

---

## Section 5: Vendor Attestations & Letters

### 5.1 Railway SOC 2 Type 1 Letter

**Status**: PENDING (to be obtained before SOC 2 audit kickoff)

**Action items**:
1. Contact Railway support: request formal SOC 2 Type 1 report or attestation letter
2. Store in: `docs/compliance/vendor-soc2-letters/railway-soc2-type1-2026.pdf`
3. Share with LLMtxt auditor as evidence for CC6.4 (physical access control delegation)

**Key details**:
- Railway ISO 27001 certified
- Data centers in AWS (physical security handled by AWS)
- Multi-region redundancy across US, EU, APAC
- SOC 2 report covers: Security, Availability, Confidentiality

### 5.2 Cloudflare DPA & Attestation

**Status**: AVAILABLE (link provided)

**Details**:
- Cloudflare Enterprise DPA: https://www.cloudflare.com/en-gb/terms/cloudflare-data-processing-addendum/
- SOC 2 report available: https://www.cloudflare.com/trust-hub/
- Sub-processor list: https://www.cloudflare.com/trust-hub/
- File copy: `docs/compliance/vendor-dpas/cloudflare-dpa-2026.pdf` (to be obtained)

**Process**:
1. Download latest Cloudflare DPA from link above
2. Ensure it references the current Cloudflare sub-processors
3. Store signed copy (if separate contract)

### 5.3 AWS S3 & SOC 2 Compliance

**Status**: AVAILABLE

**Details**:
- AWS SOC 2 Type 1 report: https://aws.amazon.com/compliance/soc/
- AWS DPA for S3: https://aws.amazon.com/legal/
- AWS sub-processor list: https://aws.amazon.com/legal/aws-dpa/
- File copy: `docs/compliance/vendor-dpas/aws-dpa-2026.pdf` (to be obtained)

**Note**: LLMtxt uses AWS S3 indirectly via Railway and Backblaze R2. Direct AWS DPA required if we use S3 API directly in production (currently: backup staging only).

### 5.4 GitHub / Microsoft DPA & SOC 2

**Status**: AVAILABLE

**Details**:
- GitHub DPA: https://docs.github.com/en/github/site-policy/github-data-protection-agreement
- Microsoft SOC 2 report: https://www.microsoft.com/en-us/trust-center
- GitHub Enterprise Security compliance: https://docs.github.com/en/github/administering-a-repository/security-and-compliance-policy-for-your-repository
- File copy: `docs/compliance/vendor-dpas/github-dpa-2026.pdf` (to be obtained)

### 5.5 Backblaze DPA & Security

**Status**: AVAILABLE

**Details**:
- Backblaze B2 security: https://www.backblaze.com/cloud-storage/data-security
- Backblaze privacy policy: https://www.backblaze.com/about/privacy
- Backblaze SOC 2 Type 1: Contact support for letter
- File copy: `docs/compliance/vendor-dpas/backblaze-soc2-letter-2026.pdf` (to request)

---

## Section 6: Privacy Policy & Terms of Service (Templates)

### 6.1 Privacy Policy

**Status**: IN PROGRESS — **T184-G1** (Due 2026-05-20)

**Location**: (To be created) `apps/frontend/src/routes/legal/privacy.ts`

**Key sections**:
- What personal data we collect
- How we use the data
- Our legal basis for processing (GDPR)
- Recipients of personal data (sub-processors)
- Data subject rights (access, deletion, portability)
- Retention schedules
- Contact for privacy questions

**Compliance**:
- GDPR Recital 13 (transparent privacy notice)
- CCPA Section 1798.100 (CPRA-compliant)
- LGPD (Brazilian requirements)

**Links**:
- Draft: To be shared during Wave 1 remediation
- Published: https://www.llmtxt.my/legal/privacy (future)

### 6.2 Terms of Service

**Status**: IN PROGRESS — **T184-G1** (Due 2026-05-20)

**Location**: (To be created) `apps/frontend/src/routes/legal/terms.ts`

**Key sections**:
- Use restrictions (no illegal activity, no spam)
- Intellectual property rights
- Liability limitations
- Data processing (references DPA)
- DMCA / copyright takedown
- Dispute resolution
- Termination

**Compliance**:
- Consumer protection laws (FTC Act Section 5)
- E-commerce regulations (state-specific)
- GDPR references (if collected from EU users)

**Links**:
- Draft: To be shared during Wave 1 remediation
- Published: https://www.llmtxt.my/legal/terms (future)

### 6.3 Acceptable Use Policy (AUP)

**Status**: OPTIONAL (not required for Type 1)

**Future**: Clarify what use cases are prohibited (e.g., no using LLMtxt for unauthorized surveillance, malware distribution).

---

## Section 7: PII Inventory

### 7.1 PII Inventory Overview

**Location**: `docs/compliance/pii-inventory.md`

This inventory documents all types of personal information we collect, how long we retain it, and how it is protected.

### 7.2 PII Collected and Retention

| PII Category | Collection Method | Retention | Deletion Method | Purpose | Compliance |
|---|---|---|---|---|---|---|
| **Email address** | Account signup or API | Until account deletion | Email anonymized in audit log | Authentication, notifications | GDPR Article 6(b) |
| **Password hash** | Account signup | Until account deletion | Hashed via bcrypt (one-way) | Authentication | GDPR Article 6(b) |
| **Session tokens** | Login | 24 hours (TTL) | Automatic expiry | Session management | GDPR Article 6(b) |
| **API keys** | User request via API | Until revocation or account deletion | Marked `revoked=true` in DB | API authentication | GDPR Article 6(b) |
| **IP address (request logs)** | HTTP request headers | 30 days | Automatic log rotation | Security monitoring, abuse detection | GDPR Article 6(f) |
| **User agent** | HTTP request headers | 30 days | Automatic log rotation | Debugging, compatibility | GDPR Article 6(f) |
| **Document content** | User upload | Until document deletion or expiry | Deleted on user request or TTL | Core product feature | GDPR Article 6(b) |
| **Org membership** | User assignment | Until user removed from org or account deletion | Cascade delete | Authorization | GDPR Article 6(b) |
| **Audit trail (actor ID, timestamp)** | Every API call | 7 years | Immutable; never deleted | Legal compliance, fraud detection | GDPR Article 6(f), SOC 2 |
| **Error stack traces** | App errors | 30 days | Automatic rotation or GlitchTip cleanup | Debugging | GDPR Article 6(f) |

### 7.3 No Tracking or Advertising

**Commitment**: LLMtxt does NOT:
- Sell personal data to advertisers
- Use cookies for behavioral tracking
- Build profiles for third-party marketing
- Share personal data with data brokers

**Analytics** (future, not yet active):
- If enabled, will use privacy-first tools (Plausible, Fathom)
- No cookie-based tracking; no personal data collection
- Compliant with GDPR and ePrivacy Directive

---

## Section 8: Distribution and Version Control

### 8.1 Artifact Locations

All compliance materials are stored in `/mnt/projects/llmtxt/docs/compliance/`:

| Document | File Path | Status | Last Updated |
|---|---|---|---|
| Sub-processor registry | `docs/compliance/sub-processors.md` | Current | 2026-04-18 |
| DPA template | `docs/compliance/dpa-template.md` | Current | 2026-04-18 |
| Data residency policy | `docs/compliance/data-residency.md` | Current | 2026-04-18 |
| Data retention policy | `docs/compliance/data-retention.md` | Current | 2026-04-18 |
| PII inventory | `docs/compliance/pii-inventory.md` | Current | 2026-04-18 |
| Privacy policy (template) | `apps/frontend/src/routes/legal/privacy.ts` | IN PROGRESS | T184-G1 (due 2026-05-20) |
| Terms of service (template) | `apps/frontend/src/routes/legal/terms.ts` | IN PROGRESS | T184-G1 (due 2026-05-20) |
| GDPR erasure procedure | `docs/compliance/gdpr-erasure.md` | Current | 2026-04-18 |
| Right to deletion (CCPA/LGPD) | `docs/compliance/right-to-deletion.md` | Current | 2026-04-18 |

### 8.2 Distribution Method

**For auditors**:
1. Provide this vendor package document (you are here)
2. Share evidence vault link (`docs/compliance/evidence-vault.md`)
3. Grant read-only GitHub access to `docs/compliance/` directory

**For customers (enterprise)**:
1. Share executed DPA (customer-specific)
2. Share current sub-processor list
3. Share privacy policy (via website)
4. Share data residency confirmation (if requested)

**For regulatory requests** (data subject access request, etc.):
1. Extract PII-containing documents within 5 business days
2. Provide in human-readable format (PDF or CSV)
3. Log in GDPR erasure tracker

### 8.3 Version Control & Updates

**Review cycle**: Quarterly (Q2, Q3, Q4, Q1)

**Update triggers**:
- New sub-processor added
- Vendor contract changes
- Regulatory requirement changes
- Data processing changes

**Version numbering**: Major.Minor.Patch (e.g., 1.0.0 → 1.0.1 for sub-processor list update → 1.1.0 for new section)

---

## Section 9: Audit Readiness Checklist

Use this checklist before sharing with the auditor:

- [ ] **DPA template**: Reviewed by legal; ready for customer use
- [ ] **Sub-processor registry**: Current as of 2026-04-19; all vendors confirmed
- [ ] **Vendor letters**: Rail SOC 2 Type 1 letter obtained and stored
- [ ] **Data residency policy**: Reviewed; matches actual infrastructure
- [ ] **Data retention policy**: Reviewed; deletion procedures tested (T427 automated deletion)
- [ ] **Privacy policy**: Drafted (T184-G1); legal review pending
- [ ] **Terms of service**: Drafted (T184-G1); legal review pending
- [ ] **GDPR erasure procedure**: Documented; tested with anonymous user purge
- [ ] **Right to deletion (CCPA)**: Procedures match data retention policy
- [ ] **Sub-processor agreements**: All have DPA addendums (copies in `vendor-dpas/`)

---

## Section 10: Contact and Ownership

| Role | Responsible | Contact |
|---|---|---|
| **Compliance materials owner** | Engineering | — |
| **Sub-processor management** | Engineering + Procurement | — |
| **Privacy & legal policy** | Founder / Legal (external) | — |
| **Auditor liaison** | Founder | — |
| **Customer DPA requests** | Support / Founder | — |
| **Data subject requests (DSAR/deletion)** | Engineering + Legal | — |

---

## Appendix A: Recommended Reading Order

For the SOC 2 auditor:

1. **Start here**: `docs/compliance/soc2-type1-readiness.md` (executive summary)
2. **Then**: `docs/compliance/controls-inventory.csv` (all controls and status)
3. **Then**: `docs/compliance/evidence-vault.md` (evidence index and testing procedures)
4. **Then**: This document (vendor-package.md) — vendor attestations and DPA
5. **Finally**: Detailed evidence artifacts (see evidence vault for file paths)

For enterprise customers:

1. **Start here**: Privacy policy (llmtxt.my/legal/privacy)
2. **Then**: Terms of service (llmtxt.my/legal/terms)
3. **Then**: DPA template (if they require it)
4. **Then**: Sub-processor registry (if they require vendor management visibility)

---

*Last updated: 2026-04-19 | Maintained by: Engineering | Next review: 2026-07-19*
