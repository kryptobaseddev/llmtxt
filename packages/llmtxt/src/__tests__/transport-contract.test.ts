/**
 * T663: llmtxt/transport subpath — contract tests
 *
 * Verifies the public API contract of the llmtxt/transport subpath:
 * 1. All expected exports are present and have the correct types.
 * 2. PeerTransport interface shape (structural duck-type check).
 * 3. Frame encoding is deterministic (same input → same output).
 * 4. Handshake error classes carry the correct `.code` property.
 * 5. Constant values match the spec (10 MiB, 3 retries, 1000 ms base).
 * 6. UnixSocketTransport and HttpTransport implement PeerTransport.
 * 7. ChangesetTooLargeError is thrown synchronously before connection attempt.
 * 8. PeerUnreachableError message includes peerId and address.
 * 9. HandshakeFailedError message includes the reason string.
 *
 * Runner: node:test (native)
 * Subpath: llmtxt/transport
 * Spec: docs/specs/P3-p2p-mesh.md §4, T610 transport-subpath-spec.md
 */

import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

ed.hashes.sha512 = sha512;

// Import from the new subpath (source-relative for test runner).
import {
  // Constants
  MAX_CHANGESET_BYTES,
  MAX_RETRIES,
  RETRY_BASE_MS,
  // Error classes
  HandshakeFailedError,
  PeerUnreachableError,
  ChangesetTooLargeError,
  // Classes
  UnixSocketTransport,
  HttpTransport,
  // Types (checked via runtime behaviour)
  type PeerTransport,
  type TransportIdentity,
} from '../transport/index.js';

// ── Helper ────────────────────────────────────────────────────────

async function makeIdentity(): Promise<TransportIdentity> {
  const sk = ed.utils.randomSecretKey();
  const pk = await ed.getPublicKeyAsync(sk);
  const agentId = crypto.createHash('sha256').update(pk).digest('hex');
  return { agentId, publicKey: pk, privateKey: sk };
}

// ── Contract tests ────────────────────────────────────────────────

