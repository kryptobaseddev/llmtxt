/**
 * CRDT collaborative editing SDK — T211.
 *
 * Provides:
 *  - `subscribeSection(slug, sectionId, callback)` — WebSocket-backed
 *    subscription that emits SectionDelta events as other agents push updates.
 *  - `getSectionText(slug, sectionId)` — HTTP fallback that returns the plain
 *    text content of a section without establishing a WS connection.
 *
 * Architecture:
 *  - WebSocket connection uses the yjs-sync-v1 subprotocol.
 *  - Message framing: 1-byte type prefix + raw lib0 v1 binary payload.
 *      0x00 = SyncStep1 (state vector)
 *      0x01 = SyncStep2 (diff update from server)
 *      0x02 = Update    (incremental update, bidirectional)
 *  - Client maintains a local Y.Doc to apply inbound updates and extract text.
 *
 * Browser + Node.js compatible:
 *  - Uses the native WebSocket global (available in Node.js >= 22 and all
 *    modern browsers). Older Node.js versions must polyfill `WebSocket`.
 *
 * Usage:
 * ```ts
 * import { subscribeSection, getSectionText } from 'llmtxt/crdt';
 *
 * const unsub = subscribeSection('my-doc', 'intro', (delta) => {
 *   console.log('Section updated:', delta.text, 'at seq', delta.seq);
 * });
 *
 * // Later:
 * unsub();
 * ```
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A delta event emitted when the CRDT state for a section changes.
 */
export interface SectionDelta {
  /** Document slug. */
  slug: string;
  /** Section identifier. */
  sectionId: string;
  /** Current plain-text content of the section after applying the delta. */
  text: string;
  /** Raw lib0 v1 update bytes that caused this delta (Uint8Array). */
  updateBytes: Uint8Array;
  /** Wall clock timestamp (ms since epoch) when the update was received. */
  receivedAt: number;
}

/**
 * Function to call to unsubscribe and close the WebSocket connection.
 */
export type Unsubscribe = () => void;

/**
 * Options for `subscribeSection`.
 */
export interface SubscribeSectionOptions {
  /**
   * Base URL of the llmtxt API.
   * Defaults to `https://api.llmtxt.my`.
   */
  baseUrl?: string;
  /**
   * Bearer token for authentication.
   * Pass your API key here (llmtxt_... format).
   */
  token?: string;
  /**
   * Called when the WebSocket encounters an error.
   */
  onError?: (err: Event) => void;
}

// ── Message type constants ────────────────────────────────────────────────────

const MSG_SYNC_STEP_1 = 0x00;
const MSG_SYNC_STEP_2 = 0x01;
const MSG_UPDATE      = 0x02;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Prepend a 1-byte type prefix to a payload. */
function framed(msgType: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + payload.length);
  out[0] = msgType;
  out.set(payload, 1);
  return out;
}

/** Strip the 1-byte prefix from a received frame. */
function unframe(data: Uint8Array): { msgType: number; payload: Uint8Array } {
  return { msgType: data[0], payload: data.subarray(1) };
}

// ── subscribeSection ─────────────────────────────────────────────────────────

/**
 * Subscribe to real-time CRDT delta events for a single section.
 *
 * Opens a WebSocket connection using the `yjs-sync-v1` subprotocol and
 * performs the initial sync step 1 + 2 exchange. Subsequent updates from
 * other agents are applied to the local Y.Doc and emitted as `SectionDelta`
 * events to `callback`.
 *
 * @param slug       - Document slug
 * @param sectionId  - Section identifier
 * @param callback   - Called each time the section changes
 * @param options    - Auth and endpoint configuration
 * @returns          - `Unsubscribe` function; call it to close the WS
 */
export function subscribeSection(
  slug: string,
  sectionId: string,
  callback: (delta: SectionDelta) => void,
  options: SubscribeSectionOptions = {},
): Unsubscribe {
  const { baseUrl = 'https://api.llmtxt.my', token, onError } = options;

  // Build WS URL — use wss:// scheme
  const httpBase = baseUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  const url = `${httpBase}/v1/documents/${encodeURIComponent(slug)}/sections/${encodeURIComponent(sectionId)}/collab${query}`;

  // Lazily import yjs — avoids bundling Yjs into consumers that only use HTTP
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any | null = null;
  let ws: WebSocket | null = null;
  let closed = false;

  // We import Yjs lazily at runtime so this file can be tree-shaken when the
  // subscribeSection function is not used.
  async function connect(): Promise<void> {
    // Dynamic import of yjs (optional peer dependency).
    // The `@ts-expect-error` suppresses the "cannot find module" error since
    // yjs is an optional dep not listed in package.json for this package —
    // consumers that use subscribeSection() must install yjs themselves.
    // @ts-expect-error — yjs is an optional peer dependency
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Y: any = await import('yjs');

    doc = new Y.Doc();
    doc.getText('content'); // initialise root

    ws = new WebSocket(url, ['yjs-sync-v1']);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      if (!doc || !ws) return;
      // Send sync step 1: our (empty) state vector
      const sv = Y.encodeStateVector(doc);
      ws.send(framed(MSG_SYNC_STEP_1, sv));
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!doc || closed) return;

      const raw =
        event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : new Uint8Array(event.data as ArrayBufferLike);

      if (raw.length === 0) return;

      // Check if this is a JSON control message (auth errors etc.)
      if (raw[0] === 0x7b /* '{' */) {
        // JSON frame — ignore (auth errors are handled by onclose)
        return;
      }

      const { msgType, payload } = unframe(raw);

      if (msgType === MSG_SYNC_STEP_2 || msgType === MSG_UPDATE) {
        // Apply incoming update to local doc
        Y.applyUpdate(doc!, payload);

        const text = doc!.getText('content').toString();
        callback({
          slug,
          sectionId,
          text,
          updateBytes: payload,
          receivedAt: Date.now(),
        });
      }
    };

    ws.onerror = (event: Event) => {
      if (onError) onError(event);
    };

    ws.onclose = () => {
      // Connection closed — no automatic reconnect in this version
    };
  }

  void connect();

  return () => {
    closed = true;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close(1000, 'client unsubscribed');
    }
  };
}

// ── getSectionText ────────────────────────────────────────────────────────────

/**
 * Fetch the current plain-text content of a section via the HTTP fallback.
 *
 * Does not require WebSocket support. Returns the text extracted from the
 * consolidated CRDT state. Returns null if the section has not been initialized.
 *
 * @param slug      - Document slug
 * @param sectionId - Section identifier
 * @param options   - Auth and endpoint configuration
 */
export async function getSectionText(
  slug: string,
  sectionId: string,
  options: SubscribeSectionOptions = {},
): Promise<string | null> {
  const { baseUrl = 'https://api.llmtxt.my', token } = options;

  const url = `${baseUrl}/v1/documents/${encodeURIComponent(slug)}/sections/${encodeURIComponent(sectionId)}/crdt-state`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { headers });

  if (res.status === 503) return null; // not initialized
  if (!res.ok) {
    throw new Error(`getSectionText: HTTP ${res.status} from ${url}`);
  }

  const json = (await res.json()) as { stateBase64: string };

  // Decode state and extract text using Yjs (optional peer dep).
  // @ts-expect-error — yjs is an optional peer dependency
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Y: any = await import('yjs');
  const stateBytes = Uint8Array.from(atob(json.stateBase64), (c) => c.charCodeAt(0));
  const doc = new Y.Doc();
  doc.getText('content');
  Y.applyUpdate(doc, stateBytes);
  return doc.getText('content').toString();
}
