/**
 * Signed URL generation and verification for conversation-scoped,
 * time-limited access to llmtxt content.
 *
 * Uses HMAC-SHA256 with a shared secret. URLs are compact (16-char hex signatures).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

// ── Types ───────────────────────────────────────────────────────

/**
 * Parameters that uniquely identify a signed URL access grant.
 *
 * @remarks
 * Combined with an HMAC secret these fields form the signature payload.
 * Each parameter is included in the URL query string so that the
 * verifier can reconstruct and validate the signature independently.
 */
export interface SignedUrlParams {
  /** Short base62-encoded document identifier (e.g. `"xK9mP2nQ"`). */
  slug: string;
  /** Unique identifier of the agent requesting access. */
  agentId: string;
  /** Conversation scope that this access grant is bound to. */
  conversationId: string;
  /** Absolute expiration time as a Unix timestamp in milliseconds. */
  expiresAt: number;
}

/**
 * Configuration for generating and verifying signed URLs.
 *
 * @remarks
 * The `secret` must be identical on both the URL-generating service and
 * the URL-verifying service. The `baseUrl` is used only during generation.
 */
export interface SignedUrlConfig {
  /** Shared HMAC-SHA256 secret used to sign and verify URLs. */
  secret: string;
  /** Base URL for document access (e.g. `"https://llmtxt.my"`). */
  baseUrl: string;
}

/**
 * Outcome of verifying a signed URL via {@link verifySignedUrl}.
 *
 * @remarks
 * When `valid` is `true` the reconstructed {@link SignedUrlParams} are
 * included so the caller can use them for authorization decisions.
 */
export interface VerifyResult {
  /** Whether the signature is valid and the URL has not expired. */
  valid: boolean;
  /** Machine-readable failure reason, present only when `valid` is `false`. */
  reason?: 'missing_params' | 'expired' | 'invalid_signature';
  /** Reconstructed request parameters, present only when `valid` is `true`. */
  params?: SignedUrlParams;
}

// ── Signature ───────────────────────────────────────────────────

/**
 * Compute the HMAC-SHA256 signature for a set of signed URL parameters.
 *
 * @remarks
 * Concatenates the parameter fields with colon delimiters, computes
 * an HMAC-SHA256 digest, and returns the first 16 hex characters for
 * URL compactness. The truncated signature still provides 64 bits of
 * collision resistance.
 *
 * @param params - The signed URL parameters to include in the signature payload.
 * @param secret - The shared HMAC secret.
 * @returns A 16-character hex string representing the truncated HMAC signature.
 *
 * @example
 * ```ts
 * const sig = computeSignature(
 *   { slug: 'xK9mP2nQ', agentId: 'agent-1', conversationId: 'conv_1', expiresAt: 1711234567890 },
 *   'my-secret',
 * );
 * // sig.length === 16
 * ```
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
 * @remarks
 * Combines the document slug, agent identity, conversation scope, and
 * expiration into a single URL whose query string includes the HMAC
 * signature. The URL can later be verified with {@link verifySignedUrl}.
 *
 * @param params - The signed URL parameters (slug, agent, conversation, expiry).
 * @param config - The HMAC secret and base URL for URL construction.
 * @returns The fully-qualified signed URL string.
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
 * @remarks
 * Extracts the query parameters from the URL, reconstructs the expected
 * HMAC signature, and performs a timing-safe comparison to prevent
 * timing attacks. Returns a {@link VerifyResult} indicating whether the
 * URL is valid and, if so, the reconstructed parameters.
 *
 * @param url - The signed URL to verify (string or `URL` instance).
 * @param secret - The shared HMAC secret used when the URL was generated.
 * @returns A {@link VerifyResult} with `valid`, optional `reason`, and optional `params`.
 *
 * @example
 * ```ts
 * const result = verifySignedUrl('https://llmtxt.my/xK9mP2nQ?agent=a&conv=c&exp=9999999999999&sig=abc123', 'secret');
 * if (result.valid) console.log(result.params);
 * ```
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
 * @remarks
 * Convenience wrapper around {@link generateSignedUrl} that calculates
 * `expiresAt` from the current time plus a TTL, so callers do not need
 * to compute the absolute timestamp themselves.
 *
 * @param params - Slug, agentId, and conversationId (expiresAt is calculated automatically).
 * @param config - The HMAC secret and base URL for URL construction.
 * @param ttlMs - Time to live in milliseconds (default: 1 hour / 3 600 000 ms).
 * @returns The fully-qualified signed URL string with a computed expiration.
 *
 * @example
 * ```ts
 * const url = generateTimedUrl(
 *   { slug: 'xK9mP2nQ', agentId: 'agent-1', conversationId: 'conv_1' },
 *   { secret: 'secret', baseUrl: 'https://llmtxt.my' },
 *   300_000, // 5 minutes
 * );
 * ```
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
