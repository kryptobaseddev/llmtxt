/**
 * SvelteKit route parameter matcher for document format extensions.
 *
 * Matches the extension segment in routes like /doc/:slug.txt, /doc/:slug.json,
 * /doc/:slug.md — these override content negotiation and return the format
 * directly without requiring JS execution.
 *
 * @see https://kit.svelte.dev/docs/advanced-routing#matching
 */

/** Supported document format extensions. */
const SUPPORTED = new Set(['txt', 'json', 'md']);

/**
 * Returns true if the parameter value is a supported format extension.
 *
 * @param param - The URL segment to test (e.g. "txt", "json", "md").
 * @returns Whether the segment is a recognised format extension.
 */
export function match(param: string): boolean {
  return SUPPORTED.has(param);
}
