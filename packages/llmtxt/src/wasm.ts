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

// ── Multi-way Diff ──────────────────────────────────────────────

/** A single version variant at a divergent line position. */
export interface MultiDiffVariant {
  versionIndex: number;
  content: string;
}

/** One line entry in a multi-way diff result. */
export interface MultiDiffLine {
  lineNumber: number;
  /** "consensus" when all versions agree, "divergent" when versions differ,
   *  "insertion" when a version adds a line not present in the base. */
  type: 'consensus' | 'divergent' | 'insertion';
  content: string;
  /** How many versions have `content` at this position. */
  agreement: number;
  /** Total number of versions (including the base). */
  total: number;
  /** Per-version contents when type is "divergent"; empty for "consensus". */
  variants: MultiDiffVariant[];
}

/** Aggregate statistics for a multi-way diff. */
export interface MultiDiffStats {
  totalLines: number;
  consensusLines: number;
  divergentLines: number;
  consensusPercentage: number;
}

/** Full result of a multi-way diff. */
export interface MultiDiffResult {
  baseVersion: number;
  versionCount: number;
  lines: MultiDiffLine[];
  stats: MultiDiffStats;
}

/**
 * Compute a multi-way diff across a base version and up to 4 additional versions.
 *
 * @param base - Base version content (typically v1).
 * @param versionsJson - JSON array of strings, one per additional version.
 * @returns Parsed MultiDiffResult.
 * @throws Error if the Rust core returns an error object.
 */
export function multiWayDiff(base: string, versionsJson: string): MultiDiffResult {
  const json = wasmModule.multi_way_diff_wasm(base, versionsJson);
  const parsed = JSON.parse(json) as MultiDiffResult & { error?: string };
  if (parsed.error) {
    throw new Error(`multiWayDiff failed: ${parsed.error}`);
  }
  return parsed;
}

// ── Cherry-Pick Merge ───────────────────────────────────────────

/** A single provenance entry in the cherry-pick merged output. */
export interface CherryPickProvenance {
  lineStart: number;
  lineEnd: number;
  fromVersion: number;
  fillFrom?: boolean;
}

/** Statistics for a cherry-pick merge operation. */
export interface CherryPickStats {
  totalLines: number;
  sourcesUsed: number;
  sectionsExtracted: number;
  lineRangesExtracted: number;
}

/** Return value of a cherry-pick merge operation. */
export interface CherryPickResult {
  content: string;
  provenance: CherryPickProvenance[];
  stats: CherryPickStats;
}

/**
 * Assemble document content from line ranges and sections across multiple versions.
 *
 * @param base - Base version content (index 0 if not supplied in versionsJson).
 * @param versionsJson - JSON object mapping version index strings to content strings.
 * @param selectionJson - JSON selection spec `{ sources: [...], fillFrom?: number }`.
 * @returns Parsed CherryPickResult.
 * @throws Error if the Rust core returns an error object.
 */
export function cherryPickMerge(
  base: string,
  versionsJson: string,
  selectionJson: string,
): CherryPickResult {
  const json = wasmModule.cherry_pick_merge_wasm(base, versionsJson, selectionJson);
  const parsed = JSON.parse(json) as CherryPickResult & { error?: string };
  if (parsed.error) {
    throw new Error(`cherryPickMerge failed: ${parsed.error}`);
  }
  return parsed;
}

// ── 3-Way Merge ─────────────────────────────────────────────────

/** A single conflict region from a 3-way merge. */
export interface Conflict {
  /** 1-based start line of the conflicting region in `ours`. */
  oursStart: number;
  /** 1-based end line of the conflicting region in `ours` (inclusive). */
  oursEnd: number;
  /** 1-based start line of the conflicting region in `theirs`. */
  theirsStart: number;
  /** 1-based end line of the conflicting region in `theirs` (inclusive). */
  theirsEnd: number;
  /** 1-based start line of the conflicting region in the common ancestor. */
  baseStart: number;
  /** 1-based end line of the conflicting region in the common ancestor. */
  baseEnd: number;
  /** The conflicting text from `ours`. */
  oursContent: string;
  /** The conflicting text from `theirs`. */
  theirsContent: string;
  /** The original text from the common ancestor. */
  baseContent: string;
}

