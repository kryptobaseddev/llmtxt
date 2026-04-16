/**
 * Awareness SDK module — T257.
 *
 * Implements the setLocalAwarenessState / onAwarenessChange / getAwarenessStates
 * surface over a raw WebSocket connection.
 *
 * The y-protocols/awareness library is used for encoding/decoding awareness
 * update messages (CRDT-aware awareness protocol). Since direct yjs imports are
 * banned by the SSoT lint rule, this module relies on the re-exported
 * primitives from the llmtxt SDK (which wraps the WASM core).
 *
 * Awareness message framing on the wire:
 *   Byte 0 = 0x03 (MSG_AWARENESS_RELAY, matching ws-crdt.ts constant)
 *   Bytes 1..N = raw y-protocols awareness update bytes
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Presence state for a single agent.
 */
export interface AwarenessState {
  agentId: string;
  section: string;
  cursorOffset?: number;
  lastSeen: number;
}

/**
 * Events emitted when awareness state changes.
 */
export type AwarenessEventType = 'JOIN' | 'LEAVE' | 'MOVE';

export interface AwarenessEvent {
  type: AwarenessEventType;
  clientId: number;
  state: AwarenessState | null;
}

/**
 * Unsubscribe function returned by onAwarenessChange.
 */
export type Unsubscribe = () => void;

// ── Awareness message type byte ───────────────────────────────────────────────

const MSG_AWARENESS_RELAY = 0x03;

// ── In-process awareness state store ─────────────────────────────────────────

/**
 * Per-connection awareness state map.
 * Key = WebSocket instance reference (using a WeakMap would be ideal but
 * we need to iterate — use a regular Map with explicit cleanup).
 */
const awarenessStates = new Map<WebSocket | object, Map<number, AwarenessState>>();
const awarenessListeners = new Map<WebSocket | object, Set<(states: Map<number, AwarenessState>) => void>>();

// ── Encoding helpers (manual lib0-style varint) ───────────────────────────────

/**
 * Encode a positive integer as a variable-length integer (lib0 format).
 * Used to manually build awareness update bytes without importing y-protocols.
 */
