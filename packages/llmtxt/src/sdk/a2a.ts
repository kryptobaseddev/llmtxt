/**
 * A2A (Agent-to-Agent) SDK helpers — W3/T292, T303.
 *
 * A2AMessage class and builder API for creating, signing, and verifying
 * agent-to-agent message envelopes. Supports both scratchpad transport
 * (T153) and HTTP inbox transport (T154).
 *
 * Usage:
 * ```ts
 * const identity = await AgentIdentity.generate();
 *
 * // Build and sign
 * const msg = await buildA2AMessage({
 *   from: 'agent-alice',
 *   to: 'agent-bob',
 *   payload: { action: 'ping' },
 *   identity,
 * });
 *
 * // Send via inbox
 * await sendToInbox(baseUrl, 'agent-bob', msg, { Authorization: 'Bearer ...' });
 *
 * // Receive direct messages
 * const stop = onDirectMessage(baseUrl, 'agent-bob', (msg) => {
 *   console.log('Got message from', msg.from);
 * }, { Authorization: 'Bearer ...' });
 * ```
 */

import type { AgentIdentity } from '../identity.js';

// ── Types ─────────────────────────────────────────────────────────

/** Canonical A2A message envelope (matches crates/llmtxt-core/src/a2a.rs). */
export interface A2AEnvelope {
  from: string;
  to: string;
  nonce: string;
  timestamp_ms: number;
  signature: string;
  content_type: string;
  /** Base64-encoded payload bytes. */
  payload: string;
}

/** Options for building an A2A message. */
export interface BuildA2AOptions {
  from: string;
  to: string;
  payload: unknown;
  contentType?: string;
  identity: AgentIdentity;
  nowMs?: number;
  nonce?: string;
}

/** Response from POST /agents/:id/inbox. */
export interface InboxDeliveryResponse {
  delivered: boolean;
  to: string;
  from: string;
  nonce: string;
  sig_verified: boolean;
  expires_at: number;
}

/** Message in agent inbox response. */
export interface InboxMessage {
  id: string;
  from: string;
  to: string;
  envelope: A2AEnvelope;
  received_at: number;
  expires_at: number;
  read: boolean;
}

/** Response from GET /agents/:id/inbox. */
export interface InboxPollResponse {
  messages: InboxMessage[];
  count: number;
}

// ── Helpers ───────────────────────────────────────────────────────

