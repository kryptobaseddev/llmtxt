/**
 * HTML sanitization for server-side rendered document content.
 *
 * Sanitization policy:
 * - Applied on OUTPUT only — stored content is never modified.
 *   Preserving raw content integrity is a first-class requirement of the
 *   LLMtxt platform; agents must receive exactly what was stored.
 * - Applied when content is embedded in an HTML page (SSR view).
 * - Not applied to JSON API responses or text/plain responses — those
 *   consumers do not parse HTML so there is no XSS vector.
 *
 * DOMPurify is run in a server-side JSDOM environment so it can be used
 * from Node.js (where `document` is not natively available).
 *
 * Allowed HTML elements and attributes are intentionally permissive enough
 * to support rich markdown-rendered content (headings, code, lists, links)
 * while stripping all event handlers and dangerous attributes.
 */
import { JSDOM } from 'jsdom';
import DOMPurify, { type WindowLike, type Config as DOMPurifyConfig } from 'dompurify';

// Create a single shared JSDOM window for DOMPurify.
// Re-using the same window is safe and avoids repeated DOM environment setup.
const { window: jsdomWindow } = new JSDOM('');

// DOMPurify accepts a WindowLike subset. The JSDOM window satisfies the
// structural contract at runtime; we cast through unknown to satisfy tsc.
const purify = DOMPurify(jsdomWindow as unknown as WindowLike);

// DOMPurify configuration — restrict to a safe subset of HTML.
const PURIFY_CONFIG: DOMPurifyConfig = {
  // Allow standard HTML content elements.
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code',
    'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins',
    'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'div', 'span',
    'img',
  ],
  // Allow only safe, non-scriptable attributes.
  ALLOWED_ATTR: [
    'href', 'title', 'target', 'rel',
    'src', 'alt', 'width', 'height',
    'class', 'id',
    // Code block styling (used by the inline <code> renderer in viewTemplate.ts)
    'style',
  ],
  // Force all links to have rel="noopener noreferrer" for safety.
  ADD_ATTR: ['rel'],
  // Block event handler attributes and other dangerous patterns.
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  // Prevent DOM clobbering attacks.
  SANITIZE_DOM: true,
  // Return a string, not a DOM node.
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
};

/**
 * Sanitize an HTML string for safe embedding in a server-rendered page.
 *
 * This function must only be called on content that will be rendered as HTML
 * (e.g., the output of renderMarkdown in viewTemplate.ts). Do not call it on
 * raw content stored in the database or returned via JSON/plain-text APIs.
 *
 * @param html - The HTML string to sanitize.
 * @returns A safe HTML string with all dangerous elements and attributes removed.
 */
export function sanitizeHtml(html: string): string {
  // DOMPurify.sanitize returns string when RETURN_DOM and RETURN_DOM_FRAGMENT
  // are both false (the config above). The overload typing returns TrustedHTML
  // in some environments; we coerce through unknown to get a plain string.
  return purify.sanitize(html, PURIFY_CONFIG) as unknown as string;
}
