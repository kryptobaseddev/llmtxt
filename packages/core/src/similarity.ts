/**
 * Lightweight content similarity using n-gram fingerprinting.
 * No external dependencies — uses only string operations.
 *
 * Designed for agent use cases: find similar messages in a conversation
 * without vector embeddings or external APIs.
 */

// ── N-gram Generation ───────────────────────────────────────────

/**
 * Extract character-level n-grams from text.
 * Normalizes whitespace and lowercases before extraction.
 */
export function extractNgrams(text: string, n = 3): Set<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const grams = new Set<string>();
  for (let i = 0; i <= normalized.length - n; i++) {
    grams.add(normalized.slice(i, i + n));
  }
  return grams;
}

/**
 * Extract word-level n-grams (shingles) from text.
 * Better for longer content where word order matters.
 */
export function extractWordShingles(text: string, n = 2): Set<string> {
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  const shingles = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    shingles.add(words.slice(i, i + n).join(' '));
  }
  return shingles;
}

// ── Similarity Metrics ──────────────────────────────────────────

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|.
 * Returns 0.0 (no overlap) to 1.0 (identical).
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  if (a.size === 0 || b.size === 0) return 0.0;

  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const item of smaller) {
    if (larger.has(item)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Compute similarity between two texts using character n-grams.
 * Returns 0.0 to 1.0.
 */
export function textSimilarity(a: string, b: string, ngramSize = 3): number {
  return jaccardSimilarity(extractNgrams(a, ngramSize), extractNgrams(b, ngramSize));
}

/**
 * Compute similarity using word shingles.
 * Better for comparing messages or documents where word choice matters more than character patterns.
 */
export function contentSimilarity(a: string, b: string, shingleSize = 2): number {
  return jaccardSimilarity(extractWordShingles(a, shingleSize), extractWordShingles(b, shingleSize));
}

// ── Fingerprinting ──────────────────────────────────────────────

/**
 * Generate a compact fingerprint for content using MinHash.
 * The fingerprint is an array of hash values that can be compared
 * for approximate similarity without storing the full n-gram set.
 *
 * Two fingerprints with many matching values indicate similar content.
 */
export function minHashFingerprint(text: string, numHashes = 64, ngramSize = 3): number[] {
  const ngrams = extractNgrams(text, ngramSize);
  const fingerprint = new Array<number>(numHashes).fill(Infinity);

  for (const gram of ngrams) {
    for (let i = 0; i < numHashes; i++) {
      const hash = simpleHash(gram, i);
      if (hash < fingerprint[i]) {
        fingerprint[i] = hash;
      }
    }
  }

  return fingerprint;
}

/**
 * Estimate similarity between two MinHash fingerprints.
 * Returns approximate Jaccard similarity (0.0 to 1.0).
 */
export function fingerprintSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  if (a.length === 0) return 0;

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / a.length;
}

// ── Ranking ─────────────────────────────────────────────────────

/**
 * Rank a list of texts by similarity to a query.
 * Returns indices sorted by descending similarity, with scores.
 */
export function rankBySimilarity(
  query: string,
  candidates: string[],
  options: { method?: 'ngram' | 'shingle'; threshold?: number } = {},
): Array<{ index: number; score: number }> {
  const { method = 'shingle', threshold = 0.0 } = options;
  const similarityFn = method === 'ngram' ? textSimilarity : contentSimilarity;

  const results: Array<{ index: number; score: number }> = [];
  for (let i = 0; i < candidates.length; i++) {
    const score = similarityFn(query, candidates[i]);
    if (score > threshold) {
      results.push({ index: i, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ── Internal ────────────────────────────────────────────────────

/**
 * Simple hash function for MinHash. Uses FNV-1a variant with seed mixing.
 */
function simpleHash(str: string, seed: number): number {
  let hash = 2166136261 ^ seed;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
