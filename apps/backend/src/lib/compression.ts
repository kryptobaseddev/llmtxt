/**
 * HTTP compression negotiation helpers.
 *
 * Centralises the `@fastify/compress` registration options so that
 * both `index.ts` (production) and `app.ts` (integration tests) use
 * the same codec preference order.
 *
 * ### Codec preference order (T753 — zstd migration)
 *
 * 1. **zstd** — preferred when the client sends `Accept-Encoding: zstd`.
 *    Available natively on Node ≥ 22 via `zlib.createZstdCompress`.
 * 2. **br** (Brotli) — high-ratio for HTTP text responses.
 * 3. **gzip** — universal fallback.
 * 4. **deflate** — legacy fallback.
 * 5. **identity** — uncompressed pass-through.
 *
 * The `encodings` array controls both the preference order and which
 * codecs are offered. Clients that do not advertise `zstd` in their
 * `Accept-Encoding` header receive the next best match automatically
 * via `@fastify/accept-negotiator`.
 *
 * T753 — Backend Accept-Encoding negotiation for zstd.
 */

import type { FastifyCompressOptions } from '@fastify/compress';

/**
 * Ordered list of HTTP response encodings offered by the server.
 *
 * zstd is first so it wins when the client sends `Accept-Encoding: zstd`.
 * Ordering follows `@fastify/compress` docs: first = highest priority.
 */
export const COMPRESS_ENCODINGS: FastifyCompressOptions['encodings'] = [
  'zstd',
  'br',
  'gzip',
  'deflate',
  'identity',
];

/**
 * Options passed to `app.register(compress, compressOptions)`.
 *
 * - `encodings`: ordered by priority; zstd first.
 * - `threshold`: only compress responses ≥ 1 KB (avoids overhead on tiny payloads).
 * - `customTypes`: extend compressible MIME types to include `application/octet-stream`
 *   (used for CRDT snapshots and blob uploads).
 */
export const compressOptions: FastifyCompressOptions = {
  encodings: COMPRESS_ENCODINGS,
  threshold: 1024,
  customTypes: /^text\/|^application\/(json|javascript|octet-stream|wasm|xml)/,
};
