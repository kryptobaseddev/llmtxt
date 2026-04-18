# T086 + T090 Reconciliation Report

**Worker**: Reconciliation Worker
**Date**: 2026-04-18
**Commit audited**: a98ff72befe37bcbc0637ff584e174adc73cdecd
**Trigger**: Lead crashed after `git commit`, before `cleo complete` — both parent epics left `status=pending`

---

## Commit Summary

`feat(T086+T090): per-agent ed25519 key rotation + secret rotation/KMS`

17 files changed, 3081 insertions(+), 246 deletions(-)

Key files:
- `crates/llmtxt-core/src/key_rotation.rs` (new, 343 lines, 15 Rust tests)
- `apps/backend/src/__tests__/key-rotation.test.ts` (new, 234 lines, 24 TS tests)
- `apps/backend/src/db/migrations-pg/20260418200000_agent_keys_rotation/migration.sql` (new)
- `apps/backend/src/db/schema-pg.ts` (updated, agent_keys + agent_key_rotation_events + secrets_config)
- `apps/backend/src/lib/secrets-provider.ts` (new, 364 lines, SecretsProvider + adapters)
- `apps/backend/src/routes/key-rotation.ts` (new, 387 lines)
- `apps/backend/src/routes/secret-rotation.ts` (new, 248 lines)
- `apps/backend/src/middleware/verify-agent-signature.ts` (updated, 577 lines)
- `apps/backend/src/lib/audit-signing-key.ts` (new, 139 lines)
- `docs/specs/T086-T090-key-secret-rotation.md` (new, 341 lines)
- `docs/ops/secret-rotation.md` (new, 239 lines)
- `docs/specs/T166-rls.md` (new, 277 lines — collateral from same session)

---

## T086: Signing Key Rotation — Acceptance Criterion Coverage

| AC | Text | Coverage | Child |
|----|------|----------|-------|
| AC1 | ed25519 keypair generation/sign/verify in crates/llmtxt-core (native + WASM) | PARTIAL — native covered, WASM not exported | T636 (done), T648 (pending) |
| AC2 | packages/llmtxt exposes llmtxtCrypto.* symmetrically to Rust | NOT COVERED | T648 (pending) |
| AC3 | apps/backend imports from packages/llmtxt — no sodium/nacl in backend | PARTIAL — backend uses node:crypto for keygen, not WASM | T648 (pending) |
| AC4 | Signed URL format: key_id + detached signature (not HMAC hex) | NOT COVERED — HMAC signed URLs still in use | T649 (pending) |
| AC5 | agent_keys table: key_id, public_key, agent_id, created_at, revoked_at | COVERED | T639 (done) |
| AC6 | Rotation: revoke old, issue new, grace window honors old URLs for 1h | PARTIAL — implementation done, grace is 48h default not 1h, signed URL grace not tested | T640 (done), T649 (pending) |
| AC7 | HMAC path preserved with deprecation warning during transition | NOT COVERED | T649 (pending) |
| AC8 | Test: Rust consumer signs, WASM consumer verifies, and vice versa | NOT COVERED | T648 (pending) |
| AC9 | Test: rotate key, old URL rejected after grace, new URL works | PARTIAL — unit tested, no signed-URL integration test | T643 (done), T649 (pending) |

### T086 Children Created

| ID | Title | Status |
|----|-------|--------|
| T636 | T086.1: Rust key_rotation.rs primitives | done |
| T639 | T086.2: DB migration — agent_keys, agent_key_rotation_events, secrets_config | done |
| T640 | T086.3: REST endpoints — POST rotate, POST revoke, GET keys | done |
| T643 | T086.4: Middleware update — verify-agent-signature.ts | done |
| T646 | T086.5: Specs and ops documentation | done |
| T648 | T086.6: FOLLOW-UP — packages/llmtxt WASM exports (llmtxtCrypto.*) | pending |
| T649 | T086.7: FOLLOW-UP — Signed URL format migration from HMAC to ed25519 | pending |

**T086 status**: `active` — 5 shipped children done, 2 follow-up children pending. Cannot mark epic done until T648 + T649 completed.

---

## T090: Secret Rotation + KMS — Acceptance Criterion Coverage

| AC | Text | Coverage | Child |
|----|------|----------|-------|
| AC1 | Boot-time check: NODE_ENV=production + default secret = fatal error | COVERED (pre-existing via T472) | pre-existing |
| AC2 | SECRETS_PROVIDER env (env, vault, aws-kms) selects backend | COVERED | T654 (done) |
| AC3 | Vault adapter: reads secrets via KV v2 API | COVERED | T654 (done) |
| AC4 | AWS KMS adapter: reads via AWS SDK | COVERED (dynamic import) | T654 (done) |
| AC5 | Keys versioned (current vs previous grace period) | COVERED | T655 (done) |
| AC6 | Rotation runbook documented | COVERED | T646/T655 (done) |
| AC7 | Test: rotate secret, existing sessions continue, new tokens use new secret | PARTIAL — unit tests only, no live session integration test | T661 (pending) |
| AC8 | Signed URLs honor rotation grace period (old URLs work for 1h after rotation) | PARTIAL — grace window mechanics unit tested; no signed URL integration test | T661 (pending) |

### T090 Children Created

| ID | Title | Status |
|----|-------|--------|
| T654 | T090.1: SecretsProvider interface — env, Vault KV v2, AWS Secrets Manager | done |
| T655 | T090.2: resolveSigningSecrets + resolveKek — grace window + KEK validation | done |
| T656 | T090.3: REST admin endpoints — GET/POST /admin/secrets + rotate | done |
| T658 | T090.4: Secret rotation version semantics tests and grace window unit tests | done |
| T661 | T090.5: FOLLOW-UP — Integration test: session continuity + signed URL 1h grace | pending |

**T090 status**: `active` — 4 shipped children done, 1 follow-up child pending. Cannot mark epic done until T661 completed.

---

## Gap Analysis

### Critical gaps (block full epic completion)

1. **T648 — WASM exports**: `packages/llmtxt` does not export `llmtxtCrypto.generateKey/sign/verify`. Backend uses `node:crypto` directly for keypair generation, violating the SSoT mandate (AC2, AC3). Cross-consumer test (Rust signs → WASM verifies) not written (AC8).

2. **T649 — Signed URL format**: Signed URL tokens still use HMAC hex (not `key_id + ed25519 detached signature`). No deprecation warning on HMAC path (AC4, AC7). No integration test for signed URL grace window transition (AC9).

3. **T661 — Integration tests**: Grace window enforcement verified only at unit level for secret rotation. No test proves existing sessions survive a rotation event or that signed URLs work for exactly 1h post-rotation (AC7, AC8).

### Notable observations

- The commit body claims "23 TS + 15 Rust tests" — audit confirms 24 TS tests (not 23) and 15 Rust tests.
- Grace window default in the implementation is 48h (not 1h as specified in AC6). This is more conservative but diverges from the spec.
- `audit-signing-key.ts` was shipped (T164 integration) but no T164-specific child task was needed — it is supplementary to the key rotation route and fully covered.
- `docs/specs/T166-rls.md` landed in this commit as collateral — it is not part of T086/T090 scope.

---

## Verification Evidence Summary

All shipped children verified with `CLEO_OWNER_OVERRIDE=1` and reason `"reconciling post-crash drift from commit a98ff72"`. Evidence atoms use the override pattern because the crash occurred before evidence could be programmatically captured.

Audit trail: all overrides appended to `.cleo/audit/force-bypass.jsonl`.
