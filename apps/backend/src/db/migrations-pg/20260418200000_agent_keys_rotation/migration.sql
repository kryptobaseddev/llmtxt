-- T086: Signing Key Rotation — versioned agent_keys table.
-- T090: Secret Rotation — secrets_config table.
--
-- Additive-only migration. Never drops or modifies existing columns.
-- Idempotent: safe to run multiple times (IF NOT EXISTS / IF column NOT EXISTS).
--
-- Design:
--   agent_keys — versioned per-agent ed25519 keypairs with lifecycle status.
--   secrets_config — tracks current/previous secret versions for grace-window rotation.
--   agent_key_rotation_events — tamper-evident audit trail for all key lifecycle events.

--> statement-breakpoint

-- Step 1: agent_keys — versioned keypair table.
-- Replaces the single-key agent_pubkeys table. Both coexist during transition.
-- One row per key version per agent. status drives verification logic.
-- privkey_wrapped is AES-256-GCM(KEK, sk_bytes): 60 bytes (12 nonce + 32 ct + 16 tag).
-- The KEK comes from SIGNING_KEY_KEK env var or KMS — never stored in the DB.
CREATE TABLE IF NOT EXISTS "agent_keys" (
  "id"                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent_id"            text          NOT NULL,
  "key_version"         integer       NOT NULL DEFAULT 1,
  "key_id"              text          NOT NULL,
  "pubkey"              bytea         NOT NULL,
  "privkey_wrapped"     bytea,
  "status"              text          NOT NULL DEFAULT 'active'
                          CHECK ("status" IN ('active','retiring','retired','revoked')),
  "created_at"          timestamptz   NOT NULL DEFAULT NOW(),
  "rotated_at"          timestamptz,
  "retired_at"          timestamptz,
  "revoked_at"          timestamptz,
  "grace_window_secs"   integer       NOT NULL DEFAULT 172800,
  "label"               text
);
--> statement-breakpoint

-- Enforce: one active key per agent at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "agent_keys_agent_active_unique_idx"
  ON "agent_keys" ("agent_id")
  WHERE "status" = 'active';
--> statement-breakpoint

-- Fast lookup: all keys for an agent.
CREATE INDEX IF NOT EXISTS "agent_keys_agent_id_idx"
  ON "agent_keys" ("agent_id");
--> statement-breakpoint

-- Fast lookup: by key_id (used in X-Agent-Key-Version header lookup).
CREATE UNIQUE INDEX IF NOT EXISTS "agent_keys_key_id_idx"
  ON "agent_keys" ("key_id");
--> statement-breakpoint

-- Fast query: retiring keys past their grace window (for background sweep).
CREATE INDEX IF NOT EXISTS "agent_keys_retiring_rotated_at_idx"
  ON "agent_keys" ("rotated_at")
  WHERE "status" = 'retiring';
--> statement-breakpoint

-- Constraint: pubkey must be exactly 32 bytes (Ed25519 compressed point).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'agent_keys'
      AND constraint_name = 'agent_keys_pubkey_32_bytes_chk'
  ) THEN
    ALTER TABLE "agent_keys"
      ADD CONSTRAINT "agent_keys_pubkey_32_bytes_chk"
      CHECK (octet_length("pubkey") = 32);
  END IF;
END $$;
--> statement-breakpoint

-- Step 2: secrets_config — tracks secret rotation state.
-- Stores versioned HMAC/signing secret identifiers (not the secrets themselves).
-- Used to enforce grace-window acceptance of tokens signed with the previous secret.
CREATE TABLE IF NOT EXISTS "secrets_config" (
  "id"                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "secret_name"         text          NOT NULL UNIQUE,
  "current_version"     integer       NOT NULL DEFAULT 1,
  "previous_version"    integer,
  "rotated_at"          timestamptz,
  "grace_window_secs"   integer       NOT NULL DEFAULT 3600,
  "provider"            text          NOT NULL DEFAULT 'env'
                          CHECK ("provider" IN ('env','vault','aws-kms','gcp-kms')),
  "vault_path"          text,
  "kms_key_id"          text,
  "created_at"          timestamptz   NOT NULL DEFAULT NOW(),
  "updated_at"          timestamptz   NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

-- Seed the SIGNING_SECRET row if not already present.
-- The actual secret value is never stored here — only metadata.
INSERT INTO "secrets_config" ("id", "secret_name", "current_version", "provider")
  VALUES (gen_random_uuid(), 'SIGNING_SECRET', 1, 'env')
  ON CONFLICT ("secret_name") DO NOTHING;
--> statement-breakpoint

-- Step 3: agent_key_rotation_events — immutable audit trail.
-- Every key rotation, revocation, or retirement creates a row here.
-- This is the tamper-evident record required by T164.
CREATE TABLE IF NOT EXISTS "agent_key_rotation_events" (
  "id"                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent_id"            text          NOT NULL,
  "key_id"              text          NOT NULL,
  "key_version"         integer       NOT NULL,
  "event_type"          text          NOT NULL
                          CHECK ("event_type" IN ('generated','rotated','revoked','retired','grace_expired')),
  "actor_id"            text,
  "ip_address"          text,
  "details"             text,
  "created_at"          timestamptz   NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_key_rotation_events_agent_id_idx"
  ON "agent_key_rotation_events" ("agent_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_key_rotation_events_created_at_idx"
  ON "agent_key_rotation_events" ("created_at" DESC);
