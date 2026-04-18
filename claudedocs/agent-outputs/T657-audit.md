# T657: Transport Code Audit

**Task**: T657 — Audit transport code locations
**Date**: 2026-04-18
**Status**: complete

---

## Summary

All transport code currently lives in a single file:
`packages/llmtxt/src/mesh/transport.ts` (1025 lines).

There is also a duplicate/minimal `PeerTransport` interface in:
`packages/llmtxt/src/mesh/sync-engine.ts` (lines 24-29).

---

## Files with Transport Code

### Primary: `packages/llmtxt/src/mesh/transport.ts`

**Exports** (public API surface):
- `MAX_CHANGESET_BYTES` — constant: 10 MB limit
- `MAX_RETRIES` — constant: 3 retries
- `RETRY_BASE_MS` — constant: 1000 ms base backoff
- `HandshakeFailedError` — error class, code `HANDSHAKE_FAILED`
- `PeerUnreachableError` — error class, code `PEER_UNREACHABLE`
- `ChangesetTooLargeError` — error class, code `CHANGESET_TOO_LARGE`
- `PeerTransport` — interface (extends EventEmitter)
- `TransportIdentity` — interface (agentId, publicKey, privateKey)
- `UnixSocketTransport` — class implementing PeerTransport
- `HttpTransport` — class implementing PeerTransport

**Internal (not exported)**:
- `MSG_TYPE_HANDSHAKE_INIT = 0x01`
- `MSG_TYPE_HANDSHAKE_RESP = 0x02`
- `MSG_TYPE_HANDSHAKE_FINAL = 0x03`
- `MSG_TYPE_CHANGESET = 0x04`
- `HandshakeInitData` — interface
- `HandshakeRespData` — interface
- `randomChallenge()` — generates 32-byte random challenge
- `encodeHandshakeInit()` — encodes INIT message
- `encodeHandshakeResp()` — encodes RESP message
- `encodeHandshakeFinal()` — encodes FINAL message
- `decodeHandshakeInit()` — decodes INIT message
- `decodeHandshakeResp()` — decodes RESP message
- `decodeHandshakeFinal()` — extracts signature from FINAL
- `verifyEd25519()` — async signature verification wrapper
- `frame()` — 4-byte LE length prefix framing
- `readFramedMessages()` — async generator for framed socket messages
- `connectSocket()` — connects Unix socket
- `writeToSocket()` — writes to socket with flush callback
- `parseUnixAddress()` — parses `unix:<path>` address format
- `readBody()` — reads HTTP request body up to maxBytes
- `httpPost()` — performs HTTP POST, returns body buffer
- `sleep()` — promise-based setTimeout

### Secondary (duplicate interface): `packages/llmtxt/src/mesh/sync-engine.ts`

Lines 24-29 define a **local `PeerTransport` interface** that partially duplicates
the one in `transport.ts`. It is narrower (no `EventEmitter` extension, `onMessage`
parameter instead of `onChangeset`). The `SyncEngine` class imports this local type
rather than importing from `transport.ts`.

---

## Frame Format

```
[4-byte LE msg-length][msg-bytes]
```

Max frame size: `MAX_CHANGESET_BYTES + 256` bytes.

### Handshake Message Layout

**INIT (0x01)**:
```
[0x01][agentId-len:u8][agentId:utf8][pubkey:32B][challenge:32B]
```

**RESP (0x02)**:
```
[0x02][agentId-len:u8][agentId:utf8][pubkey:32B][sig:64B][challenge:32B]
```

**FINAL (0x03)**:
```
[0x03][sig:64B]
```

**CHANGESET (0x04)**:
```
[0x04][payload:N bytes]
```

---

## Transport Addresses

- Unix: `unix:<absolute-path>` (e.g., `unix:/tmp/agent.sock`)
- HTTP: `http://<host>:<port>` (e.g., `http://127.0.0.1:9000`)

---

## HTTP Endpoints (HttpTransport)

- `POST /mesh/handshake` — 2-phase JSON handshake
- `POST /mesh/changeset` — binary changeset delivery (requires `X-Agent-Id` header and prior handshake)

---

## Dependencies

- `@noble/ed25519` — Ed25519 sign/verify
- `@noble/hashes/sha2.js` — sha512 for noble ed25519 v3
- `node:events` — EventEmitter base
- `node:net` — Unix socket
- `node:http` — HTTP server/client
- `node:crypto` — not imported (uses `globalThis.crypto.getRandomValues`)

---

## Existing Tests

`packages/llmtxt/src/__tests__/transport.test.ts` — 8 tests covering:
1. UnixSocketTransport listen/close
2. Full Unix handshake + changeset delivery
3. Unix: server rejects tampered signature
4. HttpTransport listen/close
5. HTTP phase-1 handshake returns signed challenge
6. HTTP: changeset rejected without handshake
7. HTTP: full handshake + changeset delivery
8. ChangesetTooLargeError for oversized changesets

Tests currently import from `../mesh/transport.js` — will need update after move.

---

## Extraction Plan

1. Move `packages/llmtxt/src/mesh/transport.ts` → `packages/llmtxt/src/transport/index.ts`
2. Add `packages/llmtxt/src/transport/` subpath export in `package.json`
3. Update `mesh/sync-engine.ts` to import `PeerTransport` from `../transport/index.js`
   and remove the duplicate local interface
4. Update existing test import path from `../mesh/transport.js` → `../transport/index.js`
5. Add `llmtxt/transport` to package.json exports map

---

## Zero-Duplication Checklist

- [ ] `mesh/transport.ts` deleted (replaced by `transport/index.ts`)
- [ ] `mesh/sync-engine.ts` local `PeerTransport` interface removed; imports from `../transport/index.js`
- [ ] Test file import updated
- [ ] No barrel re-export in mesh that duplicates the transport interface
