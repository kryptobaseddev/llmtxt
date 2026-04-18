/**
 * Security headers middleware.
 *
 * Adds defense-in-depth HTTP response headers on every reply:
 * - Content-Security-Policy (CSP) — restricts resource loading origins
 * - X-Content-Type-Options       — prevents MIME-type sniffing
 * - X-Frame-Options              — prevents clickjacking (legacy)
 * - X-XSS-Protection            — disabled per OWASP recommendation
 * - Referrer-Policy             — limits referrer information leakage
 * - Permissions-Policy          — disables unused browser APIs
 * - Strict-Transport-Security   — enforces HTTPS (production only)
 *
 * CSP notes (X-02, T108.5):
 * - A per-request cryptographic nonce is generated for every HTML response.
 *   The nonce is attached to the Fastify reply as `reply.cspNonce` so that
 *   viewTemplate.ts can embed it in inline <script nonce="…"> tags.
 * - `unsafe-inline` is REMOVED from script-src. Only scripts carrying the
 *   correct nonce are executed. This closes the XSS vector where an attacker
 *   could inject a bare <script> block.
 * - `unsafe-inline` is still allowed for style-src because the SSR template
 *   injects inline <style> blocks. A future cleanup can move those to a
 *   separate stylesheet.
 * - `connect-src` permits fetches back to the API subdomain.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';

// Augment Fastify reply to carry the nonce so viewTemplate.ts can read it.
declare module 'fastify' {
  interface FastifyReply {
    /** Per-request CSP nonce for inline <script nonce="…"> tags. */
    cspNonce?: string;
  }
}

/**
 * Generate a cryptographically random 128-bit nonce, base64-encoded.
 * A fresh nonce is produced for every HTTP response.
 */
function generateNonce(): string {
  return randomBytes(16).toString('base64');
}

/**
 * Build the Content-Security-Policy header value, embedding the per-request
 * nonce into the script-src directive.
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // X-02: unsafe-inline replaced by per-request nonce.  [T108.5]
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'", // inline styles in viewTemplate.ts
    "img-src 'self' data:",
    "font-src 'self'",
    // wss: covers WebSocket (CRDT sync); https: covers API fetch calls.
    "connect-src 'self' https://api.llmtxt.my wss://api.llmtxt.my",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; ');
}

/** Register an onSend hook that sets comprehensive security headers on every response. */
export async function securityHeaders(app: FastifyInstance) {
  // Generate a nonce early in the request lifecycle (onRequest) so that
  // route handlers rendering HTML can read reply.cspNonce.
  app.addHook('onRequest', async (_request, reply: FastifyReply) => {
    reply.cspNonce = generateNonce();
  });

  app.addHook('onSend', async (_request, reply: FastifyReply) => {
    // Use the nonce generated in onRequest, or create a fallback if the hook
    // was somehow skipped (should not happen under normal operation).
    const nonce = reply.cspNonce ?? generateNonce();
    reply.header('Content-Security-Policy', buildCsp(nonce));
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    // X-XSS-Protection is deprecated and can introduce new attack vectors in
    // older browsers. Set to 0 per OWASP guidance (disable the filter).
    reply.header('X-XSS-Protection', '0');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    // ── Cross-Origin isolation headers (T162) ──────────────────────────────
    // COEP: require-corp isolates the browsing context so SharedArrayBuffer
    // and WASM threads are available. The API serves no cross-origin resources.
    reply.header('Cross-Origin-Embedder-Policy', 'require-corp');
    // COOP: same-origin prevents opener access from cross-origin popups.
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    // CORP: same-origin restricts cross-origin reads of API responses.
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');

    // ── HSTS (production only) ────────────────────────────────────────────
    // Only enforce HSTS in production — local dev uses plain HTTP.
    // max-age=63072000 = 2 years (minimum 1 year for HSTS preload list).
    // includeSubDomains and preload enable submission to hstspreload.org.
    if (process.env.NODE_ENV === 'production') {
      reply.header(
        'Strict-Transport-Security',
        'max-age=63072000; includeSubDomains; preload',
      );
    }
  });
}
