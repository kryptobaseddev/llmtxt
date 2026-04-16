/**
 * AgentIdentity — Ed25519 keypair management for LLMtxt agent signing.
 *
 * Backed by @noble/ed25519 v2 (pure JS, no native deps).
 *
 * ## Usage
 * ```ts
 * // Generate once and register the public key with the server:
 * const identity = await AgentIdentity.generate();
 * const agentId = 'my-agent-v1';
 * // POST /api/v1/agents/keys  { agent_id: agentId, pubkey_hex: identity.pubkeyHex, label: 'prod' }
 *
 * // On subsequent requests, attach headers:
 * const headers = identity.buildSignatureHeaders('PUT', '/api/v1/documents/abc', body, agentId);
 * ```
 *
 * ## Storage
 * - Node.js: `~/.llmtxt/identity.key` (mode 0o600)
 * - Browser: `localStorage['llmtxt_identity_sk']`
 *
 * WARNING: The private key is sensitive. Never log it, never transmit it.
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

// Noble ed25519 v3 requires setting the hash function for sync methods in Node.js:
// https://github.com/paulmillr/noble-ed25519#usage
// We only use async methods so this is defensive for environments that don't
// have WebCrypto SHA-512.
ed.hashes.sha512 = sha512;

// ── Types ─────────────────────────────────────────────────────────

/** HTTP headers produced by {@link AgentIdentity.buildSignatureHeaders}. */
export interface SignatureHeaders {
  /** Agent identifier used to look up the registered public key. */
  'X-Agent-Pubkey-Id': string;
  /** Hex-encoded 64-byte Ed25519 signature. */
  'X-Agent-Signature': string;
  /** Hex-encoded random nonce (16 bytes = 32 hex chars). */
  'X-Agent-Nonce': string;
  /** Milliseconds since epoch (as a decimal string). */
  'X-Agent-Timestamp': string;
}

/** Canonical payload used by both client (signing) and server (verification). */
export interface CanonicalPayloadOptions {
  method: string;
  path: string;
  timestampMs: number;
  agentId: string;
  nonceHex: string;
  bodyHashHex: string;
}

// ── Helpers ───────────────────────────────────────────────────────

/** SHA-256 body hash returned as lowercase hex. */
export async function bodyHashHex(body: Uint8Array | string): Promise<string> {
  const str = typeof body === 'string' ? body : new TextDecoder().decode(body);
  // Match what the server computes: hashContent(body.toString('utf8'))
  // = SHA-256 of the UTF-8 encoding of the body string.
  const bytes = new TextEncoder().encode(str);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Build the canonical payload string (UTF-8 bytes). */
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

/** Generate 16 random bytes as lowercase hex. */
export function randomNonceHex(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Encode bytes as lowercase hex. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Decode a hex string to bytes. */
function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('invalid hex length');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ── Persistence ───────────────────────────────────────────────────

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
  // Verify we can chmod — on some systems writeFile with mode doesn't stick
  try {
    await fs.chmod(file, constants.S_IRUSR | constants.S_IWUSR);
  } catch {
    // Best-effort chmod; warn but don't throw.
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

// ── AgentIdentity class ───────────────────────────────────────────

/**
 * Ed25519 agent identity — keypair management, signing, and header generation.
 *
 * WARNING: The private key (`sk`) is security-sensitive. Never log or expose it.
 */
export class AgentIdentity {
  /** 32-byte private key (Ed25519 seed). */
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
   * Generate a fresh Ed25519 keypair and persist it to disk/localStorage.
   *
   * WARNING: The private key is stored to `~/.llmtxt/identity.key` (0o600).
   * Keep this file secret.
   */
  static async generate(): Promise<AgentIdentity> {
    // v3: ed.utils.randomSecretKey() or ed.keygenAsync()
    const sk = ed.utils.randomSecretKey();
    const pk = await ed.getPublicKeyAsync(sk);
    await persistKey(sk, pk);
    return new AgentIdentity(sk, pk);
  }

  /**
   * Restore an identity from the persisted private key seed.
   *
   * Returns null if no persisted key exists.
   */
  static async load(): Promise<AgentIdentity | null> {
    const stored = await loadPersistedKey();
    if (!stored) return null;
    const sk = fromHex(stored.sk);
    const pk = fromHex(stored.pk);
    return new AgentIdentity(sk, pk);
  }

  /**
   * Create an identity from a 32-byte private key seed.
   * Does NOT persist. Useful for testing.
   */
  static async fromSeed(seed: Uint8Array): Promise<AgentIdentity> {
    const pk = await ed.getPublicKeyAsync(seed);
    return new AgentIdentity(seed, pk);
  }

  /**
   * Sign arbitrary bytes with the private key.
   *
   * Returns the 64-byte raw signature.
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
   * Build the signature headers for a mutating HTTP request.
   *
   * @param method  - HTTP method (e.g. `"PUT"`)
   * @param path    - Path and query (e.g. `"/api/v1/documents/abc"`)
   * @param body    - Raw request body as string or bytes (use `""` for empty)
   * @param agentId - The `agent_id` registered on the server for this key
   * @param nowMs   - Override for timestamp (default: Date.now())
   * @param nonce   - Override for nonce hex (default: 16 random bytes)
   */
  async buildSignatureHeaders(
    method: string,
    path: string,
    body: string | Uint8Array,
    agentId: string,
    nowMs?: number,
    nonce?: string
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
