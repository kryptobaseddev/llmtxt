/**
 * Rate limiting middleware for LLMtxt API.
 *
 * Applies tiered limits based on authentication level:
 *   - API key (Bearer): highest limits (agents/programmatic clients)
 *   - Authenticated user (cookie session): mid-tier limits
 *   - Unauthenticated IP: lowest limits
 *
 * Three limit categories:
 *   - global: applies to all routes
 *   - write: stricter limits on mutating endpoints (POST/PUT/DELETE)
 *   - auth: strictest limits on authentication endpoints
 *
 * The /api/health endpoint is exempt from rate limiting.
 */
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

/** Tier-based rate limit configuration. All windows are 1 minute. */
export const RATE_LIMITS = {
  /** Per-IP limits for unauthenticated requests. */
  ip: {
    global: { max: 100, timeWindow: '1 minute' },
    write: { max: 20, timeWindow: '1 minute' },
    auth: { max: 10, timeWindow: '1 minute' },
  },
  /** Per-user limits for cookie-session authenticated requests. */
  user: {
    global: { max: 300, timeWindow: '1 minute' },
    write: { max: 60, timeWindow: '1 minute' },
    auth: { max: 30, timeWindow: '1 minute' },
  },
  /** Per-API-key limits for Bearer-token authenticated requests. */
  apiKey: {
    global: { max: 600, timeWindow: '1 minute' },
    write: { max: 120, timeWindow: '1 minute' },
    auth: { max: 60, timeWindow: '1 minute' },
  },
} as const;

/**
 * Determine which authentication tier applies to a request.
 *
 * Priority: API key Bearer token > authenticated session > IP fallback.
 * API key auth is detected by the presence of a Bearer Authorization header.
 * Session auth is detected by request.user being populated (set by requireAuth).
 */
function getAuthTier(request: FastifyRequest): 'apiKey' | 'user' | 'ip' {
  const authHeader = request.headers['authorization'];
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return 'apiKey';
  }
  if (request.user?.id) {
    return 'user';
  }
  return 'ip';
}

/**
 * Generate a stable rate-limit key for the request.
 *
 * Uses the most specific identifier available:
 *   1. Hashed API key (from Bearer token) — identifies the key, not the user
 *   2. User ID (from session cookie)
 *   3. Client IP address
 */
export function keyGenerator(request: FastifyRequest): string {
  const authHeader = request.headers['authorization'];
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    // Use the token value itself as the key identifier.
    // We take the first 64 chars to bound key length without hashing overhead.
    const token = authHeader.slice(7, 71);
    return `apikey:${token}`;
  }
  if (request.user?.id) {
    return `user:${request.user.id}`;
  }
  return `ip:${request.ip}`;
}

/**
 * Return the rate limit max for the given category based on the request's auth tier.
 */
export function getTierMax(request: FastifyRequest, category: 'global' | 'write' | 'auth'): number {
  const tier = getAuthTier(request);
  return RATE_LIMITS[tier][category].max;
}

/**
 * Route-level config object for write-operation rate limits.
 * Apply to POST/PUT/DELETE route handlers that mutate state.
 *
 * Usage:
 *   fastify.post('/route', { config: writeRateLimit }, handler)
 */
export const writeRateLimit = {
  rateLimit: {
    max: (request: FastifyRequest) => getTierMax(request, 'write'),
    timeWindow: '1 minute',
    keyGenerator,
  },
};

/**
 * Route-level config object for authentication endpoint rate limits.
 * Apply to sign-up, sign-in, and key-creation routes.
 *
 * Usage:
 *   fastify.post('/auth/sign-up/email', { config: authRateLimit }, handler)
 */
export const authRateLimit = {
  rateLimit: {
    max: (request: FastifyRequest) => getTierMax(request, 'auth'),
    timeWindow: '1 minute',
    keyGenerator,
  },
};

/**
 * Register the global rate limiter on the Fastify instance.
 *
 * Must be called AFTER CORS and compression plugins but BEFORE route
 * registration. The global limit applies to all routes; individual
 * routes may override with stricter config via writeRateLimit or authRateLimit.
 *
 * The /api/health endpoint is explicitly skipped via the skip function.
 */
export async function registerRateLimiting(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: true,
    max: (request: FastifyRequest) => getTierMax(request, 'global'),
    timeWindow: '1 minute',
    keyGenerator,
    // Exempt the health check endpoint from rate limiting
    allowList: (request: FastifyRequest, _key: string) => {
      const url = request.url.split('?')[0];
      return url === '/api/health' || url === '/health';
    },
    // Standard rate limit headers on every response
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
    // Consistent 429 error format matching existing error structure
    errorResponseBuilder: (_request: FastifyRequest, context) => ({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${Math.ceil((context.ttl ?? 60000) / 1000)} seconds.`,
      retryAfter: Math.ceil((context.ttl ?? 60000) / 1000),
      limit: context.max,
    }),
  });
}

/**
 * Adaptive throttle hook: adds artificial delay when a client approaches
 * their rate limit ceiling (< 20% remaining). This smooths out burst
 * traffic by slowing requests progressively rather than hard-cutting at
 * the limit. Maximum induced delay is 500ms.
 *
 * Attach as a preHandler hook on routes where burst smoothing is desired.
 */
export async function adaptiveThrottle(request: FastifyRequest, reply: FastifyReply) {
  const remaining = parseInt(reply.getHeader('x-ratelimit-remaining') as string ?? '100', 10);
  const limit = parseInt(reply.getHeader('x-ratelimit-limit') as string ?? '100', 10);

  if (!isNaN(remaining) && !isNaN(limit) && limit > 0 && remaining < limit * 0.2) {
    // Calculate delay proportional to how close to the limit we are
    const usedRatio = 1 - remaining / limit;
    const delayMs = Math.floor(usedRatio * 500); // up to 500ms
    if (delayMs > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, delayMs));
    }
  }
}
