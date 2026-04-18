/**
 * Extension-based format override endpoint (T014.2).
 *
 * Handles:
 *   GET /doc/:slug.txt   → text/plain (always, regardless of Accept header)
 *   GET /doc/:slug.json  → application/json
 *   GET /doc/:slug.md    → text/markdown
 *
 * URL extensions take priority over Accept header negotiation, giving
 * callers a stable, bookmarkable URL for each format variant.
 *
 * ## Query params
 *
 *   `?section=<title>` — return only the named section (progressive disclosure)
 *
 * ## Cache headers
 *
 *   - `Cache-Control: public, max-age=60, s-maxage=300`
 *   - `ETag: "<content-hash>"`
 *   - `Vary: (none — format is fixed by the URL)`
 *
 * @module
 */

import type { RequestHandler } from './$types';
import { extensionToFormat } from '$lib/content/negotiation.js';
import { fetchDocument, fetchDocumentMeta, serializePayload } from '$lib/content/fetch.js';

// ── GET ────────────────────────────────────────────────────────

export const GET: RequestHandler = async ({ params, url }) => {
  const { slug, ext } = params;
  const section = url.searchParams.get('section') ?? null;

  // Resolve format from extension (matcher guarantees ext is valid).
  const format = extensionToFormat(ext);
  if (!format) {
    // Should never reach here — the [ext=docext] matcher rejects other values.
    return new Response(`Unsupported extension '.${ext}'.`, {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Fetch document from backend.
  const payload = await fetchDocument(slug, section);

  if (!payload) {
    // Section-specific 404: differentiate "doc not found" from "section not found".
    if (section) {
      const meta = await fetchDocumentMeta(slug);
      if (!meta) {
        return new Response(`Document '${slug}' not found.\n`, {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      return new Response(
        `Section '${section}' not found in document '${slug}'.\n`,
        {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        },
      );
    }
    return new Response(`Document '${slug}' not found.\n`, {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const [body, contentType] = serializePayload(payload, format);

  const etag = payload.meta.contentHash
    ? `"${payload.meta.contentHash}"`
    : `"${hashBody(body)}"`;

  // Extension routes do not vary by Accept/UA — format is fixed.
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=60, s-maxage=300',
      'ETag': etag,
      'X-Content-Format': format,
      'X-Document-Slug': slug,
      'X-Document-Version': String(payload.meta.currentVersion),
    },
  });
};

// ── Helpers ────────────────────────────────────────────────────

function hashBody(body: string): string {
  let h = 5381;
  for (let i = 0; i < body.length; i++) {
    h = ((h << 5) + h + body.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}
