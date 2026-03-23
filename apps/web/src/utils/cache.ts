// Cache instances for the llmtxt application.
// LRUCache implementation provided by @codluv/llmtxt.
import { LRUCache } from '@codluv/llmtxt';
export type { CacheStats } from '@codluv/llmtxt';
export { LRUCache };

const maxSize = parseInt(process.env.CACHE_MAX_SIZE || '1000', 10);
const ttl = parseInt(process.env.CACHE_TTL || '86400000', 10);

export const contentCache = new LRUCache<string>({ maxSize, ttl });
export const metadataCache = new LRUCache<Record<string, unknown>>({ maxSize, ttl });
