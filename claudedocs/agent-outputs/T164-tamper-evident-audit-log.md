# T164 — Tamper-Evident Audit Log: Lead Output

**Status**: complete  
**Epic**: T164  
**Commit**: 10a13ebbbd3d479804c49159ba94ab3a9bb43709  
**Date**: 2026-04-18  

---

## Deliverables

### Rust Core (crates/llmtxt-core)

- `/mnt/projects/llmtxt/crates/llmtxt-core/src/merkle.rs` — new file, 413 lines
  - `merkle_root(leaves: &[[u8;32]]) -> [u8;32]`
  - `verify_merkle_proof(root, leaf, proof) -> bool`
  - WASM exports: `merkle_root_wasm`, `verify_merkle_proof_wasm`
  - 14 unit tests all pass
- `Cargo.toml` — added `subtle = "2"` dep (fixes pre-existing build error in crypto.rs)
- `src/lib.rs` — module wired, public exports added

### Backend (apps/backend)

- `src/db/migrations-pg/20260418000000_audit_hash_chain/migration.sql` — additive migration:
  - Adds `payload_hash text`, `chain_hash text`, `event_type text`, `actor_id text` to `audit_logs`
  - Creates `audit_checkpoints` table with unique-per-day constraint
- `src/db/schema-pg.ts` — extended `auditLogs` schema + new `auditCheckpoints` table + Zod schemas
- `src/middleware/audit.ts` — full rewrite with hash chain append logic:
  - `canonicalEventStr(id|event_type|actor_id|resource_id|timestamp_ms)`
  - `appendAuditRow` serialized via module-level `chainMutex` promise chain
  - Genesis sentinel: `'0'.repeat(64)`
  - Import corrected from `schema.js` → `schema-pg.js`
- `src/lib/rfc3161.ts` — RFC 3161 DER client:
  - Manual DER encoding of TimeStampReq (no heavy ASN.1 deps)
  - Target: freetsa.org (free, no account, WebTrust-audited)
  - Failure is non-fatal: TSA unavailable → tsr_token = null, WARN log
- `src/jobs/audit-checkpoint.ts` — daily Merkle checkpoint job:
  - Runs at startup + every 24h
  - Idempotent (skip if checkpointDate already exists)
  - TypeScript `computeMerkleRoot` byte-identical to Rust implementation
- `src/routes/audit-verify.ts` — `GET /api/v1/audit/verify`:
  - Re-derives every chain_hash from scratch
  - Returns `{valid, chainLength, lastCheckpointAt, tsrAnchored}`
  - `{valid: false, firstInvalidAt}` on tamper
- `src/routes/v1/index.ts` — registered `auditVerifyRoutes`
- `src/index.ts` — imports and starts `startAuditCheckpointJob()`

### Tests

- `src/__tests__/audit-chain.test.ts` — 17 tests:
  - Merkle root (8 cases) byte-identical to Rust
  - Hash chain helpers (6 cases) including tamper detection at row 5 of 10
  - RFC 3161 DER builder (3 cases)
  - All 17 pass with node:test
- `scripts/ci-audit-chain-verify.ts` — CI seed+verify script:
  - Seeds 10 events with correct chain hashes
  - Verifies all rows pass
  - Exits non-zero if any row fails

### CI

- `.github/workflows/audit-chain-verify.yml` — runs on push/PR to main

### Docs

- `docs/specs/T164-tamper-evident-audit-log.md` — RFC 2119 spec covering:
  - Chain format, Merkle tree structure, timestamp provider choice
  - API contract (verify endpoint), Rust API, WASM bindings

---

## Acceptance Criteria Checklist

| AC | Status |
|----|--------|
| 1. Every security event → audit_log with payload_hash + chain_hash | Done — middleware.audit.ts |
| 2. Daily Merkle root → RFC 3161 → audit_checkpoints | Done — jobs/audit-checkpoint.ts + lib/rfc3161.ts |
| 3. GET /audit/verify → {valid: true, chainLength, lastCheckpointAt} | Done — routes/audit-verify.ts |
| 4. Tampered row → {valid: false, firstInvalidAt} | Done — verify route + test vector at row 5 of 10 |
| 5. merkle_root + verify_merkle_proof byte-identity tests native | Done — 14 cargo tests pass |
| 6. CI job verifies freshly seeded DB | Done — ci-audit-chain-verify.ts + GitHub workflow |

---

## Notes / Partial Items

- RFC 3161 external anchoring: freetsa.org — works in production; test CI skips actual TSA call (failure is non-fatal by design, tsr_token stays null)
- WASM byte-identity: verified via TypeScript cross-check test; wasm-pack build needed for full WASM binary validation (depends on CI toolchain)
- T164 child tasks: T477-T486, all 10 completed
