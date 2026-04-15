/**
 * API versioning middleware for Fastify.
 *
 * Version resolution priority:
 *   1. URL path prefix:      /api/v1/documents/:slug
 *   2. Accept header:        Accept: application/vnd.llmtxt.v1+json
 *   3. Custom header:        X-API-Version: 1
 *   4. Default:              latest version (v1)
 *
 * Version registry is defined in packages/llmtxt/src/types.ts (SDK single source of truth).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  API_VERSION_REGISTRY,
  CURRENT_API_VERSION,
  LATEST_API_VERSION,
  type ApiVersionInfo,
} from 'llmtxt';

export { API_VERSION_REGISTRY, CURRENT_API_VERSION, LATEST_API_VERSION };
export type { ApiVersionInfo };

// ─────────────────────────────────────────────────────────────────────────────
// Fastify module augmentation
// ─────────────────────────────────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Resolved API version context for this request.
     * Present on every request after the apiVersion plugin is registered.
     */
    apiVersion: ApiVersionInfo | null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Version parsing helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract version number from an Accept header value, e.g.
 * "application/vnd.llmtxt.v2+json" → 2
 */
function parseAcceptHeaderVersion(accept: string): number | null {
  const match = /application\/vnd\.llmtxt\.v(\d+)\+json/.exec(accept);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return isNaN(n) ? null : n;
}

/**
 * Extract version number from the X-API-Version header value.
 */
function parseCustomHeaderVersion(value: string): number | null {
  const n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

/**
 * Resolve the version from the request.
 * URL path prefix takes precedence and is handled by route registration;
 * this function handles Accept and X-API-Version headers.
 */
export function resolveRequestVersion(request: FastifyRequest): ApiVersionInfo {
  // Check Accept header
  const accept = request.headers['accept'];
  if (accept) {
    const v = parseAcceptHeaderVersion(accept);
    if (v !== null && API_VERSION_REGISTRY[v]) {
      return API_VERSION_REGISTRY[v];
    }
  }

  // Check X-API-Version header
  const customHeader = request.headers['x-api-version'];
  if (customHeader) {
    const v = parseCustomHeaderVersion(String(customHeader));
    if (v !== null && API_VERSION_REGISTRY[v]) {
      return API_VERSION_REGISTRY[v];
    }
  }

  // Default to current version
  return API_VERSION_REGISTRY[CURRENT_API_VERSION];
}

// ─────────────────────────────────────────────────────────────────────────────
// Response header helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attach standard API version response headers to every reply.
 *
 *   X-API-Version:        <served version>
 *   X-API-Latest-Version: <latest available version>
 */
export function addVersionResponseHeaders(
  reply: FastifyReply,
  versionInfo: ApiVersionInfo,
): void {
  reply.header('X-API-Version', String(versionInfo.version));
  reply.header('X-API-Latest-Version', String(LATEST_API_VERSION));
}

/**
 * Attach RFC 8594 deprecation headers when serving a deprecated (or
 * unversioned-legacy) endpoint.
 *
 *   Deprecation: true
 *   Sunset:      <ISO date>
 *   Link:        </api/v<N><path>>; rel="successor-version"
 */
export function addDeprecationHeaders(
  reply: FastifyReply,
  requestUrl: string,
  versionInfo: ApiVersionInfo,
): void {
  reply.header('Deprecation', 'true');
  if (versionInfo.sunset) {
    reply.header('Sunset', versionInfo.sunset);
  }

  // Build the successor-version Link header pointing at the versioned path.
  // Strip the /api prefix so we can reconstruct a /api/v1/... path.
  const pathAfterApi = requestUrl.replace(/^\/api/, '') || '/';
  const link = `</api/v${CURRENT_API_VERSION}${pathAfterApi}>; rel="successor-version"`;
  reply.header('Link', link);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fastify plugin — version context on all requests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register this plugin globally so that `request.apiVersion` is always
 * populated, even for requests that are served from legacy /api/* routes.
 */
export async function apiVersionPlugin(app: FastifyInstance): Promise<void> {
  // Decorate request with the default (current) version.
  // Fastify 5 requires the default value type to match the declared property type.
  // Scoped route hooks (onRequest in v1Routes / legacyScope) overwrite this
  // value with their specific version context before any handler runs.
  app.decorateRequest('apiVersion', null);

  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    // Resolve from Accept / X-API-Version headers only when the value has not
    // already been overridden by a scoped route's own onRequest hook.
    // Because Fastify executes global hooks before scoped ones, we cannot rely
    // on the scoped hook having run yet here — so we set a safe header-based
    // resolution and let the scoped hooks overwrite it if needed.
    request.apiVersion = resolveRequestVersion(request);
  });
}
