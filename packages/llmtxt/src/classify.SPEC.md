# SPEC: `packages/llmtxt/src/classify.ts` — TypeScript `classifyContent` API

Spec version: 1.0.0
Task: T812 (S2)
Epic: T780 (Wave-2 — llmtxt@2026.4.13)
Depends on: T811 (S1 Rust API spec)
Status: APPROVED

---

## Overview

The TypeScript `classifyContent` function is a thin adapter over the WASM `classify_content_wasm` function. All classification logic lives in Rust (SSoT: `crates/llmtxt-core/src/classify/`). The TS layer is responsible for:

1. Input normalization (`string` | `Uint8Array` | `Buffer` → `Uint8Array`)
2. Calling `wasmModule.classify_content_wasm(bytes)`
3. Parsing the JSON result
4. Mapping Rust PascalCase enums to TS lowercase string literals
5. Providing the backward-compat helper `detectFormatFromClassification`

---

## File Location

```
packages/llmtxt/src/classify.ts   — implementation (new file)
```

Exported from `packages/llmtxt/src/index.ts` alongside existing exports.

---

## Public TypeScript API

### `ClassificationResult` interface

```typescript
/**
 * Result of {@link classifyContent}.
 *
 * Mirrors `ClassificationResult` from `crates/llmtxt-core/src/classify/types.rs`.
 */
export interface ClassificationResult {
  /** IANA MIME type, e.g. `"application/pdf"`, `"text/markdown"`, `"image/png"`. */
  mimeType: string;

  /** Coarse content category. */
  category: 'binary' | 'text' | 'structured' | 'unknown';

  /**
   * Specific content format.
   *
   * Binary: `'pdf'` | `'png'` | `'jpeg'` | `'gif'` | `'webp'` | `'avif'` | `'svg'` |
   *         `'mp4'` | `'webm'` | `'mp3'` | `'wav'` | `'ogg'` | `'zip'`
   *
   * Text:   `'markdown'` | `'json'` | `'javascript'` | `'typescript'` | `'python'` |
   *         `'rust'` | `'go'` | `'plainText'`
   *
   * Fallback: `'unknown'`
   */
  format:
    | 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'svg'
    | 'mp4' | 'webm' | 'mp3' | 'wav' | 'ogg' | 'zip'
    | 'markdown' | 'json' | 'javascript' | 'typescript' | 'python'
    | 'rust' | 'go' | 'plainText'
    | 'unknown';

  /** Classification confidence in `[0.0, 1.0]`. See Rust spec for semantics. */
  confidence: number;

  /**
   * Whether useful text content can be extracted from this format.
   * `true` for text formats and PDF; `false` for images, audio, video, zip.
   */
  isExtractable: boolean;
}
```

### `classifyContent` function

```typescript
/**
 * Classify the content of `input` using a three-layer pipeline:
 * magic-byte detection → text/binary gate → heuristic text analysis.
 *
 * All classification logic runs in Rust WASM (SSoT: `crates/llmtxt-core/src/classify/`).
 * This function is a thin adapter that normalises inputs and maps enum variants.
 *
 * @param input - Raw content as a `string`, `Uint8Array`, or `Buffer`.
 *   - `string`: encoded to UTF-8 bytes before classification.
 *   - `Uint8Array` / `Buffer`: passed directly (no copy if already Uint8Array).
 *
 * @returns A {@link ClassificationResult} describing the detected content type.
 *
 * @throws {Error} if the WASM module returns a serialization error (should not occur
 *   in practice — the Rust code catches all errors and returns a valid JSON string).
 *
 * @example
 * ```ts
 * import { classifyContent } from 'llmtxt';
 *
 * const result = classifyContent('# Hello\n\nMarkdown content.');
 * console.log(result.format);      // 'markdown'
 * console.log(result.mimeType);    // 'text/markdown'
 * console.log(result.confidence);  // 0.8
 *
 * const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
 * const pdfResult = classifyContent(pdfBytes);
 * console.log(pdfResult.format);   // 'pdf'
 * console.log(pdfResult.confidence); // 1.0
 * ```
 */
export function classifyContent(input: string | Uint8Array | Buffer): ClassificationResult;
```

---

## Implementation (`classify.ts`)