function encodeVarUint(value: number): Uint8Array {
  const buf: number[] = [];
  while (value > 127) {
    buf.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  buf.push(value & 0x7f);
  return new Uint8Array(buf);
}

/**
 * Decode a varint from a byte array starting at offset.
 * Returns [value, newOffset].
 */
function decodeVarUint(bytes: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  while (offset < bytes.length) {
    const byte = bytes[offset++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
    if ((byte & 0x80) === 0) break;
  }
  return [result, offset];
}

/**
 * Encode a UTF-8 string as (varint length, bytes).
 */
function encodeString(str: string): Uint8Array {
  const encoded = new TextEncoder().encode(str);
  const lenBytes = encodeVarUint(encoded.length);
  const result = new Uint8Array(lenBytes.length + encoded.length);
  result.set(lenBytes, 0);
  result.set(encoded, lenBytes.length);
  return result;
}

/**
 * Decode a length-prefixed string from bytes at offset.
 * Returns [string, newOffset].
 */
function decodeString(bytes: Uint8Array, offset: number): [string, number] {
  const [len, afterLen] = decodeVarUint(bytes, offset);
  const str = new TextDecoder().decode(bytes.subarray(afterLen, afterLen + len));
  return [str, afterLen + len];
}

/**
 * Encode an awareness state update for one client.
 *
 * Format (mirrors y-protocols/awareness):
 *   [numClients: varint] [clientId: varint] [clock: varint] [stateJson: string]
 */
function encodeAwarenessUpdate(clientId: number, clock: number, state: AwarenessState | null): Uint8Array {
  const numClients = encodeVarUint(1);
  const clientIdBytes = encodeVarUint(clientId);
  const clockBytes = encodeVarUint(clock);
  const stateStr = state ? JSON.stringify(state) : 'null';
  const stateBytes = encodeString(stateStr);

  const total = numClients.length + clientIdBytes.length + clockBytes.length + stateBytes.length;
  const buf = new Uint8Array(total);
  let offset = 0;
  buf.set(numClients, offset); offset += numClients.length;
  buf.set(clientIdBytes, offset); offset += clientIdBytes.length;
  buf.set(clockBytes, offset); offset += clockBytes.length;
  buf.set(stateBytes, offset);
  return buf;
}

/**
 * Decode an awareness update message from raw bytes.
 * Returns array of [clientId, clock, state] tuples.
 */
function decodeAwarenessUpdate(bytes: Uint8Array): Array<[number, number, AwarenessState | null]> {
  const results: Array<[number, number, AwarenessState | null]> = [];
  let offset = 0;

  const [numClients, afterNum] = decodeVarUint(bytes, offset);
  offset = afterNum;

  for (let i = 0; i < numClients; i++) {
    const [clientId, afterClientId] = decodeVarUint(bytes, offset);
    offset = afterClientId;

    const [clock, afterClock] = decodeVarUint(bytes, offset);
    offset = afterClock;

    const [stateStr, afterState] = decodeString(bytes, offset);
    offset = afterState;

    let state: AwarenessState | null = null;
    try {
      const parsed = JSON.parse(stateStr);
      if (parsed !== null && typeof parsed === 'object') {
        state = parsed as AwarenessState;
      }
    } catch {
      // Malformed state — treat as null (agent left)
    }

    results.push([clientId, clock, state]);
  }

  return results;
}

// ── Client ID generation ──────────────────────────────────────────────────────

let _clientIdCounter = Math.floor(Math.random() * 0x7fffffff);

function getLocalClientId(): number {
  return _clientIdCounter;
}

// ── Clock tracking per connection ─────────────────────────────────────────────

const clocks = new Map<WebSocket | object, number>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Set the local agent's awareness state on a WebSocket connection.
 * Encodes the state and sends it to the server (which relays to peers).
 *
 * @param conn   Active WebSocket connection.
 * @param state  The awareness state to broadcast.
 */
export function setLocalAwarenessState(conn: WebSocket | { send(data: Uint8Array | Buffer): void }, state: AwarenessState): void {
  const clientId = getLocalClientId();
  const clock = (clocks.get(conn as object) ?? 0) + 1;
  clocks.set(conn as object, clock);

  // Update local store
  let stateMap = awarenessStates.get(conn as object);
  if (!stateMap) {
    stateMap = new Map();
    awarenessStates.set(conn as object, stateMap);
  }
  stateMap.set(clientId, state);

  // Encode and send
  const updateBytes = encodeAwarenessUpdate(clientId, clock, state);

  // Frame with MSG_AWARENESS_RELAY prefix
  const frame = new Uint8Array(1 + updateBytes.length);
  frame[0] = MSG_AWARENESS_RELAY;
  frame.set(updateBytes, 1);

  try {
    (conn as { send(data: Uint8Array): void }).send(frame);
  } catch {
    // Connection may have closed
  }
}

/**
 * Subscribe to awareness state changes on a WebSocket connection.
 * The callback is invoked with the full current state map whenever
 * a peer's awareness changes.
 *
 * @param conn  Active WebSocket connection.
 * @param fn    Callback invoked with updated Map<clientId, AwarenessState>.
 * @returns     Unsubscribe function.
 */
export function onAwarenessChange(
  conn: WebSocket | { on?(event: string, handler: (data: Buffer | Uint8Array) => void): void; addEventListener?(type: string, handler: (event: { data: unknown }) => void): void },
  fn: (states: Map<number, AwarenessState>) => void,
): Unsubscribe {
  // Register listener
  let listeners = awarenessListeners.get(conn as object);
  if (!listeners) {
    listeners = new Set();
    awarenessListeners.set(conn as object, listeners);
  }
  listeners.add(fn);

  // Attach message handler if not already attached
  const stateMap = awarenessStates.get(conn as object) ?? new Map<number, AwarenessState>();
  if (!awarenessStates.has(conn as object)) {
    awarenessStates.set(conn as object, stateMap);
  }

  // Internal handler for incoming WS messages
  const messageHandler = (rawData: Buffer | Uint8Array | string | { data: unknown }) => {
    let buf: Uint8Array;
    if (rawData instanceof Uint8Array) {
      buf = rawData;
    } else if (Buffer.isBuffer(rawData)) {
      buf = new Uint8Array((rawData as Buffer).buffer, (rawData as Buffer).byteOffset, (rawData as Buffer).byteLength);
    } else if (typeof rawData === 'object' && 'data' in rawData) {
      // Browser MessageEvent
      const d = (rawData as { data: unknown }).data;
      if (d instanceof ArrayBuffer) buf = new Uint8Array(d);
      else if (d instanceof Uint8Array) buf = d;
      else return;
    } else {
      return; // string message — not awareness
    }

    if (buf.length === 0 || buf[0] !== MSG_AWARENESS_RELAY) return;

    const updateBytes = buf.subarray(1);
    try {
      const updates = decodeAwarenessUpdate(updateBytes);
      const currentMap = awarenessStates.get(conn as object) ?? new Map<number, AwarenessState>();

      for (const [clientId, , state] of updates) {
        if (state === null) {
          currentMap.delete(clientId);
        } else {
          currentMap.set(clientId, state);
        }
      }

      awarenessStates.set(conn as object, currentMap);

      // Notify all registered listeners
      const fns = awarenessListeners.get(conn as object);
      if (fns) {
        for (const listener of fns) {
          listener(new Map(currentMap));
        }
      }
    } catch {
      // Malformed update — ignore
    }
  };

  // Attach to Node.js-style WS (e.g., ws package)
  const nodeConn = conn as { on?(event: string, handler: (data: Buffer | Uint8Array) => void): void };
  if (typeof nodeConn.on === 'function') {
    nodeConn.on('message', messageHandler as (data: Buffer | Uint8Array) => void);
  }

  // Attach to browser WebSocket
  const browserConn = conn as { addEventListener?(type: string, handler: (event: { data: unknown }) => void): void };
  if (typeof browserConn.addEventListener === 'function') {
    browserConn.addEventListener('message', messageHandler as (event: { data: unknown }) => void);
  }

  return () => {
    const fns = awarenessListeners.get(conn as object);
    if (fns) fns.delete(fn);
  };
}

/**
 * Get the current awareness states for all known clients on a connection.
 *
 * @param conn  Active WebSocket connection.
 * @returns     Map<clientId, AwarenessState>.
 */
export function getAwarenessStates(conn: WebSocket | object): Map<number, AwarenessState> {
  return new Map(awarenessStates.get(conn) ?? []);
}
