/**
 * Signed URL generation and verification for conversation-scoped,
 * time-limited access to llmtxt content.
 *
 * HMAC computation and key derivation delegate to the Rust WASM module.
 * URL construction and verification logic stays in TypeScript (URL parsing
 * is complex in WASM and not needed in the Rust native crate).
 */
import {
  computeSignature as wasmComputeSignature,
  computeSignatureWithLength as wasmComputeSignatureWithLength,
  computeOrgSignature as wasmComputeOrgSignature,
  computeOrgSignatureWithLength as wasmComputeOrgSignatureWithLength,
  deriveSigningKey as wasmDeriveSigningKey,
  isExpired as wasmIsExpired,
} from './wasm.js';

// ── Types ───────────────────────────────────────────────────────

/**
 * Parameters that uniquely identify a signed URL access grant.
 */
export interface SignedUrlParams {
  slug: string;
  agentId: string;
  conversationId: string;
  expiresAt: number;
}

/**
 * Configuration for generating and verifying signed URLs.
 */
export interface SignedUrlConfig {
  secret: string;
  baseUrl: string;
}

/**
 * Outcome of verifying a signed URL.
 */
export interface VerifyResult {
  valid: boolean;
  reason?: 'missing_params' | 'expired' | 'invalid_signature';
  params?: SignedUrlParams;
}

// ── Signature (WASM-backed) ─────────────────────────────────────

/**
 * Compute the HMAC-SHA256 signature for signed URL parameters.
 * Delegates to the Rust WASM module.
 */
export function computeSignature(params: SignedUrlParams, secret: string): string {
  return wasmComputeSignature(
    params.slug,
    params.agentId,
    params.conversationId,
    params.expiresAt,
    secret,
  );
}

/**
 * Compute signature with configurable length.
 * Use 16 for short-lived URLs (default), 32 for long-lived URLs (128 bits).
 */
export function computeSignatureWithLength(
  params: SignedUrlParams,
  secret: string,
  sigLength: number,
): string {
  return wasmComputeSignatureWithLength(
    params.slug,
    params.agentId,
    params.conversationId,
    params.expiresAt,
    secret,
    sigLength,
  );
}

// ── Generate ────────────────────────────────────────────────────

/**
 * Generate a signed URL for accessing a document.
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

// Keep timing-safe from Node.js crypto for the URL verification step
import { timingSafeEqual } from 'node:crypto';

// ── Org-Scoped Signatures (Phase 5) ─────────────────────────────

/**
 * Parameters for org-scoped signed URLs (Phase 5 enterprise).
 * Extends conversation-scoped params with an organization ID.
 */
export interface OrgSignedUrlParams extends SignedUrlParams {
  orgId: string;
}

/**
 * Compute the HMAC-SHA256 signature for org-scoped signed URL parameters.
 * Includes orgId in the HMAC payload for organization-level access control.
 * Returns 32 hex characters (128 bits) by default.
 */
export function computeOrgSignature(params: OrgSignedUrlParams, secret: string): string {
  return wasmComputeOrgSignature(
    params.slug,
    params.agentId,
    params.conversationId,
    params.orgId,
    params.expiresAt,
    secret,
  );
}

/**
 * Compute org-scoped signature with configurable length.
 */
export function computeOrgSignatureWithLength(
  params: OrgSignedUrlParams,
  secret: string,
  sigLength: number,
): string {
  return wasmComputeOrgSignatureWithLength(
    params.slug,
    params.agentId,
    params.conversationId,
    params.orgId,
    params.expiresAt,
    secret,
    sigLength,
  );
}

/**
 * Generate an org-scoped signed URL for accessing a document.
 * The URL includes the org parameter for organization-level access verification.
 */
export function generateOrgSignedUrl(params: OrgSignedUrlParams, config: SignedUrlConfig): string {
  const signature = computeOrgSignature(params, config.secret);
  const url = new URL(`/${params.slug}`, config.baseUrl);
  url.searchParams.set('agent', params.agentId);
  url.searchParams.set('conv', params.conversationId);
  url.searchParams.set('org', params.orgId);
  url.searchParams.set('exp', String(params.expiresAt));
  url.searchParams.set('sig', signature);
  return url.toString();
}

/**
 * Verify an org-scoped signed URL's signature and expiration.
 */
export function verifyOrgSignedUrl(url: string | URL, secret: string): VerifyResult & { orgId?: string } {
  const parsed = typeof url === 'string' ? new URL(url) : url;

  const slug = parsed.pathname.replace(/^\//, '');
  const agent = parsed.searchParams.get('agent');
  const conv = parsed.searchParams.get('conv');
  const org = parsed.searchParams.get('org');
  const exp = parsed.searchParams.get('exp');
  const sig = parsed.searchParams.get('sig');

  if (!slug || !agent || !conv || !org || !exp || !sig) {
    return { valid: false, reason: 'missing_params' };
  }

  const expiresAt = parseInt(exp, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) {
    return { valid: false, reason: 'expired' };
  }

  const params: OrgSignedUrlParams = { slug, agentId: agent, conversationId: conv, orgId: org, expiresAt };
  const expected = computeOrgSignature(params, secret);

  const sigBuf = Buffer.from(sig, 'utf-8');
  const expBuf = Buffer.from(expected, 'utf-8');

  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'invalid_signature' };
  }

  return { valid: true, params, orgId: org };
}

// ── Convenience ─────────────────────────────────────────────────

/**
 * Generate a signed URL that expires after the given duration.
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

// ── Key Derivation (WASM-backed) ────────────────────────────────

/**
 * Derive a per-agent signing key from their API key.
 * Delegates to the Rust WASM module.
 */
export function deriveSigningKey(apiKey: string): string {
  return wasmDeriveSigningKey(apiKey);
}

// ── Expiration (WASM-backed) ────────────────────────────────────

/**
 * Check whether a timestamp has expired.
 * Returns false for null/undefined (no expiration set).
 */
export function isExpired(expiresAt: number | null | undefined): boolean {
  if (expiresAt == null) return false;
  return wasmIsExpired(expiresAt);
}
