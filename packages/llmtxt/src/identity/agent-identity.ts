/**
 * AgentIdentity implementation — backing module for llmtxt/identity subpath.
 *
 * Backed by @noble/ed25519 v3 (pure JS, no native deps, no WASM required at
 * runtime). The canonical algorithm matches `crates/llmtxt-core/src/identity.rs`
 * which exposes the same operations via WASM for cross-language verification.
 *
 * WARNING: Private keys are security-sensitive. Never log them.
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

// Noble ed25519 v3 requires setting the hash function for sync methods in Node.js.
// We only use async methods but this is defensive for environments without WebCrypto SHA-512.
ed.hashes.sha512 = sha512;

// ── Types ─────────────────────────────────────────────────────────────────────

/** HTTP headers produced by {@link AgentIdentity.buildSignatureHeaders} / {@link signRequest}. */
export interface SignatureHeaders {
  /** Agent identifier used to look up the registered public key on the server. */
  'X-Agent-Pubkey-Id': string;
  /** Hex-encoded 64-byte Ed25519 signature over the canonical payload. */
  'X-Agent-Signature': string;
  /** Hex-encoded random nonce (16 bytes = 32 hex chars). */
  'X-Agent-Nonce': string;
  /** Milliseconds since epoch as a decimal string. */
  'X-Agent-Timestamp': string;
}

/**
 * Options for {@link buildCanonicalPayload}.
 *
 * All fields map directly to the Rust `canonical_payload()` parameters in
 * `crates/llmtxt-core/src/identity.rs`.
 */
export interface CanonicalPayloadOptions {
  /** HTTP method, uppercase (e.g. "PUT"). */
  method: string;
  /** Path and query string (e.g. "/api/v1/documents/abc"). */
  path: string;
  /** Milliseconds since epoch. */
  timestampMs: number;
  /** Agent identifier registered on the server. */
  agentId: string;
  /** Hex-encoded nonce (≥ 16 bytes = ≥ 32 hex chars). */
  nonceHex: string;
  /** Lowercase hex SHA-256 of the request body bytes (64 chars). */
  bodyHashHex: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Encode bytes as lowercase hex. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Decode a hex string to bytes. Throws if length is odd. */
function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('invalid hex length');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ── Persistence helpers ───────────────────────────────────────────────────────

interface PersistedKey {
  sk: string; // hex
  pk: string; // hex
}

async function saveKeyNode(sk: Uint8Array, pk: Uint8Array): Promise<void> {
  const os = await import('node:os');
  const path = await import('node:path');
  const { promises: fs, constants } = await import('node:fs');
  const dir = path.join(os.homedir(), '.llmtxt');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'identity.key');
  const payload: PersistedKey = { sk: toHex(sk), pk: toHex(pk) };
  await fs.writeFile(file, JSON.stringify(payload), { mode: 0o600 });
  try {
    await fs.chmod(file, constants.S_IRUSR | constants.S_IWUSR);
  } catch {
    console.warn('[AgentIdentity] WARNING: could not set 0600 on identity.key');
  }
}

async function loadKeyNode(): Promise<PersistedKey | null> {
  const os = await import('node:os');
  const path = await import('node:path');
  const { promises: fs } = await import('node:fs');
  const file = path.join(os.homedir(), '.llmtxt', 'identity.key');
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw) as PersistedKey;
  } catch {
    return null;
  }
}

async function saveKeyBrowser(sk: Uint8Array, pk: Uint8Array): Promise<void> {
  const payload: PersistedKey = { sk: toHex(sk), pk: toHex(pk) };
  localStorage.setItem('llmtxt_identity_sk', JSON.stringify(payload));
}

function loadKeyBrowser(): PersistedKey | null {
  const raw = localStorage.getItem('llmtxt_identity_sk');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedKey;
  } catch {
    return null;
  }
}

const isBrowser =
  typeof globalThis.window !== 'undefined' &&
  typeof globalThis.localStorage !== 'undefined';

async function persistKey(sk: Uint8Array, pk: Uint8Array): Promise<void> {
  if (isBrowser) {
    await saveKeyBrowser(sk, pk);
  } else {
    await saveKeyNode(sk, pk);
  }
}

