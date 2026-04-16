/**
 * Path matcher utility — T293.
 *
 * Converts URL patterns with :param and * wildcards into regular expressions
 * for matching and parameter extraction.
 *
 * Pattern syntax:
 *   :param  — matches a single path segment, captured as a named group.
 *   *       — matches a single path segment (no capture group).
 *   Literal characters are matched literally (with dot-escaping).
 *
 * Examples:
 *   matchPath('/docs/:slug', '/docs/abc')          → true
 *   matchPath('/docs/*', '/docs/abc')              → true
 *   matchPath('/docs/*', '/docs/abc/xyz')          → false (multi-segment)
 *   extractParams('/docs/:slug', '/docs/abc')      → { slug: 'abc' }
 */

// ── Internal regex builder ────────────────────────────────────────────────────

/**
 * Compile a pattern string into a RegExp.
 * Trailing slashes are stripped from both pattern and path before matching.
 */
function buildRegex(pattern: string): { regex: RegExp; paramNames: string[] } {
  // Strip trailing slash, then strip leading slash for segment processing
  const normalised = pattern.replace(/\/$/, '').replace(/^\//, '');

  const paramNames: string[] = [];

  // Split on '/' — first element will be the first real segment
  const regexStr = normalised
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        // Named parameter: capture a single non-slash segment
        const name = segment.slice(1);
        paramNames.push(name);
        return `(?<${name}>[^/]+)`;
      } else if (segment === '*') {
        // Wildcard: match a single non-slash segment (no capture)
        return '[^/]+';
      } else {
        // Literal: escape regex metacharacters
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
    })
    .join('\\/');

  // Anchor to full path (leading / is literal in the path)
  const regex = new RegExp(`^\\/` + regexStr + `$`);
  return { regex, paramNames };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Test whether a path matches a pattern.
 *
 * @param pattern  URL pattern with optional :param and * placeholders.
 * @param path     The actual URL path to test.
 * @returns        true if the path matches the pattern.
 */
export function matchPath(pattern: string, path: string): boolean {
  // Normalise: strip trailing slashes, ensure leading slash
  const normPath = (path.startsWith('/') ? path : `/${path}`).replace(/\/$/, '');
  const { regex } = buildRegex(pattern);
  return regex.test(normPath);
}

/**
 * Extract named parameters from a path according to a pattern.
 *
 * @param pattern  URL pattern with :param placeholders.
 * @param path     The actual URL path.
 * @returns        Object mapping parameter names to captured values.
 *                 Empty object if no parameters or no match.
 */
export function extractParams(pattern: string, path: string): Record<string, string> {
  const normPath = (path.startsWith('/') ? path : `/${path}`).replace(/\/$/, '');
  const { regex } = buildRegex(pattern);
  const match = regex.exec(normPath);
  if (!match || !match.groups) return {};

  return Object.fromEntries(
    Object.entries(match.groups).filter(([, v]) => v !== undefined)
  ) as Record<string, string>;
}
