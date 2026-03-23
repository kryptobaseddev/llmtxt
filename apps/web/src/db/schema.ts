// Drizzle ORM database schema for LLMtxt
import { sqliteTable, text, integer, blob, index } from 'drizzle-orm/sqlite-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import type { z } from 'zod';

// Documents table - stores compressed text documents
export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(), // base62 encoded UUID
    slug: text('slug').notNull().unique(), // 8-char short URL
    format: text('format').notNull(), // 'json' | 'text'
    contentHash: text('content_hash').notNull(), // SHA-256 of compressed content
    compressedData: blob('compressed_data').notNull(), // deflate compressed content
    originalSize: integer('original_size').notNull(), // size before compression
    compressedSize: integer('compressed_size').notNull(), // size after compression
    tokenCount: integer('token_count'), // estimated tokens
    createdAt: integer('created_at').notNull(), // unix timestamp
    expiresAt: integer('expires_at'), // unix timestamp, nullable
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: integer('last_accessed_at'), // unix timestamp, nullable
  },
  (table) => ({
    slugIdx: index('documents_slug_idx').on(table.slug),
    createdAtIdx: index('documents_created_at_idx').on(table.createdAt),
    expiresAtIdx: index('documents_expires_at_idx').on(table.expiresAt),
  })
);

// Versions table - tracks document version history
export const versions = sqliteTable(
  'versions',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    compressedData: blob('compressed_data').notNull(),
    contentHash: text('content_hash').notNull(),
    tokenCount: integer('token_count'),
    createdAt: integer('created_at').notNull(), // unix timestamp
    createdBy: text('created_by'), // agent identifier, nullable
    changelog: text('changelog'), // nullable
  },
  (table) => ({
    documentIdIdx: index('versions_document_id_idx').on(table.documentId),
    versionNumberIdx: index('versions_version_number_idx').on(table.documentId, table.versionNumber),
    createdAtIdx: index('versions_created_at_idx').on(table.createdAt),
  })
);

// Export TypeScript types
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Version = typeof versions.$inferSelect;
export type NewVersion = typeof versions.$inferInsert;

// Export Zod schemas for validation
export const insertDocumentSchema = createInsertSchema(documents);
export const selectDocumentSchema = createSelectSchema(documents);
export const insertVersionSchema = createInsertSchema(versions);
export const selectVersionSchema = createSelectSchema(versions);

export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type SelectDocument = z.infer<typeof selectDocumentSchema>;
export type InsertVersion = z.infer<typeof insertVersionSchema>;
export type SelectVersion = z.infer<typeof selectVersionSchema>;
