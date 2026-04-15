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

// ── Vector Normalization ────────────────────────────────────────

/**
 * L2-normalize a vector of numbers to unit length.
 *
 * Delegates to crates/llmtxt-core::normalize::l2_normalize via WASM.
 *
 * @param vecJson - JSON array of numbers, e.g. `"[3.0, 4.0]"`.
 * @returns JSON array string of normalized values, or `"[]"` on parse error.
 */
export function l2Normalize(vecJson: string): string {
  return wasmModule.l2_normalize_wasm(vecJson);
}

// ── Webhook Signing ─────────────────────────────────────────────

/**
 * Compute the HMAC-SHA256 webhook signature for a payload.
 *
 * Returns `"sha256=<hex>"` — the canonical format for the
 * `X-LLMtxt-Signature` request header.
 *
 * Delegates to crates/llmtxt-core::crypto::sign_webhook_payload.
 *
 * @param secret - The webhook signing secret.
 * @param payload - The raw request body string to sign.
 * @returns `sha256=<hex HMAC-SHA256>` or empty string on HMAC error.
 */
export function signWebhookPayload(secret: string, payload: string): string {
  return wasmModule.sign_webhook_payload(secret, payload);
}

// ── Cosine Similarity ───────────────────────────────────────────

/**
 * Compute cosine similarity between two embedding vectors.
 *
 * Delegates to crates/llmtxt-core::semantic::cosine_similarity_wasm.
 *
 * @param a - Embedding vector as a JSON array string, e.g. `"[1.0, 0.0]"`.
 * @param b - Embedding vector as a JSON array string.
 * @returns Cosine similarity in `[-1.0, 1.0]`, or `0.0` on invalid input.
 */
