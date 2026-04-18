-- T458: blob_attachments table for LocalBackend (SQLite).
--
-- Stores the attachment manifest for binary blobs attached to documents.
-- Bytes are stored on the filesystem at <storagePath>/blobs/<hash>.
-- LWW semantics: only one active record per (doc_slug, blob_name).
-- Soft-delete: deleted_at non-null = detached record.
--
-- Design constraints (ARCH-T428 §5.2):
--   - id: TEXT (nanoid, 21 chars) PRIMARY KEY
--   - hash: SHA-256 hex (64 chars) — content address and storage key
--   - size: INTEGER (original byte count, uncompressed)
--   - uploaded_at: INTEGER (unix ms)
--   - deleted_at: INTEGER (unix ms, null = active)
--
-- The partial unique index (WHERE deleted_at IS NULL) is implemented via
-- application-level checks in BlobFsAdapter, since SQLite does not support
-- partial unique indexes through Drizzle. The blob_attachments_active_name_idx
-- is a non-partial unique index; uniqueness of active records is enforced in
-- the application layer by soft-deleting the old row before inserting the new one.

CREATE TABLE IF NOT EXISTS `blob_attachments` (
  `id` text PRIMARY KEY NOT NULL,
  `doc_slug` text NOT NULL,
  `blob_name` text NOT NULL,
  `hash` text NOT NULL,
  `size` integer NOT NULL,
  `content_type` text NOT NULL,
  `uploaded_by` text NOT NULL,
  `uploaded_at` integer NOT NULL,
  `deleted_at` integer
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `blob_attachments_doc_slug_idx`
  ON `blob_attachments` (`doc_slug`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `blob_attachments_hash_idx`
  ON `blob_attachments` (`hash`);
--> statement-breakpoint

-- Partial unique index: enforces only one ACTIVE (deleted_at IS NULL) attachment
-- per (doc_slug, blob_name). Soft-deleted records are excluded by the WHERE clause.
-- SQLite supports partial indexes natively. Drizzle does not expose this as a
-- typed schema feature, so this index is created via raw SQL migration only.
CREATE UNIQUE INDEX IF NOT EXISTS `blob_attachments_active_name_unique_idx`
  ON `blob_attachments` (`doc_slug`, `blob_name`)
  WHERE `deleted_at` IS NULL;
--> statement-breakpoint

-- Non-unique (doc_slug, blob_name) index for fast application-layer lookups
-- (used when scanning history of a named attachment).
CREATE INDEX IF NOT EXISTS `blob_attachments_active_name_idx`
  ON `blob_attachments` (`doc_slug`, `blob_name`);
