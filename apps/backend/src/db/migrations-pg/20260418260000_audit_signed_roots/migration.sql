-- T107: Add server ed25519 signature columns to audit_checkpoints.
--
-- Additive-only migration. Never drops or modifies existing columns.
-- Idempotent: safe to run multiple times (IF column NOT EXISTS).
--
-- When AUDIT_SIGNING_KEY is configured, the daily checkpoint job signs each
-- Merkle root and stores the ed25519 signature and key fingerprint here.
-- Null when the signing key is not configured (e.g., legacy rows or dev environments
-- without AUDIT_SIGNING_KEY set).

-- Step 1: Add ed25519 signature of the Merkle root.
-- Format: 128-char lowercase hex (64-byte raw ed25519 signature).
-- Canonical message: "{merkle_root}|{checkpoint_date}" (ASCII, pipe-separated).
ALTER TABLE "audit_checkpoints"
  ADD COLUMN IF NOT EXISTS "signed_root_sig" text;
--> statement-breakpoint

-- Step 2: Add signing key fingerprint.
-- Format: 16-char lowercase hex (first 16 chars of SHA-256(pubkey_hex)).
-- Allows verifiers to identify the key without exposing the full pubkey.
ALTER TABLE "audit_checkpoints"
  ADD COLUMN IF NOT EXISTS "signing_key_id" text;
