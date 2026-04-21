/**
 * SvelteKit server hooks — security response headers (T162).
 *
 * Applied to every server-rendered response from the SvelteKit frontend
 * (www.llmtxt.my). These headers mirror the policy set on the Fastify
 * backend (api.llmtxt.my) but are tuned for a browser-facing UI.
 *
 * CSP notes:
 * - `unsafe-inline` in style-src is necessary because SvelteKit injects
 *   component styles as inline <style> blocks at runtime (Vite/SSR).
 * - `fonts.googleapis.com` is permitted for the Inter / JetBrains Mono
 *   stylesheet linked from app.html. `fonts.gstatic.com` is permitted in
 *   font-src for the actual font files those stylesheets reference.
 * - script-src 'self' covers the SvelteKit JS bundle (no inline scripts).
 * - connect-src must include the API origin and any WebSocket endpoints.
 * - img-src includes api.qrserver.com for QR code generation used in the
 *   document share panel.
 *
 * COEP notes:
 * - `require-corp` is the preferred value but will block any cross-origin
 *   resource that does not send a CORP header. The QR server API must send
 *   `Cross-Origin-Resource-Policy: cross-origin` for this to work.
 *   If it does not, switch to `credentialless` which is less strict but
 *   still provides cross-origin isolation for most attacks.
 *   Currently set to `credentialless` for compatibility with the QR code
 *   external image (api.qrserver.com).
 *
 * HSTS:
 * - Only set in production (NODE_ENV === 'production') because localhost
 *   dev server uses plain HTTP.
 * - max-age=63072000 = 2 years (≥ 1 year for HSTS preload list).
 */
import type { Handle } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';

/** Generate a cryptographically random CSP nonce (128 bits, base64). */
function generateNonce(): string {
  return randomBytes(16).toString('base64');
}

/** Build the CSP header for the SvelteKit frontend. */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // SvelteKit bundles all scripts as static files; no inline scripts.
    // nonce fallback is included for any SSR-injected inline script tags.
    `script-src 'self' 'nonce-${nonce}'`,
    // SvelteKit uses inline style blocks for component CSS.
    // fonts.googleapis.com hosts the Inter / JetBrains Mono CSS linked from app.html.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    // QR code images from the external service + data: for any base64 images.
    "img-src 'self' data: https://api.qrserver.com",
    // fonts.gstatic.com serves the actual woff2 files for Google Fonts.
    "font-src 'self' https://fonts.gstatic.com",
    // API calls to the backend + WebSocket for CRDT sync.
    "connect-src 'self' https://api.llmtxt.my wss://api.llmtxt.my",
    // Prevent embedding this UI in iframes anywhere.
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; ');
}

export const handle: Handle = async ({ event, resolve }) => {
  const nonce = generateNonce();

  // Expose nonce to Svelte components via event.locals if needed.
  // Currently not used but available for future server-rendered script tags.
  (event.locals as Record<string, unknown>).cspNonce = nonce;

  const response = await resolve(event, {
    // Inject nonce into any %sveltekit.head% script tags if present.
    transformPageChunk: ({ html }) =>
      html.replace(/<script/g, `<script nonce="${nonce}"`),
  });

  // ── Content Security Policy ─────────────────────────────────────────────
  response.headers.set('Content-Security-Policy', buildCsp(nonce));

  // ── Cross-Origin isolation headers (T162) ───────────────────────────────
  // credentialless: isolates context without blocking external images (QR API).
  // Use require-corp if all cross-origin resources send CORP headers.
  response.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');

  // ── Legacy security headers ─────────────────────────────────────────────
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '0');

  // ── Referrer & permissions ──────────────────────────────────────────────
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // ── HSTS (production only) ──────────────────────────────────────────────
  // max-age=63072000 = 2 years; includeSubDomains + preload for preload list.
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
  }

  return response;
};
