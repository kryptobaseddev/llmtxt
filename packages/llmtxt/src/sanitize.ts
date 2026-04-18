/**
 * Centralized XSS sanitization module (T163 SSoT).
 *
 * This module is the single source of truth for HTML sanitization policy
 * across the LLMtxt platform. All render paths that produce HTML from
 * user-supplied content MUST use this module.
 *
 * Architecture:
 * - Server-side (Node.js): uses DOMPurify + JSDOM (lazy-initialized singleton).
 * - Client-side (browser): uses DOMPurify with the native DOM.
 * - Sanitization is applied on OUTPUT only — stored content is never modified.
 *
 * Threat model (OWASP XSS cheat sheet payloads blocked):
 * - `<script>alert(1)</script>` — script tag stripped
 * - `<img src=x onerror=alert(1)>` — event handlers stripped
 * - `<svg onload=alert(1)>` — svg allowed but event attrs stripped
 * - `javascript:alert(1)` in href — blocked by ALLOWED_URI_REGEXP
 * - `data:text/html,<script>alert(1)</script>` — blocked by ALLOWED_URI_REGEXP
 * - `vbscript:alert(1)` — blocked by ALLOWED_URI_REGEXP
 * - `<a href="javascript:alert(1)">click</a>` — href sanitized
 * - `<img src="data:image/svg+xml,<svg onload=alert(1)>">` — data: URI blocked
 * - DOM clobbering attacks — SANITIZE_DOM enabled
 *
 * @module sanitize
 */

/**
 * URI allowlist: only permit http:, https:, mailto:, and relative URIs.
 * This blocks javascript:, data:, vbscript:, and other dangerous schemes.
 *
 * The regex matches from the start of the URI value and allows:
 * - http:// and https:// URIs
 * - mailto: URIs
 * - Relative URIs (starting with /, ./, ../  or a letter that is not a
 *   protocol scheme character)
 *
 * It denies any URI starting with a protocol label (word+colon) that is
 * not explicitly http, https, or mailto.
 */
export const ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/**
 * Allowed HTML elements for markdown-rendered content.
 * Deliberately excludes: script, style, iframe, object, embed, form, input, button.
 */
export const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'ul', 'ol', 'li',
  'blockquote', 'pre', 'code',
  'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins',
  'a',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'div', 'span',
  'img',
] as const;

/**
 * Allowed HTML attributes.
 * Excludes all event handler attributes (on*).
 */
export const ALLOWED_ATTR = [
  'href', 'title', 'target', 'rel',
  'src', 'alt', 'width', 'height',
  'class', 'id',
  'style',
] as const;

/**
 * Forbidden event handler attributes (comprehensive list covering OWASP
 * cheat sheet payloads and SVG-specific handlers).
 */
export const FORBIDDEN_ATTR = [
  // Mouse / keyboard / focus
  'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur',
  'onchange', 'oninput', 'onkeydown', 'onkeyup', 'onkeypress',
  'onmousedown', 'onmouseup', 'onmousemove', 'onmouseout',
  'onsubmit', 'onreset', 'onselect', 'onscroll', 'ondblclick',
  'oncontextmenu', 'ondrag', 'ondrop', 'onpaste', 'oncopy', 'oncut',
  // Pointer events
  'onpointerdown', 'onpointerup', 'onpointermove', 'onpointercancel',
  'onpointerover', 'onpointerout', 'onpointerenter', 'onpointerleave',
  // SVG animation events
  'onbegin', 'onend', 'onrepeat',
  // DOM lifecycle
  'ondomcontentloaded', 'onreadystatechange',
] as const;

/**
 * Elements whose content must be stripped entirely (not just the tag).
 * This prevents payloads like `<script>alert(1)</script>` from
 * appearing as text content even after the script tag is removed.
 */
export const FORBIDDEN_CONTENTS = [
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
] as const;

// ── Server-side (Node.js) sanitizer ──────────────────────────────────────────

let _serverPurify: ReturnType<typeof import('dompurify')> | null = null;

/**
 * Lazy-initialize the server-side DOMPurify instance.
 * JSDOM is only imported when this function is called, so this module is
 * safe to import in browser contexts (where JSDOM is not available).
 */
async function getServerPurify(): Promise<ReturnType<typeof import('dompurify')>> {
  if (_serverPurify) return _serverPurify;

  // Dynamic import — not bundled in browser builds.
  const [{ JSDOM }, DOMPurifyFactory] = await Promise.all([
    import('jsdom'),
    import('dompurify'),
  ]);

  const { window: jsdomWindow } = new JSDOM('');
  _serverPurify = (DOMPurifyFactory.default as (win: unknown) => ReturnType<typeof import('dompurify')>)(
    jsdomWindow as unknown
  );
  return _serverPurify;
}

/**
 * Sanitize an HTML string (async, works in both Node.js and browser).
 *
 * Prefer `sanitizeHtmlSync` in browser contexts where DOMPurify is available
 * on the global window. Use this async version in server-side (Node.js)
 * contexts where JSDOM must be initialized.
 *
 * @param html - Raw HTML string (e.g. from a markdown renderer).
 * @returns Safe HTML string with all XSS vectors removed.
 */
export async function sanitizeHtmlAsync(html: string): Promise<string> {
  if (typeof window !== 'undefined') {
    // Browser context — use native DOM.
    return sanitizeHtmlSync(html);
  }

  // Node.js context — use JSDOM-backed DOMPurify.
  const purify = await getServerPurify();
  return purify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTR],
    ALLOWED_URI_REGEXP,
    ADD_ATTR: ['rel'],
    FORBID_ATTR: [...FORBIDDEN_ATTR],
    FORBID_CONTENTS: [...FORBIDDEN_CONTENTS],
    SANITIZE_DOM: true,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  }) as unknown as string;
}

/**
 * Sanitize an HTML string synchronously (browser-only).
 *
 * This function requires `window.DOMPurify` or a pre-loaded DOMPurify
 * instance. In a browser it uses the native DOM parser. In Node.js,
 * call `sanitizeHtmlAsync` instead.
 *
 * @param html - Raw HTML string.
 * @returns Safe HTML string.
 */
export function sanitizeHtmlSync(html: string): string {
  if (typeof window === 'undefined') {
    throw new Error(
      'sanitizeHtmlSync requires a browser DOM. Use sanitizeHtmlAsync in Node.js.',
    );
  }

  // DOMPurify must be available on the global scope in browser contexts.
  // It is loaded as a static import in any consuming bundle.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const DOMPurify = (globalThis as any).DOMPurify;
  if (!DOMPurify) {
    throw new Error('DOMPurify is not available on globalThis. Import it first.');
  }

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTR],
    ALLOWED_URI_REGEXP,
    ADD_ATTR: ['rel'],
    FORBID_ATTR: [...FORBIDDEN_ATTR],
    FORBID_CONTENTS: [...FORBIDDEN_CONTENTS],
    SANITIZE_DOM: true,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  }) as string;
}

/**
 * Check whether a URI is safe according to the platform allowlist.
 *
 * Useful for validating href/src attributes before inserting them into the DOM
 * without going through a full sanitization pass.
 *
 * @param uri - The URI string to validate.
 * @returns `true` if the URI matches the allowlist, `false` otherwise.
 */
export function isSafeUri(uri: string): boolean {
  return ALLOWED_URI_REGEXP.test(uri.trim());
}
