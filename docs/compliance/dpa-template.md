# Data Processing Agreement

> **Document type**: Template — not a legal advice document. Customers should have legal counsel review before execution. LLMtxt recommends having your DPO or legal team review this template before signing.
>
> **Template version**: 1.0.0 (2026-04-18)
> **Jurisdiction**: GDPR (EU 2016/679), UK GDPR, CCPA (Cal. Civ. Code § 1798.100 et seq.)

---

**DATA PROCESSING AGREEMENT**

This Data Processing Agreement ("DPA") forms part of, and is subject to, the Master Services Agreement or Terms of Service ("Agreement") between:

**Controller (Customer)**:

```
Company Name: _________________________________
Registered Address: _________________________________
Company Registration No.: _________________________________
Contact for data protection matters: _________________________________
Email: _________________________________
("Controller" or "Customer")
```

**Processor (LLMtxt)**:

```
LLMtxt
Contact: compliance@llmtxt.my
("Processor" or "LLMtxt")
```

The parties agree as follows.

---

## Article 1 — Definitions

1.1 **"Applicable Data Protection Law"** means (a) the EU General Data Protection Regulation (Regulation 2016/679, "GDPR"), (b) the UK GDPR and Data Protection Act 2018, (c) the California Consumer Privacy Act (Cal. Civ. Code § 1798.100 et seq., "CCPA") and its implementing regulations, and (d) any other data protection or privacy laws applicable to the Processing under this DPA.

1.2 **"Personal Data"** has the meaning given in the Applicable Data Protection Law. For the purposes of this DPA, it includes all data listed in Annex 1 (Description of Processing).

1.3 **"Processing"** has the meaning given in the GDPR, and includes any operation on Personal Data.

1.4 **"Data Subject"** means the identified or identifiable natural person to whom Personal Data relates.

1.5 **"Sub-processor"** means any third party engaged by LLMtxt to Process Personal Data on behalf of the Customer. The current sub-processor list is maintained at https://llmtxt.my/legal/sub-processors (also available at `docs/compliance/sub-processors.md`).

1.6 **"Security Incident"** means a breach of security leading to the accidental or unlawful destruction, loss, alteration, unauthorized disclosure of, or access to, Personal Data.

---

## Article 2 — Scope and Nature of Processing

2.1 LLMtxt shall Process Personal Data only on the documented instructions of the Customer (which include the Agreement and this DPA), unless required to do so by Applicable Data Protection Law.

2.2 LLMtxt shall inform the Customer if, in its opinion, an instruction infringes Applicable Data Protection Law, before Processing.

2.3 The nature, purpose, categories of Personal Data, and categories of Data Subjects are set out in Annex 1.

---

## Article 3 — Obligations of the Processor

LLMtxt shall:

3.1 **Confidentiality**: Ensure that persons authorized to Process Personal Data have committed to confidentiality or are under a statutory obligation of confidentiality.

3.2 **Security**: Implement the technical and organizational measures described in Annex 2 (Security Measures). LLMtxt may update these measures over time provided that the level of protection is not diminished.

3.3 **Sub-processing**: Not engage a new sub-processor without giving the Customer at least **30 days' prior written notice** (by email to the Customer's registered data protection contact). If the Customer objects to the new sub-processor on reasonable data protection grounds, the parties shall work in good faith to resolve the objection; if unresolved within 30 days, either party may terminate the Agreement on notice without penalty.

3.4 **Sub-processor flow-down**: Ensure that each sub-processor is bound by data protection obligations that are equivalent to or stricter than those in this DPA.

3.5 **Assistance — Data Subject Rights**: Assist the Customer, by appropriate technical and organizational measures, to respond to Data Subject requests for the exercise of rights under Applicable Data Protection Law (access, rectification, erasure, portability, restriction, objection). LLMtxt provides the following mechanisms:
   - Data export: SDK `exportAll()` command or `GET /api/v1/export` endpoint
   - Account deletion: `DELETE /api/v1/users/me` endpoint
   - Rectification: `PUT /api/v1/users/me` endpoint

