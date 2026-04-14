/**
 * Embedding provider abstraction.
 *
 * The semantic diff and consensus routes need vector embeddings for sections
 * and review content. This module provides:
 *
 * - `OpenAIEmbeddingProvider` — uses `text-embedding-3-small` via the OpenAI
 *   REST API (primary, requires `OPENAI_API_KEY`).
 * - `LocalEmbeddingProvider` — deterministic TF-IDF vectorizer (fallback for
 *   dev/test environments where no API key is configured).
 * - `createEmbeddingProvider()` — factory that selects the right provider.
 *
 * Embeddings are computed on-demand and NOT persisted. Storage optimisation
 * (caching / pre-computing embeddings) can be added later without changing the
 * interface.
 */

// ── Interface ──────────────────────────────────────────────────────────────

export interface EmbeddingProvider {
  /** Batch-embed an array of texts. Returns one vector per input text. */
  embed(texts: string[]): Promise<number[][]>;
  /** Dimensionality of produced vectors. */
  readonly dimensions: number;
  /** Model name for logging/observability. */
  readonly model: string;
}

// ── OpenAI provider ────────────────────────────────────────────────────────

/** Maximum inputs per OpenAI embeddings API request. */
const OPENAI_BATCH_LIMIT = 2048;

/** Base delay (ms) for exponential back-off on rate-limit errors. */
const RETRY_BASE_MS = 500;

/** Maximum number of retry attempts on transient API errors. */
const MAX_RETRIES = 3;

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

/**
 * OpenAI `text-embedding-3-small` provider.
 *
 * Handles:
 * - Batching (≤ 2 048 inputs per request)
 * - Exponential back-off on 429 / 5xx responses
 * - Result reordering by the index returned in the API response
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1536;
  readonly model = 'text-embedding-3-small';

  constructor(private readonly apiKey: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Split into batches to stay within the API limit.
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += OPENAI_BATCH_LIMIT) {
      batches.push(texts.slice(i, i + OPENAI_BATCH_LIMIT));
    }

    const results: Array<{ index: number; embedding: number[] }> = [];
    let globalOffset = 0;

    for (const batch of batches) {
      const batchResults = await this.embedBatch(batch, globalOffset);
      results.push(...batchResults);
      globalOffset += batch.length;
    }

    // Sort by original index and extract the embedding vectors.
    results.sort((a, b) => a.index - b.index);
    return results.map(r => r.embedding);
  }

  private async embedBatch(
    texts: string[],
    indexOffset: number,
  ): Promise<Array<{ index: number; embedding: number[] }>> {
    let attempt = 0;

    while (attempt <= MAX_RETRIES) {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
      });

      if (response.ok) {
        const body = (await response.json()) as OpenAIEmbeddingResponse;
        return body.data.map(d => ({
          index: d.index + indexOffset,
          embedding: d.embedding,
        }));
      }

      const isRetryable = response.status === 429 || response.status >= 500;
      if (isRetryable && attempt < MAX_RETRIES) {
        const delayMs = RETRY_BASE_MS * Math.pow(2, attempt);
        await sleep(delayMs);
        attempt++;
        continue;
      }

      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `OpenAI embeddings API error ${response.status}: ${errorText}`,
      );
    }

    // Unreachable, but satisfies TypeScript exhaustiveness.
    throw new Error('OpenAI embeddings: exceeded maximum retries');
  }
}

// ── Local TF-IDF fallback ──────────────────────────────────────────────────

/**
 * Lightweight TF-IDF vectorizer for offline / dev use.
 *
 * Algorithm:
 * 1. Tokenise each document into lowercase word n-grams (unigrams + bigrams).
 * 2. Build a global vocabulary from all input documents.
 * 3. Compute TF (term-frequency normalised by doc length) per document.
 * 4. Compute IDF (log(N / df + 1)) across the batch.
 * 5. Multiply TF × IDF to produce a sparse vector.
 * 6. Project down to `dimensions` using a deterministic hash (FNV-1a mod dims).
 * 7. L2-normalise the projected vector.
 *
 * This is intentionally approximate — sufficient for testing and development,
 * NOT a replacement for neural embeddings in production.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 256;
  readonly model = 'local-tfidf';

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const tokenised = texts.map(tokenise);
    const vocab = buildVocab(tokenised);
    const N = texts.length;

    return tokenised.map(tokens => {
      const tf = computeTf(tokens);
      const vec = new Float64Array(this.dimensions);

      for (const [term, tfVal] of tf.entries()) {
        const df = vocab.get(term) ?? 1;
        const idf = Math.log((N + 1) / (df + 1)) + 1;
        const weight = tfVal * idf;
        const bucket = fnv1aHash(term) % this.dimensions;
        vec[bucket] += weight;
      }

      return l2Normalize(Array.from(vec));
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function tokenise(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const tokens: string[] = [...words];
  for (let i = 0; i < words.length - 1; i++) {
    tokens.push(`${words[i]}_${words[i + 1]}`);
  }
  return tokens;
}

function buildVocab(tokenised: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const tokens of tokenised) {
    const seen = new Set(tokens);
    for (const t of seen) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  return df;
}

function computeTf(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const total = tokens.length || 1;
  const tf = new Map<string, number>();
  for (const [term, count] of counts.entries()) {
    tf.set(term, count / total);
  }
  return tf;
}

function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // Simulate 32-bit unsigned multiplication.
    hash = (Math.imul(hash, 0x01000193) >>> 0);
  }
  return hash;
}

function l2Normalize(vec: number[]): number[] {
  const mag = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  if (mag === 0) return vec;
  return vec.map(x => x / mag);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Select the best available embedding provider.
 *
 * - If `OPENAI_API_KEY` is set → `OpenAIEmbeddingProvider` (`text-embedding-3-small`).
 * - Otherwise → `LocalEmbeddingProvider` (TF-IDF, 256-dimensional, no external API).
 */
export function createEmbeddingProvider(): EmbeddingProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    return new OpenAIEmbeddingProvider(apiKey);
  }
  return new LocalEmbeddingProvider();
}
