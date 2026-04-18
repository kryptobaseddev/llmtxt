/**
 * llmtxt/identity — Agent identity primitives subpath
 *
 * Canonical subpath for Ed25519 agent identity: key generation, signing,
 * verification, canonical payload construction, and signature header building.
 *
 * All cryptographic operations are backed by @noble/ed25519 v3. The
 * sign/verify primitives in `crates/llmtxt-core/src/identity.rs` are the
 * SSoT for the algorithm; this module wraps the JS implementation that is
 * compatible with those Rust-produced and Rust-verified signatures.
 *
 * # API
 *
 * ## Factory functions
 * - `createIdentity()` — generate a fresh keypair (persists to disk/browser)
 * - `loadIdentity()` — restore from persisted keypair (returns null if none)
 * - `identityFromSeed(seed)` — construct from a 32-byte seed (testing / CLI)
 *
 * ## Request signing
 * - `signRequest(identity, method, path, body, agentId, nowMs?, nonce?)` — build X-Agent-* headers
 *
 * ## Verification
 * - `verifySignature(payload, sigHex, pubkeyHex)` — verify an Ed25519 signature
 *
 * ## Utilities
 * - `buildCanonicalPayload(opts)` — deterministic payload bytes (method+path+ts+nonce+bodyhash)
 * - `bodyHashHex(body)` — SHA-256 body hash as lowercase hex
 * - `randomNonceHex()` — 16 cryptographically-random bytes as hex
 *
 * ## Types
 * - `AgentIdentity` — class: keypair holder + signing methods
 * - `SignatureHeaders` — shape of X-Agent-* HTTP headers
 * - `CanonicalPayloadOptions` — input type for `buildCanonicalPayload`
 *
 * # Canonical payload format (matches Rust SSoT)
 *
 * ```
 * METHOD\nPATH_AND_QUERY\nTIMESTAMP_MS\nAGENT_ID\nNONCE_HEX\nBODY_HASH_HEX
 * ```
 *
 * All fields separated by a single newline. `BODY_HASH_HEX` is lowercase hex
 * of `SHA-256(body_utf8_bytes)`. This format is identical to the Rust
 * `canonical_payload()` function in `crates/llmtxt-core/src/identity.rs`.
 *
 * # Security properties
 * - Ed25519 signatures bind the request identity to exact canonical payload bytes.
 * - Nonce is caller-supplied (random, ≥ 16 bytes) and MUST be unique per agent
 *   within the 5-minute timestamp window enforced by the backend middleware.
 * - Timestamps outside `[now − 5 min, now + 1 min]` are rejected by the backend.
 *
 * @module llmtxt/identity
 */

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
} from './agent-identity.js';

export type {
  SignatureHeaders,
  CanonicalPayloadOptions,
} from './agent-identity.js';