/** Generate 16 random bytes as lowercase hex. */
function randomNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Encode bytes as base64. */
function encodeBase64(bytes: Uint8Array): string {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    out += CHARS[b0 >> 2];
    out += CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? CHARS[((b1 & 0xf) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? CHARS[b2 & 0x3f] : '=';
  }
  return out;
}

/** SHA-256 hash as lowercase hex. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build canonical bytes for an A2A message (matches Rust implementation).
 *
 * Format: `from\nto\nnonce\ntimestamp_ms\ncontent_type\npayload_hash_hex`
 */
async function buildCanonicalBytes(env: Omit<A2AEnvelope, 'signature'>): Promise<Uint8Array> {
  const payloadBytes = Uint8Array.from(atob(env.payload), (c) => c.charCodeAt(0));
  const payloadHash = await sha256Hex(payloadBytes);
  const s = [env.from, env.to, env.nonce, env.timestamp_ms, env.content_type, payloadHash].join(
    '\n'
  );
  return new TextEncoder().encode(s);
}

// ── A2AMessage class ─────────────────────────────────────────────

/**
 * Signed A2A message envelope with builder API.
 *
 * Construct via {@link buildA2AMessage} factory.
 */
export class A2AMessage {
  readonly envelope: A2AEnvelope;

  constructor(envelope: A2AEnvelope) {
    this.envelope = envelope;
  }

  get from(): string {
    return this.envelope.from;
  }
  get to(): string {
    return this.envelope.to;
  }
  get nonce(): string {
    return this.envelope.nonce;
  }
  get timestamp(): number {
    return this.envelope.timestamp_ms;
  }
  get contentType(): string {
    return this.envelope.content_type;
  }
  get signature(): string {
    return this.envelope.signature;
  }

  /** Decoded payload (parsed as JSON if content_type is application/json). */
  get payload(): unknown {
    const bytes = Uint8Array.from(atob(this.envelope.payload), (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    if (this.envelope.content_type === 'application/json') {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  }

  /** Verify this message's signature against a public key (32-byte hex or Uint8Array). */
  async verify(pubkeyHexOrBytes: string | Uint8Array): Promise<boolean> {
    const canonical = await buildCanonicalBytes(this.envelope);
    let pk: Uint8Array;
    if (typeof pubkeyHexOrBytes === 'string') {
      pk = new Uint8Array(
        pubkeyHexOrBytes.match(/.{2}/g)!.map((h) => parseInt(h, 16))
      );
    } else {
      pk = pubkeyHexOrBytes;
    }

    try {
      const ed = await import('@noble/ed25519');
      const sigBytes = new Uint8Array(
        this.envelope.signature.match(/.{2}/g)!.map((h) => parseInt(h, 16))
      );
      return await ed.verifyAsync(sigBytes, canonical, pk);
    } catch {
      return false;
    }
  }

  /** Serialize to JSON string. */
  toJSON(): string {
    return JSON.stringify(this.envelope);
  }
}

// ── Factory ───────────────────────────────────────────────────────

/**
 * Build and sign an A2A message.
 *
 * The payload is JSON-serialized and base64-encoded. The signature
 * covers the canonical bytes (matches Rust A2AMessage::canonical_bytes()).
 */
export async function buildA2AMessage(opts: BuildA2AOptions): Promise<A2AMessage> {
  const now = opts.nowMs ?? Date.now();
  const nonce = opts.nonce ?? randomNonce();
  const contentType = opts.contentType ?? 'application/json';

  const payloadStr =
    contentType === 'application/json'
      ? JSON.stringify(opts.payload)
      : String(opts.payload);
  const payloadBytes = new TextEncoder().encode(payloadStr);
  const payloadB64 = encodeBase64(payloadBytes);

  const partial: Omit<A2AEnvelope, 'signature'> = {
    from: opts.from,
    to: opts.to,
    nonce,
    timestamp_ms: now,
    content_type: contentType,
    payload: payloadB64,
  };

  const canonical = await buildCanonicalBytes(partial);
  const sig = await opts.identity.sign(canonical);
  const sigHex = Array.from(sig)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return new A2AMessage({ ...partial, signature: sigHex });
}

// ── Transport ─────────────────────────────────────────────────────

/**
 * Send an A2A message to an agent's HTTP inbox.
 *
 * @param baseUrl   - API base URL (e.g. "https://api.llmtxt.my/api/v1")
 * @param toAgentId - Recipient agent identifier
 * @param msg       - Signed A2A message
 * @param headers   - Optional extra headers (e.g. Authorization)
 */
export async function sendToInbox(
  baseUrl: string,
  toAgentId: string,
  msg: A2AMessage,
  headers: Record<string, string> = {}
): Promise<InboxDeliveryResponse> {
  const url = `${baseUrl}/agents/${toAgentId}/inbox`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ envelope: msg.envelope }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(
      `sendToInbox failed (${res.status}): ${(err as { message?: string }).message ?? res.statusText}`
    );
  }

  return res.json() as Promise<InboxDeliveryResponse>;
}

/**
 * Poll an agent's inbox for messages.
 *
 * @param baseUrl   - API base URL
 * @param agentId   - Recipient agent identifier
 * @param opts      - Poll options
 * @param headers   - Auth headers required
 */
export async function pollInbox(
  baseUrl: string,
  agentId: string,
  opts: { since?: number; limit?: number; unreadOnly?: boolean } = {},
  headers: Record<string, string> = {}
): Promise<InboxPollResponse> {
  const params = new URLSearchParams();
  if (opts.since !== undefined) params.set('since', String(opts.since));
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.unreadOnly) params.set('unread_only', 'true');

  const url = `${baseUrl}/agents/${agentId}/inbox?${params.toString()}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`pollInbox failed (${res.status})`);
  return res.json() as Promise<InboxPollResponse>;
}

/**
 * Subscribe to direct messages via polling loop.
 *
 * Polls every `pollIntervalMs` milliseconds (default 5000ms).
 * Returns a `stop()` function.
 */
export function onDirectMessage(
  baseUrl: string,
  agentId: string,
  onMessage: (msg: InboxMessage) => void,
  headers: Record<string, string> = {},
  pollIntervalMs = 5_000
): () => void {
  let stopped = false;
  let lastSince = Date.now() - 60_000; // Start 1 min back

  async function poll() {
    if (stopped) return;
    try {
      const result = await pollInbox(baseUrl, agentId, { since: lastSince, unreadOnly: true }, headers);
      for (const msg of result.messages) {
        onMessage(msg);
        if (msg.received_at > lastSince) {
          lastSince = msg.received_at;
        }
      }
    } catch {
      // Non-fatal — next poll will retry
    }
    if (!stopped) {
      setTimeout(poll, pollIntervalMs);
    }
  }

  poll();

  return () => {
    stopped = true;
  };
}
