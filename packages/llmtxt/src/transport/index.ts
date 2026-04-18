/**
 * llmtxt/transport — PeerTransport abstraction (extracted from mesh, T610).
 *
 * Provides the PeerTransport interface, UnixSocketTransport, HttpTransport, and
 * the Ed25519 mutual handshake protocol as an independently-importable subpath.
 *
 * Security requirement (built-in, not bolt-on):
 * - Every connection MUST complete the 3-message Ed25519 mutual handshake
 *   BEFORE any changeset data is sent or received.
 * - Connections that fail the handshake MUST be closed immediately.
 * - Unauthenticated peers MUST be rejected before any data exchange begins.
 * - Both transports enforce max changeset size of 10 MB (P3 spec §10).
 *
 * Spec: docs/specs/P3-p2p-mesh.md §4
 * Original task: T415 | Extraction: T610
 * Subpath: llmtxt/transport
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { EventEmitter } from 'node:events';
import * as http from 'node:http';
import * as net from 'node:net';

// Noble ed25519 v3 requires setting the hash function.
ed.hashes.sha512 = sha512;

// ── Constants ──────────────────────────────────────────────────────

/** Maximum changeset size: 10 MB (P3 spec §10). */
export const MAX_CHANGESET_BYTES = 10 * 1024 * 1024;

/** Number of retry attempts before giving up. */
export const MAX_RETRIES = 3;

/** Base backoff delay in milliseconds (doubles each retry). */
export const RETRY_BASE_MS = 1000;

/** Handshake message type identifiers. */
const MSG_TYPE_HANDSHAKE_INIT = 0x01;
const MSG_TYPE_HANDSHAKE_RESP = 0x02;
const MSG_TYPE_HANDSHAKE_FINAL = 0x03;
const MSG_TYPE_CHANGESET = 0x04;

// ── Errors ────────────────────────────────────────────────────────

/** Thrown when the Ed25519 mutual handshake fails. */
export class HandshakeFailedError extends Error {
  readonly code = 'HANDSHAKE_FAILED';

  constructor(reason: string) {
    super(`[transport] Handshake failed: ${reason}`);
    this.name = 'HandshakeFailedError';
  }
}

/** Thrown when a peer is unreachable after max retries. */
export class PeerUnreachableError extends Error {
  readonly code = 'PEER_UNREACHABLE';

  constructor(peerId: string, address: string, cause?: unknown) {
    super(
      `[transport] Peer '${peerId}' at '${address}' unreachable after ${MAX_RETRIES} retries` +
        (cause ? `: ${(cause as Error).message}` : '')
    );
    this.name = 'PeerUnreachableError';
  }
}

/** Thrown when a changeset exceeds the maximum size. */
export class ChangesetTooLargeError extends Error {
  readonly code = 'CHANGESET_TOO_LARGE';

  constructor(bytes: number) {
    super(
      `[transport] Changeset size ${bytes} bytes exceeds maximum of ${MAX_CHANGESET_BYTES} bytes`
    );
    this.name = 'ChangesetTooLargeError';
  }
}

// ── PeerTransport interface ───────────────────────────────────────

/**
 * PeerTransport — transport abstraction for P2P mesh (P3 spec §4.1).
 *
 * Implementations MUST complete Ed25519 mutual handshake before any changeset
 * data is exchanged. Unauthenticated peers MUST be rejected.
 */
export interface PeerTransport extends EventEmitter {
  /** Transport type identifier (e.g., `"unix"`, `"http"`). */
  readonly type: string;

  /**
   * Listen for incoming connections.
   *
   * MUST complete Ed25519 mutual handshake before calling `onChangeset()`.
   * MUST reject connections that fail the handshake.
   * MUST call `onChangeset()` for each received, authenticated changeset.
   */
  listen(onChangeset: (peerId: string, changeset: Uint8Array) => void): Promise<void>;

  /**
   * Send a changeset to a specific peer.
   *
   * MUST complete Ed25519 mutual handshake before sending any data.
   * MUST throw {@link PeerUnreachableError} if the peer is unreachable after
   * {@link MAX_RETRIES} attempts.
   */
  sendChangeset(peerId: string, peerAddress: string, changeset: Uint8Array): Promise<void>;

  /** Graceful shutdown — close all open connections and stop listening. */
  close(): Promise<void>;
}

