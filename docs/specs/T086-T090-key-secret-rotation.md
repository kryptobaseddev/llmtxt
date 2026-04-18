# T086 + T090: Signing Key Rotation and Secret Rotation

**Status**: Implemented  
**Version**: 1.0.0  
**Date**: 2026-04-18  
**Authors**: CLEO Wave C  
**RFC 2119 Conformance**: This document uses MUST, SHOULD, MAY per RFC 2119.

---

## 1. Overview

This specification covers two coordinated epics:

- **T086** — Per-agent Ed25519 signing key lifecycle: generate, rotate, retire, revoke.
- **T090** — Unified secret rotation with versioned grace windows and a KMS provider abstraction.

These are shipped as one coordinated delivery because key rotation (T086) depends on the secret wrapping (T090 KEK) to store private keys safely.

---

## 2. Key Architecture (T086)

### 2.1 SSoT Layer

| Layer | Responsibility |
|-------|---------------|
| `crates/llmtxt-core` | Ed25519 keygen, sign, verify, key ID computation, AES-256-GCM wrap/unwrap |
| `apps/backend` | Key lifecycle policy (rotate, retire, revoke), DB persistence, REST endpoints |

**The backend MUST NOT implement crypto primitives.** All signing/verification MUST use `crates/llmtxt-core`.

### 2.2 Key Lifecycle

```
                     ┌──────────┐
                     │  active  │────── rotate ──────►  retiring
                     └──────────┘                         │
                                                      grace window
                                                          │
                                              ┌───────────┴────────────┐
                                              ▼                        ▼
                                           retired                  revoked
                                       (grace expired)            (immediate)
```

States:

| Status | Signatures Accepted | New Requests |
|--------|-------------------|--------------|
| `active` | YES | YES |
| `retiring` | YES (within grace window) | NO |
| `retired` | NO | NO |
| `revoked` | NO | NO |

### 2.3 Database Schema

The `agent_keys` table stores versioned keypairs:

```sql
CREATE TABLE agent_keys (
  id               uuid PRIMARY KEY,
  agent_id         text NOT NULL,
  key_version      integer NOT NULL DEFAULT 1,
  key_id           text NOT NULL UNIQUE,         -- SHA-256(pubkey)[0..8] hex
  pubkey           bytea NOT NULL,               -- 32 bytes, Ed25519 compressed
  privkey_wrapped  bytea,                        -- AES-256-GCM(KEK, sk) = 60 bytes
  status           text NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL,
  rotated_at       timestamptz,
  retired_at       timestamptz,
  revoked_at       timestamptz,
  grace_window_secs integer NOT NULL DEFAULT 172800,
  label            text
);
```

The `agent_key_rotation_events` table is an append-only audit trail:

```sql
CREATE TABLE agent_key_rotation_events (
  id           uuid PRIMARY KEY,
  agent_id     text NOT NULL,
  key_id       text NOT NULL,
  key_version  integer NOT NULL,
  event_type   text NOT NULL,   -- generated | rotated | revoked | retired | grace_expired
  actor_id     text,
  ip_address   text,
  details      text,            -- JSON
  created_at   timestamptz NOT NULL
);
```

### 2.4 Key ID Computation

```
key_id = hex(SHA-256(pubkey_bytes)[0..8])   -- 16 hex chars
```

This is computed in `crates/llmtxt-core/src/key_rotation.rs::key_id_from_pubkey()`.

### 2.5 REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/agents/:id/keys` | List all key versions |
| `POST` | `/api/v1/agents/:id/keys/rotate` | Rotate to a new key |
| `POST` | `/api/v1/agents/:id/keys/:keyId/revoke` | Immediately revoke a key |

**Rotate request body** (all fields optional):
```json
{
  "grace_window_secs": 172800,
  "label": "CI Bot v2"
}
```

**Rotate response** (201 Created):
```json
{
  "agent_id": "my-agent",
  "new_key": {
    "key_version": 2,
    "key_id": "a1b2c3d4e5f60708",
    "pubkey_hex": "...",
    "status": "active",
    "created_at": "2026-04-18T19:00:00.000Z",
    "label": "CI Bot v2"
  },
  "retired_key": {
    "key_version": 1,
    "key_id": "...",
    "status": "retiring",
    "grace_window_secs": 172800,
    "grace_ends_at": "2026-04-20T19:00:00.000Z"
  },
  "message": "Key rotated. Previous key (v1) retiring — accepted for 172800s."
}
```

### 2.6 Grace Window Enforcement

Verification MUST check both the current `active` key AND any `retiring` key that is still within its grace window:

```
for each candidate pubkey in [active, retiring-within-window]:
  if ed25519.verify(sig, payload, candidate_pubkey):
    accept → break
reject
```

Grace window check (from `crates/llmtxt-core::is_key_accepted`):

```rust
pub fn is_key_accepted(
    status: &KeyStatus,
    rotated_at_ms: u64,
    grace_window_secs: u64,
    now_ms: u64,
) -> bool {
    match status {
        KeyStatus::Active => true,
        KeyStatus::Retiring => now_ms < rotated_at_ms + grace_window_secs * 1000,
        _ => false,
    }
}
```

### 2.7 Private Key Wrapping

Private keys MUST NOT be stored in plaintext. They MUST be wrapped with AES-256-GCM using the KEK:

```
wrapped = nonce(12) || AES-256-GCM(KEK, sk_bytes, nonce)(32+16)
        = 60 bytes total
```

The KEK is resolved from `SIGNING_KEY_KEK` env var (64-char hex = 32 bytes). In production, the KEK MUST come from a KMS or secrets vault. It MUST NOT be hardcoded.

