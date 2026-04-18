# LLMtxt Monetization Investigation

**Status**: Approved  
**Date**: 2026-04-18  
**Author**: CLEO Wave E — T009

---

## Executive Summary

LLMtxt is an AI-native document platform used by agents and human developers to
store, compress, version, and collaborate on text documents. The platform has
strong SSoT Rust primitives, real-time CRDT collaboration, BFT consensus, and a
growing multi-agent story.

This investigation recommends a **freemium metered model** with three tiers:
Free, Pro ($19/month), and Enterprise ($199/month). The primary monetization
surface is document volume, API call volume, and agent seat count — all of which
align with value delivered.

Target: $30K MRR by Month 6 post-launch.

---

## 1. Revenue Model Evaluation

### 1.1 Per-Document Model

Charge per document created or stored.

| Criterion | Score |
|-----------|-------|
| Aligns with value | High — users pay when they create value |
| Predictability | Low — burst creation patterns |
| Developer friction | Medium — creators must budget per write |
| Implementation complexity | Low |

**Verdict**: Good supplement, not primary axis.

### 1.2 Per-Agent / Per-Seat Model

Charge per registered agent or human user seat.

| Criterion | Score |
|-----------|-------|
| Aligns with value | Medium — agents vary wildly in activity |
| Predictability | High — fixed monthly commitment |
| Developer friction | Low — predictable billing |
| Implementation complexity | Low |

**Verdict**: Good secondary axis for Enterprise. Too coarse for Free/Pro.

### 1.3 Metered API Call Model

Charge per API call (compress, read, write, CRDT op, etc.).

| Criterion | Score |
|-----------|-------|
| Aligns with value | Very High — pay exactly for what you use |
| Predictability | Low — developer burden to estimate |
| Developer friction | High — every call has a cost |
| Implementation complexity | High — requires real-time metering |

**Verdict**: Best for Enterprise overages; bad as primary for Free/Pro.

### 1.4 Tiered Quota (Freemium Metered) — Recommended

Bundle generous quotas per tier. Overage is blocked (not billed) until upgrade.
This maximises conversion pressure while minimising billing complexity.

| Criterion | Score |
|-----------|-------|
| Aligns with value | High |
| Predictability | High — fixed monthly billing |
| Developer friction | Low — clear limits, easy to understand |
| Implementation complexity | Medium — quota tracking + rollups |

**Verdict**: Recommended primary model.

---

## 2. Competitive Landscape

| Platform | Model | Price | Notes |
|----------|-------|-------|-------|
| Notion | Seat-based | $8-$15/user/mo | Offline docs, no agent API |
| Confluence | Seat-based | $5-$10/user/mo | Enterprise focus |
| Linear | Seat-based | $8-$14/user/mo | Issue tracker, not docs |
| Roam Research | Flat | $15/mo | Bidirectional linking |
| Obsidian Publish | Flat | $8-$16/mo | No API / agent features |
| Mem.ai | Seat-based | $14.99/mo | AI-native notes, similar target |
| Notion AI | Add-on | $10/user/mo | AI features on top of seats |
| Langchain Hub | Usage-based | Variable | Prompt management |
| LlamaIndex Cloud | Usage-based | Variable | RAG pipelines, not general docs |

**Key insight**: No direct competitor in "agent-native compressed document
platform with CRDT + BFT consensus." LLMtxt occupies a novel position.
Pricing against Notion/Mem at $15-20/month is defensible for Pro.

---

## 3. Recommended Pricing Tiers

### Free Tier

Target: Individual developers, hobbyists, evaluation.

| Limit | Value |
|-------|-------|
| Documents | 50 total |
| Document size | 500 KB each |
| API calls | 1,000/month |
| CRDT operations | 500/month |
| Agent seats | 3 |
| Storage | 25 MB |
| Retention | 90 days for versions |

### Pro Tier — $19/month

Target: Individual power users, small teams, active agent deployments.

| Limit | Value |
|-------|-------|
| Documents | 500 total |
| Document size | 10 MB each |
| API calls | 50,000/month |
| CRDT operations | 25,000/month |
| Agent seats | 25 |
| Storage | 5 GB |
| Retention | Unlimited versions |
| Features | Priority support, admin panel access |

### Enterprise Tier — $199/month

