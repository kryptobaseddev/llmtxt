/**
 * Local ONNX embedding provider for SDK consumers.
 *
 * # Architecture exception (T102 — documented in docs/SSOT.md)
 * Model loading is environment-specific (onnxruntime-node on Node.js,
 * onnxruntime-web in browsers), so this module lives in packages/llmtxt
 * rather than crates/llmtxt-core.  The VECTOR MATH (cosine similarity,
 * L2-normalise) remains in crates/llmtxt-core/src/semantic.rs (SSoT for
 * math).
 *
 * # Model
 * `sentence-transformers/all-MiniLM-L6-v2` — 384-dimensional, ~90 MB ONNX.
 * Downloaded to `~/.llmtxt/models/` on first use, checksum-verified.
 * No external API calls are made at embed time.
 *
 * # Usage
 * ```ts
 * import { embed, embedBatch, MODEL_DIMS } from 'llmtxt/embeddings';
 *
 * const vec = await embed('hello world');          // Float32Array(384)
 * const vecs = await embedBatch(['foo', 'bar']);   // Float32Array[]
 * ```
 *
 * # Environment variables
 * - `LLMTXT_MODEL_CACHE_DIR` — override default `~/.llmtxt/models/`
 * - `LLMTXT_EMBEDDING_MODEL` — override model variant (must be 384-dim ONNX)
 *
 * @module embeddings
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

// ── Constants ────────────────────────────────────────────────────────────

/** Output dimensionality of the bundled model. */
export const MODEL_DIMS = 384;

/** Provider identifier used in database records. */
export const PROVIDER_NAME = 'local-onnx-minilm-l6';

/** Model name stored in database records. */
export const MODEL_NAME = 'all-MiniLM-L6-v2';

/**
 * Hugging Face model files to download.
 * Using the ONNX-optimized community repo for quantized inference.
 */
const HF_BASE =
  'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx';

const MODEL_FILES = [
  {
    name: 'model_quantized.onnx',
    url: `${HF_BASE}/model_quantized.onnx`,
    // SHA-256 of the Xenova quantized model (verified 2026-04-16)
    sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1',
    sizeBytes: 22_905_032,
  },
] as const;

const TOKENIZER_FILES = [
  {
    name: 'tokenizer.json',
    url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer.json',
    sha256: null as string | null, // tokenizer is small; skip checksum
  },
  {
    name: 'tokenizer_config.json',
    url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer_config.json',
    sha256: null as string | null,
  },
  {
    name: 'vocab.txt',
    url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/vocab.txt',
    sha256: null as string | null,
  },
] as const;

// ── Cache directory ───────────────────────────────────────────────────────

function getCacheDir(): string {
  const override = process.env.LLMTXT_MODEL_CACHE_DIR;
  if (override) return resolve(override);
  return join(homedir(), '.llmtxt', 'models', MODEL_NAME);
}

// ── File download helper ──────────────────────────────────────────────────

async function downloadFile(
  url: string,
  destPath: string,
  expectedSha256?: string | null,
): Promise<void> {
  console.log(`[llmtxt/embeddings] Downloading ${url} → ${destPath}`);

  const response = await fetch(url, {
    headers: { 'User-Agent': 'llmtxt-embedding-downloader/1.0' },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);

  if (expectedSha256) {
    const actual = createHash('sha256').update(buf).digest('hex');
    if (actual !== expectedSha256) {
      throw new Error(
        `Checksum mismatch for ${url}:\n  expected: ${expectedSha256}\n  actual:   ${actual}`,
      );
    }
  }

  writeFileSync(destPath, buf);
}

// ── Model loader (lazy, singleton) ────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _session: any | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _tokenizer: any | null = null;
let _loadPromise: Promise<void> | null = null;

async function ensureModelLoaded(): Promise<void> {
  if (_session && _tokenizer) return;
  if (_loadPromise) return _loadPromise;
  _loadPromise = _loadModel();
  return _loadPromise;
}

async function _loadModel(): Promise<void> {
  const cacheDir = getCacheDir();
  mkdirSync(cacheDir, { recursive: true });

  // Download ONNX model files if missing
  for (const file of MODEL_FILES) {
    const destPath = join(cacheDir, file.name);
    if (!existsSync(destPath)) {
      await downloadFile(file.url, destPath, file.sha256 ?? undefined);
    }
  }

  // Download tokenizer files if missing
  const tokenizerDir = join(cacheDir, 'tokenizer');
  mkdirSync(tokenizerDir, { recursive: true });
  for (const file of TOKENIZER_FILES) {
    const destPath = join(tokenizerDir, file.name);
    if (!existsSync(destPath)) {
      await downloadFile(file.url, destPath, file.sha256 ?? undefined);
    }
  }

  const modelPath = join(cacheDir, MODEL_FILES[0].name);

  // Load ONNX runtime (Node.js path)
  // Dynamic import so bundlers can tree-shake the browser path.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ort: any = await import('onnxruntime-node');
  _session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });

  // Load tokenizer from the downloaded vocab files
  const tokenizerJsonPath = join(tokenizerDir, 'tokenizer.json');
  const tokenizerJson = JSON.parse(readFileSync(tokenizerJsonPath, 'utf-8'));
  // Use the Transformers.js tokenizer format embedded in tokenizer.json
  _tokenizer = new BertTokenizer(tokenizerJson);

  console.log(
    `[llmtxt/embeddings] Model loaded: ${MODEL_NAME} from ${cacheDir}`,
  );
}

