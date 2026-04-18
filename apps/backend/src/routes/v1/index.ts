/**
 * V1 route aggregator.
 *
 * Registers every current route module under the /api/v1 prefix.
 * V1 is exactly the current API — no behaviour changes.
 *
 * When a future v2 is introduced, create src/routes/v2/index.ts alongside
 * this file and register it at /api/v2 in index.ts.
 */
import type { FastifyInstance } from 'fastify';
import { apiRoutes } from '../api.js';
import { disclosureRoutes } from '../disclosure.js';
import { versionRoutes } from '../versions.js';
import { authRoutes } from '../auth.js';
import { lifecycleRoutes } from '../lifecycle.js';
import { patchRoutes } from '../patches.js';
import { similarityRoutes } from '../similarity.js';
import { graphRoutes } from '../graph.js';
import { retrievalRoutes } from '../retrieval.js';
import { signedUrlRoutes } from '../signed-urls.js';
import { mergeRoutes } from '../merge.js';
import { apiKeyRoutes } from '../api-keys.js';
import { auditLogRoutes } from '../../middleware/audit.js';
import { conflictRoutes } from '../conflicts.js';
import { accessControlRoutes } from '../access-control.js';
import { organizationRoutes } from '../organizations.js';
import { semanticRoutes } from '../semantic.js';
import { crossDocRoutes } from '../cross-doc.js';
import { collectionRoutes } from '../collections.js';
import { webhookRoutes } from '../webhooks.js';
import { documentEventRoutes } from '../document-events.js';
import { agentKeyRoutes } from '../agent-keys.js';
import { crdtRoutes } from '../crdt.js';
import { presenceRoutes } from '../presence.js';
import { leaseRoutes } from '../leases.js';
import { subscribeRoutes } from '../subscribe.js';
import { bftRoutes } from '../bft.js';
import { scratchpadRoutes } from '../scratchpad.js';
import { a2aRoutes } from '../a2a.js';
import { searchRoutes } from '../search.js';
import { exportRoutes } from '../export.js';
import { blobRoutes } from '../blobs.js';
import { auditVerifyRoutes } from '../audit-verify.js';
import {
  API_VERSION_REGISTRY,
  addVersionResponseHeaders,
} from '../../middleware/api-version.js';
import { agentSignaturePlugin } from '../../middleware/agent-signature-plugin.js';

export async function v1Routes(app: FastifyInstance): Promise<void> {
  const versionInfo = API_VERSION_REGISTRY[1];

  // Register agent signature plugin first — scopes onRequest (signature verify)
  // and onSend (X-Server-Receipt + receipt body) hooks to every route in v1.
  // Must be registered before any route module so all handlers inherit the hooks.
  // (T368: registering at root scope put the hooks in a separate Fastify child
  // context that v1 route handlers never entered, so X-Server-Receipt was never set.)
  await app.register(agentSignaturePlugin);

  // Stamp every request entering this scope with v1 context.
  // This runs before any route handler so request.apiVersion is always set.
  app.addHook('onRequest', async (request, _reply) => {
    request.apiVersion = versionInfo;
  });

  // Add standard version headers to every response from this scope.
  // addVersionResponseHeaders sets both X-API-Version and X-API-Latest-Version.
  app.addHook('onSend', async (_request, reply) => {
    addVersionResponseHeaders(reply, versionInfo);
  });

  // Register all route modules — unchanged from current behaviour.
  await app.register(apiRoutes);
  await app.register(disclosureRoutes);
  await app.register(versionRoutes);
  await app.register(authRoutes);
  await app.register(lifecycleRoutes);
  await app.register(patchRoutes);
  await app.register(similarityRoutes);
  await app.register(graphRoutes);
  await app.register(retrievalRoutes);
  await app.register(signedUrlRoutes);
  await app.register(mergeRoutes);
  await app.register(apiKeyRoutes);
  await app.register(auditLogRoutes);
  await app.register(conflictRoutes);
  await app.register(accessControlRoutes);
  await app.register(organizationRoutes);
  await app.register(semanticRoutes);
  await app.register(crossDocRoutes);
  await app.register(collectionRoutes);
  await app.register(webhookRoutes);
  await app.register(documentEventRoutes);
  await app.register(agentKeyRoutes);
  await app.register(crdtRoutes);
  await app.register(presenceRoutes);
  await app.register(leaseRoutes);
  await app.register(subscribeRoutes);
  // W3: Byzantine consensus, scratchpad messaging, A2A inbox
  await app.register(bftRoutes);
  await app.register(scratchpadRoutes);
  await app.register(a2aRoutes);
  // T102/T103: Semantic search + similar-docs
  await app.register(searchRoutes);
  // T427.6: Document export endpoint
  await app.register(exportRoutes);
  // T428.8: Blob attachment endpoints
  await app.register(blobRoutes);
  // T164: Tamper-evident audit log verification
  await app.register(auditVerifyRoutes);
}
