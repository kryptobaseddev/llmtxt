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

export function computeOrgSignature(
  slug: string,
  agentId: string,
  conversationId: string,
  orgId: string,
  expiresAt: number,
  secret: string,
): string {
  return wasmModule.compute_org_signature(slug, agentId, conversationId, orgId, expiresAt, secret);
}

export function computeOrgSignatureWithLength(
  slug: string,
  agentId: string,
  conversationId: string,
  orgId: string,
  expiresAt: number,
  secret: string,
  sigLength: number,
): string {
  return wasmModule.compute_org_signature_with_length(slug, agentId, conversationId, orgId, expiresAt, secret, sigLength);
}

export function deriveSigningKey(apiKey: string): string {
  return wasmModule.derive_signing_key(apiKey);
}


// ── Patching ─────────────────────────────────────────────────────

export function createPatch(original: string, modified: string): string {
  return wasmModule.create_patch(original, modified);
}

export function applyPatch(original: string, patchText: string): string {
  return wasmModule.apply_patch(original, patchText);
}

export function reconstructVersion(base: string, patchesJson: string, target: number): string {
  return wasmModule.reconstruct_version(base, patchesJson, target);
}

export function squashPatchesWasm(base: string, patchesJson: string): string {
  return wasmModule.squash_patches(base, patchesJson);
}

// ── Similarity (WASM-backed) ────────────────────────────────────

export function wasmTextSimilarity(a: string, b: string): number {
  return wasmModule.text_similarity(a, b);
}

export function wasmTextSimilarityNgram(a: string, b: string, n: number): number {
  return wasmModule.text_similarity_ngram(a, b, n);
}

// ── Expiration ──────────────────────────────────────────────────

export function isExpired(expiresAtMs: number): boolean {
  return wasmModule.is_expired(expiresAtMs);
}

// ── Diff ────────────────────────────────────────────────────────

export interface DiffResult {
  addedLines: number;
  removedLines: number;
  addedTokens: number;
  removedTokens: number;
}

export function computeDiff(oldText: string, newText: string): DiffResult {
  const result = wasmModule.compute_diff(oldText, newText);
  const out: DiffResult = {
    addedLines: result.added_lines,
    removedLines: result.removed_lines,
    addedTokens: result.added_tokens,
    removedTokens: result.removed_tokens,
  };
  result.free();
  return out;
}

// ── Structured Diff ────────────────────────────────────────────

/** A single line in a structured diff with type annotation and line numbers. */
export interface StructuredDiffLine {
  type: 'context' | 'added' | 'removed';
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

/** Full structured diff result with interleaved lines and summary counts. */
export interface StructuredDiffResult {
  lines: StructuredDiffLine[];
  addedLineCount: number;
  removedLineCount: number;
  addedTokens: number;
  removedTokens: number;
}

/** Compute a structured line-level diff between two texts via the Rust LCS algorithm. */
export function structuredDiff(oldText: string, newText: string): StructuredDiffResult {
  const json = wasmModule.structured_diff(oldText, newText);
  return JSON.parse(json) as StructuredDiffResult;
}
