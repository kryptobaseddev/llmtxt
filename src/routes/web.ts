// Simple web routes - slug detection utility
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const publicDir = path.join(__dirname, '..', '..', 'public');

/**
 * Check if a URL path looks like a document slug.
 * Slugs are short alphanumeric strings at the root level.
 * Returns the slug if valid, null otherwise.
 */
export function extractSlug(urlPath: string): string | null {
  // Remove leading slash and query string
  const pathOnly = urlPath.split('?')[0].replace(/^\//, '').replace(/\/$/, '');

  // Must be a single root-level segment (no nested paths)
  if (pathOnly.includes('/')) {
    return null;
  }

  const segment = pathOnly;

  // Not a slug if:
  // - empty
  // - contains a dot (file extension, e.g., index.html, llms.txt)
  // - starts with "api"
  // - is too long (slugs are short IDs)
  if (
    !segment ||
    segment.includes('.') ||
    segment.startsWith('api') ||
    segment.length > 20
  ) {
    return null;
  }

  // Must be alphanumeric (base62-like)
  if (!/^[a-zA-Z0-9]+$/.test(segment)) {
    return null;
  }

  return segment;
}
