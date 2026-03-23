/**
 * WASM bridge — loads the Rust-compiled WASM module and re-exports
 * portable core functions with TypeScript-friendly signatures.
 *
 * This module is the bridge between the Rust single-source-of-truth
 * and the TypeScript API surface. All portable primitives (compression,
 * hashing, signing, encoding) are delegated to WASM.
 */
import * as wasmModule from '../wasm/llmtxt_core.js';

// ── Compression ─────────────────────────────────────────────────

export async function compress(data: string): Promise<Buffer> {
  const bytes = wasmModule.compress(data);
  return Buffer.from(bytes);
}

export async function decompress(data: Buffer): Promise<string> {
  return wasmModule.decompress(new Uint8Array(data));
}

// ── Base62 ──────────────────────────────────────────────────────

export function encodeBase62(num: number): string {
  return wasmModule.encode_base62(BigInt(num));
}

export function decodeBase62(str: string): number {
  return Number(wasmModule.decode_base62(str));
}

// ── ID Generation ───────────────────────────────────────────────

export function generateId(): string {
  return wasmModule.generate_id();
}

// ── Hashing ─────────────────────────────────────────────────────

export function hashContent(data: string): string {
  return wasmModule.hash_content(data);
}

// ── Token Estimation ────────────────────────────────────────────

export function calculateTokens(text: string): number {
  return wasmModule.calculate_tokens(text);
}

// ── Compression Ratio ───────────────────────────────────────────

export function calculateCompressionRatio(
  originalSize: number,
  compressedSize: number,
): number {
  return wasmModule.calculate_compression_ratio(originalSize, compressedSize);
}

// ── HMAC Signing ────────────────────────────────────────────────

export function computeSignature(
  slug: string,
  agentId: string,
  conversationId: string,
  expiresAt: number,
  secret: string,
): string {
  return wasmModule.compute_signature(slug, agentId, conversationId, expiresAt, secret);
}

export function computeSignatureWithLength(
  slug: string,
  agentId: string,
  conversationId: string,
  expiresAt: number,
  secret: string,
  sigLength: number,
): string {
  return wasmModule.compute_signature_with_length(slug, agentId, conversationId, expiresAt, secret, sigLength);
}

export function deriveSigningKey(apiKey: string): string {
  return wasmModule.derive_signing_key(apiKey);
}

// ── Expiration ──────────────────────────────────────────────────

export function isExpired(expiresAtMs: number): boolean {
  return wasmModule.is_expired(expiresAtMs);
}
