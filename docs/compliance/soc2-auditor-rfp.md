# SOC 2 Type 1 Auditor Request for Proposal

> **Document type**: RFP for SOC 2 Type 1 audit engagement
> **Date**: 2026-04-19
> **Version**: 1.0.0
> **Scope**: Shortlisted SOC 2 auditors and engagement template
> **Timeline**: Auditor selection Q2 2026; audit execution Q3 2026

---

## Executive Summary

LLMtxt is seeking a licensed CPA firm to conduct a SOC 2 Type 1 audit covering the period ending 2026-06-30. We have completed an internal control assessment and created a readiness package. This RFP documents three qualified auditor candidates and our engagement expectations.

---

## About LLMtxt

**Company**: LLMtxt  
**Founded**: 2024 (initial version); v2 rewrite 2025–2026  
**Business**: Multi-agent document collaboration platform with cryptographic audit chain  
**Services**: SaaS API (api.llmtxt.my), frontend (www.llmtxt.my), SDK (npm + Rust crate)  
**Annual recurring revenue (ARR)**: <$100K (seed stage)  
**Employees**: 1 full-time engineer (founder)  

**Trust Service Categories in Scope**:
- Security (CC1–CC9): Control environment, communications, risk assessment, monitoring, control activities, logical access, system operations, change management, vendor management
- Availability (A1): Capacity, environmental protections, backup/recovery, BCDR testing, uptime commitments
- Confidentiality (C1): Identify, dispose, protect, and disclose confidential information

**Exclusions**: Performance (P), Privacy (P), Separately Risk (SR)

---

## Readiness Status

**Overall readiness**: 52% (22 of 42 controls met; 12 partial; 8 gaps)

| Category | Controls | Met | Partial | Gap | Score |
|---|---|---|---|---|---|
| Security (CC1–CC9) | 33 | 18 | 9 | 6 | 55% |
| Availability (A1) | 5 | 2 | 2 | 1 | 40% |
| Confidentiality (C1) | 4 | 2 | 1 | 1 | 50% |

**Gap remediation timeline**:
- Wave 1 (by 2026-05-20): Enable Dependabot, draft privacy policy, draft IR runbook
- Wave 2 (by 2026-06-15): Security alerting, DPA template, SLA publication
- Wave 3 (optional, pre-Type 2): Vendor risk ratings, BCDR formal plan, data retention policy

**Expected readiness by audit period end (2026-06-30)**: 85% (all high-priority gaps closed)

---

## Audit Scope

### In-Scope Entities and Systems

| Entity | Scope | Notes |
|---|---|---|
| api.llmtxt.my | Full production API | Rust + TypeScript backend on Railway |
| www.llmtxt.my | Frontend authentication and RBAC | Next.js SPA on Railway |
| docs.llmtxt.my | Public documentation site | Fumadocs; read-only |
| llmtxt npm package | SDK module | Published to npm registry; contains WASM bindings |
| llmtxt-core Rust crate | Core crypto library | Published to crates.io; cryptographic primitives |
| Database | Postgres on Railway | Managed service; backup and recovery procedures |
| Infrastructure | Railway platform + Cloudflare | Cloud PaaS; physical access delegated |
| Personnel | 1 full-time engineer (founder) | Works remotely; no office |

### Out-of-Scope (Explicitly Delegated)

| Item | Provider | Justification |
|---|---|---|
| Physical infrastructure security | Railway | ISO 27001 certified; SOC 2 Type 1 compliant |
| TLS termination and DDoS mitigation | Cloudflare | Cloudflare Enterprise plan |
| Object storage (backups, blobs) | AWS S3 / Backblaze R2 | SOC 2 Type 1 compliant |
| API registry and npm infrastructure | npm, Inc. | Out of scope per SOC 2 standard |
| GitHub and GitHub Actions CI | GitHub / Microsoft | Signed commits and audit log; GitHub has ISO 27001 cert |

---

## Engagement Model

### Timing and Deliverables

| Phase | Timeline | Deliverable | Notes |
|---|---|---|---|
| Planning & kickoff | 2026-05-01 to 2026-05-15 | Engagement letter, control walkthrough, schedule | 2-week window |
| Control testing | 2026-05-15 to 2026-06-15 | Evidence review, walkthrough interviews, testing | 4-week fieldwork |
| Reporting & review | 2026-06-15 to 2026-06-30 | Draft report, management review, final issuance | 2-week final window |
| **Total duration** | **8 weeks** | | Point-in-time Type 1 report |

