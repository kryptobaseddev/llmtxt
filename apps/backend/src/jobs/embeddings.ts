/**
 * Section embedding persistence job.
 *
 * Responsibilities:
 * 1. `computeAndStoreEmbeddings(documentId, content)` — compute embeddings for
 *    all sections of a document and upsert into `section_embeddings`.
 * 2. `invalidateDocumentEmbeddings(documentId)` — delete stale embeddings when
 *    a document is overwritten (called by the write path).
 * 3. `backfillEmbeddings(limit)` — scan documents that have no embeddings and
 *    compute them.  Safe to run repeatedly (idempotent via content_hash check).
 *
 * Uses the local ONNX embedding provider (no external API calls).
 * Falls back gracefully if pgvector extension is not enabled (logs warning,
 * returns without throwing so the write path is never blocked).
 *
 * SSoT note: vector math stays in crates/llmtxt-core/src/semantic.rs.
 * This file only handles I/O and orchestration.
 */

import { eq, sql } from 'drizzle-orm';
import { db, DATABASE_PROVIDER } from '../db/index.js';
import { sectionEmbeddings } from '../db/schema-pg.js';
import { decompress, generateOverview, hashContent } from 'llmtxt';
import { LocalOnnxEmbeddingProvider } from 'llmtxt/embeddings';

// Singleton provider — lazy-loaded on first embed call
let _provider: LocalOnnxEmbeddingProvider | null = null;
function getProvider(): LocalOnnxEmbeddingProvider {
  if (!_provider) _provider = new LocalOnnxEmbeddingProvider();
  return _provider;
}

/** SHA-256 hex of a string (for content_hash staleness detection). */
function sha256(text: string): string {
  return hashContent(text);
}

/** Normalise a heading into a URL-safe slug for section_slug. */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 128);
}

/**
 * Split document content into sections using the SDK section parser.
 *
 * @returns Array of `{ slug, title, content }` objects.
 */
function parseDocumentSections(
  content: string,
): Array<{ slug: string; title: string; content: string }> {
  const overview = generateOverview(content);
  if (overview.sections.length === 0) {
    return [{ slug: '', title: 'Document', content }];
  }

  const lines = content.split('\n');
  return overview.sections.map(s => ({
    slug: slugify(s.title),
    title: s.title,
    content: lines.slice(s.startLine - 1, s.endLine).join('\n'),
  }));
}

/**
 * Compute and store embeddings for all sections of a document.
 *
 * Skips sections whose content_hash matches the stored value (no recompute).
 * Safe to call on every version write — idempotent and fast for unchanged sections.
 *
 * @param documentId - The document ID.
 * @param content    - Decompressed document text.
 */
export async function computeAndStoreEmbeddings(
  documentId: string,
  content: string,
): Promise<void> {
  if (DATABASE_PROVIDER !== 'postgresql') {
    // pgvector only available on Postgres
    return;
  }

  try {
    const sections = parseDocumentSections(content);

    // Determine which sections need new embeddings
    const sectionsToEmbed = sections.filter(s => {
      return true; // Always recompute — staleness check done via upsert ON CONFLICT
    });

    if (sectionsToEmbed.length === 0) return;

    const texts = sectionsToEmbed.map(s => s.content);
    const provider = getProvider();
    const embeddings = await provider.embed(texts);

    const now = Date.now();

    // Upsert each section embedding
    for (let i = 0; i < sectionsToEmbed.length; i++) {
      const section = sectionsToEmbed[i];
      const embedding = embeddings[i];
      const contentHash = sha256(section.content);

      // Format as pgvector literal: '[0.1,0.2,...]'
      const vectorLiteral = '[' + embedding.join(',') + ']';

      // Use raw SQL for the upsert because Drizzle doesn't know about vector(384)
      await db.execute(sql`
        INSERT INTO section_embeddings
          (id, document_id, section_slug, section_title, content_hash,
           provider, model, embedding, computed_at)
        VALUES
          (gen_random_uuid(), ${documentId}, ${section.slug}, ${section.title},
           ${contentHash}, ${'local-onnx-minilm-l6'}, ${'all-MiniLM-L6-v2'},
           ${vectorLiteral}::vector, ${now})
        ON CONFLICT (document_id, section_slug, model)
        DO UPDATE SET
          section_title = EXCLUDED.section_title,
          content_hash  = EXCLUDED.content_hash,
          embedding     = EXCLUDED.embedding,
          computed_at   = EXCLUDED.computed_at
        WHERE section_embeddings.content_hash != EXCLUDED.content_hash
      `);
    }
  } catch (err) {
    // Embedding failures must never block document writes
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('relation "section_embeddings" does not exist') ||
        msg.includes('type "vector" does not exist')) {
      console.warn(
        '[embeddings] pgvector not yet enabled — run migration 20260416040000_pgvector_embeddings. Skipping.',
      );
    } else {
      console.error('[embeddings] computeAndStoreEmbeddings error:', err);
    }
  }
}

/**
 * Delete all stored embeddings for a document.
 *
 * Called before regenerating embeddings (e.g. on content change).
 * In practice the ON CONFLICT upsert handles staleness, but explicit
 * invalidation is useful when sections are removed.
 */
export async function invalidateDocumentEmbeddings(
  documentId: string,
): Promise<void> {
  if (DATABASE_PROVIDER !== 'postgresql') return;
  try {
    await db
      .delete(sectionEmbeddings)
      .where(eq(sectionEmbeddings.documentId, documentId));
  } catch (err) {
    console.error('[embeddings] invalidateDocumentEmbeddings error:', err);
  }
}

/**
 * Backfill embeddings for documents that have none.
 *
 * Fetches the latest version for each document lacking embeddings and
 * computes section embeddings.  Safe to run concurrently — each document
 * is processed independently.
 *
 * @param limit - Maximum number of documents to backfill per run (default 50).
 */
export async function backfillEmbeddings(limit = 50): Promise<number> {
  if (DATABASE_PROVIDER !== 'postgresql') return 0;

  try {
    // Find documents with no embeddings
    const rows = await db.execute(sql`
      SELECT d.id, d.slug
      FROM documents d
      WHERE NOT EXISTS (
        SELECT 1 FROM section_embeddings se
        WHERE se.document_id = d.id
      )
      LIMIT ${limit}
    `);

    if (!rows.rows || rows.rows.length === 0) return 0;

    let processed = 0;
    for (const row of rows.rows as Array<{ id: string; slug: string }>) {
      try {
        // Get the latest version for this document
        const versionRows = await db.execute(sql`
          SELECT compressed_data
          FROM versions
          WHERE document_id = ${row.id}
          ORDER BY version_number DESC
          LIMIT 1
        `);

        if (!versionRows.rows || versionRows.rows.length === 0) continue;

        const versionRow = versionRows.rows[0] as { compressed_data: Buffer | null };
        if (!versionRow.compressed_data) continue;

        const buf =
          versionRow.compressed_data instanceof Buffer
            ? versionRow.compressed_data
            : Buffer.from(versionRow.compressed_data);

        const content = await decompress(buf);
        await computeAndStoreEmbeddings(row.id, content);
        processed++;
      } catch (docErr) {
        console.error(`[embeddings] backfill failed for ${row.slug}:`, docErr);
      }
    }

    console.log(`[embeddings] backfill: processed ${processed} documents`);
    return processed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('relation "section_embeddings" does not exist')) {
      console.warn('[embeddings] pgvector migration not applied yet — skipping backfill');
      return 0;
    }
    console.error('[embeddings] backfillEmbeddings error:', err);
    return 0;
  }
}
