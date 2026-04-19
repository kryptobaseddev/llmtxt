/**
 * T752 + T754: WASM-level zstd compression tests.
 *
 * Verifies the Rust zstd bindings exposed through the llmtxt package:
 *   1. compress() / decompress() round-trip via zstd.
 *   2. zstdCompressBytes() / zstdDecompressBytes() for raw binary payloads.
 *   3. Backward compat: decompress() decodes legacy zlib bytes.
 *   4. Magic-byte detection routing.
 *
 * T756 note: these tests serve as living proof that the API contract in
 * docs/api/compression.md is accurate.
 */

import assert from "node:assert/strict";
import zlib from "node:zlib";
import { describe, it } from "node:test";
import {
  compress,
  decompress,
  zstdCompressBytes,
  zstdDecompressBytes,
} from "../compression.js";

// RFC 8478 §3.1.1 — 0xFD2FB528 in little-endian byte order
const ZSTD_MAGIC = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]);

// RFC 8478 §3.1.1: zstd frame magic = 0xFD2FB528 in little-endian = [0x28, 0xB5, 0x2F, 0xFD]
function bufStartsWithZstd(buf: Buffer): boolean {
  return (
    buf[0] === 0x28 &&
    buf[1] === 0xb5 &&
    buf[2] === 0x2f &&
    buf[3] === 0xfd
  );
}

describe("compress / decompress (zstd, T752 + T754)", () => {
  it("compress() produces zstd output", async () => {
    const out = await compress("llmtxt zstd test");
    assert.ok(bufStartsWithZstd(out), "output must start with zstd magic bytes");
  });

  it("compress + decompress round-trip", async () => {
    const texts = [
      "",
      "hello world",
      "# Markdown\n\nWith **bold** and `code`.",
      "日本語テスト",
      "a".repeat(10_000),
    ];
    for (const text of texts) {
      const c = await compress(text);
      const d = await decompress(c);
      assert.strictEqual(d, text, `round-trip failed for: ${text.slice(0, 40)}`);
    }
  });

  it("decompress handles legacy zlib-compressed bytes (backward compat)", async () => {
    const input = "legacy content compressed with zlib before T708 migration";
    const zlibBytes = await new Promise<Buffer>((resolve, reject) => {
      zlib.deflate(Buffer.from(input), (err, buf) => {
        if (err) reject(err);
        else resolve(buf);
      });
    });
    assert.strictEqual(zlibBytes[0], 0x78, "zlib output must start with 0x78");
    const result = await decompress(zlibBytes);
    assert.strictEqual(result, input);
  });
});

describe("zstdCompressBytes / zstdDecompressBytes (T752 raw binary API)", () => {
  it("round-trip binary bytes", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 0xff, 0xfe, 0x00, 42, 99]);
    const compressed = zstdCompressBytes(data);
    assert.deepStrictEqual(
      compressed.slice(0, 4),
      ZSTD_MAGIC,
      "compressed bytes must start with zstd magic"
    );
    const decompressed = zstdDecompressBytes(compressed);
    assert.deepStrictEqual(
      Array.from(decompressed),
      Array.from(data),
      "binary round-trip must be lossless"
    );
  });

  it("compresses large repetitive payload", () => {
    const data = new TextEncoder().encode("repeat ".repeat(5000));
    const compressed = zstdCompressBytes(data);
    assert.ok(
      compressed.length < data.length,
      `zstd should compress repetitive data: ${compressed.length} >= ${data.length}`
    );
  });

  it("empty bytes round-trip", () => {
    const data = new Uint8Array(0);
    const c = zstdCompressBytes(data);
    const d = zstdDecompressBytes(c);
    assert.strictEqual(d.length, 0);
  });
});
