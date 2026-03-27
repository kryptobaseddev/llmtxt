# Portable Core Contract

Version: 2.0.0
Status: ACTIVE

## Purpose

This document defines the subset of `llmtxt` functions that MUST produce
byte-identical output across all consumers. The Rust crate (`crates/llmtxt-core`)
is the **single source of truth**. It ships two ways:

- **WASM** (via `wasm-pack`): loaded by the TypeScript npm package (`llmtxt`)
- **Native** (via Cargo): consumed directly by Rust services (e.g. SignalDock)

```
Rust (crates/llmtxt-core/)  -->  wasm-pack  -->  WASM (85.6KB)  -->  TS wrapper  -->  npm
                             \-> Cargo dep  -->  SignalDock (native)
```

Because both consumers execute the same compiled Rust code, cross-platform drift
is eliminated by construction.

## Portable Functions

### 1. compress / decompress

- **Algorithm**: zlib-wrapped deflate (RFC 1950), default compression level
- **Encoding**: Input is UTF-8 string, output is zlib-wrapped deflate bytes
- **Contract**: `decompress(compress(input)) === input` for any valid UTF-8 string
- **Rust**: `flate2::read::ZlibEncoder` / `flate2::read::ZlibDecoder`
- **TypeScript wrapper**: async `Promise<Buffer>` for backward compat; WASM call is sync

#### Test Vectors

```
Input:  "Hello, world!"
Output: (zlib-wrapped deflate bytes) — round-trip correctness is the guarantee

Input:  "" (empty string)
Output: (valid zlib of empty, must decompress to "")

Input:  "{"key":"value","nested":{"a":1}}"
Output: (zlib bytes, must decompress to exact input)
```

Note: Exact compressed bytes may vary by compression level. The contract is
round-trip correctness: `decompress(compress(x)) === x` for all inputs.
Cross-consumer decompression is the critical guarantee: bytes compressed by
WASM must decompress correctly in native Rust and vice versa.

### 2. generateId

- **Algorithm**: UUID v4 → remove dashes → take first 16 hex chars → parse as u64 → base62 encode → pad to 8 chars (left-pad with `'0'`, truncate to 8)
- **Base62 alphabet**: `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`
- **Output**: Always exactly 8 characters
- **Contract**: Output matches regex `^[0-9A-Za-z]{8}$`

Note: Output is random, so no fixed test vectors. Verify format and base62 round-trip:
`decodeBase62(encodeBase62(n)) === n` for all non-negative integers.

### 3. hashContent

- **Algorithm**: SHA-256
- **Input encoding**: UTF-8
- **Output**: Lowercase hex-encoded digest (64 characters)

#### Test Vectors

```
Input:  "hello"
Output: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"

Input:  ""
Output: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
```

### 4. calculateTokens

- **Algorithm**: `ceil(byte_length / 4)` where byte_length is the UTF-8 byte count (Rust: `text.len()`, JS: string `.length` for ASCII-dominated text)
- **Output**: Non-negative integer

#### Test Vectors

```
Input:  "Hello, world!"  (13 bytes)
Output: 4

Input:  ""  (0 bytes)
Output: 0

Input:  "a"  (1 byte)
Output: 1

Input:  "1234"  (4 bytes)
Output: 1

Input:  "12345"  (5 bytes)
Output: 2
```

### 5. encodeBase62 / decodeBase62

- **Alphabet**: `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`
- **Encoding**: Big-endian (most significant digit first)
- **Zero**: `encodeBase62(0) === "0"`
- **TypeScript wrapper note**: WASM uses `u64`/`bigint`; the TS wrapper converts `number` ↔ `bigint`

#### Test Vectors

```
encodeBase62(0)    === "0"
encodeBase62(1)    === "1"
encodeBase62(61)   === "z"
encodeBase62(62)   === "10"
encodeBase62(3844) === "100"

decodeBase62("0")   === 0
decodeBase62("z")   === 61
decodeBase62("10")  === 62
decodeBase62("100") === 3844
```

### 6. computeSignature

- **Algorithm**: HMAC-SHA256
- **Payload format**: `"${slug}:${agentId}:${conversationId}:${expiresAt}"`
- **Output**: First 16 characters of the hex-encoded HMAC digest (lowercase)
- **Rust signature**: `compute_signature(slug, agent_id, conversation_id, expires_at: f64, secret)` — 5 positional args
- **TypeScript public API**: `computeSignature(params: SignedUrlParams, secret)` — struct wrapper in `signed-url.ts`

#### Test Vectors

```
Params: { slug: "xK9mP2nQ", agentId: "test-agent", conversationId: "conv_123", expiresAt: 1700000000000 }
Secret: "test-secret"
Payload: "xK9mP2nQ:test-agent:conv_123:1700000000000"
Output: "650eb9dd6c396a45"
```

