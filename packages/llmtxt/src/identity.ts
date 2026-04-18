/**
 * @deprecated Import from `llmtxt/identity` subpath instead.
 *
 * This file is kept for backward compatibility only. All implementation has
 * moved to `packages/llmtxt/src/identity/agent-identity.ts` (T647 / T650).
 * The public `llmtxt` root export still re-exports from here, which in turn
 * re-exports from the canonical subpath.
 */

// Re-export everything from the canonical identity subpath implementation.
export {
  AgentIdentity,
  bodyHashHex,
  buildCanonicalPayload,
  randomNonceHex,
  createIdentity,
  loadIdentity,
  identityFromSeed,
  signRequest,
  verifySignature,
} from './identity/agent-identity.js';

export type {
  SignatureHeaders,
  CanonicalPayloadOptions,
} from './identity/agent-identity.js';

// End of file — all implementation is in packages/llmtxt/src/identity/agent-identity.ts