Target: Companies with multiple agent pipelines, compliance needs.

| Limit | Value |
|-------|-------|
| Documents | Unlimited |
| Document size | 100 MB each |
| API calls | 500,000/month |
| CRDT operations | 250,000/month |
| Agent seats | Unlimited |
| Storage | 100 GB |
| Retention | Unlimited + audit export |
| Features | SSO, SLA, dedicated support, custom limits |

---

## 4. Unit Economics

### Cost Structure (estimated, per month)

| Cost Item | Monthly ($) |
|-----------|-------------|
| Railway (API + PG + Redis) | $100 |
| Railway (obs: Grafana/Loki/Tempo) | $50 |
| S3/R2 blob storage (per GB) | $0.015/GB |
| Stripe fees | 2.9% + $0.30 |

### Gross Margin Estimate

At $19/month Pro with ~$2 COGS per user:
- Gross margin: **($19 - $2) / $19 = 89%**

At $199/month Enterprise with ~$20 COGS:
- Gross margin: **($199 - $20) / $199 = 90%**

### MRR Projections

| Month | Free MAU | Pro | Enterprise | MRR |
|-------|----------|-----|------------|-----|
| 1 | 500 | 20 | 2 | $778 |
| 2 | 1,200 | 60 | 5 | $2,135 |
| 3 | 2,500 | 150 | 10 | $4,840 |
| 6 | 8,000 | 600 | 50 | $21,350 |
| 9 | 15,000 | 1,200 | 100 | $42,600 |

Target of **$30K MRR by Month 6** is achievable with aggressive developer
outreach and an excellent free tier that converts naturally.

---

## 5. Implementation Roadmap

### Phase 1 — Usage Tracking & Tier Management (T010)

- `usage_events` table: per-event tracking
- `tiers` config (in-code, not DB)
- `subscriptions` table: user → tier mapping
- Middleware enforcing limits with HTTP 402
- GET `/api/me/usage` endpoint
- Daily `usage_rollups` background job

### Phase 2 — Stripe Pro Tier Launch (T011)

- Stripe Subscriptions integration
- Checkout session creation
- Webhook handler (`customer.subscription.*`)
- Grace period for failed payments
- Pro tier landing page at www.llmtxt.my/pricing
- Admin subscription panel

### Phase 3 — Enterprise & Custom (Future)

- Custom limit negotiation
- Invoice billing
- SSO (SAML/SCIM)
- Dedicated tenant option

---

## 6. Technical Contract

### Tier Limit Evaluator (SSoT: `crates/llmtxt-core`)

```
evaluate_tier_limits(usage: UsageSnapshot, tier: TierKind) -> TierDecision
```

Returns `Allowed | Blocked { limit_type, current, limit }`.

Deterministic: same inputs always produce same output. No I/O.

### Usage Event Schema (SSoT: `crates/llmtxt-core`)

```json
{
  "agent_id": "string",
  "user_id": "string",
  "event_type": "doc_read | doc_write | api_call | crdt_op | blob_upload",
  "resource_id": "string",
  "bytes": 0,
  "timestamp": "ISO 8601"
}
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/me/usage` | Current period usage + tier |
| GET | `/api/me/subscription` | Subscription status |
| POST | `/api/billing/checkout` | Create Stripe checkout session |
| POST | `/api/billing/portal` | Create Stripe billing portal session |
| POST | `/api/billing/webhook` | Stripe webhook handler |
| GET | `/api/v1/admin/subscriptions` | Admin: all subscriptions |

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Free tier abuse (bots) | Medium | Medium | Rate limits + usage events |
| Stripe webhook replay | Low | High | Idempotent dedup on event ID |
| Price bypass via usage spoofing | Low | High | Server-side enforcement only |
| Churn on Pro due to limit friction | Medium | Medium | Generous Pro limits; clear upgrade messaging |
| Enterprise deal cycle too long | Low | Low | Self-serve checkout available at all times |

---

## 8. Recommendation

Proceed with **freemium metered model** at Free / Pro ($19) / Enterprise ($199).

Implement in two phases:
1. Usage tracking + tier enforcement first (no billing, just blocking)
2. Stripe checkout second (convert blockers to payers)

This order lets us validate limit thresholds with real usage before requiring
payment, reducing churn risk from miscalibrated limits.