3.6 **Assistance — Security obligations**: Assist the Customer in ensuring compliance with Articles 32-36 of the GDPR (security, breach notification, DPIA, prior consultation).

3.7 **Deletion or return**: On termination or expiry of the Agreement, delete or return all Personal Data, at the Customer's election, unless Applicable Data Protection Law requires storage. LLMtxt will complete deletion within 30 days of receiving written notice of termination.

3.8 **Audit**: Make available to the Customer all information necessary to demonstrate compliance with this Article, and allow for and contribute to audits conducted by the Customer or its mandated auditor. Customer shall provide at least 30 days' written notice of an audit and conduct audits no more than once per calendar year unless there is a reasonable basis to suspect non-compliance. Audit costs are borne by the Customer.

3.9 **Notification of Security Incidents**: Notify the Customer without undue delay, and in any event within **72 hours** of becoming aware of a Security Incident involving Personal Data. The notification shall include (to the extent available): nature of the incident, categories and approximate number of Data Subjects affected, categories and approximate number of records affected, likely consequences, measures taken or proposed. LLMtxt shall not be required to notify where the Security Incident is unlikely to result in a risk to the rights and freedoms of natural persons.

---

## Article 4 — Transfers of Personal Data Outside the EEA

4.1 LLMtxt is incorporated and operates in the United States. Processing of Personal Data by LLMtxt and its sub-processors may involve transfers of Personal Data to the United States or other countries outside the European Economic Area ("EEA").

4.2 Where such transfers occur, they shall be governed by the **EU Standard Contractual Clauses (Module 2: Controller to Processor)** issued by the European Commission on 4 June 2021 (Decision 2021/914), incorporated by reference in this DPA with the following specifications:

   - **Module**: 2 (Controller to Processor)
   - **Clause 7**: Optional docking clause — included
   - **Clause 9**: Sub-processors — Option B (general written authorization with 30-day notice)
   - **Clause 11**: Redress — optional language not included
   - **Clause 17**: Governing law of SCCs — law of Ireland (EU Member State where GDPR supervisor is located)
   - **Clause 18(b)**: Disputes — courts of Ireland

4.3 The Customer (as data exporter) and LLMtxt (as data importer) agree to be bound by the SCCs as completed above. In the event of conflict between the SCCs and this DPA, the SCCs shall prevail.

4.4 Where the transfer is from the United Kingdom, the UK Addendum to the EU SCCs (issued by the UK ICO under S119A of the Data Protection Act 2018) is incorporated by reference.

4.5 **Data Transfer Impact Assessment (DTIA)**: The Customer acknowledges that LLMtxt has made available for review: (a) this DPA, (b) the sub-processor list, (c) the security measures in Annex 2, and (d) LLMtxt's response to the DTIA questionnaire available at compliance@llmtxt.my. The Customer is responsible for conducting its own DTIA based on these materials.

---

## Article 5 — CCPA (California) Provisions

5.1 For purposes of the CCPA, LLMtxt is a "service provider" and shall not: (a) sell or share Personal Information; (b) retain, use, or disclose Personal Information for any purpose other than providing the services under the Agreement; (c) retain, use, or disclose Personal Information outside the direct business relationship between LLMtxt and the Customer; (d) combine Personal Information received from the Customer with Personal Information received from or collected in connection with another person's business.

5.2 LLMtxt certifies that it understands these obligations and shall comply with them.

---

## Article 6 — Term and Termination

6.1 This DPA is effective from the date both parties have executed it and shall remain in force until the Agreement terminates or expires.

6.2 Obligations regarding data deletion and confidentiality survive termination.

---

## Annex 1 — Description of Processing

| Field | Detail |
|---|---|
| **Subject matter** | Provision of the LLMtxt multi-agent document collaboration platform |
| **Duration** | The term of the Agreement |
| **Nature and purpose** | Storage, retrieval, versioning, and collaboration on text documents. Authentication and session management. Audit logging for compliance. |
| **Categories of Personal Data** | Account data: email address, display name, profile image URL. Usage data: document content (if it contains PII), version history, audit log actor references. Technical data: IP address (sessions table), user agent string (sessions table), API key metadata (not the key itself). |
| **Special categories of Personal Data** | None anticipated. Customers must not upload special-category data (health, biometric, etc.) without agreeing specific additional terms. |
| **Categories of Data Subjects** | Registered users (human collaborators), anonymous users (24-hour session), programmatic agents (identified by agentId). |
| **Frequency of transfers** | Continuous (real-time API operations) |
| **Retention** | As configured by the Customer per document `expiresAt`. Account data retained until account deletion. Audit logs retained minimum 90 days (compliance requirement). |

