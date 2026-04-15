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
 *
 * L2 normalization delegates to crates/llmtxt-core::normalize::l2_normalize
 * via the llmtxt WASM binding (audit item #4 fix).
 */

import { tfidfEmbedBatch } from 'llmtxt';

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
 * Delegates to `crates/llmtxt-core::tfidf::tfidf_embed_batch_wasm` via the
 * `llmtxt` WASM binding (audit item #15 fix). The algorithm is identical to
 * the previous TypeScript implementation:
 * 1. Tokenise into lowercase word unigrams + bigrams.
 * 2. Build global vocabulary, compute TF, IDF (smooth), project via FNV-1a.
 * 3. L2-normalise.
 *
 * This is intentionally approximate — sufficient for testing and development,
 * NOT a replacement for neural embeddings in production.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 256;
  readonly model = 'local-tfidf';

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return tfidfEmbedBatch(texts, this.dimensions);
  }
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
