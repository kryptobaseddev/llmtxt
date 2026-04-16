/**
 * watchDocument — SDK helper for streaming per-document events.
 *
 * Returns an AsyncIterable<DocumentEventLogEntry> backed by the
 * GET /api/v1/documents/:slug/events/stream SSE endpoint.
 *
 * Features:
 *  - Fetch-based streaming (no EventSource dependency; works in Node ≥18 + browser).
 *  - Reconnect on close / network error with exponential backoff:
 *      100ms → 500ms → 2s → 10s cap.
 *  - Sets Last-Event-ID on reconnect so events are not replayed.
 *  - Circuit-breaker: after 5 reconnect attempts within 60 seconds, emits
 *      an error event and stops iteration.
 *  - If the server sends an explicit `event: error` frame, the generator
 *      throws.
 *
 * Usage (Node):
 *   import { watchDocument } from 'llmtxt';
 *   for await (const evt of watchDocument('https://api.llmtxt.my', 'abc123')) {
 *     console.log(evt.event_type, evt.payload);
 *   }
 *
 * Usage (Browser):
 *   Same API — `fetch` is available globally.
 *
 * SSOT note: event type names are owned by apps/backend/src/lib/document-events.ts.
 * This module is a pure consumer; it forwards whatever event_type the server sends.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single event row from the document event log. */
export interface DocumentEventLogEntry {
  id: string;
  /** Monotonically increasing per-document sequence number (as string — bigint-safe). */
  seq: string;
  event_type: string;
  actor_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface WatchDocumentOptions {
  /**
   * Resume from this sequence number (exclusive).
   * If unset, starts from the beginning.
   */
  fromSeq?: string | number;
  /**
   * Bearer token or API key for authenticated requests.
   * Passed as `Authorization: Bearer <apiKey>` header.
   */
  apiKey?: string;
  /**
   * Maximum reconnect attempts within the circuit-breaker window (60s).
   * Defaults to 5.
   */
  maxReconnects?: number;
  /**
   * AbortSignal to cancel the stream externally.
   */
  signal?: AbortSignal;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RECONNECT_DELAYS_MS = [100, 500, 2_000, 10_000] as const;
const CIRCUIT_BREAKER_WINDOW_MS = 60_000;
const DEFAULT_MAX_RECONNECTS = 5;

// ── SSE line parser ───────────────────────────────────────────────────────────

interface SseFrame {
  id?: string;
  event?: string;
  data?: string;
}

/** Parse SSE text into frames. Yields one frame per blank-line boundary. */
async function* parseSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<SseFrame> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let frame: SseFrame = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Split on newlines
    let nlIdx: number;
    while ((nlIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nlIdx).replace(/\r$/, '');
      buffer = buffer.slice(nlIdx + 1);

      if (line === '') {
        // Blank line → dispatch frame
        if (frame.data !== undefined || frame.id !== undefined || frame.event !== undefined) {
          yield frame;
          frame = {};
        }
        continue;
      }

      // Skip comment lines (heartbeats)
      if (line.startsWith(':')) continue;

      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const field = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).replace(/^ /, '');

      if (field === 'id') frame.id = val;
      else if (field === 'event') frame.event = val;
      else if (field === 'data') frame.data = val;
    }
  }

  // Flush any partial frame at end of stream
  if (frame.data !== undefined || frame.id !== undefined) {
    yield frame;
  }
}

// ── Core generator ────────────────────────────────────────────────────────────

/**
 * Watch a document's event stream.
 *
 * @param baseUrl  Base URL of the llmtxt API, e.g. `https://api.llmtxt.my`.
 * @param slug     Document slug.
 * @param options  Optional configuration (fromSeq, apiKey, maxReconnects, signal).
 */
export async function* watchDocument(
  baseUrl: string,
  slug: string,
  options: WatchDocumentOptions = {},
): AsyncGenerator<DocumentEventLogEntry> {
  const { apiKey, signal } = options;
  const maxReconnects = options.maxReconnects ?? DEFAULT_MAX_RECONNECTS;

  let lastSeenId: string | undefined =
    options.fromSeq !== undefined ? String(options.fromSeq) : undefined;

  // Circuit-breaker state
  let reconnectAttempts = 0;
  let windowStart = Date.now();
  let attemptIndex = 0;

  while (true) {
    // Check abort signal
    if (signal?.aborted) return;

    // Build URL
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/api/v1/documents/${slug}/events/stream`);
    if (lastSeenId !== undefined) {
      url.searchParams.set('since', lastSeenId);
    }

    // Build headers
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
    };
    if (lastSeenId !== undefined) {
      headers['Last-Event-ID'] = lastSeenId;
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const resp = await fetch(url.toString(), {
        headers,
        signal,
        // Node 18+ fetch streams: disable automatic body buffering
        // @ts-ignore — not in all TS versions of fetch types
        cache: 'no-store',
      });

      if (!resp.ok) {
        throw new Error(`watchDocument: HTTP ${resp.status} ${resp.statusText}`);
      }

      if (!resp.body) {
        throw new Error('watchDocument: response body is null');
      }

      reader = resp.body.getReader();

      for await (const frame of parseSse(reader)) {
        if (signal?.aborted) return;

        // Update last-seen ID for reconnect
        if (frame.id) {
          lastSeenId = frame.id;
        }

        if (frame.event === 'error') {
          throw new Error(`watchDocument: server sent error event: ${frame.data}`);
        }

        // Skip non-data frames
        if (!frame.data) continue;

        let parsed: DocumentEventLogEntry;
        try {
          parsed = JSON.parse(frame.data) as DocumentEventLogEntry;
        } catch {
          continue; // Malformed frame — skip
        }

        yield parsed;
      }

      // Clean stream end (server closed) — reconnect
    } catch (err) {
      if (signal?.aborted) return;

      // Rethrow explicit server errors
      if (err instanceof Error && err.message.startsWith('watchDocument: server sent error')) {
        throw err;
      }
      // Otherwise fall through to reconnect logic
    } finally {
      reader?.releaseLock?.();
    }

    // ── Reconnect with circuit-breaker ──────────────────────────────────────
    const now = Date.now();
    if (now - windowStart > CIRCUIT_BREAKER_WINDOW_MS) {
      // Reset window
      reconnectAttempts = 0;
      windowStart = now;
      attemptIndex = 0;
    }

    reconnectAttempts++;
    if (reconnectAttempts > maxReconnects) {
      throw new Error(
        `watchDocument: circuit breaker open — ${reconnectAttempts} reconnects in ${CIRCUIT_BREAKER_WINDOW_MS}ms`,
      );
    }

    const delay = RECONNECT_DELAYS_MS[Math.min(attemptIndex, RECONNECT_DELAYS_MS.length - 1)];
    attemptIndex++;

    // Wait before reconnecting (respect abort signal)
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, delay);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      }, { once: true });
    }).catch(() => { /* aborted */ });

    if (signal?.aborted) return;
  }
}