---

## 3. Secret Rotation (T090)

### 3.1 Boot-time Validation

The server MUST refuse to start in production if:

1. `SIGNING_SECRET` is unset or matches a known insecure default (see `signing-secret-validator.ts`).
2. `SIGNING_KEY_KEK` is unset (the KEK for private key wrapping).

### 3.2 Secret Provider Abstraction

The `SECRETS_PROVIDER` env var selects the backend:

| Value | Provider | Use Case |
|-------|----------|----------|
| `env` (default) | `EnvSecretsProvider` | Dev, test, single-server |
| `vault` | `VaultSecretsProvider` | HashiCorp Vault KV v2 |
| `aws-kms` | `AwsKmsSecretsProvider` | AWS Secrets Manager |

All providers implement:

```typescript
interface SecretsProvider {
  getSecret(name: string): Promise<string>;
  getSecretVersion(name: string, version: number): Promise<string | null>;
}
```

### 3.3 Versioned Secret Naming (env provider)

When using the `env` provider, versioned secrets follow this convention:

```
SIGNING_SECRET       — current version (always set)
SIGNING_SECRET_V1    — version 1 value
SIGNING_SECRET_V2    — version 2 value (set BEFORE rotating)
```

**IMPORTANT**: The new secret value MUST be deployed before triggering a rotation via the API.

### 3.4 Rotation Database State

The `secrets_config` table tracks version metadata (never values):

```sql
CREATE TABLE secrets_config (
  id               uuid PRIMARY KEY,
  secret_name      text UNIQUE NOT NULL,
  current_version  integer NOT NULL DEFAULT 1,
  previous_version integer,
  rotated_at       timestamptz,
  grace_window_secs integer NOT NULL DEFAULT 3600,
  provider         text NOT NULL DEFAULT 'env',
  vault_path       text,
  kms_key_id       text,
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL
);
```

### 3.5 Grace Window for Secrets

After rotation, tokens signed with the previous secret MUST be accepted for `grace_window_secs` (default 3600 = 1 hour).

Use `resolveSigningSecrets()` to get both the current and previous (grace-window) secret values:

```typescript
const { current, previous, graceWindowActive } = await resolveSigningSecrets('SIGNING_SECRET');
// Try current secret first, fall back to previous if graceWindowActive
```

### 3.6 REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/admin/secrets` | List rotation metadata for all secrets |
| `GET` | `/api/v1/admin/secrets/:name/status` | Grace window status for a secret |
| `POST` | `/api/v1/admin/secrets/:name/rotate` | Bump version + start grace window |

---

## 4. Security Properties

### 4.1 Ed25519 Signatures

- Ed25519 signatures are computed using `ed25519-dalek` (Rust) or `@noble/ed25519` (TypeScript).
- Both implementations use constant-time verification.
- Verification MUST fail on any tampered payload (even a single-bit flip).

### 4.2 AES-256-GCM Key Wrapping

- Nonces are generated from `OsRng` — cryptographically random, never reused in practice.
- Authentication tag (16 bytes) ensures decryption fails if ciphertext is tampered.
- Wrong KEK MUST produce decryption failure (authenticated encryption guarantee).

### 4.3 Audit Trail (T164)

- Every key rotation, revocation, and retirement event MUST be recorded in `agent_key_rotation_events`.
- This table is append-only and feeds into the T164 tamper-evident audit log.
- Audit writes are fire-and-forget (non-blocking) but errors are logged.

### 4.4 Non-Negotiables

- Secrets MUST NOT appear in git, logs, or API responses.
- The KEK MUST NOT be hardcoded. It MUST come from env var or KMS.
- Revocation takes effect immediately (no grace window for revoked keys).
- Rotation grace window MUST be tested with time-bounded assertions.

---

## 5. Automatic Rotation (Scheduler)

A background job SHOULD run monthly to trigger key rotation for agents that have not rotated in >30 days. This is not implemented in this delivery but the infrastructure is in place.

The grace-expiry sweep SHOULD run hourly to transition `retiring` → `retired` for keys past their window:

```sql
UPDATE agent_keys
  SET status = 'retired', retired_at = NOW()
  WHERE status = 'retiring'
    AND rotated_at + grace_window_secs * INTERVAL '1 second' < NOW();
```

---

## 6. Migration

Migration: `20260418200000_agent_keys_rotation/migration.sql`

Creates:
- `agent_keys` — versioned keypair table
- `secrets_config` — rotation metadata (seeds `SIGNING_SECRET` row)
- `agent_key_rotation_events` — immutable audit trail

The existing `agent_pubkeys` table is preserved during transition. The signature verification middleware checks both tables.

---

## 7. Testing

### Rust Tests (15 tests in `key_rotation.rs`)

- `test_key_id_from_pubkey_deterministic` — key ID is stable
- `test_key_id_from_pubkey_unique` — different keys → different IDs
- `test_versioned_keypair_version_increment` — 0→1→2→3
- `test_wrap_unwrap_roundtrip` — AES-256-GCM round-trip
- `test_wrap_produces_different_ciphertexts` — random nonce
- `test_unwrap_wrong_kek_fails` — authentication failure
- `test_unwrap_truncated_input_fails` — malformed input
- `test_is_key_accepted_*` — grace window policy (5 tests)
- `test_grace_remaining_ms` — remaining ms computation
- `test_sign_verify_with_wrapped_key` — end-to-end

### TypeScript Tests (23 tests in `key-rotation.test.ts`)

- Grace window enforcement (9 assertions)
- Key version management (2 assertions)
- Signing secret validator (5 assertions)
- KEK validation (3 assertions)
- Secret rotation version semantics (5 assertions)