async function loadPersistedKey(): Promise<PersistedKey | null> {
  if (isBrowser) {
    return loadKeyBrowser();
  }
  return loadKeyNode();
}

// ── Public utilities ──────────────────────────────────────────────────────────

/**
 * SHA-256 body hash returned as lowercase hex (64 chars).
 *
 * Matches what the backend `computeBodyHash` function computes:
 * `hashContent(body.toString('utf8'))` → SHA-256 of the UTF-8 string.
 * This in turn matches the Rust `identity_body_hash_hex(body)` WASM export.
 */
export async function bodyHashHex(body: Uint8Array | string): Promise<string> {
  const str = typeof body === 'string' ? body : new TextDecoder().decode(body);
  const bytes = new TextEncoder().encode(str);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build the canonical payload bytes (UTF-8 encoded).
 *
 * Format (newline-separated, same as Rust `canonical_payload()`):
 * ```
 * METHOD\nPATH_AND_QUERY\nTIMESTAMP_MS\nAGENT_ID\nNONCE_HEX\nBODY_HASH_HEX
 * ```
 */
export function buildCanonicalPayload(opts: CanonicalPayloadOptions): Uint8Array {
  const s = [
    opts.method.toUpperCase(),
    opts.path,
    String(opts.timestampMs),
    opts.agentId,
    opts.nonceHex,
    opts.bodyHashHex,
  ].join('\n');
  return new TextEncoder().encode(s);
}

/** Generate 16 cryptographically-random bytes as lowercase hex (32 chars). */
export function randomNonceHex(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── AgentIdentity class ───────────────────────────────────────────────────────

/**
 * Ed25519 agent identity — keypair management, signing, and header generation.
 *
 * ## Usage
 * ```ts
 * // Generate once and register the public key:
 * const identity = await AgentIdentity.generate();
 * // POST /api/v1/agents/keys  { agent_id: agentId, pubkey_hex: identity.pubkeyHex }
 *
 * // On subsequent requests, attach headers:
 * const headers = await identity.buildSignatureHeaders('PUT', '/api/v1/documents/abc', body, agentId);
 * ```
 *
 * ## Storage
 * - Node.js: `~/.llmtxt/identity.key` (mode 0o600)
 * - Browser: `localStorage['llmtxt_identity_sk']`
 *
 * WARNING: The private key (`sk`) is security-sensitive. Never log or expose it.
 */
export class AgentIdentity {
  /** 32-byte private key (Ed25519 seed). WARNING: keep secret. */
  readonly sk: Uint8Array;
  /** 32-byte public key (compressed point). */
  readonly pk: Uint8Array;

  private constructor(sk: Uint8Array, pk: Uint8Array) {
    this.sk = sk;
    this.pk = pk;
  }

  /** Lowercase hex of the 32-byte public key (64 chars). */
  get pubkeyHex(): string {
    return toHex(this.pk);
  }

  /**
   * Generate a fresh Ed25519 keypair and persist it.
   *
   * Persists to `~/.llmtxt/identity.key` (Node, 0o600) or
   * `localStorage['llmtxt_identity_sk']` (browser).
   */
  static async generate(): Promise<AgentIdentity> {
    const sk = ed.utils.randomSecretKey();
    const pk = await ed.getPublicKeyAsync(sk);
    await persistKey(sk, pk);
    return new AgentIdentity(sk, pk);
  }

  /**
   * Restore an identity from the persisted private key.
   * Returns `null` if no persisted key exists.
   */
  static async load(): Promise<AgentIdentity | null> {
    const stored = await loadPersistedKey();
    if (!stored) return null;
    const sk = fromHex(stored.sk);
    const pk = fromHex(stored.pk);
    return new AgentIdentity(sk, pk);
  }

  /**
   * Construct from a 32-byte private key seed. Does NOT persist.
   * Useful for tests and CLI scenarios where the seed is provided externally.
   */
  static async fromSeed(seed: Uint8Array): Promise<AgentIdentity> {
    const pk = await ed.getPublicKeyAsync(seed);
    return new AgentIdentity(seed, pk);
  }

  /**
   * Sign arbitrary bytes with the private key.
   * Returns the 64-byte raw Ed25519 signature.
   */
  async sign(message: Uint8Array): Promise<Uint8Array> {
    return ed.signAsync(message, this.sk);
  }

  /**
   * Verify a signature against this identity's public key.
   */
  async verify(message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    try {
      return await ed.verifyAsync(signature, message, this.pk);
    } catch {
      return false;
    }
  }

  /**
   * Build the X-Agent-* signature headers for a mutating HTTP request.
   *
   * @param method  - HTTP method (e.g. `"PUT"`)
   * @param path    - Path and optional query string (e.g. `"/api/v1/documents/abc"`)
   * @param body    - Raw request body as string or bytes (use `""` for empty)
   * @param agentId - The `agent_id` registered on the server for this key
   * @param nowMs   - Timestamp override (default: `Date.now()`)
   * @param nonce   - Nonce hex override (default: 16 random bytes)
   */
  async buildSignatureHeaders(
    method: string,
    path: string,
    body: string | Uint8Array,
    agentId: string,
    nowMs?: number,
    nonce?: string,
  ): Promise<SignatureHeaders> {
    const timestampMs = nowMs ?? Date.now();
    const nonceHex = nonce ?? randomNonceHex();
    const bh = await bodyHashHex(body);
    const payload = buildCanonicalPayload({
      method,
      path,
      timestampMs,
      agentId,
      nonceHex,
      bodyHashHex: bh,
    });
    const sig = await this.sign(payload);
    return {
      'X-Agent-Pubkey-Id': agentId,
      'X-Agent-Signature': toHex(sig),
      'X-Agent-Nonce': nonceHex,
      'X-Agent-Timestamp': String(timestampMs),
    };
  }
}

// ── Convenience factory functions ─────────────────────────────────────────────

/**
 * Generate a fresh `AgentIdentity` and persist it.
 * Convenience wrapper around `AgentIdentity.generate()`.
 */
export async function createIdentity(): Promise<AgentIdentity> {
  return AgentIdentity.generate();
}

/**
 * Load the persisted `AgentIdentity`.
 * Returns `null` if no identity has been persisted yet.
 * Convenience wrapper around `AgentIdentity.load()`.
 */
export async function loadIdentity(): Promise<AgentIdentity | null> {
  return AgentIdentity.load();
}

/**
 * Construct an `AgentIdentity` from a raw 32-byte seed.
 * Does NOT persist. Useful for tests and CLI scenarios.
 * Convenience wrapper around `AgentIdentity.fromSeed()`.
 */
export async function identityFromSeed(seed: Uint8Array): Promise<AgentIdentity> {
  return AgentIdentity.fromSeed(seed);
}

/**
 * Build X-Agent-* signature headers for a mutating HTTP request.
 *
 * Convenience function equivalent to `identity.buildSignatureHeaders(…)`.
 *
 * @param identity - The caller's `AgentIdentity`
 * @param method   - HTTP method (e.g. `"PUT"`)
 * @param path     - Path and optional query (e.g. `"/api/v1/documents/abc"`)
 * @param body     - Request body (string or bytes; use `""` for empty)
 * @param agentId  - The `agent_id` registered on the server
 * @param nowMs    - Timestamp override (default: `Date.now()`)
 * @param nonce    - Nonce override (default: 16 random bytes)
 */
export async function signRequest(
  identity: AgentIdentity,
  method: string,
  path: string,
  body: string | Uint8Array,
  agentId: string,
  nowMs?: number,
  nonce?: string,
): Promise<SignatureHeaders> {
  return identity.buildSignatureHeaders(method, path, body, agentId, nowMs, nonce);
}

/**
 * Verify an Ed25519 signature over the given canonical payload bytes.
 *
 * @param payload   - Canonical payload bytes (from `buildCanonicalPayload`)
 * @param sigHex    - 128-char hex-encoded 64-byte signature
 * @param pubkeyHex - 64-char hex-encoded 32-byte Ed25519 public key
 * @returns `true` if the signature is valid; `false` for any mismatch
 */
export async function verifySignature(
  payload: Uint8Array,
  sigHex: string,
  pubkeyHex: string,
): Promise<boolean> {
  try {
    const sig = fromHex(sigHex);
    const pk = fromHex(pubkeyHex);
    if (sig.length !== 64 || pk.length !== 32) return false;
    return await ed.verifyAsync(sig, payload, pk);
  } catch {
    return false;
  }
}
