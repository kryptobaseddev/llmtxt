/**
 * Storage content reference types.
 *
 * Abstracts where document content lives -- inline in a database column
 * or in an external object store (S3-compatible). Platform implementations
 * provide the actual storage backend; llmtxt defines the portable types.
 */

// ── Content Reference ──────────────────────────────────────────

/** How document content is stored. */
export type StorageType = 'inline' | 'object-store';

/** Compression method used for stored content. */
export type CompressionMethod = 'deflate' | 'none';

/**
 * Reference to where a document's compressed content lives.
 *
 * Inline: content is stored directly in the database (small documents).
 * Object-store: content is stored in S3-compatible storage, referenced by key.
 */
export interface ContentRef {
  /** Storage backend type. */
  type: StorageType;
  /**
   * Location of the content.
   * - For `inline`: not used (content is in the database row).
   * - For `object-store`: the object key (e.g. `attachments/xK9mP2nQ/v3.zlib`).
   */
  storageKey?: string;
  /** SHA-256 hash of the uncompressed content for integrity verification. */
  contentHash: string;
  /** Size of the uncompressed content in bytes. */
  originalSize: number;
  /** Size of the compressed content in bytes. */
  compressedSize: number;
  /** Compression method used. */
  compression: CompressionMethod;
}

// ── Storage Metadata ───────────────────────────────────────────

/** Metadata about a stored document blob. */
export interface StorageMetadata {
  /** Content reference. */
  ref: ContentRef;
  /** When the content was first stored (ms since epoch). */
  createdAt: number;
  /** When the content was last accessed (ms since epoch). */
  lastAccessedAt: number;
  /** Number of times the content has been accessed. */
  accessCount: number;
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Create a content reference for inline storage.
 *
 * @param contentHash - SHA-256 hash of the uncompressed content.
 * @param originalSize - Size of the uncompressed content in bytes.
 * @param compressedSize - Size of the compressed content in bytes.
 * @returns An inline content reference.
 */
export function inlineRef(
  contentHash: string,
  originalSize: number,
  compressedSize: number,
): ContentRef {
  return {
    type: 'inline',
    contentHash,
    originalSize,
    compressedSize,
    compression: 'deflate',
  };
}

/**
 * Create a content reference for object-store storage.
 *
 * @param storageKey - The object key in the store.
 * @param contentHash - SHA-256 hash of the uncompressed content.
 * @param originalSize - Size of the uncompressed content in bytes.
 * @param compressedSize - Size of the compressed content in bytes.
 * @returns An object-store content reference.
 */
export function objectStoreRef(
  storageKey: string,
  contentHash: string,
  originalSize: number,
  compressedSize: number,
): ContentRef {
  return {
    type: 'object-store',
    storageKey,
    contentHash,
    originalSize,
    compressedSize,
    compression: 'deflate',
  };
}

/**
 * Generate a storage key for a document version.
 *
 * Convention: `attachments/{slug}/v{version}.zlib`
 *
 * @param slug - Document slug.
 * @param version - Version number.
 * @returns The object storage key.
 */
export function versionStorageKey(slug: string, version: number): string {
  return `attachments/${slug}/v${version}.zlib`;
}

/**
 * Determine whether content should be stored in object-store vs inline.
 *
 * Threshold: content larger than 64KB compressed goes to object-store.
 *
 * @param compressedSize - Size of the compressed content in bytes.
 * @param threshold - Size threshold in bytes. Defaults to 65536 (64KB).
 * @returns `true` if the content should use object-store.
 */
export function shouldUseObjectStore(compressedSize: number, threshold = 65536): boolean {
  return compressedSize > threshold;
}
