# LLMtxt Sub-Processor Register

> **Document type**: Public sub-processor register
> **Date**: 2026-04-18
> **Version**: 1.0.0
> **Update policy**: LLMtxt provides 30 days advance notice of material sub-processor additions or changes. Customers subscribed to compliance notifications will receive email notice. This page is the authoritative list.
>
> **Notification**: To receive sub-processor change notifications, contact compliance@llmtxt.my or include a sub-processor notification clause in your DPA.

---

## What is a Sub-Processor?

A sub-processor is any third party that LLMtxt engages to process personal data on behalf of LLMtxt customers. This register lists every such entity, their purpose, the categories of data they process, and their geographic location.

---

## Current Sub-Processors

As of 2026-04-18, LLMtxt engages the following sub-processors:

| # | Entity | Purpose | Data types processed | Headquarters | Processing location | DPA / Privacy reference |
|---|---|---|---|---|---|---|
| 1 | **Railway, Inc.** | Cloud infrastructure hosting — Postgres database, application servers, observability stack (Grafana/Loki/Tempo/Prometheus), backup storage | All customer data stored in the database: documents, versions, users (email, name), sessions, audit logs, agent state | San Francisco, CA, USA | US (us-west2 Oregon) — EU (eu-west4 Netherlands) planned Q3 2026 | [Railway Privacy Policy](https://railway.app/legal/privacy) / [Railway DPA](https://railway.app/legal/dpa) |
| 2 | **Cloudflare, Inc.** | CDN, DDoS protection, TLS termination, DNS — all traffic to api.llmtxt.my, www.llmtxt.my, docs.llmtxt.my passes through Cloudflare edge | Request headers, IP addresses, user agent strings, request URLs (not request bodies — Cloudflare is a pass-through at the API layer) | San Francisco, CA, USA | Global edge network (145+ countries) — data in-transit only, not stored at edge | [Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/) / [Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/) |
| 3 | **Amazon Web Services (AWS) / Cloudflare R2** | S3-compatible object storage for binary blob attachments (documents larger than inline threshold, exported files) | Binary blob content (user-authored document content when stored externally), blob content hash (SHA-256) | Seattle, WA, USA (AWS) / San Francisco, CA, USA (Cloudflare) | AWS: us-east-1 (default). Cloudflare R2: region configured at deployment. EU-residency tenants will use R2 EU bucket. | [AWS Privacy Notice](https://aws.amazon.com/privacy/) / [AWS DPA](https://aws.amazon.com/agreement/) / [Cloudflare R2 Privacy](https://www.cloudflare.com/privacypolicy/) |
| 4 | **GitHub, Inc. (Microsoft)** | Source code repository, CI/CD pipelines (GitHub Actions), backup failure issue tracking, release automation | Repository metadata, workflow logs (may include error messages referencing user data), contributor email addresses for git commits | San Francisco, CA, USA | US (GitHub data centers) | [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) / [GitHub DPA](https://github.com/customer-terms/github-dpa) |
| 5 | **npm, Inc. (GitHub/Microsoft)** | npm package registry — publishes `llmtxt` npm package | Package metadata, version history, maintainer email | San Francisco, CA, USA | US | [npm Privacy Policy](https://docs.npmjs.com/policies/privacy) |
| 6 | **crates.io (The Rust Foundation)** | Rust crate registry — publishes `llmtxt-core` crate | Crate metadata, version history, owner email | Mountain View, CA, USA | US | [crates.io Privacy Notice](https://foundation.rust-lang.org/policies/privacy-policy/) |

---

## Infrastructure Services (Not Sub-Processors)

The following services are used by LLMtxt but do not process customer personal data:

| Entity | Purpose | Why not a sub-processor |
|---|---|---|
| **Namecheap / DNS registrar** | Domain registration (llmtxt.my) | Processes registrant contact data (LLMtxt operator), not customer data |
| **Pino (open-source library)** | Structured logging library | Not a company; no data leaves the Railway instance |
| **OpenTelemetry SDK** | Trace instrumentation | Traces are sent to self-hosted Tempo on Railway (covered by Railway sub-processor entry) |

---

## Sub-Processor Change Log

| Date | Change | 30-day notice sent? |
|---|---|---|
| 2026-04-18 | Initial register published (6 sub-processors) | N/A — initial publication |

---

## How to Request DPA Execution

Enterprise customers may request a Data Processing Agreement with LLMtxt that:
- Incorporates Standard Contractual Clauses (SCCs) for data transfers from EU to US
- References this sub-processor register
- Specifies notification procedures for sub-processor changes

Contact: compliance@llmtxt.my or see the DPA template at `docs/compliance/dpa-template.md`.

---

*Last updated: 2026-04-18 | Maintainer: Engineering | Next review: 2026-07-18*
