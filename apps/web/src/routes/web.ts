// Simple web routes - slug detection utility
import path from 'path';
import { fileURLToPath } from 'url';
import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { documents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { decompress } from '../utils/compression.js';
import { getDocumentCacheKey, contentCache, setCachedContent, shouldSkipCache } from '../middleware/cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const publicDir = path.join(__dirname, '..', '..', 'public');

const BOT_USER_AGENTS = [
  'ClaudeBot',
  'Claude-Web',
  'GPTBot',
  'ChatGPT-User',
  'Applebot',
  'bingbot',
  'Googlebot',
  'Slurp',
  'DuckDuckBot',
  'Baiduspider',
  'YandexBot',
  'curl',
  'wget',
  'python-requests',
  'node-fetch',
  'axios',
];

export async function getDocumentWithContent(slug: string, request: FastifyRequest) {
  const skipCache = shouldSkipCache(request);
  let content: string | undefined;
  
  if (!skipCache) {
    const cacheKey = getDocumentCacheKey(slug, 'content');
    content = contentCache.get(cacheKey) as string | undefined;
  }
  
  const [doc] = await db.select().from(documents).where(eq(documents.slug, slug));
  
  if (!doc) {
    return null;
  }
  
  // Update access count non-blocking
  db.update(documents)
    .set({
      accessCount: (doc.accessCount || 0) + 1,
      lastAccessedAt: Date.now(),
    })
    .where(eq(documents.id, doc.id))
    .catch(err => request.log.error(err));
    
  if (!content) {
    const compressedBuffer = doc.compressedData instanceof Buffer
      ? doc.compressedData
      : Buffer.from(doc.compressedData as ArrayBuffer);
      
    content = await decompress(compressedBuffer);
    setCachedContent(slug, content);
  }
  
  return { ...doc, content };
}

/**
 * Handle content negotiation for slug requests.
 * Returns true if the request was handled (response sent), false otherwise.
 */
export async function handleContentNegotiation(request: FastifyRequest, reply: FastifyReply, slug: string): Promise<boolean> {
  const accept = request.headers.accept || '';
  const userAgent = request.headers['user-agent'] || '';
  
  const isBot = BOT_USER_AGENTS.some(bot => userAgent.toLowerCase().includes(bot.toLowerCase()));
  
  const wantsJson = accept.includes('application/json');
  const wantsText = accept.includes('text/plain') || accept === '*/*';
  const wantsHtml = accept.includes('text/html');
  
  // If explicitly wants HTML, let the caller redirect to view.html unless it's a known bot
  if (wantsHtml && !isBot && !wantsJson && !wantsText) {
    return false;
  }
  
  // If not a bot and doesn't explicitly want json/text, let caller redirect
  if (!isBot && !wantsJson && !wantsText) {
    return false;
  }
  
  // They either want JSON, want TEXT, or are a bot. We need to fetch the document.
  const doc = await getDocumentWithContent(slug, request);
  
  if (!doc) {
    reply.status(404).send({ error: 'Document not found' });
    return true; // Handled
  }
  
  // Send response based on Accept header
  if (wantsJson) {
    reply.type('application/json').send({
      id: doc.id,
      slug: doc.slug,
      format: doc.format,
      content: doc.content,
      tokenCount: doc.tokenCount,
      originalSize: doc.originalSize,
      compressedSize: doc.compressedSize,
      createdAt: doc.createdAt,
      accessCount: (doc.accessCount || 0) + 1,
    });
    return true;
  }
  
  // Default for bots and wantsText: raw text/plain
  reply.type('text/plain').send(doc.content);
  return true;
}

/**
 * Check if a URL path looks like a document slug with an explicit extension.
 * Supported extensions: .txt, .json, .md
 */
export function extractSlugWithExtension(urlPath: string): { slug: string; ext: string } | null {
  const pathOnly = urlPath.split('?')[0].replace(/^\//, '').replace(/\/$/, '');

  if (pathOnly.includes('/')) {
    return null;
  }

  const match = pathOnly.match(/^([a-zA-Z0-9]+)\.(txt|json|md)$/);
  if (!match) {
    return null;
  }

  const slug = match[1];
  const ext = match[2];

  if (slug.startsWith('api') || slug.length > 20) {
    return null;
  }

  return { slug, ext };
}

/**
 * Check if a URL path looks like a document slug.
 * Slugs are short alphanumeric strings at the root level.
 * Returns the slug if valid, null otherwise.
 */
export function extractSlug(urlPath: string): string | null {
  // Remove leading slash and query string
  const pathOnly = urlPath.split('?')[0].replace(/^\//, '').replace(/\/$/, '');

  // Must be a single root-level segment (no nested paths)
  if (pathOnly.includes('/')) {
    return null;
  }

  const segment = pathOnly;

  // Not a slug if:
  // - empty
  // - contains a dot (file extension, e.g., index.html, llms.txt)
  // - starts with "api"
  // - is too long (slugs are short IDs)
  if (
    !segment ||
    segment.includes('.') ||
    segment.startsWith('api') ||
    segment.length > 20
  ) {
    return null;
  }

  // Must be alphanumeric (base62-like)
  if (!/^[a-zA-Z0-9]+$/.test(segment)) {
    return null;
  }

  return segment;
}
