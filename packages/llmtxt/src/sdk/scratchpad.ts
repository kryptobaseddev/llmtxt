/**
 * Scratchpad SDK helpers — W3/T286.
 *
 * sendScratchpad() — publish a message to a document's scratchpad.
 * onScratchpadMessage() — subscribe to live scratchpad messages via SSE.
 *
 * Usage:
 * ```ts
 * // Publish
 * const msg = await sendScratchpad(baseUrl, 'my-doc', {
 *   content: 'Hello from agent-1',
 *   agentId: 'agent-1',
 * }, { Authorization: 'Bearer ...' });
 *
 * // Subscribe (SSE)
 * const stop = onScratchpadMessage(baseUrl, 'my-doc', (msg) => {
 *   console.log(msg.content);
 * });
 * // Later: stop() to close the stream
 * ```
 */

import type { AgentIdentity } from '../identity.js';

// ── Types ─────────────────────────────────────────────────────────

/** A scratchpad message as returned by the API. */
export interface ScratchpadMessage {
  id: string;
  agent_id: string;
  content: string;
  content_type: string;
  thread_id?: string;
  sig_hex?: string;
  timestamp_ms: number;
}

/** Options for sending a scratchpad message. */
export interface SendScratchpadOptions {
  /** Message content body. */
  content: string;
  /** MIME content type (default: "text/plain"). */
  contentType?: string;
  /** Optional thread identifier for reply chains. */
  threadId?: string;
  /** Agent identity for signing (optional — unsigned if omitted). */
  identity?: AgentIdentity;
  /** Agent ID to include in the request (required if identity provided). */
  agentId?: string;
}

/** Options for reading scratchpad messages. */
export interface ReadScratchpadOptions {
  /** Return messages after this stream ID. */
  lastId?: string;
  /** Filter by thread. */
  threadId?: string;
  /** Maximum number of messages to return. Default 100. */
  limit?: number;
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Build canonical scratchpad message bytes for signing.
 *
 * Format: `slug\nagent_id\ncontent\ntimestamp_ms`
 */
function buildScratchpadCanonical(
  slug: string,
  agentId: string,
  content: string,
  timestampMs: number
): string {
  return [slug, agentId, content, timestampMs].join('\n');
}

// ── API ───────────────────────────────────────────────────────────

/**
 * Publish a message to a document's scratchpad.
 *
 * If `identity` and `agentId` are provided, the message will be signed
 * with Ed25519 using the canonical format.
 *
 * @param baseUrl  - API base URL (e.g. "https://api.llmtxt.my/api/v1")
 * @param slug     - Document slug
 * @param opts     - Message options
 * @param headers  - Optional extra headers (e.g. Authorization)
 */
export async function sendScratchpad(
  baseUrl: string,
  slug: string,
  opts: SendScratchpadOptions,
  headers: Record<string, string> = {}
): Promise<ScratchpadMessage> {
  const url = `${baseUrl}/documents/${slug}/scratchpad`;
  const now = Date.now();

  let sigHex: string | undefined;
  if (opts.identity && opts.agentId) {
    const canonical = buildScratchpadCanonical(slug, opts.agentId, opts.content, now);
    const bytes = new TextEncoder().encode(canonical);
    const sig = await opts.identity.sign(bytes);
    sigHex = Array.from(sig)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  const body = {
    content: opts.content,
    content_type: opts.contentType ?? 'text/plain',
    ...(opts.threadId ? { thread_id: opts.threadId } : {}),
    ...(sigHex ? { sig_hex: sigHex } : {}),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(
      `sendScratchpad failed (${res.status}): ${(err as { message?: string }).message ?? res.statusText}`
    );
  }

  return res.json() as Promise<ScratchpadMessage>;
}

/**
 * Read scratchpad messages (poll).
 *
 * @param baseUrl  - API base URL
 * @param slug     - Document slug
 * @param opts     - Read options
 * @param headers  - Optional extra headers
 */
export async function readScratchpad(
  baseUrl: string,
  slug: string,
  opts: ReadScratchpadOptions = {},
  headers: Record<string, string> = {}
): Promise<ScratchpadMessage[]> {
  const params = new URLSearchParams();
  if (opts.lastId) params.set('last_id', opts.lastId);
  if (opts.threadId) params.set('thread_id', opts.threadId);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));

  const url = `${baseUrl}/documents/${slug}/scratchpad?${params.toString()}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`readScratchpad failed (${res.status})`);

  const data = (await res.json()) as { messages: ScratchpadMessage[] };
  return data.messages;
}

/**
 * Subscribe to live scratchpad messages via Server-Sent Events.
 *
 * Returns a `stop()` function to close the SSE connection.
 *
 * @param baseUrl     - API base URL
 * @param slug        - Document slug
 * @param onMessage   - Callback invoked on each new message
 * @param opts        - Subscribe options (threadId, lastId)
 * @param authHeaders - Optional auth headers (added to query params since SSE can't set headers)
 */
export function onScratchpadMessage(
  baseUrl: string,
  slug: string,
  onMessage: (msg: ScratchpadMessage) => void,
  opts: { threadId?: string; lastId?: string } = {},
  _authHeaders: Record<string, string> = {}
): () => void {
  const params = new URLSearchParams();
  if (opts.lastId) params.set('last_id', opts.lastId);
  if (opts.threadId) params.set('thread_id', opts.threadId);

  const url = `${baseUrl}/documents/${slug}/scratchpad/stream?${params.toString()}`;

  let es: EventSource | null = null;
  let stopped = false;

  function connect() {
    if (stopped) return;
    es = new EventSource(url);

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ScratchpadMessage;
        onMessage(msg);
      } catch {
        // Ignore parse errors (heartbeat, malformed data)
      }
    };

    es.onerror = () => {
      es?.close();
      es = null;
      if (!stopped) {
        // Reconnect after 2 seconds
        setTimeout(connect, 2000);
      }
    };
  }

  connect();

  return () => {
    stopped = true;
    es?.close();
    es = null;
  };
}