```typescript
/**
 * Content classification — TypeScript adapter over Rust WASM classify_content_wasm.
 *
 * @module classify
 */

import { wasmModule } from './wasm.js';

export interface ClassificationResult {
  mimeType: string;
  category: 'binary' | 'text' | 'structured' | 'unknown';
  format:
    | 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'svg'
    | 'mp4' | 'webm' | 'mp3' | 'wav' | 'ogg' | 'zip'
    | 'markdown' | 'json' | 'javascript' | 'typescript' | 'python'
    | 'rust' | 'go' | 'plainText'
    | 'unknown';
  confidence: number;
  isExtractable: boolean;
}

// Rust PascalCase enum variants → TS lowercase strings
const CATEGORY_MAP: Record<string, ClassificationResult['category']> = {
  Binary:     'binary',
  Text:       'text',
  Structured: 'structured',
  Unknown:    'unknown',
};

const FORMAT_MAP: Record<string, ClassificationResult['format']> = {
  // Binary
  Pdf:   'pdf',   Png:   'png',   Jpeg: 'jpeg',  Webp:  'webp',
  Avif:  'avif',  Svg:   'svg',   Gif:  'gif',
  Mp4:   'mp4',   Webm:  'webm',  Mp3:  'mp3',
  Wav:   'wav',   Ogg:   'ogg',   Zip:  'zip',
  // Text
  Markdown:   'markdown',   Json:       'json',
  JavaScript: 'javascript', TypeScript: 'typescript',
  Python:     'python',     Rust:       'rust',
  Go:         'go',         PlainText:  'plainText',
  // Fallback
  Unknown: 'unknown',
};

/**
 * Classify content using the Rust WASM classification pipeline.
 */
export function classifyContent(input: string | Uint8Array | Buffer): ClassificationResult {
  // Normalize to Uint8Array
  let bytes: Uint8Array;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else if (Buffer.isBuffer(input)) {
    // Buffer is a Uint8Array subtype in Node.js — works without special handling
    bytes = input;
  } else {
    bytes = input;
  }

  // Call WASM
  const json = wasmModule.classify_content_wasm(bytes);

  // Parse result
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new Error(`classifyContent: WASM returned invalid JSON: ${json}`);
  }

  // Check for WASM-level serialization error
  if (raw.error) {
    throw new Error(`classifyContent: WASM serialization error: ${raw.error}`);
  }

  // Map enum variants to TS strings
  const category = CATEGORY_MAP[raw.category as string] ?? 'unknown';
  const format = FORMAT_MAP[raw.format as string] ?? 'unknown';

  return {
    mimeType:      typeof raw.mimeType === 'string' ? raw.mimeType : 'application/octet-stream',
    category,
    format,
    confidence:    typeof raw.confidence === 'number' ? raw.confidence : 0.0,
    isExtractable: typeof raw.isExtractable === 'boolean' ? raw.isExtractable : false,
  };
}
```

---

## Overload Handling

### `string` input

```typescript
bytes = new TextEncoder().encode(input);
```

- Encodes to UTF-8 bytes.
- BOMs are NOT added (plain string → clean UTF-8).
- The Rust heuristic layer handles BOM stripping if caller passes BOM-prefixed strings (they would appear as bytes `\xEF\xBB\xBF` after encoding — correctly stripped by `strip_bom()`).

### `Uint8Array` input

```typescript
bytes = input; // No copy needed
```

Passed directly to WASM. If the caller provides binary content (PNG bytes, PDF bytes, etc.), the magic-byte layer in Rust handles detection.

### `Buffer` input (Node.js)

```typescript
bytes = input; // Buffer is a Uint8Array subtype
```

Node.js `Buffer` is a subclass of `Uint8Array`. No conversion needed. The WASM binding accepts `Uint8Array` (which `Buffer` satisfies).

---

## Backward Compatibility Helper

This helper is **NOT exported as a replacement for `detectDocumentFormat`**. It is used INTERNALLY by the back-compat reroute (`T828`) inside `disclosure.ts` / `wasm.ts`.

```typescript
/**
 * Map a {@link ClassificationResult} to the legacy four-value format string.
 *
 * Used internally by the `detectDocumentFormat` back-compat reroute (T828).
 * External callers should use `classifyContent` directly for new code.
 *
 * @internal
 */
export function detectFormatFromClassification(
  result: ClassificationResult,
): 'json' | 'markdown' | 'code' | 'text' {
  if (result.format === 'json') return 'json';
  if (result.format === 'markdown') return 'markdown';
  if (['javascript', 'typescript', 'python', 'rust', 'go'].includes(result.format)) {
    return 'code';
  }
  return 'text';  // pdf, png, jpeg, plainText, unknown, all binary formats → 'text'
}
```

**Mapping table** (matches Rust reroute spec in T813):

| `ClassificationResult.format` | Legacy string |
|-------------------------------|--------------|
| `'json'` | `'json'` |
| `'markdown'` | `'markdown'` |
| `'javascript'` \| `'typescript'` \| `'python'` \| `'rust'` \| `'go'` | `'code'` |
| everything else (binary, plainText, unknown) | `'text'` |

---

## Index Exports (`index.ts` additions)

Add to `packages/llmtxt/src/index.ts`:

```typescript
export {
  classifyContent,
  detectFormatFromClassification,
  type ClassificationResult,
} from './classify.js';
```