export function cosineSimilarity(aJson: string, bJson: string): number {
  return wasmModule.cosine_similarity_wasm(aJson, bJson);
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

// ── RBAC ────────────────────────────────────────────────────────

/**
 * Return the permissions for a document role as a JSON array of strings.
 *
 * Delegates to crates/llmtxt-core::rbac::role_permissions via WASM.
 *
 * @param role - One of `"owner"`, `"editor"`, `"viewer"`.
 * @returns JSON array string, e.g. `'["read","write","approve"]'`. Returns `"[]"` for unknown roles.
 */
export function rolePermissions(role: string): string {
  return wasmModule.role_permissions(role);
}

/**
 * Check whether a document role has a specific permission.
 *
 * Delegates to crates/llmtxt-core::rbac::role_has_permission via WASM.
 *
 * @param role - One of `"owner"`, `"editor"`, `"viewer"`.
 * @param permission - One of `"read"`, `"write"`, `"delete"`, `"manage"`, `"approve"`.
 * @returns `true` when the role grants that permission.
 */
export function roleHasPermission(role: string, permission: string): boolean {
  return wasmModule.role_has_permission(role, permission);
}

// ── Slug Generation ─────────────────────────────────────────────

/**
 * Convert a collection or document name to a URL-safe slug.
 *
 * Delegates to crates/llmtxt-core::slugify::slugify via WASM.
 *
 * @param name - The raw name to slugify.
 * @returns A lowercase, hyphen-separated slug (max 80 chars).
 *
 * @example
 * ```ts
 * slugify('Hello World'); // "hello-world"
 * slugify('My Collection 2024'); // "my-collection-2024"
 * ```
 */
export function slugify(name: string): string {
  return wasmModule.slugify(name);
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

// ── Content Similarity (n-gram / MinHash) ────────────────────────

/**
 * Compute similarity between two texts using word shingles.
 *
 * Delegates to crates/llmtxt-core::similarity::content_similarity_wasm.
 *
 * @param a - First text.
 * @param b - Second text.
 * @returns Jaccard similarity of word bigrams, 0.0 to 1.0.
 */
export function contentSimilarity(a: string, b: string): number {
  return wasmModule.content_similarity_wasm(a, b);
}

/**
 * Auto-detect whether a string is JSON, markdown, or plain text.
 *
 * Delegates to crates/llmtxt-core::validation::detect_format.
 *
 * @param content - The string to inspect.
 * @returns `"json"`, `"markdown"`, or `"text"`.
 */
export function detectFormat(content: string): 'json' | 'markdown' | 'text' {
  return wasmModule.detect_format(content) as 'json' | 'markdown' | 'text';
}

/**
 * Check for binary content (control chars 0x00–0x08) in the first 8 KB.
 *
 * Delegates to crates/llmtxt-core::validation::contains_binary_content.
 */
export function containsBinaryContent(content: string): boolean {
  return wasmModule.contains_binary_content(content);
}

/**
 * Extract @mentions from message content. Returns unique names (excluding @all).
 *
 * Delegates to crates/llmtxt-core::graph::extract_mentions_wasm.
 *
 * @returns JSON array string of mention strings.
 */
export function extractMentions(content: string): string[] {
  return JSON.parse(wasmModule.extract_mentions_wasm(content)) as string[];
}

/**
 * Extract character-level n-grams from text.
 *
 * Delegates to crates/llmtxt-core::similarity::extract_ngrams_wasm.
 *
 * @param text - Input text.
 * @param n - N-gram size (default 3).
 * @returns Sorted array of n-gram strings.
 */
export function extractNgrams(text: string, n = 3): string[] {
  return JSON.parse(wasmModule.extract_ngrams_wasm(text, n)) as string[];
}

/**
 * Extract #tags from message content. Returns unique tag names.
 *
 * Delegates to crates/llmtxt-core::graph::extract_tags_wasm.
 */
export function extractTags(content: string): string[] {
  return JSON.parse(wasmModule.extract_tags_wasm(content)) as string[];
}

/**
 * Extract /directives from message content. Returns unique directive keywords.
 *
 * Delegates to crates/llmtxt-core::graph::extract_directives_wasm.
 */
export function extractDirectives(content: string): string[] {
  return JSON.parse(wasmModule.extract_directives_wasm(content)) as string[];
}

/**
 * Extract word-level n-gram shingles from text.
 *
 * Delegates to crates/llmtxt-core::similarity::extract_word_shingles_wasm.
 *
 * @param text - Input text.
 * @param n - Shingle size (default 2).
 * @returns Sorted array of shingle strings.
 */
export function extractWordShingles(text: string, n = 2): string[] {
  return JSON.parse(wasmModule.extract_word_shingles_wasm(text, n)) as string[];
}

/**
 * Find the 1-based line number of the first line exceeding max_chars.
 * Returns 0 if no overlong line exists.
 *
 * Delegates to crates/llmtxt-core::validation::find_overlong_line.
 */
export function findOverlongLine(content: string, maxChars: number): number {
  return wasmModule.find_overlong_line(content, maxChars);
}

/**
 * Estimate similarity between two MinHash fingerprints.
 *
 * @param a - Fingerprint array (from minHashFingerprint).
 * @param b - Fingerprint array (from minHashFingerprint).
 * @returns Approximate Jaccard similarity, 0.0 to 1.0.
 */
export function fingerprintSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / a.length;
}

// ── Knowledge Graph ──────────────────────────────────────────────

/** A node in the knowledge graph. */
export interface GraphNode {
  id: string;
  type: string;
  label: string;
  weight: number;
}

/** An edge in the knowledge graph. */
export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

/** Statistics for a knowledge graph. */
export interface GraphStats {
  agentCount: number;
  topicCount: number;
  decisionCount: number;
  edgeCount: number;
}

/** A knowledge graph containing nodes, edges, and statistics. */
export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

/** Input message for graph construction. */
export interface MessageInput {
  id: string;
  fromAgentId: string;
  content: string;
  metadata?: {
    mentions?: string[];
    directives?: string[];
    tags?: string[];
  };
  createdAt: string;
}

/**
 * Build a knowledge graph from an array of messages.
 *
 * Delegates to crates/llmtxt-core::graph::build_graph_wasm.
 *
 * @param messages - Array of MessageInput objects.
 * @returns Parsed KnowledgeGraph.
 * @throws Error if the Rust core returns an error.
 */
export function buildGraph(messages: MessageInput[]): KnowledgeGraph {
  const json = wasmModule.build_graph_wasm(JSON.stringify(messages));
  const parsed = JSON.parse(json) as KnowledgeGraph & { error?: string };
  if (parsed.error) {
    throw new Error(`buildGraph failed: ${parsed.error}`);
  }
  return parsed;
}

/**
 * Find the most connected topics in the graph.
 *
 * Delegates to crates/llmtxt-core::graph::top_topics_wasm.
 *
 * @param graph - A KnowledgeGraph returned by buildGraph.
 * @param limit - Maximum number of results (default 10).
 * @returns Array of `{ topic, agents }` sorted by agent count descending.
 */
export function topTopics(graph: KnowledgeGraph, limit = 10): Array<{ topic: string; agents: number }> {
  const json = wasmModule.top_topics_wasm(JSON.stringify(graph), limit);
  const parsed = JSON.parse(json) as Array<{ topic: string; agents: number }> | { error?: string };
  if (!Array.isArray(parsed) && parsed.error) {
    throw new Error(`topTopics failed: ${parsed.error}`);
  }
  return parsed as Array<{ topic: string; agents: number }>;
}

/**
 * Find the most active agents in the graph.
 *
 * Delegates to crates/llmtxt-core::graph::top_agents_wasm.
 *
 * @param graph - A KnowledgeGraph returned by buildGraph.
 * @param limit - Maximum number of results (default 10).
 * @returns Array of `{ agent, activity }` sorted by activity descending.
 */
export function topAgents(graph: KnowledgeGraph, limit = 10): Array<{ agent: string; activity: number }> {
  const json = wasmModule.top_agents_wasm(JSON.stringify(graph), limit);
  const parsed = JSON.parse(json) as Array<{ agent: string; activity: number }> | { error?: string };
  if (!Array.isArray(parsed) && parsed.error) {
    throw new Error(`topAgents failed: ${parsed.error}`);
  }
  return parsed as Array<{ agent: string; activity: number }>;
}

/**
 * Compute Jaccard similarity between two texts using character n-grams.
 *
 * Delegates to crates/llmtxt-core::similarity::jaccard_similarity_wasm.
 *
 * @param a - First text.
 * @param b - Second text.
 * @returns Jaccard similarity with n=3, 0.0 to 1.0.
 */
export function jaccardSimilarity(a: string, b: string): number {
  return wasmModule.jaccard_similarity_wasm(a, b);
}

/**
 * Generate a MinHash fingerprint for content.
 *
 * Delegates to crates/llmtxt-core::similarity::min_hash_fingerprint_wasm.
 *
 * @param text - Input text.
 * @param numHashes - Number of hash functions (default 64).
 * @param ngramSize - N-gram size (default 3).
 * @returns Array of minimum hash values.
 */
export function minHashFingerprint(text: string, numHashes = 64, ngramSize = 3): number[] {
  return JSON.parse(wasmModule.min_hash_fingerprint_wasm(text, numHashes, ngramSize)) as number[];
}

/** Result entry from rankBySimilarity. */
export interface SimilarityRankResult {
  index: number;
  score: number;
}

/**
 * Rank a list of texts by similarity to a query.
 *
 * Delegates to crates/llmtxt-core::similarity::rank_by_similarity_wasm.
 *
 * @param query - Query string.
 * @param candidates - Array of candidate strings.
 * @param options - `{ method?: "ngram" | "shingle", threshold?: number }`.
 * @returns Array of `{ index, score }` sorted by descending score.
 */
export function rankBySimilarity(
  query: string,
  candidates: string[],
  options: { method?: 'ngram' | 'shingle'; threshold?: number } = {},
): SimilarityRankResult[] {
  const json = wasmModule.rank_by_similarity_wasm(
    query,
    JSON.stringify(candidates),
    JSON.stringify(options),
  );
  const parsed = JSON.parse(json) as SimilarityRankResult[] | { error?: string };
  if (!Array.isArray(parsed) && parsed.error) {
    throw new Error(`rankBySimilarity failed: ${parsed.error}`);
  }
  return parsed as SimilarityRankResult[];
}
