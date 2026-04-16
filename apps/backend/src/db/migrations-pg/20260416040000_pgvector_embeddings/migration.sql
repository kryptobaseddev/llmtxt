-- T102/T103 migration: pgvector extension + section_embeddings table
-- Generated: 2026-04-16
-- Tasks: T102 (Real Semantic Embeddings), T103 (Stored Embeddings / pgvector NN)

-- ── Enable pgvector extension ─────────────────────────────────────────────
-- NOTE: Requires superuser or pg_extension privileges on Railway.
-- If this fails, enable via Railway dashboard > Postgres > Extensions > vector.
CREATE EXTENSION IF NOT EXISTS vector;

-- ── section_embeddings table ──────────────────────────────────────────────
-- Stores per-section embeddings for nearest-neighbour search.
-- One row per (document_id, section_slug, model) triplet.
-- Invalidated when section content changes (computed_at / content_hash used for staleness).

CREATE TABLE IF NOT EXISTS "section_embeddings" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id"   text NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  -- Normalised section heading slug (e.g. "introduction", "api-reference").
  -- Empty string means the whole document was embedded as one section.
  "section_slug"  text NOT NULL DEFAULT '',
  -- Raw section heading as it appears in the document.
  "section_title" text NOT NULL DEFAULT '',
  -- SHA-256 hex of the section content used to detect staleness.
  "content_hash"  text NOT NULL,
  -- Embedding provider name, e.g. "local-onnx-minilm-l6", "openai-text-embedding-3-small"
  "provider"      text NOT NULL DEFAULT 'local-onnx-minilm-l6',
  -- Model identifier, e.g. "all-MiniLM-L6-v2"
  "model"         text NOT NULL DEFAULT 'all-MiniLM-L6-v2',
  -- 384-dimensional float vector (all-MiniLM-L6-v2 output)
  "embedding"     vector(384),
  -- Unix millisecond timestamp of last computation.
  "computed_at"   bigint NOT NULL
);

-- Uniqueness: one embedding per (document, section, model)
CREATE UNIQUE INDEX IF NOT EXISTS "section_embeddings_doc_section_model_idx"
  ON "section_embeddings" ("document_id", "section_slug", "model");

-- IVFFlat index for approximate nearest-neighbour search.
-- lists=100 is a reasonable default for up to ~100k rows.
-- Rebuild with higher lists as the table grows.
-- Uses cosine distance (<=>); for inner product use vector_ip_ops.
CREATE INDEX IF NOT EXISTS "section_embeddings_ivfflat_idx"
  ON "section_embeddings"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);

-- Supporting index for document-level lookups (e.g. invalidation on write).
CREATE INDEX IF NOT EXISTS "section_embeddings_document_id_idx"
  ON "section_embeddings" ("document_id");
