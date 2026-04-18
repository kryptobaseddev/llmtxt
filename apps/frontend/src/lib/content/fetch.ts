/**
 * Server-side document fetch helpers for LLM-First content delivery (T014).
 *
 * All functions call the backend API from the SvelteKit server context.
 * They MUST NOT be imported client-side.
 *
 * The API base URL is read from VITE_API_BASE (build-time) or falls back to
 * the production URL. SvelteKit exposes Vite env vars at build time in
 * server-side code via `import.meta.env`.
 *
 * @module
 */

import type { ContentFormat } from './negotiation.js';

// ── Config ─────────────────────────────────────────────────────

/**
 * Backend API base URL.
 *
 * In production this is https://api.llmtxt.my.
 * In development set VITE_API_BASE in apps/frontend/.env.local.
 *
 * Uses the same pattern as the existing client.ts to keep config consistent.
 */
function getApiBase(): string {
  // import.meta.env.VITE_API_BASE is available in both client and server
  // contexts in SvelteKit/Vite (VITE_ prefix makes it public/embedded at build).
  return (import.meta.env.VITE_API_BASE as string | undefined) ?? 'https://api.llmtxt.my';
}

// ── Types ──────────────────────────────────────────────────────

/** Minimal document metadata returned by the backend. */
export interface DocMeta {
  slug: string;
  state: string;
  format: string;
  tokenCount: number;
  currentVersion: number;
  createdAt: number;
  updatedAt: number;
  contentHash?: string | null;
  versionCount?: number | null;
  createdBy?: string | null;
  labels?: string[] | null;
}

/** Full document payload with metadata and raw content. */
export interface DocPayload {
  meta: DocMeta;
  content: string;
}

// ── Fetch helpers ──────────────────────────────────────────────

/**
 * Fetch plain-text document content from the backend.
 *
 * Optionally fetches only a named section via the `?section=` query param
 * that the backend `/raw` endpoint already supports.
 *
 * @param slug - Document slug.
 * @param section - Optional section title to narrow the response.
 * @returns Plain-text content string, or null if the document is not found.
 */
export async function fetchDocumentText(
  slug: string,
  section?: string | null,
): Promise<string | null> {
  const base = getApiBase();
  const url = new URL(`/documents/${encodeURIComponent(slug)}/raw`, base);
  if (section) url.searchParams.set('section', section);

  const res = await fetch(url.toString(), {
    headers: {
      // Pass through as an internal server call — no auth cookie needed
      // for public documents (canRead allows unauthenticated reads).
      Accept: 'text/plain',
    },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Backend returned ${res.status} for /documents/${slug}/raw`);
  }
  return res.text();
}

/**
 * Fetch document metadata from the backend.
 *
 * @param slug - Document slug.
 * @returns Parsed DocMeta, or null if the document is not found.
 */
export async function fetchDocumentMeta(slug: string): Promise<DocMeta | null> {
  const base = getApiBase();
  const res = await fetch(`${base}/documents/${encodeURIComponent(slug)}`, {
    headers: { Accept: 'application/json' },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Backend returned ${res.status} for /documents/${slug}`);
  }
  return res.json() as Promise<DocMeta>;
}

/**
 * Fetch both document metadata and content in parallel.
 *
 * @param slug - Document slug.
 * @param section - Optional section to limit the content.
 * @returns Combined payload, or null if the document is not found.
 */
export async function fetchDocument(
  slug: string,
  section?: string | null,
): Promise<DocPayload | null> {
  const [meta, content] = await Promise.all([
    fetchDocumentMeta(slug),
    fetchDocumentText(slug, section),
  ]);

  if (!meta || content === null) return null;
  return { meta, content };
}

// ── Format serializers ─────────────────────────────────────────

/**
 * Serialise a document payload to the requested content format.
 *
 * @param payload - Document metadata and content.
 * @param format  - Target serialization format.
 * @returns Tuple of [body string, MIME content-type string].
 */
export function serializePayload(
  payload: DocPayload,
  format: ContentFormat,
): [body: string, contentType: string] {
  const { meta, content } = payload;

  switch (format) {
    case 'text': {
      const body = content.trimEnd() + '\n';
      return [body, 'text/plain; charset=utf-8'];
    }

    case 'markdown': {
      // Minimal YAML frontmatter + document body.
      const contributors: string[] = [];
      const fm = [
        '---',
        `title: "${meta.slug}"`,
        `slug: "${meta.slug}"`,
        `version: ${meta.currentVersion}`,
        `state: ${meta.state}`,
        `contributors: [${contributors.join(', ')}]`,
        `exported_at: "${new Date().toISOString()}"`,
        '---',
        '',
        content.trimEnd(),
        '',
      ].join('\n');
      return [fm, 'text/markdown; charset=utf-8'];
    }

    case 'json': {
      const obj = {
        schema: 'llmtxt-export/1',
        slug: meta.slug,
        version: meta.currentVersion,
        state: meta.state,
        format: meta.format,
        token_count: meta.tokenCount,
        created_at: meta.createdAt,
        updated_at: meta.updatedAt,
        content_hash: meta.contentHash ?? null,
        labels: meta.labels ?? null,
        created_by: meta.createdBy ?? null,
        content,
      };
      return [JSON.stringify(obj, null, 2) + '\n', 'application/json; charset=utf-8'];
    }
  }
}
