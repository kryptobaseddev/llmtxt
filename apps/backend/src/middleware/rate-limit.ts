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
 * Anonymous-specific limits (T167):
 *   - anonRead: 60 req/min per IP for public document reads
 *   - anonWrite: 10 req/min per IP for mutations
 *   - anonCreate: 1 doc/hour per IP for document creation
 *   - anonSession: 300 req/hour per anon-session fingerprint (dual-axis)
 *
 * The /api/health endpoint is exempt from rate limiting.
 */
import crypto from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

/**
 * Anonymous-specific rate limits (T167).
 * Configurable via environment variables.
 */
export const ANON_RATE_LIMITS = {
	/** Per-IP: read endpoints. Default: 60/min. Env: ANON_READ_LIMIT_PER_MIN */
	read: {
		max: parseInt(process.env.ANON_READ_LIMIT_PER_MIN ?? "60", 10),
		timeWindow: "1 minute",
	},
	/** Per-IP: write/mutate endpoints. Default: 10/min. Env: ANON_WRITE_LIMIT_PER_MIN */
	write: {
		max: parseInt(process.env.ANON_WRITE_LIMIT_PER_MIN ?? "10", 10),
		timeWindow: "1 minute",
	},
	/** Per-IP: document creation (POST /compress). Default: 1/hour. Env: ANON_CREATE_LIMIT_PER_HOUR */
	create: {
		max: parseInt(process.env.ANON_CREATE_LIMIT_PER_HOUR ?? "1", 10),
		timeWindow: "1 hour",
	},
	/** Per-session token: total across all endpoints. Default: 300/hour. Env: ANON_SESSION_LIMIT_PER_HOUR */
	session: {
		max: parseInt(process.env.ANON_SESSION_LIMIT_PER_HOUR ?? "300", 10),
		timeWindow: "1 hour",
	},
};

/** Tier-based rate limit configuration. All windows are 1 minute. */
export const RATE_LIMITS = {
	/** Per-IP limits for unauthenticated requests. */
	ip: {
		global: { max: 100, timeWindow: "1 minute" },
		write: { max: 20, timeWindow: "1 minute" },
		auth: { max: 10, timeWindow: "1 minute" },
	},
	/** Per-user limits for cookie-session authenticated requests. */
	user: {
		global: { max: 300, timeWindow: "1 minute" },
		write: { max: 60, timeWindow: "1 minute" },
		auth: { max: 30, timeWindow: "1 minute" },
	},
	/** Per-API-key limits for Bearer-token authenticated requests. */
	apiKey: {
		global: { max: 600, timeWindow: "1 minute" },
		write: { max: 120, timeWindow: "1 minute" },
		auth: { max: 60, timeWindow: "1 minute" },
	},
} as const;

/**
 * Derive the X-Anonymous-Id for a request (T167).
 *
 * Non-PII, non-persistent: derived from IP + UA + Accept-Language,
 * keyed by a per-epoch salt. Epoch rotates every 12 hours so the
 * value cannot be used as a persistent tracker.
 *
 * Algorithm:
 *   epoch    = floor(unix_ms / 43_200_000)
 *   salt     = HMAC-SHA256(ANON_ID_SALT, String(epoch))
 *   anon_id  = HMAC-SHA256(salt, ip + "|" + ua + "|" + acceptLang)[0..32] (hex)
 */
export function deriveAnonId(request: FastifyRequest): string {
	const salt = process.env.ANON_ID_SALT ?? "llmtxt-anon-id-default-salt";
	const epochMs = 43_200_000; // 12 hours
	const epoch = Math.floor(Date.now() / epochMs);

	const epochSalt = crypto
		.createHmac("sha256", salt)
		.update(String(epoch))
		.digest();

	const ip = request.ip ?? "";
	const ua =
		(Array.isArray(request.headers["user-agent"])
			? request.headers["user-agent"][0]
			: request.headers["user-agent"]) ?? "";
	const lang =
		(Array.isArray(request.headers["accept-language"])
			? request.headers["accept-language"][0]
			: request.headers["accept-language"]) ?? "";

	const input = `${ip}|${ua}|${lang}`;
	return crypto
		.createHmac("sha256", epochSalt)
		.update(input)
		.digest("hex")
		.slice(0, 32);
}

/**
 * Return true if the request is from an anonymous session (T167).
 * Anonymous = no Bearer auth header AND (no user OR user.isAnonymous=true).
 */
export function isAnonymousRequest(request: FastifyRequest): boolean {
	const authHeader = request.headers["authorization"];
	if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
		return false;
	}
	if (request.user?.id && request.user.isAnonymous !== true) {
		return false;
	}
	return true;
}

