-- W1 raw-SQL follow-up: constraints that Drizzle cannot express in schema alone.
--
-- 1. Partial unique index on document_events(document_id, idempotency_key)
--    scoped to rows where idempotency_key IS NOT NULL. Prevents duplicate
--    event submission for the same idempotency key per document, while
--    allowing NULL (no idempotency key) without constraint.
--
-- 2. CHECK constraint on agent_pubkeys.pubkey to enforce exactly 32 bytes.
--    Ed25519 public keys are always 32 bytes; this guards against truncation
--    or encoding errors at insert time.

CREATE UNIQUE INDEX document_events_doc_idem_unique
  ON document_events (document_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint
ALTER TABLE agent_pubkeys
  ADD CONSTRAINT agent_pubkeys_pubkey_len_chk
  CHECK (octet_length(pubkey) = 32);