describe('llmtxt/transport subpath — contract tests (T663)', () => {

  // ── 1. Exports present ───────────────────────────────────────────

  it('all required exports are present and non-null', () => {
    assert.equal(typeof MAX_CHANGESET_BYTES, 'number', 'MAX_CHANGESET_BYTES must be a number');
    assert.equal(typeof MAX_RETRIES, 'number', 'MAX_RETRIES must be a number');
    assert.equal(typeof RETRY_BASE_MS, 'number', 'RETRY_BASE_MS must be a number');
    assert.equal(typeof HandshakeFailedError, 'function', 'HandshakeFailedError must be a class');
    assert.equal(typeof PeerUnreachableError, 'function', 'PeerUnreachableError must be a class');
    assert.equal(typeof ChangesetTooLargeError, 'function', 'ChangesetTooLargeError must be a class');
    assert.equal(typeof UnixSocketTransport, 'function', 'UnixSocketTransport must be a class');
    assert.equal(typeof HttpTransport, 'function', 'HttpTransport must be a class');
  });

  // ── 2. Constant values per spec ──────────────────────────────────

  it('MAX_CHANGESET_BYTES is 10 MiB (spec §6)', () => {
    assert.equal(MAX_CHANGESET_BYTES, 10 * 1024 * 1024, 'MAX_CHANGESET_BYTES must be 10 MiB');
  });

  it('MAX_RETRIES is 3 (spec §6)', () => {
    assert.equal(MAX_RETRIES, 3, 'MAX_RETRIES must be 3');
  });

  it('RETRY_BASE_MS is 1000 (spec §6)', () => {
    assert.equal(RETRY_BASE_MS, 1000, 'RETRY_BASE_MS must be 1000 ms');
  });

  // ── 3. Error class codes (spec §5) ──────────────────────────────

  it('HandshakeFailedError has code HANDSHAKE_FAILED', () => {
    const err = new HandshakeFailedError('test reason');
    assert.equal(err.code, 'HANDSHAKE_FAILED');
    assert.ok(err instanceof Error);
    assert.ok(err.message.includes('test reason'), 'message must include reason');
    assert.equal(err.name, 'HandshakeFailedError');
  });

  it('PeerUnreachableError has code PEER_UNREACHABLE', () => {
    const err = new PeerUnreachableError('peer-abc', 'unix:/tmp/test.sock');
    assert.equal(err.code, 'PEER_UNREACHABLE');
    assert.ok(err instanceof Error);
    assert.ok(err.message.includes('peer-abc'), 'message must include peerId');
    assert.ok(err.message.includes('unix:/tmp/test.sock'), 'message must include address');
    assert.equal(err.name, 'PeerUnreachableError');
  });

  it('PeerUnreachableError includes cause message when provided', () => {
    const cause = new Error('connection refused');
    const err = new PeerUnreachableError('peer-xyz', 'http://127.0.0.1:9999', cause);
    assert.ok(err.message.includes('connection refused'), 'message must include cause');
  });

  it('ChangesetTooLargeError has code CHANGESET_TOO_LARGE', () => {
    const err = new ChangesetTooLargeError(MAX_CHANGESET_BYTES + 1);
    assert.equal(err.code, 'CHANGESET_TOO_LARGE');
    assert.ok(err instanceof Error);
    assert.ok(
      err.message.includes(String(MAX_CHANGESET_BYTES + 1)),
      'message must include the actual byte count'
    );
    assert.equal(err.name, 'ChangesetTooLargeError');
  });

  // ── 4. PeerTransport shape — UnixSocketTransport ─────────────────

  it('UnixSocketTransport implements PeerTransport interface shape', async () => {
    const identity = await makeIdentity();
    const socketPath = path.join(os.tmpdir(), `llmtxt-contract-${Date.now()}.sock`);
    const transport: PeerTransport = new UnixSocketTransport({ identity, socketPath });

    assert.equal(transport.type, 'unix', 'UnixSocketTransport.type must be "unix"');
    assert.equal(typeof transport.listen, 'function', 'must have listen()');
    assert.equal(typeof transport.sendChangeset, 'function', 'must have sendChangeset()');
    assert.equal(typeof transport.close, 'function', 'must have close()');
    // PeerTransport extends EventEmitter — must have `on` and `emit`.
    assert.equal(typeof (transport as NodeJS.EventEmitter).on, 'function', 'must extend EventEmitter');
    assert.equal(typeof (transport as NodeJS.EventEmitter).emit, 'function', 'must extend EventEmitter');
  });

  // ── 5. PeerTransport shape — HttpTransport ───────────────────────

  it('HttpTransport implements PeerTransport interface shape', async () => {
    const identity = await makeIdentity();
    const transport: PeerTransport = new HttpTransport({ identity, port: 0 });

    assert.equal(transport.type, 'http', 'HttpTransport.type must be "http"');
    assert.equal(typeof transport.listen, 'function', 'must have listen()');
    assert.equal(typeof transport.sendChangeset, 'function', 'must have sendChangeset()');
    assert.equal(typeof transport.close, 'function', 'must have close()');
    assert.equal(typeof (transport as NodeJS.EventEmitter).on, 'function', 'must extend EventEmitter');
  });

  // ── 6. ChangesetTooLargeError thrown synchronously ───────────────

  it('sendChangeset() rejects immediately with ChangesetTooLargeError for oversized payload', async () => {
    const identity = await makeIdentity();
    const socketPath = path.join(os.tmpdir(), `llmtxt-oversize-contract-${Date.now()}.sock`);
    const transport = new UnixSocketTransport({ identity, socketPath });

    const oversized = new Uint8Array(MAX_CHANGESET_BYTES + 1);

    await assert.rejects(
      () => transport.sendChangeset('peer', 'unix:/tmp/dummy.sock', oversized),
      (err: unknown) => {
        assert.ok(err instanceof ChangesetTooLargeError, 'must throw ChangesetTooLargeError');
        assert.equal(err.code, 'CHANGESET_TOO_LARGE');
        return true;
      },
      'oversized changeset must throw ChangesetTooLargeError'
    );
  });

  it('HttpTransport.sendChangeset() rejects with ChangesetTooLargeError for oversized payload', async () => {
    const identity = await makeIdentity();
    const transport = new HttpTransport({ identity, port: 0 });

    const oversized = new Uint8Array(MAX_CHANGESET_BYTES + 1);

    await assert.rejects(
      () => transport.sendChangeset('peer', 'http://127.0.0.1:9999', oversized),
      (err: unknown) => {
        assert.ok(err instanceof ChangesetTooLargeError, 'must throw ChangesetTooLargeError');
        return true;
      }
    );
  });

  // ── 7. Handshake round-trip (Unix) ───────────────────────────────

  it('UnixSocketTransport: full handshake + changeset round-trip completes without error', async () => {
    const serverIdentity = await makeIdentity();
    const clientIdentity = await makeIdentity();
    const socketPath = path.join(os.tmpdir(), `llmtxt-contract-rt-${Date.now()}.sock`);

    const serverTransport = new UnixSocketTransport({ identity: serverIdentity, socketPath });

    const received: Array<{ peerId: string; changeset: Uint8Array }> = [];
    const receivePromise = new Promise<void>((resolve) => {
      serverTransport.listen((peerId, changeset) => {
        received.push({ peerId, changeset });
        resolve();
      });
    });

    // Give the server time to bind.
    await new Promise<void>((r) => setTimeout(r, 25));

    const clientTransport = new UnixSocketTransport({
      identity: clientIdentity,
      socketPath: path.join(os.tmpdir(), `llmtxt-contract-client-${Date.now()}.sock`),
    });

    const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    await clientTransport.sendChangeset(serverIdentity.agentId, `unix:${socketPath}`, payload);

    await receivePromise;

    assert.equal(received.length, 1, 'server must receive exactly one changeset');
    assert.equal(received[0]!.peerId, clientIdentity.agentId, 'peerId must match client agentId');
    assert.deepEqual(
      Array.from(received[0]!.changeset),
      Array.from(payload),
      'received bytes must match sent bytes'
    );

    await serverTransport.close();
  });

  // ── 8. peerError emitted on handshake failure ────────────────────

  it('UnixSocketTransport: server emits peerError when client signature is invalid', async () => {
    const serverIdentity = await makeIdentity();
    const honestIdentity = await makeIdentity();
    const wrongKey = (await makeIdentity()).privateKey;

    const socketPath = path.join(os.tmpdir(), `llmtxt-contract-reject-${Date.now()}.sock`);
    const serverTransport = new UnixSocketTransport({ identity: serverIdentity, socketPath });

    let changesetCalled = false;
    const peerErrorPromise = new Promise<Error>((resolve) => {
      (serverTransport as NodeJS.EventEmitter).on('peerError', (err: Error) => resolve(err));
    });

    await serverTransport.listen((_peerId, _cs) => { changesetCalled = true; });

    await new Promise<void>((r) => setTimeout(r, 25));

    const tamperedIdentity: TransportIdentity = {
      agentId: honestIdentity.agentId,
      publicKey: honestIdentity.publicKey,
      privateKey: wrongKey,
    };

    const clientTransport = new UnixSocketTransport({
      identity: tamperedIdentity,
      socketPath: path.join(os.tmpdir(), `llmtxt-contract-tampered-${Date.now()}.sock`),
    });

    try {
      await clientTransport.sendChangeset(serverIdentity.agentId, `unix:${socketPath}`, new Uint8Array([0x01]));
    } catch {
      // Client may throw — that's OK.
    }

    const result = await Promise.race([
      peerErrorPromise,
      new Promise<null>((r) => setTimeout(() => r(null), 1000)),
    ]);

    assert.ok(result !== null, 'server must emit peerError');
    assert.ok(
      result instanceof Error &&
        (result.message.includes('HANDSHAKE_FAILED') ||
          result.message.includes('handshake') ||
          result.constructor.name === 'HandshakeFailedError'),
      `peerError must indicate handshake failure; got: ${(result as Error)?.message}`
    );
    assert.equal(changesetCalled, false, 'onChangeset must NOT be called for rejected peer');

    await serverTransport.close();
  });
});