### Services Required

| Service | Scope | Effort | Notes |
|---|---|---|---|
| SOC 2 Type 1 audit | Security + Availability + Confidentiality | Full | AICPA Professional Standards SSAE 18 |
| Management letter | Control observations and recommendations | Included | Optional: Recommendations for Wave 2/3 gaps |
| Auditor attestation | Report issuance | Included | To be offered to customers under NDA |
| Field interview time | 2 x 2-hour sessions with founder | 4 hours | Remote via video; no travel required |

### Out-of-Scope Services

- Type 2 audit (deferred to 2027 if Type 1 successful)
- GDPR/CCPA compliance assessment (separate engagement)
- Penetration testing or vulnerability assessment (future)
- Remediation project delivery (we handle this in-house)

---

## Shortlisted Auditors

We have identified three qualified SOC 2 audit firms. All are AICPA members and have B2B SaaS experience.

---

## Candidate 1: Drata

**Company**: Drata  
**Type**: Automation-first SOC 2 audit platform  
**Headquarters**: San Francisco, CA  
**Website**: https://www.drata.com/soc2  

### Profile

Drata is a compliance automation platform that assists companies in achieving SOC 2 compliance. They streamline the audit process by collecting evidence automatically and providing compliance infrastructure. Suitable for startups seeking a faster, more cost-effective audit path.

### Pros

- **Speed**: Reduced time-to-audit through automation and continuous monitoring
- **Cost**: Typically $8K–$15K for Type 1; pricing scales with complexity
- **Accessibility**: Web-based portal; minimal manual documentation required
- **Evidence gathering**: Automated backup testing, log monitoring, deployment tracking
- **Renewability**: Type 1 → Type 2 → continuous monitoring pathway
- **Startup-focused**: Understands early-stage company constraints

### Cons

- **Less traditional**: Auditor opinion still required; Drata is a compliance partner, not the auditor
- **Limited depth**: May not dig as deeply into custom controls (e.g., our tamper-evident audit chain)
- **Customization**: Less flexible if controls differ significantly from template

### Pricing (Estimate)

- SOC 2 Type 1 audit: $10K–$15K (fixed-price engagement)
- Evidence platform: $1K–$2K/month (ongoing)
- Management letter: Included
- **Total first-year cost**: ~$22K–$27K

### Key Contact

Contact form: https://www.drata.com/contact  
Expected response: 1–2 business days

### Fit Assessment

**Alignment with LLMtxt**: **HIGH**

Drata's automation-first approach aligns well with our infrastructure-as-code and continuous monitoring practices. Their Type 1 → Type 2 pathway is valuable for future growth.

---

## Candidate 2: Vanta

**Company**: Vanta  
**Type**: Trust management and compliance platform  
**Headquarters**: San Francisco, CA  
**Website**: https://www.vanta.com/soc-2  

### Profile

Vanta is a trust management platform that integrates with SaaS infrastructure to automate evidence collection for SOC 2, ISO 27001, and other compliance frameworks. They provide both the platform and auditor connections.

### Pros

- **Integrated auditing**: Vanta partners with licensed CPA firms; manages the audit on behalf of clients
- **Automation**: Continuous monitoring and automated evidence collection
- **Multi-framework**: Can stack SOC 2 + ISO 27001 + HIPAA in a single engagement
- **Visibility**: Real-time compliance dashboard; status tracking
- **Best-in-class platform**: High customer satisfaction in SaaS audit space
- **Investor credibility**: Backed by a16z, widely recognized

### Cons

- **Cost**: Higher pricing tier than Drata; $15K–$25K for Type 1
- **Platform dependency**: Locked into their evidence platform after audit completes
- **Customization**: Similar limitations to Drata on custom controls

### Pricing (Estimate)

- SOC 2 Type 1 audit: $15K–$20K (via partner auditor)
- Vanta platform: $2K–$3K/month (ongoing)
- Management letter: Included
- **Total first-year cost**: ~$39K–$56K

### Key Contact

Contact form: https://www.vanta.com/get-a-demo  
Expected response: 1–2 business days

### Fit Assessment

**Alignment with LLMtxt**: **HIGH**