/**
 * In-memory token bucket for per-anon-session rate limiting (T167).
 * Exported for test access (test can call .clear() between suites).
 * Production deployments with multiple pods should replace with Redis.
 */
export const _anonSessionBuckets = new Map<
	string,
	{ count: number; windowStart: number }
>();
const _ANON_SESSION_WINDOW_MS = 3_600_000; // 1 hour

/**
 * Determine which authentication tier applies to a request.
 *
 * Priority: API key Bearer token > authenticated session > IP fallback.
 * API key auth is detected by the presence of a Bearer Authorization header.
 * Session auth is detected by request.user being populated (set by requireAuth).
 */
function getAuthTier(request: FastifyRequest): "apiKey" | "user" | "ip" {
	const authHeader = request.headers["authorization"];
	if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
		return "apiKey";
	}
	if (request.user?.id) {
		return "user";
	}
	return "ip";
}

/**
 * Generate a stable rate-limit key for the request.
 *
 * Uses the most specific identifier available (priority order):
 *   1. Bearer API key — identifies the key, not the user
 *   2. User ID (from session cookie)
 *   3. Verified agent pubkey ID (x-agent-pubkey-id header, set by T147
 *      verifyAgentSignature middleware) — prevents Railway internal-IP
 *      collisions where multiple agents share a single egress address
 *      (100.64.0.x). Multi-agent features (scratchpad, CRDT, leases, A2A)
 *      must be rate-limited per identity, not per network origin.
 *   4. x-agent-id header — unverified self-reported identity, used as a
 *      best-effort fallback when signature middleware has not run.
 *   5. Client IP address — last resort for fully anonymous requests.
 */
export function keyGenerator(request: FastifyRequest): string {
	const authHeader = request.headers["authorization"];
	if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
		// Use the token value itself as the key identifier.
		// We take the first 64 chars to bound key length without hashing overhead.
		const token = authHeader.slice(7, 71);
		return `apikey:${token}`;
	}
	if (request.user?.id) {
		return `user:${request.user.id}`;
	}
	// Verified agent pubkey ID set by verifyAgentSignature (T147).
	// Cast required because agentPubkeyId is added via module augmentation
	// in verify-agent-signature.ts and may not be visible at this call site.
	const verifiedAgentId = (request as unknown as { agentPubkeyId?: string })
		.agentPubkeyId;
	if (verifiedAgentId) {
		return `agent:${verifiedAgentId}`;
	}
	// Self-reported agent identity header — unverified but sufficient to
	// distinguish agents sharing a Railway private-network IP.
	const agentIdHeader = request.headers["x-agent-id"];
	if (agentIdHeader) {
		const id = Array.isArray(agentIdHeader) ? agentIdHeader[0] : agentIdHeader;
		return `agent:${id.slice(0, 64)}`;
	}
	return `ip:${request.ip}`;
}

/**
 * Return the rate limit max for the given category based on the request's auth tier.
 */
export function getTierMax(
	request: FastifyRequest,
	category: "global" | "write" | "auth",
): number {
	const tier = getAuthTier(request);
	return RATE_LIMITS[tier][category].max;
}

/**
 * Key generator that uses the anonymous-session fingerprint as the rate-limit key.
 * Falls back to keyGenerator for non-anonymous requests (T167).
 */
export function anonSessionKeyGenerator(request: FastifyRequest): string {
	if (!isAnonymousRequest(request)) {
		return keyGenerator(request);
	}
	const anonId = deriveAnonId(request);
	return `anon-session:${anonId}`;
}

/**
 * Route-level config for anonymous write mutations (T167).
 * Per-IP: 10/min. Authenticated users fall through to writeRateLimit tier.
 */
export const anonWriteRateLimit = {
	rateLimit: {
		max: (request: FastifyRequest) => {
			if (isAnonymousRequest(request)) {
				return ANON_RATE_LIMITS.write.max;
			}
			return getTierMax(request, "write");
		},
		timeWindow: "1 minute",
		keyGenerator,
	},
};

/**
 * Route-level config for anonymous document creation (T167).
 * Per-IP: 1 doc/hour. Authenticated users fall through to writeRateLimit tier.
 */
export const anonCreateRateLimit = {
	rateLimit: {
		max: (request: FastifyRequest) => {
			if (isAnonymousRequest(request)) {
				return ANON_RATE_LIMITS.create.max;
			}
			return getTierMax(request, "write");
		},
		timeWindow: "1 hour",
		keyGenerator,
	},
};

/**
 * Route-level config for anonymous read endpoints (T167).
 * Per-IP: 60/min. Authenticated users get the standard global tier.
 */
export const anonReadRateLimit = {
	rateLimit: {
		max: (request: FastifyRequest) => {
			if (isAnonymousRequest(request)) {
				return ANON_RATE_LIMITS.read.max;
			}
			return getTierMax(request, "global");
		},
		timeWindow: "1 minute",
		keyGenerator,
	},
};

