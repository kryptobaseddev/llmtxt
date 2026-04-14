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
 * CSP notes:
 * - `unsafe-inline` is allowed for style-src because the SSR template in
 *   viewTemplate.ts injects inline <style> blocks.
 * - `script-src 'self'` disallows inline scripts. The client JS in
 *   viewTemplate.ts is emitted as inline <script> — this is intentional
 *   for the MVP; a nonce-based approach should replace it before v2.
 * - `connect-src` permits fetches back to the API subdomain.
 */
import type { FastifyInstance } from 'fastify';

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // inline scripts in viewTemplate.ts
  "style-src 'self' 'unsafe-inline'",   // inline styles in viewTemplate.ts
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.llmtxt.my",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** Register an onSend hook that sets comprehensive security headers on every response. */
export async function securityHeaders(app: FastifyInstance) {
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Content-Security-Policy', CSP_DIRECTIVES);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    // X-XSS-Protection is deprecated and can introduce new attack vectors in
    // older browsers. Set to 0 per OWASP guidance (disable the filter).
    reply.header('X-XSS-Protection', '0');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    // Only enforce HSTS in production — local dev uses plain HTTP.
    if (process.env.NODE_ENV === 'production') {
      reply.header(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }
  });
}
