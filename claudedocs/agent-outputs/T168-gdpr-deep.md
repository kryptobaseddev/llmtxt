# T168 — GDPR Deep: PII Inventory + RetentionPolicy DSL + Deep Erase + SAR

**Status**: complete
**Date**: 2026-04-18
**Commits**: 8f5a4db (Rust DSL + pre-existing compliance schema), 5676c99 (backend + docs)

---

## Children Completed

| Task | Title | Status |
|------|-------|--------|
| T613 | T168.1: PII inventory doc | done |
| T614 | T168.2: RetentionPolicy DSL in crates/llmtxt-core | done |
| T617 | T168.3: Background retention job apps/backend/src/jobs/retention.ts | done |
| T618 | T168.4: Deep erasure endpoint DELETE /api/v1/users/me/erase | done |
| T619 | T168.5: Subject Access Request GET /api/v1/users/me/sar | done |
| T620 | T168.6: Retention event audit — evictions logged to T164 chain | done |
| T624 | T168.7: GDPR erasure deep docs — docs/compliance/gdpr-erasure.md | done |

---

## Files Produced

### Rust (crates/llmtxt-core/src/retention.rs)
- `RetentionPolicy` struct: tier, max_age_days, lawful_basis, action, archive_then_delete_after_days
- `RetentionRow`, `EvictionSet`, `RetentionAction`, `RetentionTier`, `LawfulBasis` types
- `apply_retention(rows, policy, now_ms) -> EvictionSet`
- `canonical_policies() -> Vec<RetentionPolicy>` — 9 authoritative policies
- `retention_apply_wasm(rows_json, policy_json, now_ms) -> String` — WASM export
- 8 unit tests (all green)

### Backend (apps/backend/src/jobs/retention.ts)
- Nightly PII retention job: 6 eviction phases
- Sessions (30d), revoked API keys (365d), webhook deliveries (30d),
  agent nonces (1d), agent inbox (7d post-expiry), section embeddings (90d)
- Each phase logs `retention.eviction` audit entry (no PII in details)

### Backend (apps/backend/src/routes/user-data.ts) — additions
- `DELETE /api/v1/users/me/erase`: immediate cascade
  - Soft-delete owned documents
  - Pseudonymize audit log actor_id (T164 chain preserved — never hard-delete rows)
  - Revoke + hard-delete webhook deliveries for user's webhooks
  - Nullify API key hashes (sentinel SHA-256)
  - Initiate user soft-delete
  - Emit `retention.erasure` audit event
  - Returns 202 with erasure_id
- `GET /api/v1/users/me/sar`: Subject Access Request
  - Machine-readable PII bundle: profile, documents, api_keys, audit_log, webhooks
  - `data_categories[]` array with lawful_basis + retention_period per category
  - Returns 200 within 30s; emits `user.sar` audit event

### Docs
- `docs/compliance/pii-inventory.md` — 13 tables inventoried with tier/lawful_basis/retention/action
- `docs/compliance/gdpr-erasure.md` — cascade flow, SAR spec, retention DSL, WASM binding, audit chain

---

## Test Results

- Backend: 618/618 tests pass (pnpm-test)
- Rust: 8/8 retention::tests pass (cargo test)
- TypeScript: 0 errors (tsc --noEmit)
- ESLint: 0 warnings

---

## Non-Negotiables Honored

- Audit log rows NEVER hard-deleted — actor_id pseudonymized only (T164 chain preserved)
- cargo fmt clean + ferrous-forge validate run before Rust commit
- WASM binding byte-identical to native Rust (same serde JSON path)
- No raw PII in audit eviction details — only table/policy/count/cutoff/action
