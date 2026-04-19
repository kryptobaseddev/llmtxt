# Compression

## Overview

LLMtxt uses **zstd** (RFC 8478) as its primary compression codec for document
storage and HTTP transfer encoding. Legacy documents stored with **zlib**
(RFC 1950) continue to decompress transparently via magic-byte detection.

## Codecs

| Codec | Magic bytes | Direction |
|-------|-------------|-----------|
| zstd (RFC 8478) | `0x28 0xB5 0x2F 0xFD` | New writes |
| zlib/deflate (RFC 1950) | `0x78 __` | Legacy read |

## Why zstd

Red-team analysis (2026-04-14) identified that zlib provided 1.3-1.5x worse
compression ratio and speed on LLMtxt's text/markdown workload. zstd at level 3
provides comparable CPU cost with materially better ratio.

## Storage Layer (T752 + T754)

The Rust primitive in `crates/llmtxt-core` implements auto-detection:

```rust
// Compress new content — always writes zstd
pub fn compress(data: &str) -> Result<Vec<u8>, String>

// Decompress — detects codec from magic bytes automatically
pub fn decompress(data: &[u8]) -> Result<String, String>

// Low-level zstd for binary payloads (blobs, CRDT snapshots)
pub fn zstd_compress(data: &[u8]) -> Result<Vec<u8>, String>
pub fn zstd_decompress(data: &[u8]) -> Result<Vec<u8>, String>

// Explicit zlib for backward-compat tooling only
pub fn zlib_compress(data: &[u8]) -> Result<Vec<u8>, String>
```

The same functions are available via the `llmtxt` npm package (WASM bridge):

```typescript
import { compress, decompress, zstdCompressBytes, zstdDecompressBytes } from 'llmtxt';

// Compress a document — returns zstd bytes
const bytes = await compress(content);

// Decompress — auto-detects zstd or legacy zlib
const text = await decompress(bytes);

// Binary payloads (blobs, CRDT snapshots)
const compressed = zstdCompressBytes(binaryData);
const raw = zstdDecompressBytes(compressed);
```

## Backward Compatibility (T754)

**No schema migration required.** The decompression path detects the codec
from the leading 4 bytes:

- `0x28 0xB5 0x2F 0xFD` → zstd (new writes since T708)
- `0x78 __` → zlib/deflate (rows written before T708)

On next read of a legacy row the content is returned decoded correctly. If you
want to eagerly re-compress existing rows, decompress and re-store them through
the `POST /api/compress` endpoint — but this is not required.

## HTTP Transfer Encoding (T753)

The API server advertises `zstd` as the highest-priority response encoding.
Clients that send `Accept-Encoding: zstd` receive zstd-compressed HTTP
responses. Clients that do not advertise zstd receive `br`, `gzip`, or
`deflate` instead.

**Encoding preference order** (highest → lowest):

1. `zstd` — best ratio on text content; native in Node ≥ 22
2. `br` (Brotli) — good ratio; universal browser support
3. `gzip` — universal fallback
4. `deflate` — legacy fallback
5. `identity` — uncompressed pass-through

The server compresses responses ≥ 1024 bytes. Smaller responses are sent
uncompressed to avoid overhead.

### Example

```http
GET /api/documents/xK9mP2nQ HTTP/1.1
Accept-Encoding: zstd, br;q=0.9, gzip;q=0.8

HTTP/1.1 200 OK
Content-Encoding: zstd
Content-Type: application/json
```

## Benchmarks (T755)

Run the benchmark suite from the crate root:

```bash
cargo bench --bench compression
```

The benchmark compares zlib vs zstd on three corpus samples:

| Sample | Description |
|--------|-------------|
| `readme` | Project README (~8 KB markdown) |
| `synthetic_md_8kb` | Synthetic agent protocol document |
| `repetitive_prose_30kb` | Repetitive prose — worst-case ratio test |

Results are written to `target/criterion/` as HTML reports. On representative
text content, zstd level 3 achieves 1.3-1.5x better compression ratio than
zlib default at similar CPU cost.

## Configuration Reference

| Setting | Value | Notes |
|---------|-------|-------|
| Zstd compression level | 3 | Balance of ratio vs CPU |
| Response threshold | 1024 bytes | Below this, responses are uncompressed |
| Storage codec | zstd | All new writes since T708 |
| Legacy codec | zlib/deflate | Readable via magic-byte fallback |
