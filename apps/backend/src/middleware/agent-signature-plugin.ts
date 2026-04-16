/**
 * Agent signature plugin — wires verifyAgentSignature into write routes
 * and attaches receipt data to responses. (T221)
 *
 * Acceptance criteria:
 *   1. verifyAgentSignature middleware registered on POST versions, PATCH lifecycle,
 *      POST approvals, PATCH sections, PUT document routes.
 *   2. Every write response includes receipt: {agent_id, pubkey_fingerprint,
 *      payload_hash, server_timestamp, signature_verified}.
 *   3. Unsigned writes return receipt.signature_verified: false and are not rejected.
 *   4. Signed writes return receipt.signature_verified: true.
 *
 * Implementation: uses Fastify onRequest and onSend hooks scoped to write routes.
 */
import type { FastifyInstance } from 'fastify';
import { hashContent } from 'llmtxt';
import { verifyAgentSignature, buildReceipt } from './verify-agent-signature.js';

/** URL patterns for the 5 write routes that require signature middleware. */
const WRITE_ROUTE_PATTERNS: Array<{ method: string; pathPattern: RegExp }> = [
  // PUT /api/(v1/)?documents/:slug  — create version (T221 "PUT document routes")
  { method: 'PUT', pathPattern: /\/documents\/[^/]+$/ },
  // POST /api/(v1/)?compress  — create document (T221 "POST versions" ~ document creation)
  { method: 'POST', pathPattern: /\/compress$/ },
  // POST /api/(v1/)?documents/:slug/transition  — lifecycle (T221 "PATCH lifecycle")
  { method: 'POST', pathPattern: /\/documents\/[^/]+\/transition$/ },
  // POST /api/(v1/)?documents/:slug/approve  — approvals (T221 "POST approvals")
  { method: 'POST', pathPattern: /\/documents\/[^/]+\/approve$/ },
  // POST /api/(v1/)?documents/:slug/reject  — rejections (T221 "POST approvals")
  { method: 'POST', pathPattern: /\/documents\/[^/]+\/reject$/ },
  // POST /api/(v1/)?documents/:slug/patch  — sections (T221 "PATCH sections")
  { method: 'POST', pathPattern: /\/documents\/[^/]+\/patch$/ },
  // POST /api/(v1/)?documents  — create new document (document creation)
  { method: 'POST', pathPattern: /\/documents$/ },
  // POST /api/(v1/)?documents/:slug/versions  — explicit version creation
  { method: 'POST', pathPattern: /\/documents\/[^/]+\/versions$/ },
];

/** Check if a request's method + URL matches our write route patterns. */
function isWriteRoute(method: string, url: string): boolean {
  // Strip query string for matching
  const path = url.split('?')[0];
  return WRITE_ROUTE_PATTERNS.some(
    (p) => p.method === method && p.pathPattern.test(path)
  );
}

/**
 * Register the agent signature plugin as a Fastify plugin.
 *
 * Adds:
 * - onRequest hook: calls verifyAgentSignature for write routes
 * - onSend hook: injects receipt into JSON responses for write routes
 */
export async function agentSignaturePlugin(fastify: FastifyInstance): Promise<void> {
  // onRequest hook: verify agent signature for write routes
  fastify.addHook('onRequest', async (request, reply) => {
    if (!isWriteRoute(request.method, request.url)) {
      return;
    }
    await verifyAgentSignature(request, reply);
  });

  // onSend hook: inject receipt into 200/201 JSON responses
  fastify.addHook('onSend', async (request, reply, payload) => {
    // Only instrument write routes that returned a success status
    const status = reply.statusCode;
    if (!isWriteRoute(request.method, request.url)) {
      return payload;
    }
    if (status < 200 || status >= 300) {
      return payload;
    }

    // Only inject into JSON responses
    const ct = reply.getHeader('content-type') as string | undefined;
    if (!ct?.includes('application/json')) {
      return payload;
    }

    // Parse the current payload
    let body: Record<string, unknown>;
    try {
      body = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return payload;
      }
    } catch {
      return payload;
    }

    // Compute payload hash for the receipt (WASM Rust SHA-256 per SSOT.md)
    const canonicalPayload = request._canonicalPayload ?? '';
    const payloadHash = hashContent(canonicalPayload);

    // Build receipt
    const receipt = buildReceipt({
      agentId: request.agentPubkeyId ?? null,
      pubkeyFingerprint: request.agentFingerprint ?? null,
      payloadHash,
      serverTimestamp: Date.now(),
      signatureVerified: request.signatureVerified ?? false,
    });

    // Attach receipt to response
    body.receipt = receipt;
    return JSON.stringify(body);
  });
}