// ── Ed25519 handshake helpers ─────────────────────────────────────

/**
 * Local identity used by the transport layer for handshakes.
 */
export interface TransportIdentity {
  /** Hex-encoded SHA-256 of the public key bytes. */
  agentId: string;
  /** 32-byte Ed25519 public key. */
  publicKey: Uint8Array;
  /** 32-byte Ed25519 private key seed. */
  privateKey: Uint8Array;
}

/** Generate 32 cryptographically random bytes. */
function randomChallenge(): Uint8Array {
  const buf = new Uint8Array(new ArrayBuffer(32));
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

/**
 * Serialize a handshake message to bytes.
 * Format: [1-byte type][1-byte agentId-len][agentId-utf8][32-byte pubkey]
 *         [optional: 32-byte challenge][optional: 64-byte signature]
 */
function encodeHandshakeInit(
  agentId: string,
  publicKey: Uint8Array,
  challenge: Uint8Array
): Uint8Array {
  const agentIdBytes = new TextEncoder().encode(agentId);
  // type(1) + agentIdLen(1) + agentId + pubkey(32) + challenge(32)
  const buf = new Uint8Array(1 + 1 + agentIdBytes.length + 32 + 32);
  let offset = 0;
  buf[offset++] = MSG_TYPE_HANDSHAKE_INIT;
  buf[offset++] = agentIdBytes.length;
  buf.set(agentIdBytes, offset);
  offset += agentIdBytes.length;
  buf.set(publicKey, offset);
  offset += 32;
  buf.set(challenge, offset);
  return buf;
}

function encodeHandshakeResp(
  agentId: string,
  publicKey: Uint8Array,
  sig: Uint8Array,
  challenge: Uint8Array
): Uint8Array {
  const agentIdBytes = new TextEncoder().encode(agentId);
  // type(1) + agentIdLen(1) + agentId + pubkey(32) + sig(64) + challenge(32)
  const buf = new Uint8Array(1 + 1 + agentIdBytes.length + 32 + 64 + 32);
  let offset = 0;
  buf[offset++] = MSG_TYPE_HANDSHAKE_RESP;
  buf[offset++] = agentIdBytes.length;
  buf.set(agentIdBytes, offset);
  offset += agentIdBytes.length;
  buf.set(publicKey, offset);
  offset += 32;
  buf.set(sig, offset);
  offset += 64;
  buf.set(challenge, offset);
  return buf;
}

function encodeHandshakeFinal(sig: Uint8Array): Uint8Array {
  // type(1) + sig(64)
  const buf = new Uint8Array(1 + 64);
  buf[0] = MSG_TYPE_HANDSHAKE_FINAL;
  buf.set(sig, 1);
  return buf;
}

interface HandshakeInitData {
  agentId: string;
  publicKey: Uint8Array;
  challenge: Uint8Array;
}

interface HandshakeRespData {
  agentId: string;
  publicKey: Uint8Array;
  sig: Uint8Array;
  challenge: Uint8Array;
}

function decodeHandshakeInit(buf: Uint8Array): HandshakeInitData {
  let offset = 0;
  const type = buf[offset++];
  if (type !== MSG_TYPE_HANDSHAKE_INIT) {
    throw new HandshakeFailedError(`expected INIT (0x01), got 0x${type.toString(16)}`);
  }
  const agentIdLen = buf[offset++];
  if (typeof agentIdLen !== 'number') {
    throw new HandshakeFailedError('missing agentId length byte');
  }
  const agentId = new TextDecoder().decode(buf.slice(offset, offset + agentIdLen));
  offset += agentIdLen;
  const publicKey = new Uint8Array(buf.slice(offset, offset + 32));
  offset += 32;
  const challenge = new Uint8Array(buf.slice(offset, offset + 32));
  return { agentId, publicKey, challenge };
}

function decodeHandshakeResp(buf: Uint8Array): HandshakeRespData {
  let offset = 0;
  const type = buf[offset++];
  if (type !== MSG_TYPE_HANDSHAKE_RESP) {
    throw new HandshakeFailedError(`expected RESP (0x02), got 0x${type.toString(16)}`);
  }
  const agentIdLen = buf[offset++];
  if (typeof agentIdLen !== 'number') {
    throw new HandshakeFailedError('missing agentId length byte');
  }
  const agentId = new TextDecoder().decode(buf.slice(offset, offset + agentIdLen));
  offset += agentIdLen;
  const publicKey = new Uint8Array(buf.slice(offset, offset + 32));
  offset += 32;
  const sig = new Uint8Array(buf.slice(offset, offset + 64));
  offset += 64;
  const challenge = new Uint8Array(buf.slice(offset, offset + 32));
  return { agentId, publicKey, sig, challenge };
}

function decodeHandshakeFinal(buf: Uint8Array): Uint8Array {
  if (buf[0] !== MSG_TYPE_HANDSHAKE_FINAL) {
    throw new HandshakeFailedError(`expected FINAL (0x03), got 0x${buf[0]!.toString(16)}`);
  }
  return buf.slice(1, 65);
}

/**
 * Verify a Ed25519 signature.
 * Returns false on any error rather than throwing.
 */
async function verifyEd25519(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  try {
    return await ed.verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}

// ── Binary framing helpers ────────────────────────────────────────

/**
 * Frame a message with a 4-byte LE length prefix.
 * Format: [4-byte msg-length LE][msg-bytes]
 */
function frame(data: Uint8Array): Buffer {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(data.length, 0);
  return Buffer.concat([header, data]);
}

/**
 * Async generator that reads framed messages from a socket.
 * Yields complete messages one at a time, enabling sequential async processing.
 * Format: [4-byte LE length][msg-bytes]
 */
async function* readFramedMessages(
  socket: net.Socket,
  maxFrameSize = MAX_CHANGESET_BYTES + 256
): AsyncGenerator<Uint8Array> {
  let buffer = Buffer.alloc(0);

  for await (const chunk of socket) {
    buffer = Buffer.concat([buffer, chunk as Buffer]);

    while (buffer.length >= 4) {
      const msgLen = buffer.readUInt32LE(0);
      if (msgLen > maxFrameSize) {
        throw new ChangesetTooLargeError(msgLen);
      }
      if (buffer.length < 4 + msgLen) break;
      yield new Uint8Array(buffer.slice(4, 4 + msgLen));
      buffer = buffer.slice(4 + msgLen);
    }
  }
}

// ── Unix socket transport ─────────────────────────────────────────

/**
 * UnixSocketTransport — primary transport for same-machine collaboration.
 *
 * - Listens on a Unix domain socket.
 * - Frames messages with 4-byte LE length prefix.
 * - Completes Ed25519 mutual handshake before passing changesets to the sync engine.
 * - Handles reconnection with 3-retry exponential backoff.
 * - Emits `peerError` events for unreachable peers.
 *
 * Spec: P3 spec §4.2, §4.3
 */
export class UnixSocketTransport extends EventEmitter implements PeerTransport {
  readonly type = 'unix';

  private readonly identity: TransportIdentity;
  private readonly socketPath: string;
  private server: net.Server | null = null;

  constructor(opts: {
    /** Local agent identity for handshakes. */
    identity: TransportIdentity;
    /**
     * Unix socket path. Must be an absolute path.
     * Address format for peers: `unix:<socketPath>`.
     */
    socketPath: string;
  }) {
    super();
    this.identity = opts.identity;
    this.socketPath = opts.socketPath;
  }

  /**
   * Listen for incoming connections on the Unix socket.
   * MUST NOT call onChangeset until the handshake completes.
   */
  async listen(onChangeset: (peerId: string, changeset: Uint8Array) => void): Promise<void> {
    // Remove stale socket file from previous crash.
    try {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(this.socketPath);
    } catch {
      // No stale file — fine.
    }

    return new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) => {
        this.handleIncomingConnection(socket, onChangeset).catch((err) => {
          this.emit('peerError', err);
          socket.destroy();
        });
      });

      server.once('error', reject);
      server.listen(this.socketPath, () => {
        this.server = server;
        resolve();
      });
    });
  }

  /**
   * Handle an incoming connection: run handshake as responder, then receive changesets.
   *
   * Uses an async generator over framed messages so each async step (signature
   * verify, sign) completes before the next message is processed — no race
   * between async callbacks and socket close events.
   */
  private async handleIncomingConnection(
    socket: net.Socket,
    onChangeset: (peerId: string, changeset: Uint8Array) => void
  ): Promise<void> {
    let peerAgentId = '';
    let peerPublicKey: Uint8Array = new Uint8Array(new ArrayBuffer(0));

    // Track whether the handshake completed so we can emit peerError correctly.
    let handshakeDone = false;

    try {
      const messages = readFramedMessages(socket);

      // ── Message 1: INIT ──
      const initResult = await messages.next();
      if (initResult.done) throw new HandshakeFailedError('connection closed before INIT');
      const init = decodeHandshakeInit(initResult.value);
      peerAgentId = init.agentId;
      peerPublicKey = init.publicKey;

      // Sign their challenge.
      const sig = await ed.signAsync(init.challenge, this.identity.privateKey);
      // Generate our challenge.
      const ourChallenge = randomChallenge();

      // ── Message 2: RESP ──
      const resp = encodeHandshakeResp(
        this.identity.agentId,
        this.identity.publicKey,
        sig,
        ourChallenge
      );
      await writeToSocket(socket, frame(resp));

      // ── Message 3: FINAL ──
      const finalResult = await messages.next();
      if (finalResult.done) throw new HandshakeFailedError('connection closed before FINAL');
      const finalSig = decodeHandshakeFinal(finalResult.value);
      const ok = await verifyEd25519(ourChallenge, finalSig, peerPublicKey);
      if (!ok) {
        throw new HandshakeFailedError(`initiator '${peerAgentId}' failed to sign our challenge`);
      }

      handshakeDone = true;

      // ── Changeset messages ──
      for await (const msg of messages) {
        if (msg[0] !== MSG_TYPE_CHANGESET) {
          console.warn(
            `[transport:unix] Unexpected message type 0x${msg[0]?.toString(16)} from '${peerAgentId}'`
          );
          continue;
        }
        const changeset = msg.slice(1);
        if (changeset.length > MAX_CHANGESET_BYTES) {
          throw new ChangesetTooLargeError(changeset.length);
        }
        onChangeset(peerAgentId, changeset);
      }
    } catch (err) {
      socket.destroy();
      if (!handshakeDone) {
        this.emit('peerError', err);
      }
      throw err;
    }
  }

  /**
   * Send a changeset to a peer.
   * Runs the full handshake as the initiator, then sends the changeset.
   * Retries up to MAX_RETRIES times with exponential backoff.
   */
  async sendChangeset(peerId: string, peerAddress: string, changeset: Uint8Array): Promise<void> {
    if (changeset.length > MAX_CHANGESET_BYTES) {
      throw new ChangesetTooLargeError(changeset.length);
    }

    // Parse address: `unix:<path>`
    const socketPath = parseUnixAddress(peerAddress);

    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.sendOnce(peerId, socketPath, changeset);
        return;
      } catch (err) {
        lastErr = err;
        if (err instanceof HandshakeFailedError) {
          // Do not retry handshake failures — they are security violations.
          this.emit('peerError', err);
          throw err;
        }
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
        }
      }
    }

    const error = new PeerUnreachableError(peerId, peerAddress, lastErr);
    this.emit('peerError', error);
    throw error;
  }

  /**
   * One connection attempt: connect, handshake as initiator, send changeset.
   *
   * Uses async generator for sequential message processing to avoid race
   * conditions between async crypto operations and socket events.
   */
  private async sendOnce(
    _peerId: string,
    socketPath: string,
    changeset: Uint8Array
  ): Promise<void> {
    const socket = await connectSocket(socketPath);

    try {
      const ourChallenge = randomChallenge();
      const messages = readFramedMessages(socket);

      // ── Message 1: send INIT ──
      const init = encodeHandshakeInit(
        this.identity.agentId,
        this.identity.publicKey,
        ourChallenge
      );
      await writeToSocket(socket, frame(init));

      // ── Message 2: receive RESP ──
      const respResult = await messages.next();
      if (respResult.done) throw new HandshakeFailedError('connection closed before RESP');
      const resp = decodeHandshakeResp(respResult.value);

      // Verify responder's signature of our challenge.
      const ok = await verifyEd25519(ourChallenge, resp.sig, resp.publicKey);
      if (!ok) {
        throw new HandshakeFailedError(`responder failed to sign our challenge`);
      }

      // ── Message 3: send FINAL ──
      const sig = await ed.signAsync(resp.challenge, this.identity.privateKey);
      const finalMsg = encodeHandshakeFinal(sig);
      await writeToSocket(socket, frame(finalMsg));

      // ── Send changeset ──
      const changesetMsg = new Uint8Array(1 + changeset.length);
      changesetMsg[0] = MSG_TYPE_CHANGESET;
      changesetMsg.set(changeset, 1);
      await writeToSocket(socket, frame(changesetMsg));

      // Graceful close — half-close the write side.
      await new Promise<void>((resolve, reject) => {
        socket.end((err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (err) {
      socket.destroy();
      throw err;
    }
  }

  /** Graceful shutdown: close the server and stop accepting connections. */
  async close(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
      this.server = null;
    });
  }
}

// ── HTTP transport ────────────────────────────────────────────────

/**
 * HttpTransport — secondary transport for cross-machine collaboration.
 *
 * - Listens on a local HTTP port.
 * - Changeset exchange: POST /mesh/changeset (binary body).
 * - Ed25519 handshake: POST /mesh/handshake (JSON body).
 * - Handles reconnection with 3-retry exponential backoff.
 * - Emits `peerError` events for unreachable peers.
 *
 * Spec: P3 spec §4.2, §4.3
 */
export class HttpTransport extends EventEmitter implements PeerTransport {
  readonly type = 'http';

  private readonly identity: TransportIdentity;
  private readonly port: number;
  private readonly host: string;
  private server: http.Server | null = null;
  /**
   * In-memory session store: maps `peerId -> { verified: true, peerPublicKey }`.
   * A session is established after the handshake and used to authorize changeset
   * delivery.
   */
  private readonly sessions = new Map<string, { peerPublicKey: Uint8Array }>();

  constructor(opts: {
    identity: TransportIdentity;
    port: number;
    host?: string;
  }) {
    super();
    this.identity = opts.identity;
    this.port = opts.port;
    this.host = opts.host ?? '127.0.0.1';
  }

  /**
   * Start the HTTP server and listen for incoming handshake + changeset requests.
   */
  async listen(onChangeset: (peerId: string, changeset: Uint8Array) => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res, onChangeset);
        } catch (err) {
          console.error('[transport:http] Unhandled request error:', err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end('Internal server error');
          }
        }
      });

      server.once('error', reject);
      server.listen(this.port, this.host, () => {
        this.server = server;
        resolve();
      });
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    onChangeset: (peerId: string, changeset: Uint8Array) => void
  ): Promise<void> {
    if (req.method === 'POST' && req.url === '/mesh/handshake') {
      await this.handleHandshakeRequest(req, res);
    } else if (req.method === 'POST' && req.url === '/mesh/changeset') {
      await this.handleChangesetRequest(req, res, onChangeset);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }

  /**
   * POST /mesh/handshake — 3-message handshake over HTTP.
   *
   * Phase 1 (client sends INIT JSON):
   *   { "phase": 1, "agentId": "...", "pubkey": "base64", "challenge": "base64" }
   * Server responds:
   *   { "agentId": "...", "pubkey": "base64", "sig": "base64", "challenge": "base64" }
   *
   * Phase 2 (client sends FINAL JSON):
   *   { "phase": 2, "agentId": "...", "sig": "base64" }
   * Server responds:
   *   { "ok": true }
   */
  private async handleHandshakeRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body = await readBody(req, 65_536 /* 64 KB max for handshake */);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body.toString('utf-8')) as Record<string, unknown>;
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'invalid JSON' }));
      return;
    }

    const phase = payload['phase'];

    if (phase === 1) {
      // INIT phase — verify fields exist.
      const peerAgentId = String(payload['agentId'] ?? '');
      const peerPubkeyB64 = String(payload['pubkey'] ?? '');
      const peerChallengeB64 = String(payload['challenge'] ?? '');

      if (!peerAgentId || !peerPubkeyB64 || !peerChallengeB64) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'HANDSHAKE_FAILED: missing fields' }));
        return;
      }

      let peerPublicKey: Uint8Array;
      let peerChallenge: Uint8Array;
      try {
        peerPublicKey = new Uint8Array(Buffer.from(peerPubkeyB64, 'base64'));
        peerChallenge = new Uint8Array(Buffer.from(peerChallengeB64, 'base64'));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'HANDSHAKE_FAILED: invalid base64' }));
        return;
      }

      if (peerPublicKey.length !== 32) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'HANDSHAKE_FAILED: pubkey must be 32 bytes' }));
        return;
      }

      // Sign their challenge.
      const sig = await ed.signAsync(peerChallenge, this.identity.privateKey);

      // Generate our challenge.
      const ourChallenge = randomChallenge();

      // Store pending session (phase 1 complete — awaiting FINAL).
      this.sessions.set(`pending:${peerAgentId}`, {
        peerPublicKey,
      });
      // Store challenge keyed by agentId for phase 2 verification.
      this.sessions.set(`challenge:${peerAgentId}`, {
        peerPublicKey: ourChallenge, // reuse field to store challenge bytes
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          agentId: this.identity.agentId,
          pubkey: Buffer.from(this.identity.publicKey).toString('base64'),
          sig: Buffer.from(sig).toString('base64'),
          challenge: Buffer.from(ourChallenge).toString('base64'),
        })
      );
    } else if (phase === 2) {
      // FINAL phase — verify initiator's signature.
      const peerAgentId = String(payload['agentId'] ?? '');
      const sigB64 = String(payload['sig'] ?? '');

      if (!peerAgentId || !sigB64) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'HANDSHAKE_FAILED: missing fields' }));
        return;
      }

      const pendingSession = this.sessions.get(`pending:${peerAgentId}`);
      const challengeEntry = this.sessions.get(`challenge:${peerAgentId}`);

      if (!pendingSession || !challengeEntry) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'HANDSHAKE_FAILED: no pending session' }));
        return;
      }

      let sig: Uint8Array;
      try {
        sig = new Uint8Array(Buffer.from(sigB64, 'base64'));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'HANDSHAKE_FAILED: invalid sig base64' }));
        return;
      }

      const ourChallenge = challengeEntry.peerPublicKey; // stored challenge bytes
      const peerPublicKey = pendingSession.peerPublicKey;

      const ok = await verifyEd25519(ourChallenge, sig, peerPublicKey);
      if (!ok) {
        this.sessions.delete(`pending:${peerAgentId}`);
        this.sessions.delete(`challenge:${peerAgentId}`);
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'HANDSHAKE_FAILED: signature verification failed' }));
        return;
      }

      // Promote to authenticated session.
      this.sessions.delete(`pending:${peerAgentId}`);
      this.sessions.delete(`challenge:${peerAgentId}`);
      this.sessions.set(peerAgentId, { peerPublicKey });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'HANDSHAKE_FAILED: unknown phase' }));
    }
  }

  /**
   * POST /mesh/changeset — receive a changeset from an authenticated peer.
   *
   * MUST have a valid authenticated session (completed handshake).
   * Request headers: `X-Agent-Id: <agentId>`.
   * Body: raw binary changeset (application/octet-stream).
   * Response: 200 OK with empty body (or delta body in future bidirectional sync).
   */
  private async handleChangesetRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    onChangeset: (peerId: string, changeset: Uint8Array) => void
  ): Promise<void> {
    const peerAgentId = req.headers['x-agent-id'];
    if (typeof peerAgentId !== 'string' || !peerAgentId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'missing X-Agent-Id header' }));
      return;
    }

    // MUST have completed handshake.
    if (!this.sessions.has(peerAgentId)) {
      res.writeHead(401);
      res.end(
        JSON.stringify({ error: 'HANDSHAKE_FAILED: no authenticated session — complete handshake first' })
      );
      return;
    }

    const changeset = await readBody(req, MAX_CHANGESET_BYTES);
    if (changeset.length > MAX_CHANGESET_BYTES) {
      res.writeHead(413);
      res.end(JSON.stringify({ error: 'changeset too large' }));
      return;
    }

    onChangeset(peerAgentId, new Uint8Array(changeset));

    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(); // In Phase 3, delta response is a future enhancement.
  }

  /**
   * Send a changeset to a peer via HTTP.
   * Performs the 2-phase handshake first, then POST /mesh/changeset.
   * Retries up to MAX_RETRIES times.
   */
  async sendChangeset(peerId: string, peerAddress: string, changeset: Uint8Array): Promise<void> {
    if (changeset.length > MAX_CHANGESET_BYTES) {
      throw new ChangesetTooLargeError(changeset.length);
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.sendOnce(peerId, peerAddress, changeset);
        return;
      } catch (err) {
        lastErr = err;
        if (err instanceof HandshakeFailedError) {
          this.emit('peerError', err);
          throw err;
        }
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
        }
      }
    }

    const error = new PeerUnreachableError(peerId, peerAddress, lastErr);
    this.emit('peerError', error);
    throw error;
  }

  private async sendOnce(
    peerId: string,
    peerAddress: string,
    changeset: Uint8Array
  ): Promise<void> {
    const baseUrl = peerAddress.startsWith('http') ? peerAddress : `http://${peerAddress}`;

    // ── Phase 1 handshake ──
    const ourChallenge = randomChallenge();
    const initBody = JSON.stringify({
      phase: 1,
      agentId: this.identity.agentId,
      pubkey: Buffer.from(this.identity.publicKey).toString('base64'),
      challenge: Buffer.from(ourChallenge).toString('base64'),
    });

    const phase1Resp = await httpPost(`${baseUrl}/mesh/handshake`, initBody, {
      'Content-Type': 'application/json',
    });

    let phase1Data: {
      agentId: string;
      pubkey: string;
      sig: string;
      challenge: string;
    };
    try {
      phase1Data = JSON.parse(phase1Resp.toString('utf-8')) as typeof phase1Data;
    } catch {
      throw new HandshakeFailedError('invalid JSON in phase 1 response');
    }

    // Verify responder's signature of our challenge.
    const peerPublicKey = new Uint8Array(Buffer.from(phase1Data.pubkey, 'base64'));
    const peerSig = new Uint8Array(Buffer.from(phase1Data.sig, 'base64'));
    const peerChallenge = new Uint8Array(Buffer.from(phase1Data.challenge, 'base64'));

    const ok = await verifyEd25519(ourChallenge, peerSig, peerPublicKey);
    if (!ok) {
      throw new HandshakeFailedError(`responder '${peerId}' failed to sign our challenge`);
    }

    // ── Phase 2 handshake — sign their challenge ──
    const ourSig = await ed.signAsync(peerChallenge, this.identity.privateKey);
    const finalBody = JSON.stringify({
      phase: 2,
      agentId: this.identity.agentId,
      sig: Buffer.from(ourSig).toString('base64'),
    });

    const phase2Resp = await httpPost(`${baseUrl}/mesh/handshake`, finalBody, {
      'Content-Type': 'application/json',
    });
    const phase2Data = JSON.parse(phase2Resp.toString('utf-8')) as { ok?: boolean };
    if (!phase2Data.ok) {
      throw new HandshakeFailedError('server rejected FINAL handshake message');
    }

    // ── Send changeset ──
    await httpPost(`${baseUrl}/mesh/changeset`, Buffer.from(changeset), {
      'Content-Type': 'application/octet-stream',
      'X-Agent-Id': this.identity.agentId,
    });
  }

  /** Graceful shutdown. */
  async close(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
      this.server = null;
    });
  }
}

