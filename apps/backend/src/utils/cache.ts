/**
 * Cache instances for the llmtxt application.
 * LRUCache implementation provided by the llmtxt SDK.
 */
import { LRUCache } from 'llmtxt';
export type { CacheStats } from 'llmtxt';
export { LRUCache };

const maxSize = parseInt(process.env.CACHE_MAX_SIZE || '1000', 10);
const ttl = parseInt(process.env.CACHE_TTL || '86400000', 10);

/** LRU cache for decompressed document content strings, keyed by slug. */
export const contentCache = new LRUCache<string>({ maxSize, ttl });
/** LRU cache for document metadata objects, keyed by slug. */
export const metadataCache = new LRUCache<Record<string, unknown>>({ maxSize, ttl });
