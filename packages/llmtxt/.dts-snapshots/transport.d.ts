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
import { EventEmitter } from 'node:events';
/** Maximum changeset size: 10 MB (P3 spec §10). */
export declare const MAX_CHANGESET_BYTES: number;
/** Number of retry attempts before giving up. */
export declare const MAX_RETRIES = 3;
/** Base backoff delay in milliseconds (doubles each retry). */
export declare const RETRY_BASE_MS = 1000;
/** Thrown when the Ed25519 mutual handshake fails. */
export declare class HandshakeFailedError extends Error {
    readonly code = "HANDSHAKE_FAILED";
    constructor(reason: string);
}
/** Thrown when a peer is unreachable after max retries. */
export declare class PeerUnreachableError extends Error {
    readonly code = "PEER_UNREACHABLE";
    constructor(peerId: string, address: string, cause?: unknown);
}
/** Thrown when a changeset exceeds the maximum size. */
export declare class ChangesetTooLargeError extends Error {
    readonly code = "CHANGESET_TOO_LARGE";
    constructor(bytes: number);
}
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
export declare class UnixSocketTransport extends EventEmitter implements PeerTransport {
    readonly type = "unix";
    private readonly identity;
    private readonly socketPath;
    private server;
    constructor(opts: {
        /** Local agent identity for handshakes. */
        identity: TransportIdentity;
        /**
         * Unix socket path. Must be an absolute path.
         * Address format for peers: `unix:<socketPath>`.
         */
        socketPath: string;
    });
    /**
     * Listen for incoming connections on the Unix socket.
     * MUST NOT call onChangeset until the handshake completes.
     */
    listen(onChangeset: (peerId: string, changeset: Uint8Array) => void): Promise<void>;
    /**
     * Handle an incoming connection: run handshake as responder, then receive changesets.
     *
     * Uses an async generator over framed messages so each async step (signature
     * verify, sign) completes before the next message is processed — no race
     * between async callbacks and socket close events.
     */
    private handleIncomingConnection;
    /**
     * Send a changeset to a peer.
     * Runs the full handshake as the initiator, then sends the changeset.
     * Retries up to MAX_RETRIES times with exponential backoff.
     */
    sendChangeset(peerId: string, peerAddress: string, changeset: Uint8Array): Promise<void>;
    /**
     * One connection attempt: connect, handshake as initiator, send changeset.
     *
     * Uses async generator for sequential message processing to avoid race
     * conditions between async crypto operations and socket events.
     */
    private sendOnce;
    /** Graceful shutdown: close the server and stop accepting connections. */
    close(): Promise<void>;
}
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
export declare class HttpTransport extends EventEmitter implements PeerTransport {
    readonly type = "http";
    private readonly identity;
    private readonly port;
    private readonly host;
    private server;
    /**
     * In-memory session store: maps `peerId -> { verified: true, peerPublicKey }`.
     * A session is established after the handshake and used to authorize changeset
     * delivery.
     */
    private readonly sessions;
    constructor(opts: {
        identity: TransportIdentity;
        port: number;
        host?: string;
    });
    /**
     * Start the HTTP server and listen for incoming handshake + changeset requests.
     */
    listen(onChangeset: (peerId: string, changeset: Uint8Array) => void): Promise<void>;
    private handleRequest;
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
    private handleHandshakeRequest;
    /**
     * POST /mesh/changeset — receive a changeset from an authenticated peer.
     *
     * MUST have a valid authenticated session (completed handshake).
     * Request headers: `X-Agent-Id: <agentId>`.
     * Body: raw binary changeset (application/octet-stream).
     * Response: 200 OK with empty body (or delta body in future bidirectional sync).
     */
    private handleChangesetRequest;
    /**
     * Send a changeset to a peer via HTTP.
     * Performs the 2-phase handshake first, then POST /mesh/changeset.
     * Retries up to MAX_RETRIES times.
     */
    sendChangeset(peerId: string, peerAddress: string, changeset: Uint8Array): Promise<void>;
    private sendOnce;
    /** Graceful shutdown. */
    close(): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map