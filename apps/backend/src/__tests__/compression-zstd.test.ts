/**
 * T753 + T754: zstd compression migration tests.
 *
 * Verifies:
 *   1. compressOptions encodes zstd as highest priority.
 *   2. New compress() calls produce zstd output (magic bytes 0x28 0xB5 0x2F 0xFD).
 *   3. decompress() auto-detects zstd by magic bytes and decodes correctly.
 *   4. decompress() still handles legacy zlib data (backward compatibility).
 *   5. Unknown codec returns a descriptive error.
 *
 * These tests are pure unit tests — no HTTP server or database required.
 */

import assert from "node:assert/strict";
import zlib from "node:zlib";
import { describe, it } from "node:test";
import { compress, decompress } from "llmtxt";
import { compressOptions } from "../lib/compression.js";

// ── zstd magic bytes ─────────────────────────────────────────────────────────
// RFC 8478 §3.1.1 — 0xFD2FB528 stored in little-endian byte order
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

// ── T753: compressOptions ────────────────────────────────────────────────────

describe("compressOptions (T753)", () => {
	it("lists zstd as the first (highest priority) encoding", () => {
		const encodings = compressOptions.encodings ?? [];
		assert.strictEqual(
			encodings[0],
			"zstd",
			"zstd must be first in the encodings array",
		);
	});

	it("includes all required encodings: zstd, br, gzip, deflate, identity", () => {
		const encodings = compressOptions.encodings ?? [];
		const required = ["zstd", "br", "gzip", "deflate", "identity"] as const;
		for (const enc of required) {
			assert.ok(
				encodings.includes(enc),
				`encodings must include '${enc}'`,
			);
		}
	});

	it("compressOptions.threshold is 1024", () => {
		assert.strictEqual(compressOptions.threshold, 1024);
	});
});

// ── T754: compress / decompress ──────────────────────────────────────────────

describe("compress() — new writes use zstd (T754)", () => {
	it("produces bytes starting with the zstd magic header", async () => {
		const out = await compress("Hello, zstd world!");
		assert.ok(out.length >= 4, "compressed output must have at least 4 bytes");
		assert.ok(
			out.slice(0, 4).equals(ZSTD_MAGIC),
			`first 4 bytes should be ${ZSTD_MAGIC.toString("hex")} (zstd magic), got ${out.slice(0, 4).toString("hex")}`,
		);
	});
});

describe("decompress() — auto-detect codec (T754)", () => {
	it("decompresses zstd output from compress()", async () => {
		const input = "Agent document content — zstd round-trip test.";
		const compressed = await compress(input);
		const result = await decompress(compressed);
		assert.strictEqual(result, input);
	});

	it("decompresses legacy zlib data (backward compatibility)", async () => {
		// Simulate a document row written before the zstd migration
		const input = "Legacy zlib-stored document content for backward compat test.";
		const zlibWrapped = Buffer.from(
			await new Promise<Buffer>((resolve, reject) => {
				zlib.deflate(Buffer.from(input), (err, buf) => {
					if (err) reject(err);
					else resolve(buf);
				});
			}),
		);
		// zlib.deflate produces RFC 1950 (zlib-wrapped deflate) — magic byte 0x78
		assert.strictEqual(
			zlibWrapped[0],
			0x78,
			"Node zlib.deflate should produce 0x78 CMF byte",
		);
		const result = await decompress(zlibWrapped);
		assert.strictEqual(result, input, "decompress must decode legacy zlib data");
	});

	it("handles empty string round-trip via zstd", async () => {
		const compressed = await compress("");
		const result = await decompress(compressed);
		assert.strictEqual(result, "");
	});

	it("handles unicode content round-trip", async () => {
		const input = "日本語テスト — マルチエージェント";
		const compressed = await compress(input);
		const result = await decompress(compressed);
		assert.strictEqual(result, input);
	});

	it("returns error on unknown codec bytes", async () => {
		const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
		await assert.rejects(
			() => decompress(garbage),
			/unknown compression codec|decompression failed/i,
		);
	});
});
