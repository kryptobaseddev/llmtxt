-- T226: Add event_seq_counter column to documents for atomic per-document
-- sequence assignment in the document event log.
--
-- Uses UPDATE ... RETURNING to atomically increment and return the next
-- sequence number without a separate SELECT on document_events.

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "event_seq_counter" bigint NOT NULL DEFAULT 0;