// ── Utility functions ─────────────────────────────────────────────

/**
 * Connect a client Unix socket and wait for the 'connect' event.
 */
function connectSocket(socketPath: string): Promise<net.Socket> {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    socket.once('error', reject);
    socket.once('connect', () => resolve(socket));
  });
}

/**
 * Write data to a socket and wait for the flush callback.
 */
function writeToSocket(socket: net.Socket, data: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.write(data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Parse a `unix:<path>` address string and return the socket path.
 */
function parseUnixAddress(address: string): string {
  if (!address.startsWith('unix:')) {
    throw new Error(`[transport:unix] Invalid address '${address}': expected 'unix:<path>'`);
  }
  return address.slice('unix:'.length);
}

/**
 * Read a complete HTTP request body up to `maxBytes`.
 * Throws if the body exceeds `maxBytes`.
 */
async function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        reject(new ChangesetTooLargeError(totalBytes));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Perform an HTTP POST request and return the response body.
 */
function httpPost(
  url: string,
  body: string | Buffer,
  headers: Record<string, string>
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const bodyBuffer = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;
    const parsed = new URL(url);

    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : 80,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': String(bodyBuffer.length),
      },
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks);
        if (res.statusCode !== undefined && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(
            new Error(
              `[transport:http] POST ${url} returned HTTP ${res.statusCode}: ${responseBody.toString('utf-8').slice(0, 200)}`
            )
          );
        } else {
          resolve(responseBody);
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

/**
 * Sleep for `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