// ── Minimal BERT tokenizer ────────────────────────────────────────────────

/**
 * Minimal WordPiece tokenizer sufficient for all-MiniLM-L6-v2.
 *
 * Handles the Transformers.js tokenizer.json format.
 * This avoids a dependency on @xenova/transformers (>100MB) while keeping
 * the tokenization correct for the model.
 */
class BertTokenizer {
  private vocab: Map<string, number>;
  private ids: Map<number, string>;
  private clsId: number;
  private sepId: number;
  private padId: number;
  private unkId: number;
  private maxSeqLen: number;

  constructor(tokenizerJson: Record<string, unknown>) {
    this.vocab = new Map();
    this.ids = new Map();
    this.maxSeqLen = 512;

    // Parse vocab from Transformers.js format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = tokenizerJson.model as any;
    if (model && model.vocab && typeof model.vocab === 'object') {
      for (const [token, id] of Object.entries(model.vocab as Record<string, number>)) {
        this.vocab.set(token, id);
        this.ids.set(id, token);
      }
    }

    this.clsId = this.vocab.get('[CLS]') ?? 101;
    this.sepId = this.vocab.get('[SEP]') ?? 102;
    this.padId = this.vocab.get('[PAD]') ?? 0;
    this.unkId = this.vocab.get('[UNK]') ?? 100;
  }

  /**
   * Tokenize text using WordPiece algorithm.
   * Returns token IDs padded/truncated to maxSeqLen.
   */
  encode(text: string, maxLen = 128): {
    inputIds: BigInt64Array;
    attentionMask: BigInt64Array;
    tokenTypeIds: BigInt64Array;
  } {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    const tokens: number[] = [this.clsId];

    for (const word of words) {
      const wordTokens = this.wordpieceTokenize(word);
      for (const t of wordTokens) {
        tokens.push(this.vocab.get(t) ?? this.unkId);
      }
      if (tokens.length >= maxLen - 1) break;
    }

    tokens.push(this.sepId);

    // Truncate to maxLen
    const truncated = tokens.slice(0, maxLen);
    const len = truncated.length;

    // Pad to maxLen
    const inputIds = new BigInt64Array(maxLen).fill(BigInt(this.padId));
    const attentionMask = new BigInt64Array(maxLen).fill(BigInt(0));
    const tokenTypeIds = new BigInt64Array(maxLen).fill(BigInt(0));

    for (let i = 0; i < len; i++) {
      inputIds[i] = BigInt(truncated[i]);
      attentionMask[i] = BigInt(1);
    }

    return { inputIds, attentionMask, tokenTypeIds };
  }

  private wordpieceTokenize(word: string): string[] {
    if (this.vocab.has(word)) return [word];
    const tokens: string[] = [];
    let remaining = word;
    let isFirst = true;

    while (remaining.length > 0) {
      let found = false;
      for (let end = remaining.length; end > 0; end--) {
        const substr = isFirst ? remaining.slice(0, end) : '##' + remaining.slice(0, end);
        if (this.vocab.has(substr)) {
          tokens.push(substr);
          remaining = remaining.slice(end);
          isFirst = false;
          found = true;
          break;
        }
      }
      if (!found) {
        tokens.push('[UNK]');
        break;
      }
    }

    return tokens.length > 0 ? tokens : ['[UNK]'];
  }
}

// ── Mean pooling ──────────────────────────────────────────────────────────

/**
 * Mean pooling over token embeddings, masked by attention.
 * This is the standard sentence-transformers pooling strategy.
 */
function meanPool(
  tokenEmbeddings: Float32Array,
  attentionMask: BigInt64Array,
  seqLen: number,
  hiddenSize: number,
): Float32Array {
  const result = new Float32Array(hiddenSize);
  let totalAttention = 0;

  for (let t = 0; t < seqLen; t++) {
    const attn = Number(attentionMask[t]);
    totalAttention += attn;
    for (let h = 0; h < hiddenSize; h++) {
      result[h] += tokenEmbeddings[t * hiddenSize + h] * attn;
    }
  }

  if (totalAttention > 0) {
    for (let h = 0; h < hiddenSize; h++) {
      result[h] /= totalAttention;
    }
  }

  return result;
}