### 7. calculateCompressionRatio

- **Algorithm**: `round(originalSize / compressedSize, 2)` — returns 1.0 when compressedSize is 0
- **Output**: Float rounded to 2 decimal places

#### Test Vectors

```
calculateCompressionRatio(1000, 400)  === 2.5
calculateCompressionRatio(100, 100)   === 1.0
calculateCompressionRatio(100, 0)     === 1.0
calculateCompressionRatio(500, 200)   === 2.5
```

### 8. deriveSigningKey

- **Algorithm**: `HMAC-SHA256(apiKey, "llmtxt-signing")`
- **Output**: Full hex-encoded HMAC digest (64 characters)
- **Purpose**: Derive a per-agent signing key from their API key, avoiding shared secrets

#### Test Vectors

```
Input:  apiKey = "sk_live_abc123"
Output: "fb5f79640e9ed141d4949ccb36110c7aaf829c56d9870942dd77219a57575372"
```

### 9. isExpired

- **Algorithm**: Compare `expiresAtMs` to current time (`Date.now()` / `js_sys::Date::now()`)
- **Input**: Unix timestamp in milliseconds (0 or `null`/`undefined` means no expiration)
- **Output**: `true` if the timestamp is in the past; `false` for 0/null/undefined
- **TypeScript wrapper**: Handles `null | undefined` → converts to 0 for WASM

Note: No fixed test vectors — output depends on current time. Verify:
- `isExpired(0) === false` (no expiration)
- `isExpired(farFutureTimestamp) === false`
- `isExpired(pastTimestamp) === true`

## Non-Portable Functions

The following functions are **platform-specific** and NOT required to produce
identical output across implementations. They stay in their respective ecosystems.

### TypeScript-only (in npm package)

| Module | Functions | Rationale |
|--------|-----------|-----------|
| `signed-url.ts` | `generateSignedUrl`, `verifySignedUrl`, `generateTimedUrl` | URL construction/parsing uses `URL` API; Rust has a native-only `verify_signed_url` |
| `validation.ts` | `validateContent`, `detectFormat`, `autoValidate`, `validateJson`, `validateText` | Zod-based; Rust uses serde |
| `schemas.ts` | All Zod schemas (`promptV1Schema`, `compressRequestSchema`, etc.) | Zod-specific |
| `disclosure.ts` | `generateOverview`, `getSection`, `searchContent`, `queryJsonPath`, `getLineRange` | Text parsing, stays in content service |
| `cache.ts` | `LRUCache` class | JS-native data structure |
| `types.ts` | `DocumentMeta`, `VersionMeta`, `LlmtxtRef`, `AttachmentOptions` | TypeScript-only type definitions |

### Rust native-only (not in WASM)

| Function | Rationale |
|----------|-----------|
| `verify_signed_url` | URL parsing via `url` crate; TypeScript handles this with `URL` API. Both rely on the portable `compute_signature`. |
| `SignedUrlParams`, `VerifyError` | Rust types for native URL verification |

## Compatibility Testing

Both WASM and native Rust consume the same test vector suite. The shared file
is at `packages/llmtxt/test-vectors.json`.

### File Format

```json
{
  "version": "1.0.0",
  "description": "Cross-platform test vectors for llmtxt portable core contract.",
  "hashContent": [
    { "input": "hello", "expected": "2cf24dba..." }
  ],
  "base62": {
    "encode": [
      { "input": 0, "expected": "0" }
    ],
    "decode": [
      { "input": "0", "expected": 0 }
    ]
  },
  "calculateTokens": [
    { "input": "Hello, world!", "expected": 4 }
  ],
  "calculateCompressionRatio": [
    { "originalSize": 1000, "compressedSize": 400, "expected": 2.5 }
  ],
  "computeSignature": [
    {
      "params": { "slug": "xK9mP2nQ", "agentId": "test-agent", "conversationId": "conv_123", "expiresAt": 1700000000000 },
      "secret": "test-secret",
      "expected": "650eb9dd6c396a45"
    }
  ],
  "deriveSigningKey": [
    { "apiKey": "sk_live_abc123", "expected": "fb5f79640e9ed141d4949ccb36110c7aaf829c56d9870942dd77219a57575372" }
  ]
}
```

### Test Suites

| Suite | Count | What |
|-------|-------|------|
| Rust native | 12 | All portable functions + test vectors |
| WASM runtime | 21 | All exports callable from JS |
| Cross-platform | 8 | TS ↔ WASM bidirectional compatibility |

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-08 | Initial contract — dual TypeScript/Rust implementations |
| 2.0.0 | 2026-03-23 | Rust→WASM single source of truth; fix compression to RFC 1950; add `isExpired`; fill in concrete test vector values; remove Phase 4 label from `deriveSigningKey`; move `verifySignedUrl` to non-portable; update architecture description |
