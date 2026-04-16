-- W3 migration: BFT consensus extensions + A2A agent inbox
-- Generated: 2026-04-16
-- Tasks: T251 (approvals BFT fields), T152 (documents bft_f), T154 (agent_inbox_messages)

-- ── T251: Extend approvals table with BFT signature fields ────────────────────

ALTER TABLE "approvals"
  ADD COLUMN IF NOT EXISTS "sig_hex" text,
  ADD COLUMN IF NOT EXISTS "canonical_payload" text,
  ADD COLUMN IF NOT EXISTS "chain_hash" text,
  ADD COLUMN IF NOT EXISTS "prev_chain_hash" text,
  ADD COLUMN IF NOT EXISTS "bft_f" integer NOT NULL DEFAULT 1;

-- ── T152: Add per-document BFT fault tolerance config ────────────────────────

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "bft_f" integer NOT NULL DEFAULT 1;

-- ── T154: Agent inbox messages table ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "agent_inbox_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "to_agent_id" text NOT NULL,
  "from_agent_id" text NOT NULL,
  "envelope_json" jsonb NOT NULL,
  "nonce" text NOT NULL,
  "received_at" bigint NOT NULL,
  "expires_at" bigint NOT NULL,
  "read" boolean NOT NULL DEFAULT false
);

-- Unique nonce constraint for dedup — emulated idempotently via the unique index
-- `agent_inbox_nonce_idx` below (avoids non-idempotent ADD CONSTRAINT UNIQUE).

-- Indexes for agent_inbox_messages
CREATE INDEX IF NOT EXISTS "agent_inbox_to_agent_idx"
  ON "agent_inbox_messages" ("to_agent_id", "received_at");

CREATE INDEX IF NOT EXISTS "agent_inbox_expires_at_idx"
  ON "agent_inbox_messages" ("expires_at");

CREATE UNIQUE INDEX IF NOT EXISTS "agent_inbox_nonce_idx"
  ON "agent_inbox_messages" ("nonce");
