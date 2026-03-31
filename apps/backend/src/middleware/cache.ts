// Fastify middleware for caching
import type { FastifyRequest, FastifyReply } from 'fastify';
import { contentCache, metadataCache } from '../utils/cache.js';

export { contentCache, metadataCache };

/**
 * Generate cache key for a document
 */
export function getDocumentCacheKey(slug: string, type: 'content' | 'metadata' = 'content'): string {
  return `doc:${type}:${slug}`;
}

/**
 * Check if cache should be skipped based on query params
 */
export function shouldSkipCache(request: FastifyRequest): boolean {
  const query = request.query as Record<string, string | undefined>;
  return query.nocache === '1' || query.nocache === 'true';
}

/**
 * Middleware to cache document content
 * Usage: app.get('/documents/:slug', cacheDocumentContent, async (request, reply) => { ... })
 */
export async function cacheDocumentContent(
  request: FastifyRequest<{ Params: { slug: string }; Querystring: Record<string, string> }>,
  reply: FastifyReply
): Promise<void> {
  const { slug } = request.params;
  
  // Skip cache if requested
  if (shouldSkipCache(request)) {
    reply.header('X-Cache', 'SKIP');
    return;
  }
  
  const cacheKey = getDocumentCacheKey(slug, 'content');
  const cached = contentCache.get(cacheKey);
  
  if (cached) {
    reply.header('X-Cache', 'HIT');
    reply.send(cached);
    return;
  }
  
  reply.header('X-Cache', 'MISS');
}

/**
 * Middleware to cache document metadata
 */
export async function cacheDocumentMetadata(
  request: FastifyRequest<{ Params: { slug: string }; Querystring: Record<string, string> }>,
  reply: FastifyReply
): Promise<void> {
  const { slug } = request.params;
  
  // Skip cache if requested
  if (shouldSkipCache(request)) {
    reply.header('X-Cache', 'SKIP');
    return;
  }
  
  const cacheKey = getDocumentCacheKey(slug, 'metadata');
  const cached = metadataCache.get(cacheKey);
  
  if (cached) {
    reply.header('X-Cache', 'HIT');
    reply.send(cached);
    return;
  }
  
  reply.header('X-Cache', 'MISS');
}

/**
 * Store document content in cache
 */
export function setCachedContent(slug: string, content: string, ttl?: number): void {
  const cacheKey = getDocumentCacheKey(slug, 'content');
  contentCache.set(cacheKey, content, ttl);
}

/**
 * Store document metadata in cache
 */
export function setCachedMetadata(slug: string, metadata: Record<string, unknown>, ttl?: number): void {
  const cacheKey = getDocumentCacheKey(slug, 'metadata');
  metadataCache.set(cacheKey, metadata, ttl);
}

/**
 * Invalidate cache for a document
 */
export function invalidateDocumentCache(slug: string): void {
  contentCache.delete(getDocumentCacheKey(slug, 'content'));
  metadataCache.delete(getDocumentCacheKey(slug, 'metadata'));
}

/**
 * Invalidate all cache
 */
export function invalidateAllCache(): void {
  contentCache.clear();
  metadataCache.clear();
}

/**
 * Get cache stats for both caches
 */
export function getCacheStats(): {
  content: ReturnType<typeof contentCache.getStats>;
  metadata: ReturnType<typeof metadataCache.getStats>;
} {
  return {
    content: contentCache.getStats(),
    metadata: metadataCache.getStats(),
  };
}
