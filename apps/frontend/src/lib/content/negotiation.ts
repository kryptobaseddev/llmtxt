/**
 * Content negotiation utilities for LLM-First content delivery (T014).
 *
 * Determines the response format to use based on the HTTP Accept header and
 * User-Agent string, following a clear precedence order:
 *
 *   1. URL extension (".txt", ".json", ".md") — highest priority, callers
 *      resolve this before reaching negotiation.
 *   2. Explicit Accept header — respects the client's stated preference.
 *   3. User-Agent heuristic — bot/agent UAs default to text/plain.
 *   4. Fall-through — for Accept:text/html or unrecognised, returns null
 *      so the SvelteKit page renderer takes over.
 *
 * @module
 */

// ── Types ──────────────────────────────────────────────────────

/** Resolved content format for the response. */
export type ContentFormat = 'text' | 'json' | 'markdown';

// ── Bot / agent User-Agent patterns ───────────────────────────

/**
 * Regex that matches User-Agent strings from known bots, agents, and
 * non-browser HTTP clients that should default to plain text.
 *
 * Includes:
 * - AI crawlers: GPTBot, ClaudeBot, PerplexityBot, Googlebot, Bingbot, etc.
 * - CLI tools: curl, wget, httpie (http/1), LWP
 * - HTTP libraries: python-requests, python-httpx, Go-http-client, Axios,
 *   node-fetch, got, undici
 * - Generic patterns: "bot", "spider", "crawl", "agent", "scraper"
 */
const BOT_UA_RE =
  /bot|spider|crawl|agent|scraper|gptbot|claudebot|perplexitybot|googlebot|bingbot|curl|wget|httpie|lwp|python[\s-]|go-http|axios|node-fetch|got\/|undici/i;

// ── Helpers ────────────────────────────────────────────────────

/**
 * Returns true if the User-Agent string identifies a bot or non-browser client.
 *
 * @param ua - User-Agent header value (may be undefined).
 */
export function isBotUserAgent(ua: string | undefined | null): boolean {
  if (!ua) return false;
  return BOT_UA_RE.test(ua);
}

// ── Primary negotiation ────────────────────────────────────────

/**
 * Resolve the content format from the request's Accept header and User-Agent.
 *
 * Returns `null` for text/html or unrecognised Accept headers so that the
 * caller can fall through to the SvelteKit HTML page renderer.
 *
 * Precedence:
 *  1. Accept header (specific MIME types take priority over wildcards).
 *  2. Bot User-Agent heuristic (only applied when Accept is absent or wildcard).
 *  3. Returns null — let SvelteKit render the HTML page.
 *
 * @param accept - Value of the HTTP Accept header (may be undefined).
 * @param userAgent - Value of the HTTP User-Agent header (may be undefined).
 * @returns The resolved format, or null if the request should render HTML.
 */
export function negotiateFormat(
  accept: string | undefined | null,
  userAgent: string | undefined | null,
): ContentFormat | null {
  const a = (accept ?? '').toLowerCase();

  // Explicit Accept header signals — checked before UA heuristic.
  if (a.includes('text/plain')) return 'text';
  if (a.includes('application/json')) return 'json';
  if (a.includes('text/markdown') || a.includes('text/x-markdown')) return 'markdown';

  // text/html: let SvelteKit render the page.
  if (a.includes('text/html')) return null;

  // Accept: */* or absent — apply UA heuristic.
  const isWildcard = !a || a.includes('*/*');
  if (isWildcard && isBotUserAgent(userAgent)) return 'text';

  // Unknown / browser default (*/*) — render HTML.
  return null;
}

/**
 * Map a URL file extension to its ContentFormat.
 *
 * @param ext - Extension without the leading dot (e.g. "txt", "json", "md").
 * @returns The corresponding format, or null for unrecognised extensions.
 */
export function extensionToFormat(ext: string): ContentFormat | null {
  switch (ext.toLowerCase()) {
    case 'txt':
      return 'text';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    default:
      return null;
  }
}
