/**
 * CRDT collaborative editing SDK — T397 (Loro migration).
 *
 * Provides:
 *  - `subscribeSection(slug, sectionId, callback)` — WebSocket-backed
 *    subscription that emits SectionDelta events as other agents push updates.
 *  - `getSectionText(slug, sectionId)` — HTTP fallback that returns the plain
 *    text content of a section without establishing a WS connection.
 *
 * Architecture:
 *  - WebSocket connection uses the loro-sync-v1 subprotocol.
 *  - Message framing: 1-byte type prefix + Loro binary payload.
 *    Byte values are intentionally shifted from the legacy Yrs/y-sync protocol
 *    to prevent accidental cross-protocol acceptance by stray legacy clients:
 *
 *      0x01 = SyncStep1     (client → server: Loro VersionVector bytes)
 *      0x02 = SyncStep2     (server → client: Loro ExportMode::Updates blob)
 *      0x03 = Update        (client → server: incremental Loro update blob)
 *      0x04 = AwarenessRelay (raw relay, same payload shape as before)
 *
 *    Any stray 0x00 frame (legacy Yjs SyncStep1) MUST be rejected. The server
 *    drops it silently; this client never sends it.
 *
 * Wire-format incompatibility note (migration from Yrs):
 *  - This SDK uses Loro binary format. All previous Yrs/lib0 v1 bytes are
 *    bitwise incompatible and MUST NOT be mixed. If you have clients still
 *    sending the old y-sync protocol (0x00/0x01/0x02 framing with Y.js state
 *    vectors), they will be rejected by the server with a 4400 close code.
 *    Update all clients to use this SDK version.
 *
 * Client maintains a local Loro Doc to apply inbound updates and extract text.
 * On WS open: encode local VersionVector → send as SyncStep1 (0x01).
 * On receive SyncStep2 (0x02): import Loro update blob into local doc.
 * On receive Update (0x03): import Loro incremental update into local doc.
 * On receive AwarenessRelay (0x04): pass payload to awareness callback.
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
    /**
     * Raw Loro update bytes that caused this delta (Uint8Array).
     * These are Loro binary format bytes — bitwise incompatible with
     * the previous Yrs lib0 v1 format.
     */
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
    /**
     * Called when an AwarenessRelay (0x04) message is received.
     * The payload is the raw awareness bytes relayed from a peer.
     */
    onAwareness?: (payload: Uint8Array) => void;
}
/**
 * Subscribe to real-time CRDT delta events for a single section.
 *
 * Opens a WebSocket connection using the `loro-sync-v1` subprotocol and
 * performs the Loro sync protocol (SyncStep1 → SyncStep2 exchange).
 * Subsequent updates from other agents are imported into the local Loro Doc
 * and emitted as `SectionDelta` events to `callback`.
 *
 * Wire protocol (spec P1 §3.2):
 *  1. On open: encode local VersionVector → send as 0x01 SyncStep1.
 *  2. On receive 0x02 (SyncStep2): import Loro update blob (full diff from server).
 *  3. On receive 0x03 (Update): import incremental Loro update blob from peer.
 *  4. On receive 0x04 (AwarenessRelay): pass to options.onAwareness if set.
 *  5. Stray 0x00 frames (legacy Yjs SyncStep1) are dropped and never sent.
 *
 * @param slug       - Document slug
 * @param sectionId  - Section identifier
 * @param callback   - Called each time the section changes
 * @param options    - Auth and endpoint configuration
 * @returns          - `Unsubscribe` function; call it to close the WS
 */
export declare function subscribeSection(slug: string, sectionId: string, callback: (delta: SectionDelta) => void, options?: SubscribeSectionOptions): Unsubscribe;
/**
 * Fetch the current plain-text content of a section via the HTTP fallback.
 *
 * Does not require WebSocket support. Returns the text extracted from the
 * consolidated Loro CRDT state. Returns null if the section has not been
 * initialized (HTTP 503).
 *
 * The server returns a base64-encoded Loro snapshot blob. This function:
 *  1. Decodes the base64 → Loro binary bytes.
 *  2. Creates a local Loro Doc and imports the bytes.
 *  3. Reads the "content" LoroText root and returns its string value.
 *
 * Wire-format note: the stateBase64 field contains Loro binary (magic header
 * 0x6c 0x6f 0x72 0x6f "loro"). Do NOT pass these bytes to any Y.js / lib0
 * decoder — they are bitwise incompatible.
 *
 * @param slug      - Document slug
 * @param sectionId - Section identifier
 * @param options   - Auth and endpoint configuration
 */
export declare function getSectionText(slug: string, sectionId: string, options?: SubscribeSectionOptions): Promise<string | null>;
//# sourceMappingURL=crdt.d.ts.map