---

## Annex 2 — Technical and Organizational Security Measures

LLMtxt implements the following measures as of the DPA effective date:

### Access Control

- **Authentication**: Server-side session tokens (better-auth), API keys (HMAC-SHA256 hashed at rest, never stored in plaintext), Ed25519 agent signatures for machine-to-machine identity.
- **Authorization**: Role-based access control (RBAC) — owner, editor, viewer roles per document. Organization-level membership controls. Document visibility (public/private/org).
- **Least privilege**: API keys are scoped; agents receive only the permissions their role grants.

### Cryptography

- **In transit**: TLS 1.2+ enforced on all endpoints via Cloudflare. HSTS with `max-age=31536000; includeSubDomains`. No HTTP fallback in production.
- **At rest**: Database encryption delegated to Railway's managed PostgreSQL (underlying storage encryption). Backup files encrypted with `age` (X25519 recipient key) before upload to S3.
- **Cryptographic operations**: All cryptographic primitives (SHA-256 hashing, HMAC-SHA256 signed URLs, Ed25519 signing, content compression) are implemented in `crates/llmtxt-core` (Rust, published to crates.io). No direct use of `node:crypto` in TypeScript code (enforced by CI lint rule).

### Integrity and Audit

- **Tamper-evident audit log**: All state-changing API operations are recorded in `audit_logs` table with a hash chain (SHA-256 of previous entry concatenated with current payload). Chain integrity is verifiable by external parties.
- **Content hashing**: All documents carry a SHA-256 `content_hash`. Blob attachments are verified on read.

### Network Security

- **HTTP security headers**: Content-Security-Policy with per-request cryptographic nonce (no `unsafe-inline`), X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy.
- **Rate limiting**: Tiered rate limiting by authentication level (IP / session / API key) on all API routes. Auth routes have stricter limits.
- **DDoS protection**: Cloudflare DDoS protection on all endpoints.
- **CSRF protection**: Per-request CSRF token enforcement on mutating routes.
- **Input sanitization**: DOMPurify sanitization on HTML rendering paths.

### Operational Security

- **Backups**: Nightly Postgres backups to S3 (age-encrypted). Weekly and monthly backups. Retention: 7 daily, 4 weekly, 12 monthly. Restore drill run monthly.
- **Observability**: Self-hosted Grafana/Loki/Tempo/Prometheus on Railway. Structured logging via Pino. OpenTelemetry distributed tracing.
- **Change management**: All code changes via GitHub PR. Migration safety CI check. CalVer versioning with mandatory CHANGELOG entries.

### Gaps (tracked remediation)

- No automated dependency vulnerability scanning (Dependabot not yet enabled — target 2026-05-15).
- No formal written incident response plan (target 2026-05-15).
- No automated security event alerting on Prometheus (target 2026-06-01).

---

## Annex 3 — Authorized Sub-Processors

The current authorized sub-processor list is maintained at:
- Public URL: https://llmtxt.my/legal/sub-processors (target publication date 2026-05-15)
- Repository: `docs/compliance/sub-processors.md`

LLMtxt will provide 30 days' advance written notice of material sub-processor additions or changes.

---

## Signature Block

**CONTROLLER (CUSTOMER)**

```
Signed: _______________________________
Name:   _______________________________
Title:  _______________________________
Date:   _______________________________
```

**PROCESSOR (LLMtxt)**

```
Signed: _______________________________
Name:   _______________________________
Title:  _______________________________
Date:   _______________________________
```

---

*DPA template version 1.0.0 — 2026-04-18. This template is provided as a starting point and does not constitute legal advice. LLMtxt recommends both parties have legal counsel review the executed agreement.*