/**
 * Route-level config object for write-operation rate limits.
 * Apply to POST/PUT/DELETE route handlers that mutate state.
 *
 * Usage:
 *   fastify.post('/route', { config: writeRateLimit }, handler)
 */
export const writeRateLimit = {
	rateLimit: {
		max: (request: FastifyRequest) => getTierMax(request, "write"),
		timeWindow: "1 minute",
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
		max: (request: FastifyRequest) => getTierMax(request, "auth"),
		timeWindow: "1 minute",
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
		max: (request: FastifyRequest) => getTierMax(request, "global"),
		timeWindow: "1 minute",
		keyGenerator,
		// Exempt health and readiness probe endpoints from rate limiting.
		// /api/ready is included so Railway readiness checks never count toward
		// the per-IP quota (which could trigger 429 during rolling deploys).
		allowList: (request: FastifyRequest, _key: string) => {
			const url = request.url.split("?")[0];
			return (
				url === "/api/health" ||
				url === "/health" ||
				url === "/api/ready" ||
				url === "/ready" ||
				url === "/api/metrics" ||
				url === "/metrics"
			);
		},
		// Standard rate limit headers on every response
		addHeadersOnExceeding: {
			"x-ratelimit-limit": true,
			"x-ratelimit-remaining": true,
			"x-ratelimit-reset": true,
		},
		addHeaders: {
			"x-ratelimit-limit": true,
			"x-ratelimit-remaining": true,
			"x-ratelimit-reset": true,
			"retry-after": true,
		},
		// Consistent 429 error format matching existing error structure
		errorResponseBuilder: (_request: FastifyRequest, context) => ({
			error: "Too Many Requests",
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
export async function adaptiveThrottle(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const remaining = parseInt(
		(reply.getHeader("x-ratelimit-remaining") as string) ?? "100",
		10,
	);
	const limit = parseInt(
		(reply.getHeader("x-ratelimit-limit") as string) ?? "100",
		10,
	);

	if (
		!isNaN(remaining) &&
		!isNaN(limit) &&
		limit > 0 &&
		remaining < limit * 0.2
	) {
		// Calculate delay proportional to how close to the limit we are
		const usedRatio = 1 - remaining / limit;
		const delayMs = Math.floor(usedRatio * 500); // up to 500ms
		if (delayMs > 0) {
			await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
		}
	}
}

/**
 * Anon-session rate limit preHandler (T167).
 *
 * Second enforcement axis: 300 requests per hour per anonymous-session fingerprint
 * (derived via deriveAnonId). This runs after the global IP-based limiter.
 * For authenticated (non-anonymous) requests, this is a no-op.
 *
 * If exceeded, returns 429 SESSION_RATE_LIMIT_EXCEEDED.
 *
 * Note: Uses in-memory Map. For multi-pod deployments, replace with Redis.
 */
export async function anonSessionRateLimitHook(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	if (!isAnonymousRequest(request)) return;

	const key = anonSessionKeyGenerator(request);
	const now = Date.now();
	const sessionLimit = ANON_RATE_LIMITS.session.max;

	let bucket = _anonSessionBuckets.get(key);
	if (!bucket || now - bucket.windowStart >= _ANON_SESSION_WINDOW_MS) {
		bucket = { count: 0, windowStart: now };
	}

	bucket.count += 1;
	_anonSessionBuckets.set(key, bucket);

	const remaining = Math.max(0, sessionLimit - bucket.count);
	const resetAt = bucket.windowStart + _ANON_SESSION_WINDOW_MS;

	reply.header("x-anon-session-limit", String(sessionLimit));
	reply.header("x-anon-session-remaining", String(remaining));
	reply.header("x-anon-session-reset", String(Math.ceil(resetAt / 1000)));

	if (bucket.count > sessionLimit) {
		const retryAfter = Math.ceil((resetAt - now) / 1000);
		reply.status(429).send({
			error: "Too Many Requests",
			code: "SESSION_RATE_LIMIT_EXCEEDED",
			message: `Anonymous session rate limit exceeded. Try again in ${retryAfter} seconds.`,
			retryAfter,
			limit: sessionLimit,
		});
	}
}

/**
 * X-Anonymous-Id response header hook (T167).
 *
 * Adds X-Anonymous-Id header to responses for anonymous requests.
 * NOT an authentication mechanism — only for rate-limit isolation.
 * Non-PII: epoch-salted hash, rotates every 12h.
 */
export async function anonIdResponseHook(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	if (!isAnonymousRequest(request)) return;
	const anonId = deriveAnonId(request);
	reply.header("x-anonymous-id", anonId);
}