Vanta's maturity and integrated auditor network make them a safe choice. Their platform would provide ongoing compliance visibility, useful for future Type 2 audit and investor due diligence.

---

## Candidate 3: A-LIGN

**Company**: A-LIGN  
**Type**: Traditional big-4 alternative audit and compliance firm  
**Headquarters**: Arlington, VA  
**Website**: https://www.a-lign.com/soc-2-compliance  

### Profile

A-LIGN is a traditional CPA audit firm (not a platform) with deep SOC 2 expertise. They conduct audits directly (not through a platform intermediary). More suitable for companies with custom controls or preference for traditional audit relationships.

### Pros

- **Traditional audit**: Direct engagement with licensed CPAs; no platform intermediary
- **Customization**: Auditors deeply understand custom controls like tamper-evident audit chains
- **Depth**: More rigorous control testing; longer management letter with detailed recommendations
- **Relationship**: Direct auditor contact; continuity across multiple audits
- **No platform lock-in**: Evidence stays with you; no ongoing platform fees beyond audit
- **Type 2 expertise**: Strong track record on multi-year engagements

### Cons

- **Cost**: Highest pricing tier; $20K–$30K for Type 1
- **Timeline**: Traditional audit timeline (8–12 weeks vs. Drata/Vanta 6–8 weeks)
- **Less automation**: More manual evidence collection required
- **Larger firm overhead**: Not as nimble as platform-first vendors

### Pricing (Estimate)

- SOC 2 Type 1 audit: $22K–$28K (fixed-price)
- Management letter: Included
- No ongoing platform fees
- **Total first-year cost**: ~$22K–$28K

### Key Contact

Sales: https://www.a-lign.com/contact-us  
Expected response: 2–3 business days

### Fit Assessment

**Alignment with LLMtxt**: **MODERATE–HIGH**

A-LIGN's depth and customization capability make them ideal if we want the most thorough audit and richest feedback. Best choice if we plan to pursue Type 2 immediately after Type 1.

---

## Comparison Matrix

| Criterion | Drata | Vanta | A-LIGN |
|---|---|---|---|
| **Speed (weeks to report)** | 6–8 | 6–8 | 10–12 |
| **First-year cost** | $22K–$27K | $39K–$56K | $22K–$28K |
| **Ongoing platform cost** | $1K–$2K/month | $2K–$3K/month | $0 |
| **Customization** | Moderate | Moderate | High |
| **Direct auditor relationship** | Via partner | Via partner | Yes |
| **Type 2 pathway** | Moderate | High | High |
| **SaaS specialization** | High | Very High | High |
| **Best for** | Budget-conscious startups | Fast growth + investor diligence | Deep audit + Type 2 planning |

---

## RFP Template: Questions for Auditor Candidates

Use this template when requesting proposals:

```
REQUEST FOR PROPOSAL: SOC 2 Type 1 Audit — LLMtxt

1. ENGAGEMENT SCOPE
   a) Can you provide a fixed-price proposal for SOC 2 Type 1 audit covering 
      Security (CC1–CC9), Availability (A1), and Confidentiality (C1) for 
      LLMtxt as of 2026-06-30?
   
   b) What is your timeline from engagement letter (2026-05-01) to report 
      issuance (target: 2026-06-30)?
   
   c) Will you need fieldwork in our facility, or can fieldwork be conducted 
      remotely?

2. CONTROL ASSESSMENT
   a) Have you audited custom controls in other startups (e.g., tamper-evident 
      audit logs, CRDT-based version control)?
   
   b) What is your approach to delegated controls (e.g., Railway infrastructure, 
      Cloudflare TLS termination)?
   
   c) Will you visit or audit our cloud infrastructure, or will you rely on 
      third-party attestations (e.g., Railway SOC 2)?

3. EVIDENCE REQUIREMENTS
   a) What artifacts will you request from us? (We can provide: code repository, 
      CI logs, deployment records, backup logs, audit trail database, Grafana 
      dashboards, etc.)
   
   b) Will you conduct automated testing, or manual testing only?
   
   c) Do you have integrations with GitHub, Postgres, Grafana, or other 
      platforms we use?

4. REPORTING AND DELIVERABLES
   a) What format will the final report take? (PDF, printed, digital with 
      auditor letter?)
   
   b) How many copies of the management letter will you provide?
   
   c) Can we share the audit report with customers under NDA? (This is 
      important for enterprise sales.)
   
   d) What is your timeline for issuing a corrected report if we remediate 
      a gap-control finding before final report?

5. PRICING AND TIMELINE
   a) Fixed-price quote for SOC 2 Type 1 audit (excluding optional management 
      letter upgrades)?
   
   b) What is included in your pricing? (Fieldwork hours, report writing, 
      travel, contingency testing?)
   
   c) What are your fee terms and payment schedule?
   
   d) Do you have ongoing platform or subscription fees post-audit? (For 
      evidence retention, compliance monitoring, or Type 2 preparation?)

6. NEXT STEPS FOR TYPE 2
   a) If we pursue Type 2 after this Type 1, will you be our auditor for that 
      engagement, or should we plan for a different firm?
   
   b) What is your Type 2 pricing model? (Same firm, same team continuity?)
   
   c) Do you recommend any controls or documentation we should implement now 
      to ease the Type 2 transition?

7. REFERENCES
   a) Can you provide 2–3 references from recent SOC 2 Type 1 engagements 
      (ideally startups with <$10M ARR)?
   
   b) May we contact them to discuss your process and quality?

SUBMISSION DEADLINE: 2026-04-26
Please submit your proposal to: auditor-rfp@llmtxt.my (placeholder)
```

