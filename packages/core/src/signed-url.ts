/**
 * Signed URL generation and verification for conversation-scoped,
 * time-limited access to llmtxt content.
 *
 * Uses HMAC-SHA256 with a shared secret. URLs are compact (16-char hex signatures).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

// ── Types ───────────────────────────────────────────────────────

export interface SignedUrlParams {
  /** Document slug. */
  slug: string;
  /** Requesting agent ID. */
  agentId: string;
  /** Conversation this access is scoped to. */
  conversationId: string;
  /** Expiration as unix timestamp (milliseconds). */
  expiresAt: number;
}

export interface SignedUrlConfig {
  /** Shared HMAC secret between services. */
  secret: string;
  /** Base URL for document access (e.g. "https://llmtxt.my"). */
  baseUrl: string;
}

export interface VerifyResult {
  valid: boolean;
  reason?: 'missing_params' | 'expired' | 'invalid_signature';
  params?: SignedUrlParams;
}

// ── Signature ───────────────────────────────────────────────────

/**
 * Compute the HMAC-SHA256 signature for a set of parameters.
 * Returns the first 16 hex characters for URL compactness.
 */
export function computeSignature(params: SignedUrlParams, secret: string): string {
  const payload = `${params.slug}:${params.agentId}:${params.conversationId}:${params.expiresAt}`;
  return createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
    .substring(0, 16);
}

// ── Generate ────────────────────────────────────────────────────

/**
 * Generate a signed URL for accessing a document.
 *
 * @example
 * ```ts
 * const url = generateSignedUrl(
 *   { slug: 'xK9mP2nQ', agentId: 'my-agent', conversationId: 'conv_123', expiresAt: Date.now() + 3600000 },
 *   { secret: 'shared-secret', baseUrl: 'https://llmtxt.my' },
 * );
 * // => "https://llmtxt.my/xK9mP2nQ?agent=my-agent&conv=conv_123&exp=1711234567890&sig=a1b2c3d4e5f6a7b8"
 * ```
 */
export function generateSignedUrl(params: SignedUrlParams, config: SignedUrlConfig): string {
  const signature = computeSignature(params, config.secret);
  const url = new URL(`/${params.slug}`, config.baseUrl);
  url.searchParams.set('agent', params.agentId);
  url.searchParams.set('conv', params.conversationId);
  url.searchParams.set('exp', String(params.expiresAt));
  url.searchParams.set('sig', signature);
  return url.toString();
}

// ── Verify ──────────────────────────────────────────────────────

/**
 * Verify a signed URL's signature and expiration.
 *
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifySignedUrl(url: string | URL, secret: string): VerifyResult {
  const parsed = typeof url === 'string' ? new URL(url) : url;

  const slug = parsed.pathname.replace(/^\//, '');
  const agent = parsed.searchParams.get('agent');
  const conv = parsed.searchParams.get('conv');
  const exp = parsed.searchParams.get('exp');
  const sig = parsed.searchParams.get('sig');

  if (!slug || !agent || !conv || !exp || !sig) {
    return { valid: false, reason: 'missing_params' };
  }

  const expiresAt = parseInt(exp, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) {
    return { valid: false, reason: 'expired' };
  }

  const params: SignedUrlParams = { slug, agentId: agent, conversationId: conv, expiresAt };
  const expected = computeSignature(params, secret);

  // Timing-safe comparison
  const sigBuf = Buffer.from(sig, 'utf-8');
  const expBuf = Buffer.from(expected, 'utf-8');

  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'invalid_signature' };
  }

  return { valid: true, params };
}

// ── Convenience ─────────────────────────────────────────────────

/**
 * Generate a signed URL that expires after the given duration.
 *
 * @param params - Slug, agentId, conversationId (expiresAt will be calculated)
 * @param config - Secret and base URL
 * @param ttlMs - Time to live in milliseconds (default: 1 hour)
 */
export function generateTimedUrl(
  params: Omit<SignedUrlParams, 'expiresAt'>,
  config: SignedUrlConfig,
  ttlMs = 60 * 60 * 1000,
): string {
  return generateSignedUrl(
    { ...params, expiresAt: Date.now() + ttlMs },
    config,
  );
}
