/**
 * LLM-First content delivery endpoint (T014.1).
 *
 * Handles GET requests for /doc/:slug with content negotiation.
 * AI agents and CLI tools can access document content directly
 * without executing JavaScript or parsing HTML.
 *
 * ## Content negotiation priority
 *
 *   1. `Accept: text/plain`        → plain text body
 *   2. `Accept: application/json`  → JSON with metadata
 *   3. `Accept: text/markdown`     → Markdown with frontmatter
 *   4. `Accept: text/html`         → falls through (SvelteKit renders page)
 *   5. Bot User-Agent + no Accept  → plain text
 *   6. Browser / unknown           → falls through (SvelteKit renders page)
 *
 * ## Query params
 *
 *   `?section=<title>` — return only the named section (progressive disclosure)
 *
 * ## Cache headers
 *
 *   - `Cache-Control: public, max-age=60, s-maxage=300`
 *   - `ETag: "<content-hash>"`
 *   - `Vary: Accept, User-Agent`
 *
 * @module
 */

import type { RequestHandler } from './$types';
import { negotiateFormat } from '$lib/content/negotiation.js';
import { fetchDocument, fetchDocumentText, serializePayload } from '$lib/content/fetch.js';

// ── GET ────────────────────────────────────────────────────────

/**
 * Content-negotiated GET handler for /doc/:slug.
 *
 * When the resolved format is null (browser / text/html request), the handler
 * returns a 200 but with no body — SvelteKit's page renderer will handle it
 * instead via the co-located +page.svelte. In practice this endpoint only
 * fires for non-browser clients because SvelteKit routes +server.ts handlers
 * ahead of +page rendering only for non-html responses; for requests that
 * accept text/html, SvelteKit will route to +page.svelte automatically.
 *
 * Reference: https://kit.svelte.dev/docs/routing#server
 */
export const GET: RequestHandler = async ({ params, request, url }) => {
  const { slug } = params;
  const accept = request.headers.get('accept');
  const userAgent = request.headers.get('user-agent');
  const section = url.searchParams.get('section') ?? null;

  // Resolve format via content negotiation.
  const format = negotiateFormat(accept, userAgent);

  // If format is null the request is from a browser expecting HTML.
  // Return a 406 to signal to SvelteKit to use +page.svelte instead.
  // In SvelteKit, when both +server.ts and +page.svelte exist, the
  // +server.ts is only invoked for non-HTML requests. Returning null here
  // is not possible — we cannot "pass through" from a server handler.
  // Instead, we rely on SvelteKit's built-in routing: GET requests that
  // include text/html in Accept are handled by +page.svelte, NOT +server.ts,
  // because SvelteKit gives page routes priority for HTML requests.
  //
  // This handler is therefore only reached for non-HTML Accept headers
  // or bot UAs that don't specify Accept:text/html. We still guard here
  // in case SvelteKit routes an unexpected request.
  if (!format) {
    // Let SvelteKit fall through to +page.svelte.
    // Returning a non-2xx causes SvelteKit to invoke the error boundary,
    // so we return a 406 with a helpful message for any non-browser client
    // that arrived here without a recognised Accept header.
    return new Response(
      'Not Acceptable. Use Accept: text/plain, application/json, or text/markdown for machine access.',
      {
        status: 406,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Vary': 'Accept, User-Agent',
        },
      },
    );
  }

  // Fetch document from backend.
  const payload = await fetchDocument(slug, section);

  if (!payload) {
    // If a specific section was requested, give a targeted 404.
    if (section) {
      const meta = await fetchDocumentText(slug);
      if (meta === null) {
        return new Response(`Document '${slug}' not found.\n`, {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      return new Response(
        `Section '${section}' not found in document '${slug}'.\n`,
        {
          status: 404,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Vary': 'Accept, User-Agent',
          },
        },
      );
    }
    return new Response(`Document '${slug}' not found.\n`, {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const [body, contentType] = serializePayload(payload, format);

  // ETag from content hash or a hash of the body.
  const etag = payload.meta.contentHash
    ? `"${payload.meta.contentHash}"`
    : `"${hashBody(body)}"`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=60, s-maxage=300',
      'ETag': etag,
      'Vary': 'Accept, User-Agent',
      'X-Content-Format': format,
      'X-Document-Slug': slug,
      'X-Document-Version': String(payload.meta.currentVersion),
    },
  });
};

// ── Helpers ────────────────────────────────────────────────────

/**
 * Lightweight djb2-style hash for generating an ETag when the backend
 * does not provide a content hash.
 *
 * This is only a fallback — in practice the backend always sets contentHash.
 */
function hashBody(body: string): string {
  let h = 5381;
  for (let i = 0; i < body.length; i++) {
    h = ((h << 5) + h + body.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}