---

## Evaluation Rubric

When comparing proposals, use this scoring matrix:

| Criterion | Weight | Drata | Vanta | A-LIGN |
|---|---|---|---|---|
| **Responsiveness & Communication** | 15% | Score 1–10 | — | — |
| **Timeline (6–8 weeks preferred)** | 20% | — | — | — |
| **Cost (lower is better)** | 20% | — | — | — |
| **Customization & depth** | 20% | — | — | — |
| **Type 2 pathway & continuity** | 15% | — | — | — |
| **References & track record** | 10% | — | — | — |
| **TOTAL** | **100%** | — | — | — |

**Scoring guide**:
- 9–10: Exceeds expectations; clear winner
- 7–8: Meets expectations; solid choice
- 5–6: Adequate; minor concerns
- 3–4: Below expectations; requires clarification
- 1–2: Weak response; not recommended

---

## Selection Timeline

| Date | Activity |
|---|---|
| 2026-04-19 | Publish RFP to shortlisted candidates (this document) |
| 2026-04-22 to 2026-04-26 | Auditor responses due |
| 2026-04-27 to 2026-04-30 | Evaluation and reference checks |
| 2026-05-01 | Auditor selected; engagement letter signed |
| 2026-05-15 to 2026-06-30 | Audit execution and reporting |
| 2026-07-01 | SOC 2 Type 1 report available for customer sharing |

---

## Next Steps

1. **Customize this RFP**: Replace placeholder email and adjust dates as needed
2. **Reach out to candidates**: Send this document + RFP template to Drata, Vanta, A-LIGN
3. **Collect proposals**: Set a deadline (2026-04-26 recommended)
4. **Evaluate & select**: Use the rubric above; request references
5. **Engage auditor**: Sign engagement letter; begin planning (May 1)

---

## Internal Preparation Checklist

Before the audit kickoff meeting, ensure:

- [ ] Readiness assessment complete (`docs/compliance/soc2-type1-readiness.md`)
- [ ] Controls inventory CSV exported (`docs/compliance/controls-inventory.csv`)
- [ ] Evidence vault documented (`docs/compliance/evidence-vault.md`)
- [ ] Wave 1 gap remediation on schedule (Dependabot, privacy policy, IR runbook)
- [ ] Access provisioned for auditor
  - [ ] Read-only Grafana/Prometheus credentials
  - [ ] GitHub repo viewer access (or docs.llmtxt.my public access)
  - [ ] Scoped API key for audit endpoint testing
- [ ] Founder calendar blocked for 4–6 hours fieldwork interviews (May 15–June 15)
- [ ] Evidence artifacts organized and indexed (see evidence vault)

---

## Contact and Ownership

| Role | Responsible |
|---|---|
| **RFP coordination** | Engineering / Compliance |
| **Auditor relationship** | Founder / Compliance Officer |
| **Gap remediation** | Engineering |
| **Stakeholder alignment** | Founder |

---

*Last updated: 2026-04-19 | Maintained by: Engineering | Next review: 2026-05-01*