**Note**: `detectFormatFromClassification` is exported for internal use by the TS back-compat reroute. It MAY be useful to external callers who already have a `ClassificationResult` and want to bridge to legacy code. Mark as `@internal` in JSDoc but keep exported (not `private`) to allow testing.

---

## `wasm.ts` Integration

The `classifyContent` function calls `wasmModule.classify_content_wasm(bytes)`. This requires:

1. `classify_content_wasm` to be exported from `crates/llmtxt-core/src/classify/wasm_bindings.rs` with `#[wasm_bindgen]` (done in T811 spec).
2. wasm-pack regenerates `packages/llmtxt/wasm/llmtxt_core.js` and `packages/llmtxt/wasm/llmtxt_core.d.ts` to include the new export.
3. `wasmModule` in `wasm.ts` is the imported WASM module — `classify_content_wasm` will be available as `wasmModule.classify_content_wasm`.

No changes needed to `wasm.ts` itself beyond the WASM regeneration step. `classifyContent` imports `wasmModule` from `./wasm.js` directly.

---

## TypeScript Tests (`packages/llmtxt/src/__tests__/classify.test.ts`)

Minimum 10 contract tests (Wave-2 AC):

```typescript
describe('classifyContent', () => {
  test('string input — markdown heading → markdown', () => {
    const r = classifyContent('# Hello\n\nContent.');
    expect(r.format).toBe('markdown');
    expect(r.mimeType).toBe('text/markdown');
    expect(r.confidence).toBeCloseTo(0.8);
    expect(r.isExtractable).toBe(true);
    expect(r.category).toBe('text');
  });

  test('string input — JSON → json', () => {
    const r = classifyContent('{"key":"value"}');
    expect(r.format).toBe('json');
    expect(r.category).toBe('structured');
    expect(r.isExtractable).toBe(true);
  });

  test('string input — plain text → plainText', () => {
    const r = classifyContent('Hello world, no signals.');
    expect(r.format).toBe('plainText');
    expect(r.category).toBe('text');
  });

  test('Uint8Array PDF magic → pdf binary', () => {
    const pdfMagic = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]); // %PDF-
    const r = classifyContent(pdfMagic);
    expect(r.format).toBe('pdf');
    expect(r.confidence).toBe(1.0);
    expect(r.isExtractable).toBe(true);
    expect(r.category).toBe('binary');
  });

  test('Uint8Array PNG magic → png binary', () => {
    const pngMagic = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const r = classifyContent(pngMagic);
    expect(r.format).toBe('png');
    expect(r.confidence).toBe(1.0);
    expect(r.isExtractable).toBe(false);
  });

  test('Buffer input → works (Buffer is Uint8Array subtype)', () => {
    const buf = Buffer.from('{"a":1}');
    const r = classifyContent(buf);
    expect(r.format).toBe('json');
  });

  test('empty string → unknown confidence 0.0', () => {
    const r = classifyContent('');
    expect(r.confidence).toBe(0.0);
    expect(r.format).toBe('unknown');
  });

  test('heading-only markdown → markdown (Wave-1 fix validated)', () => {
    const r = classifyContent('# Single Heading Only');
    expect(r.format).toBe('markdown');
    expect(r.confidence).toBeCloseTo(0.8);
  });

  test('TypeScript code → typescript format', () => {
    const r = classifyContent('const x: string = "hello";\nexport { x };');
    expect(r.format).toBe('typescript');
    expect(r.category).toBe('text');
  });

  test('detectFormatFromClassification maps formats correctly', () => {
    expect(detectFormatFromClassification({ format: 'json', category: 'structured', mimeType: '', confidence: 1, isExtractable: true })).toBe('json');
    expect(detectFormatFromClassification({ format: 'markdown', category: 'text', mimeType: '', confidence: 1, isExtractable: true })).toBe('markdown');
    expect(detectFormatFromClassification({ format: 'typescript', category: 'text', mimeType: '', confidence: 1, isExtractable: true })).toBe('code');
    expect(detectFormatFromClassification({ format: 'pdf', category: 'binary', mimeType: '', confidence: 1, isExtractable: true })).toBe('text');
    expect(detectFormatFromClassification({ format: 'unknown', category: 'unknown', mimeType: '', confidence: 0, isExtractable: false })).toBe('text');
  });
});
```

---

## Quality Gates

Before merging Wave-2 TS implementation:

- [ ] `pnpm typecheck` exits 0 (`packages/llmtxt`)
- [ ] `pnpm test` includes `classify.test.ts` — all 10+ tests pass
- [ ] `classify_content_wasm` present in `packages/llmtxt/wasm/llmtxt_core.d.ts`
- [ ] `classifyContent` and `ClassificationResult` exported from `packages/llmtxt` root
- [ ] `classifyContent('# H')` returns `{ format: 'markdown', confidence: 0.8 }` in integration smoke test
- [ ] No TypeScript `any` usage in `classify.ts` (use explicit `Record<string, unknown>` for WASM parse)