/**
 * L2-normalise a Float32Array in place.
 */
function l2Normalize(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }
  return vec;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Embed a single text string into a 384-dimensional Float32Array.
 *
 * Model is loaded lazily on first call (~1-2s cold start, instant thereafter).
 * No external API calls are made — inference runs locally via onnxruntime-node.
 *
 * @param text - Input text to embed.
 * @returns L2-normalised 384-dim embedding vector.
 */
export async function embed(text: string): Promise<Float32Array> {
  await ensureModelLoaded();
  const results = await embedBatch([text]);
  return results[0];
}

/**
 * Embed a batch of texts in a single ONNX session run.
 *
 * For large batches, texts are split into chunks of 32 to avoid OOM.
 *
 * @param texts - Array of texts to embed.
 * @returns Array of L2-normalised 384-dim embedding vectors.
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  await ensureModelLoaded();

  const CHUNK_SIZE = 32;
  const results: Float32Array[] = [];

  for (let offset = 0; offset < texts.length; offset += CHUNK_SIZE) {
    const chunk = texts.slice(offset, offset + CHUNK_SIZE);
    const chunkResults = await _runInference(chunk);
    results.push(...chunkResults);
  }

  return results;
}

const MAX_SEQ_LEN = 128; // sufficient for MiniLM-L6; full model supports 512

async function _runInference(texts: string[]): Promise<Float32Array[]> {
  const batchSize = texts.length;

  // Tokenize all texts
  const encodings = texts.map(t => _tokenizer.encode(t, MAX_SEQ_LEN));

  // Build flat tensors
  const inputIds = new BigInt64Array(batchSize * MAX_SEQ_LEN);
  const attentionMask = new BigInt64Array(batchSize * MAX_SEQ_LEN);
  const tokenTypeIds = new BigInt64Array(batchSize * MAX_SEQ_LEN);

  for (let i = 0; i < batchSize; i++) {
    const enc = encodings[i];
    inputIds.set(enc.inputIds, i * MAX_SEQ_LEN);
    attentionMask.set(enc.attentionMask, i * MAX_SEQ_LEN);
    tokenTypeIds.set(enc.tokenTypeIds, i * MAX_SEQ_LEN);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ort: any = await import('onnxruntime-node');
  const { Tensor } = ort;

  const feeds = {
    input_ids: new Tensor('int64', inputIds, [batchSize, MAX_SEQ_LEN]),
    attention_mask: new Tensor('int64', attentionMask, [batchSize, MAX_SEQ_LEN]),
    token_type_ids: new Tensor('int64', tokenTypeIds, [batchSize, MAX_SEQ_LEN]),
  };

  const output = await _session.run(feeds);

  // The model outputs last_hidden_state: [batch, seq, hidden]
  // Some models output pooler_output directly; prefer last_hidden_state + mean pool.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hiddenState: any = output.last_hidden_state ?? output.token_embeddings;
  const tokenEmbeddings = hiddenState.data as Float32Array;
  const hiddenSize = MODEL_DIMS; // 384

  const embeddings: Float32Array[] = [];
  for (let i = 0; i < batchSize; i++) {
    const slice = tokenEmbeddings.slice(
      i * MAX_SEQ_LEN * hiddenSize,
      (i + 1) * MAX_SEQ_LEN * hiddenSize,
    );
    const pooled = meanPool(slice, encodings[i].attentionMask, MAX_SEQ_LEN, hiddenSize);
    l2Normalize(pooled);
    embeddings.push(pooled);
  }

  return embeddings;
}

// ── EmbeddingProvider interface ────────────────────────────────────────────

/**
 * Standard embedding provider interface — matches apps/backend/src/utils/embeddings.ts.
 * Implemented by both the local ONNX provider and the TF-IDF fallback.
 */
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly model: string;
  readonly provider: string;
}

/**
 * Local ONNX embedding provider — wraps `embedBatch` to conform to the
 * `EmbeddingProvider` interface used by the backend routes.
 *
 * Drop-in replacement for `LocalEmbeddingProvider` (TF-IDF):
 * ```ts
 * import { LocalOnnxEmbeddingProvider } from 'llmtxt/embeddings';
 * const ep = new LocalOnnxEmbeddingProvider();
 * const vecs = await ep.embed(['hello world']);
 * ```
 */
export class LocalOnnxEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = MODEL_DIMS;
  readonly model = MODEL_NAME;
  readonly provider = PROVIDER_NAME;

  async embed(texts: string[]): Promise<number[][]> {
    const vecs = await embedBatch(texts);
    // Convert Float32Array[] → number[][] for interface compatibility
    return vecs.map(v => Array.from(v));
  }
}
