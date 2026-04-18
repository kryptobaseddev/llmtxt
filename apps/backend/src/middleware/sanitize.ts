/**
 * HTML sanitization for server-side rendered document content (T163).
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
 * URI scheme policy (T163):
 * - `javascript:` URIs are blocked via ALLOWED_URI_REGEXP which only
 *   permits http:, https:, mailto:, and relative paths.
 * - `data:text/html` and other dangerous data: MIME types are blocked.
 * - `vbscript:` URIs are blocked.
 *
 * Style attribute policy:
 * - `style` attribute is NOT allowed. CSS url() values can contain
 *   javascript: URIs which DOMPurify does not sanitize inside CSS strings.
 *   Code block styling is applied via class attributes instead.
 */
import { JSDOM } from 'jsdom';
import DOMPurify, { type WindowLike, type Config as DOMPurifyConfig } from 'dompurify';

// Create a single shared JSDOM window for DOMPurify.
// Re-using the same window is safe and avoids repeated DOM environment setup.
const { window: jsdomWindow } = new JSDOM('');

// DOMPurify accepts a WindowLike subset. The JSDOM window satisfies the
// structural contract at runtime; we cast through unknown to satisfy tsc.
const purify = DOMPurify(jsdomWindow as unknown as WindowLike);

/**
 * URI allowlist: only permit http:, https:, mailto:, and relative URIs.
 * This blocks javascript:, data:, vbscript:, and other dangerous schemes.
 * Pattern is anchored to match from the start of the URI value.
 */
const ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

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
  // NOTE: `style` is intentionally excluded — CSS url() values can contain
  // javascript: URIs. Use class attributes for styling instead.
  ALLOWED_ATTR: [
    'href', 'title', 'target', 'rel',
    'src', 'alt', 'width', 'height',
    'class', 'id',
  ],
  // URI scheme allowlist — blocks javascript:, data:text/html, vbscript:, etc.
  ALLOWED_URI_REGEXP,
  // Force all links to have rel="noopener noreferrer" for safety.
  ADD_ATTR: ['rel'],
  // Block ALL event handler attributes (comprehensive list).
  FORBID_ATTR: [
    'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur',
    'onchange', 'oninput', 'onkeydown', 'onkeyup', 'onkeypress',
    'onmousedown', 'onmouseup', 'onmousemove', 'onmouseout',
    'onsubmit', 'onreset', 'onselect', 'onscroll', 'ondblclick',
    'oncontextmenu', 'ondrag', 'ondrop', 'onpaste', 'oncopy', 'oncut',
    'onpointerdown', 'onpointerup', 'onpointermove', 'onpointercancel',
    'onpointerover', 'onpointerout', 'onpointerenter', 'onpointerleave',
    'onbegin', 'onend', 'onrepeat',
    'ondomcontentloaded', 'onreadystatechange',
    // Also block style attribute explicitly
    'style',
  ],
  // Prevent DOM clobbering attacks.
  SANITIZE_DOM: true,
  // Return a string, not a DOM node.
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
  // Strip content of these tags entirely (not just the tag).
  FORBID_CONTENTS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
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