/** Statistics for a 3-way merge operation. */
export interface MergeStats {
  /** Total lines in the merged output (including conflict markers). */
  totalLines: number;
  /** Number of lines accepted without conflict. */
  autoMergedLines: number;
  /** Number of distinct conflict regions. */
  conflictCount: number;
}

/** Full result of a 3-way merge operation. */
export interface ThreeWayMergeResult {
  /** The merged document content, with conflict markers where applicable. */
  merged: string;
  /** `true` when at least one conflict could not be auto-merged. */
  hasConflicts: boolean;
  /** Details of each conflict region. */
  conflicts: Conflict[];
  /** Summary statistics for the merge. */
  stats: MergeStats;
}

/**
 * Perform a 3-way merge of `base`, `ours`, and `theirs`.
 *
 * Regions modified by only one side are auto-merged.  Regions modified by
 * both sides produce conflict markers in the output:
 * ```
 * <<<<<<< ours
 * …ours content…
 * =======
 * …theirs content…
 * >>>>>>> theirs
 * ```
 *
 * @param base - Common ancestor content.
 * @param ours - Our version of the document.
 * @param theirs - Their version of the document.
 * @returns Parsed ThreeWayMergeResult.
 * @throws Error if the Rust core returns an error object.
 */
export function threeWayMerge(base: string, ours: string, theirs: string): ThreeWayMergeResult {
  const json = wasmModule.three_way_merge_wasm(base, ours, theirs);
  const parsed = JSON.parse(json) as ThreeWayMergeResult & { error?: string };
  if (parsed.error) {
    throw new Error(`threeWayMerge failed: ${parsed.error}`);
  }
  return parsed;
}

// ── Semantic Diff ───────────────────────────────────────────────

/** How a section from version A maps to version B. */
export type SectionAlignment = 'Matched' | 'Renamed' | 'Added' | 'Removed';

/** Per-section similarity record produced by semantic diff. */
export interface SectionSimilarity {
  sectionA: string;
  sectionB: string;
  similarity: number;
  alignment: SectionAlignment;
}

/** A semantic change annotation for a matched/renamed section pair. */
export interface SemanticChange {
  /** One of: "unchanged", "rephrased", "modified", "rewritten". */
  changeType: string;
  section: string;
  similarity: number;
  description: string;
}

/** Full result of a semantic diff between two document versions. */
export interface SemanticDiffResult {
  overallSimilarity: number;
  sectionSimilarities: SectionSimilarity[];
  semanticChanges: SemanticChange[];
}

/**
 * Compute a semantic diff between two sets of pre-embedded document sections.
 *
 * @param sectionsAJson - JSON array of `{ title, content, embedding: number[] }` for version A.
 * @param sectionsBJson - JSON array of `{ title, content, embedding: number[] }` for version B.
 * @returns Parsed SemanticDiffResult.
 * @throws Error if the Rust core returns an error object.
 */
export function semanticDiff(sectionsAJson: string, sectionsBJson: string): SemanticDiffResult {
  const json = wasmModule.semantic_diff_wasm(sectionsAJson, sectionsBJson);
  const parsed = JSON.parse(json) as SemanticDiffResult & { error?: string };
  if (parsed.error) {
    throw new Error(`semanticDiff failed: ${parsed.error}`);
  }
  return parsed;
}

// ── Semantic Consensus ──────────────────────────────────────────

/** A cluster of reviewers whose embeddings are mutually similar. */
export interface ReviewCluster {
  members: string[];
  avgSimilarity: number;
}

/** Result of semantic consensus evaluation across a set of reviews. */
export interface SemanticConsensusResult {
  consensus: boolean;
  agreementScore: number;
  clusters: ReviewCluster[];
  outliers: string[];
}

/**
 * Evaluate semantic consensus across a set of pre-embedded reviews.
 *
 * @param reviewsJson - JSON array of `{ reviewerId, content, embedding: number[] }`.
 * @param threshold - Cosine similarity threshold for clustering (e.g. 0.80).
 * @returns Parsed SemanticConsensusResult.
 * @throws Error if the Rust core returns an error object.
 */
export function semanticConsensus(
  reviewsJson: string,
  threshold: number,
): SemanticConsensusResult {
  const json = wasmModule.semantic_consensus_wasm(reviewsJson, threshold);
  const parsed = JSON.parse(json) as SemanticConsensusResult & { error?: string };
  if (parsed.error) {
    throw new Error(`semanticConsensus failed: ${parsed.error}`);
  }
  return parsed;
}
