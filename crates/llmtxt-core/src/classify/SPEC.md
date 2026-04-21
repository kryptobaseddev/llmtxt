# SPEC: `crates/llmtxt-core/src/classify` Module

Spec version: 1.0.0
Task: T811 (S1)
Epic: T780 (Wave-2 — llmtxt@2026.4.13)
Status: APPROVED (Architect decision T780-decomposition.md)

---

## Overview

The `classify` module provides a layered content classification pipeline:

```
classify_content(bytes: &[u8]) → ClassificationResult

Layer 1: Magic-byte detection (infer@0.19)
    ↓ (if no match)
Layer 2: Text/binary gate (content_inspector@0.2.4)
    ↓ (if is_text)
Layer 3: Text heuristics (extracted from disclosure/mod.rs)
    → markdown / json / code / plain-text

WASM binding: classify_content_wasm(bytes: &[u8]) → String (JSON)
```

---

## Module Layout

```
crates/llmtxt-core/src/classify/
  mod.rs              — public API: classify_content(), re-exports types
  magic.rs            — Layer 1: magic-byte detection (infer crate wrapper)
  text_gate.rs        — Layer 2: text/binary gate (content_inspector wrapper)
  heuristic.rs        — Layer 3: markdown/JSON/code/text signals (extracted from disclosure/mod.rs)
  wasm_bindings.rs    — #[wasm_bindgen] exports
  types.rs            — ClassificationResult, ContentCategory, ContentFormat enums
  tests.rs            — #[cfg(test)] unit tests (30+ cases minimum)
```

The directory `crates/llmtxt-core/src/classify/` is a NEW module and does not exist prior to Wave-2. It is NOT to be confused with the existing `disclosure/` module which is separate and remains unchanged (except for the back-compat reroute in `disclosure/mod.rs`).

---

## Public Rust API (`mod.rs`)

```rust
//! Content classification pipeline for LLMtxt.
//!
//! Entry point: [`classify_content`] — takes raw bytes, returns a [`ClassificationResult`].
//!
//! Layer order:
//! 1. Magic-byte detection via `infer` crate (1.0 confidence on hit)
//! 2. Text/binary gate via `content_inspector` (determines is_text)
//! 3. Heuristic text classification (markdown / JSON / code / plain-text)
//!
//! The WASM export is [`classify_content_wasm`] in `wasm_bindings.rs`.

pub mod magic;
pub mod text_gate;
pub mod heuristic;
pub mod types;
pub mod wasm_bindings;

#[cfg(test)]
mod tests;

pub use types::{ClassificationResult, ContentCategory, ContentFormat};

/// Classify the content of `bytes` using a three-layer pipeline.
///
/// # Guarantees
///
/// - Zero-byte input returns `{ confidence: 0.0, category: Unknown, format: Unknown }` without panic.
/// - UTF-8 BOM (0xEF 0xBB 0xBF) and UTF-16 BOMs (0xFF 0xFE, 0xFE 0xFF) are stripped
///   before the heuristic pass.
/// - Binary inputs that pass magic-byte detection return `is_extractable: false`
///   (except PDF which returns `is_extractable: true`).
///
/// # Confidence Semantics
///
/// | Value | Meaning |
/// |-------|---------|
/// | 1.0   | Magic-byte match confirmed by `infer` |
/// | 0.8   | Strong heuristic signal (JSON parses successfully; heading present) |
/// | 0.5   | Weak heuristic match (single code signal) |
/// | 0.0   | Empty input — cannot determine |
///
/// # Examples
///
/// ```rust
/// use llmtxt_core::classify::{classify_content, ContentFormat};
///
/// let result = classify_content(b"%PDF-1.4 ...");
/// assert_eq!(result.format, ContentFormat::Pdf);
/// assert_eq!(result.confidence, 1.0);
///
/// let result = classify_content(b"# Hello\n\nThis is markdown.");
/// assert_eq!(result.format, ContentFormat::Markdown);
/// assert_eq!(result.confidence, 0.8);
///
/// let result = classify_content(b"");
/// assert_eq!(result.confidence, 0.0);
/// ```
pub fn classify_content(bytes: &[u8]) -> ClassificationResult {
    use magic::detect_magic;
    use text_gate::is_text;
    use heuristic::classify_text;
    use types::{ContentCategory, ContentFormat};

    // Guard: zero-byte input
    if bytes.is_empty() {
        return ClassificationResult {
            mime_type: "application/octet-stream".to_string(),
            category: ContentCategory::Unknown,
            format: ContentFormat::Unknown,
            confidence: 0.0,
            is_extractable: false,
        };
    }

    // Layer 1: Magic-byte detection
    if let Some(result) = detect_magic(bytes) {
        return result;
    }

    // Layer 2: Text/binary gate
    if !is_text(bytes) {
        return ClassificationResult {
            mime_type: "application/octet-stream".to_string(),
            category: ContentCategory::Binary,
            format: ContentFormat::Unknown,
            confidence: 0.5,
            is_extractable: false,
        };
    }

    // Layer 3: Text heuristics (BOM-strip happens inside classify_text)
    classify_text(bytes)
}
```

---

## Types (`types.rs`)

```rust
use serde::{Deserialize, Serialize};

/// Result of [`classify_content`].
///
/// Fields use `camelCase` for JSON serialization to match the TypeScript surface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationResult {
    /// IANA MIME type string, e.g. `"application/pdf"`, `"text/markdown"`.
    pub mime_type: String,

    /// Coarse category bucket.
    pub category: ContentCategory,

    /// Specific format within the category.
    pub format: ContentFormat,

    /// Classification confidence in `[0.0, 1.0]`.
    ///
    /// See [`classify_content`] documentation for semantics.
    pub confidence: f32,

    /// Whether text content can be extracted from this format.
    ///
    /// `true` for text formats and PDF (future extraction support).
    /// `false` for binary formats without a text layer (images, audio, zip).
    pub is_extractable: bool,
}

/// Coarse content category.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ContentCategory {
    /// Binary format (image, audio, video, archive, etc.)
    Binary,
    /// Human-readable text (plain, markdown, code).
    Text,
    /// Structured data format (JSON, YAML, TOML).
    Structured,
    /// Cannot be determined (empty input or unrecognised binary).
    Unknown,
}

/// Specific content format.
///
/// Variants listed below form the Wave-2 minimum coverage set (17 formats).
/// Additional formats may be added in future waves without breaking changes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ContentFormat {
    // ── Binary ────────────────────────────────────────────────
    /// PDF document (application/pdf) — magic: `%PDF`
    Pdf,
    /// PNG image (image/png) — magic: `\x89PNG\r\n\x1a\n`
    Png,
    /// JPEG image (image/jpeg) — magic: `\xFF\xD8\xFF`
    Jpeg,
    /// WebP image (image/webp) — magic: `RIFF....WEBP`
    Webp,
    /// AVIF image (image/avif) — magic: `ftyp` container
    Avif,
    /// SVG image (image/svg+xml) — magic/heuristic: `<svg`
    Svg,
    /// GIF image (image/gif) — magic: `GIF87a` / `GIF89a`
    Gif,
    /// MP4 video (video/mp4) — magic: `ftyp` container
    Mp4,
    /// WebM video (video/webm) — magic: `\x1A\x45\xDF\xA3`
    Webm,
    /// MP3 audio (audio/mpeg) — magic: `ID3` / `\xFF\xFB`
    Mp3,
    /// WAV audio (audio/wav) — magic: `RIFF....WAVE`
    Wav,
    /// OGG audio (audio/ogg) — magic: `OggS`
    Ogg,
    /// ZIP archive (application/zip) — magic: `PK\x03\x04`
    Zip,

    // ── Text ─────────────────────────────────────────────────
    /// Markdown document (text/markdown)
    Markdown,
    /// JSON document (application/json)
    Json,
    /// JavaScript source (text/javascript)
    JavaScript,
    /// TypeScript source (text/typescript)
    TypeScript,
    /// Python source (text/x-python)
    Python,
    /// Rust source (text/x-rust)
    Rust,
    /// Go source (text/x-go)
    Go,
    /// Plain text (text/plain) — fallback for unrecognised text content
    PlainText,

    // ── Fallback ─────────────────────────────────────────────
    /// Unknown format — empty input or unrecognised binary
    Unknown,
}
```

---

## Layer 1: Magic-Byte Detection (`magic.rs`)

```rust
//! Layer 1: Magic-byte content detection using the `infer` crate.
//!
//! Returns `Some(ClassificationResult)` when a magic-byte pattern is confirmed,
//! or `None` when the type is unrecognised (caller falls through to Layer 2).

use infer;
use super::types::{ClassificationResult, ContentCategory, ContentFormat};

/// Attempt to detect the content type via magic bytes.
///
/// Returns `None` for unknown binary types — caller should proceed to Layer 2.
pub fn detect_magic(bytes: &[u8]) -> Option<ClassificationResult> {
    let kind = infer::get(bytes)?;
    
    let (format, category, is_extractable) = match kind.mime_type() {
        "application/pdf"   => (ContentFormat::Pdf,    ContentCategory::Binary, true),
        "image/png"         => (ContentFormat::Png,    ContentCategory::Binary, false),
        "image/jpeg"        => (ContentFormat::Jpeg,   ContentCategory::Binary, false),
        "image/webp"        => (ContentFormat::Webp,   ContentCategory::Binary, false),
        "image/avif"        => (ContentFormat::Avif,   ContentCategory::Binary, false),
        "image/svg+xml"     => (ContentFormat::Svg,    ContentCategory::Binary, false),
        "image/gif"         => (ContentFormat::Gif,    ContentCategory::Binary, false),
        "video/mp4"         => (ContentFormat::Mp4,    ContentCategory::Binary, false),
        "video/webm"        => (ContentFormat::Webm,   ContentCategory::Binary, false),
        "audio/mpeg"        => (ContentFormat::Mp3,    ContentCategory::Binary, false),
        "audio/x-wav" | "audio/wav"
                            => (ContentFormat::Wav,    ContentCategory::Binary, false),
        "audio/ogg"         => (ContentFormat::Ogg,    ContentCategory::Binary, false),
        "application/zip"   => (ContentFormat::Zip,    ContentCategory::Binary, false),
        // Unrecognised MIME from infer — return None, let text gate decide
        _ => return None,
    };
    
    Some(ClassificationResult {
        mime_type: kind.mime_type().to_string(),
        category,
        format,
        confidence: 1.0,
        is_extractable,
    })
}
```

**Implementation note**: `infer::get` returns `None` for text content — it only matches known binary magic patterns. Text detection is handled by Layers 2 and 3.

**WAV MIME note**: `infer` returns `"audio/x-wav"`. Normalise to `"audio/wav"` in the arm for consistency with IANA registry.

---

## Layer 2: Text/Binary Gate (`text_gate.rs`)

```rust
//! Layer 2: Text/binary gate using the `content_inspector` crate.
//!
//! `content_inspector::inspect` uses byte-frequency analysis to distinguish
//! text from binary content. It handles UTF-8 BOM, UTF-16 LE/BE BOMs, and
//! malformed UTF-8 sequences correctly.

use content_inspector;

/// Returns `true` if `bytes` appear to be text (UTF-8, UTF-16, or similar text encoding).
///
/// Returns `false` for binary content (high frequency of null/control bytes).
///
/// # Notes
///
/// - UTF-8 BOM (`\xEF\xBB\xBF`) is treated as text.
/// - UTF-16 LE BOM (`\xFF\xFE`) and UTF-16 BE BOM (`\xFE\xFF`) are treated as text.
/// - Malformed UTF-8 sequences with high binary byte frequency → binary.
pub fn is_text(bytes: &[u8]) -> bool {
    content_inspector::inspect(bytes).is_text()
}
```

---

## Layer 3: Text Heuristics (`heuristic.rs`)

```rust
//! Layer 3: Text heuristic classification.
//!
//! Extracts the signal logic currently inlined in `disclosure/mod.rs:detect_document_format`
//! into this standalone, testable module. After Wave-2 lands, `detect_document_format`
//! delegates to `classify_content` (via the back-compat reroute in T828).
//!
//! BOM stripping is performed before analysis:
//! - UTF-8 BOM:    `\xEF\xBB\xBF` — strip 3 bytes
//! - UTF-16 LE:    `\xFF\xFE`      — strip 2 bytes  
//! - UTF-16 BE:    `\xFE\xFF`      — strip 2 bytes

use super::types::{ClassificationResult, ContentCategory, ContentFormat};

/// Classify text bytes using heuristic signals.
///
/// Caller guarantees `bytes` is non-empty and passed Layer 2 (`is_text == true`).
///
/// Precedence order:
/// 1. JSON: valid `serde_json` parse → `Json` (confidence 0.8)
/// 2. Markdown: any heading signal → `Markdown` (confidence 0.8)
/// 3. Markdown: 2+ of 5 signals → `Markdown` (confidence 0.8)
/// 4. Code: 2+ of 5 code signals → appropriate code format (confidence 0.5)
/// 5. Fallback: `PlainText` (confidence 0.3)
pub fn classify_text(bytes: &[u8]) -> ClassificationResult {
    // Strip BOMs before string conversion
    let stripped = strip_bom(bytes);
    
    // Convert to &str (lossy for robustness)
    let content = match std::str::from_utf8(stripped) {
        Ok(s) => s,
        Err(_) => {
            // Valid text (passed is_text gate) but not valid UTF-8 — treat as plain
            return ClassificationResult {
                mime_type: "text/plain".to_string(),
                category: ContentCategory::Text,
                format: ContentFormat::PlainText,
                confidence: 0.5,
                is_extractable: true,
            };
        }
    };
    
    let trimmed = content.trim();
    
    // ── JSON detection ────────────────────────────────────────────────
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if serde_json::from_str::<serde_json::Value>(trimmed).is_ok() {
            return ClassificationResult {
                mime_type: "application/json".to_string(),
                category: ContentCategory::Structured,
                format: ContentFormat::Json,
                confidence: 0.8,
                is_extractable: true,
            };
        }
        // Partial JSON signals (malformed but JSON-like)
        let json_signals = [
            content.contains("\":"),
            trimmed.starts_with('{') || trimmed.starts_with('['),
            trimmed.ends_with('}') || trimmed.ends_with(']'),
        ];
        if json_signals.iter().filter(|&&b| b).count() >= 2 {
            return ClassificationResult {
                mime_type: "application/json".to_string(),
                category: ContentCategory::Structured,
                format: ContentFormat::Json,
                confidence: 0.5,
                is_extractable: true,
            };
        }
    }
    
    // ── Markdown detection ────────────────────────────────────────────
    let has_heading = content.lines().any(|l| {
        let t = l.trim_start_matches(' ');
        t.starts_with("# ")
            || t.starts_with("## ")
            || t.starts_with("### ")
            || t.starts_with("#### ")
            || t.starts_with("##### ")
            || t.starts_with("###### ")
    });
    
    // Short-circuit on heading (strong unambiguous signal — Wave-1 fix)
    if has_heading {
        return ClassificationResult {
            mime_type: "text/markdown".to_string(),
            category: ContentCategory::Text,
            format: ContentFormat::Markdown,
            confidence: 0.8,
            is_extractable: true,
        };
    }
    
    let markdown_signals: [bool; 5] = [
        has_heading,
        content.lines().any(|l| l.trim_start().starts_with("- ") || l.trim_start().starts_with("* ")),
        content.lines().any(|l| l.trim_start().starts_with(|c: char| c.is_ascii_digit()) && l.contains(". ")),
        content.contains("```"),
        has_markdown_link(content),
    ];
    if markdown_signals.iter().filter(|&&b| b).count() >= 2 {
        return ClassificationResult {
            mime_type: "text/markdown".to_string(),
            category: ContentCategory::Text,
            format: ContentFormat::Markdown,
            confidence: 0.8,
            is_extractable: true,
        };
    }
    
    // ── Code detection ────────────────────────────────────────────────
    let (code_signals, detected_lang) = detect_code(content);
    if code_signals >= 2 {
        let (mime_type, format) = match detected_lang {
            Some(CodeLang::TypeScript) => ("text/typescript", ContentFormat::TypeScript),
            Some(CodeLang::JavaScript) => ("text/javascript", ContentFormat::JavaScript),
            Some(CodeLang::Python)     => ("text/x-python",   ContentFormat::Python),
            Some(CodeLang::Rust)       => ("text/x-rust",     ContentFormat::Rust),
            Some(CodeLang::Go)         => ("text/x-go",       ContentFormat::Go),
            None                       => ("text/plain",      ContentFormat::PlainText),
        };
        return ClassificationResult {
            mime_type: mime_type.to_string(),
            category: ContentCategory::Text,
            format,
            confidence: 0.5,
            is_extractable: true,
        };
    }
    
    // ── Fallback: plain text ─────────────────────────────────────────
    ClassificationResult {
        mime_type: "text/plain".to_string(),
        category: ContentCategory::Text,
        format: ContentFormat::PlainText,
        confidence: 0.3,
        is_extractable: true,
    }
}

// ── Internal helpers ───────────────────────────────────────────────

/// Strips leading BOM sequences from bytes.
fn strip_bom(bytes: &[u8]) -> &[u8] {
    // UTF-8 BOM: EF BB BF
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return &bytes[3..];
    }
    // UTF-16 LE BOM: FF FE
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return &bytes[2..];
    }
    // UTF-16 BE BOM: FE FF
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return &bytes[2..];
    }
    bytes
}

/// Detects whether a `[text](url)` markdown link pattern exists in `s`.
fn has_markdown_link(s: &str) -> bool {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'['
            && let Some(cb) = bytes[i..].iter().position(|&b| b == b']')
        {
            let j = i + cb;
            if j + 1 < bytes.len() && bytes[j + 1] == b'(' && bytes[j + 1..].contains(&b')') {
                return true;
            }
        }
        i += 1;
    }
    false
}

/// Language hints for code detection.
enum CodeLang { JavaScript, TypeScript, Python, Rust, Go }

/// Returns `(signal_count, Option<CodeLang>)`.
fn detect_code(content: &str) -> (usize, Option<CodeLang>) {
    let code_signals: [bool; 5] = [
        content.lines().any(|l| {
            let t = l.trim_start();
            t.starts_with("import ")
                || t.starts_with("export ")
                || t.starts_with("const ")
                || t.starts_with("let ")
                || t.starts_with("var ")
                || t.starts_with("function ")
                || t.starts_with("class ")
                || t.starts_with("def ")
                || t.starts_with("fn ")
                || t.starts_with("pub ")
                || t.starts_with("use ")
        }),
        content.lines().any(|l| {
            l.trim_end().ends_with('{')
                || l.trim_end().ends_with(';')
                || l.trim_end().ends_with('}')
        }),
        content.lines().any(|l| {
            let t = l.trim_start();
            t.starts_with("if ")
                || t.starts_with("for ")
                || t.starts_with("while ")
                || t.starts_with("return ")
                || t.starts_with("switch ")
        }),
        content.contains("=>"),
        content.contains(": string")
            || content.contains(": number")
            || content.contains(": boolean")
            || content.contains(": int")
            || content.contains(": void")
            || content.contains(": any"),
    ];
    let count = code_signals.iter().filter(|&&b| b).count();

    // Language detection heuristics (best-effort, not exhaustive)
    let lang = if content.contains(": string") || content.contains(": boolean") || content.contains(": number") {
        Some(CodeLang::TypeScript)
    } else if content.contains("def ") && content.contains(":") && !content.contains("{") {
        Some(CodeLang::Python)
    } else if content.contains("fn ") && content.contains("pub ") {
        Some(CodeLang::Rust)
    } else if content.contains("func ") && content.contains("package ") {
        Some(CodeLang::Go)
    } else if count >= 2 {
        Some(CodeLang::JavaScript)
    } else {
        None
    };

    (count, lang)
}
```

---

## WASM Bindings (`wasm_bindings.rs`)

```rust
//! WASM exports for the classify module.
//!
//! Exports a single JSON-returning function `classify_content_wasm` to avoid
//! wasm-bindgen's struct serialization complexity. The TS layer parses the JSON
//! and maps to camelCase fields.

use wasm_bindgen::prelude::*;
use super::classify_content;

/// Classify content and return a JSON string.
///
/// Input: raw bytes as a `&[u8]`. WASM callers pass a `Uint8Array`.
///
/// Output: JSON string of [`ClassificationResult`] (camelCase keys).
///
/// On serialization failure (should not occur in practice), returns:
/// `{"error":"serialize failed: <reason>","mimeType":"application/octet-stream","category":"Unknown","format":"Unknown","confidence":0.0,"isExtractable":false}`
///
/// WASM consumers MUST check for the `error` key.
#[wasm_bindgen]
pub fn classify_content_wasm(bytes: &[u8]) -> String {
    let result = classify_content(bytes);
    serde_json::to_string(&result).unwrap_or_else(|e| {
        format!(
            r#"{{"error":"serialize failed: {}","mimeType":"application/octet-stream","category":"Unknown","format":"Unknown","confidence":0.0,"isExtractable":false}}"#,
            e
        )
    })
}
```

**Notes**:
- `ClassificationResult` derives `Serialize` with `#[serde(rename_all = "camelCase")]` — JSON keys are camelCase automatically.
- `ContentCategory` and `ContentFormat` serialize as their variant name string (e.g. `"Binary"`, `"Markdown"`).
- The TS adapter maps these to lowercase strings for the public API (see T812 spec).

---

## Cargo Dependencies (`Cargo.toml` additions)

Add to `[dependencies]` section of `crates/llmtxt-core/Cargo.toml`:

```toml
# Layer 1: magic-byte content type detection
infer = { version = "0.19", default-features = false, features = ["alloc"] }

# Layer 2: text/binary gate via byte-frequency analysis
content_inspector = "0.2.4"
```

**Feature flags**:
- `infer`: `default-features = false, features = ["alloc"]` — disables std (compatible with wasm32-unknown-unknown), enables alloc (required for Vec/String in WASM). Confirmed WASM-compatible in T780 probe.
- `content_inspector`: no feature flags needed — pure Rust, memchr dependency only, WASM-confirmed.

**Feature gating**: These dependencies are NOT gated behind `[features]`. They are always compiled. The WASM size probe showed ~102KB overhead for both crates in a minimal probe crate — well within the 526KB budget (20% of 2.57MB baseline).

---

## Confidence Semantics (Normative)

| Confidence | Condition |
|-----------|-----------|
| `1.0` | Magic-byte match confirmed by `infer::get()` |
| `0.8` | Strong heuristic: JSON parse succeeds OR markdown heading present OR 2+ markdown signals |
| `0.5` | Weak heuristic: 2+ code signals (language uncertain); or content_inspector says text but no heuristic match; or malformed JSON with 2+ JSON-like signals |
| `0.3` | Plain text fallback (no other signal matched) |
| `0.0` | Zero-byte input — cannot determine |

---

## Zero-Byte Handling (Normative)

`classify_content(&[])` MUST return:

```rust
ClassificationResult {
    mime_type: "application/octet-stream".to_string(),
    category: ContentCategory::Unknown,
    format: ContentFormat::Unknown,
    confidence: 0.0,
    is_extractable: false,
}
```

No panic. No `unwrap`. This contract is verified by test `test_empty_input` in `tests.rs`.

---

## BOM Handling (Normative)

The following BOMs are stripped by `strip_bom()` before heuristic analysis:

| BOM | Bytes | Action |
|-----|-------|--------|
| UTF-8 | `0xEF 0xBB 0xBF` | Strip 3 bytes before heuristic |
| UTF-16 LE | `0xFF 0xFE` | Strip 2 bytes before heuristic |
| UTF-16 BE | `0xFE 0xFF` | Strip 2 bytes before heuristic |

Content that begins with a BOM passes `is_text()` check (content_inspector handles these correctly). The BOM is stripped before passing to heuristic analysis to avoid misclassifying BOM-prefixed JSON/markdown as unknown.

---

## Test Plan (`tests.rs` minimum — 30 cases)

### Magic-byte tests (13 cases — one per binary format)

```rust
test_pdf_magic()     — b"%PDF-1.4 body" → Pdf, confidence 1.0
test_png_magic()     — PNG header bytes → Png, confidence 1.0
test_jpeg_magic()    — JPEG header bytes → Jpeg, confidence 1.0
test_webp_magic()    — RIFF...WEBP bytes → Webp, confidence 1.0
test_avif_magic()    — ftyp container → Avif, confidence 1.0
test_svg_magic()     — <svg bytes → Svg (may be text-layer detect)
test_gif_magic()     — GIF89a bytes → Gif, confidence 1.0
test_mp4_magic()     — ftyp container → Mp4, confidence 1.0
test_webm_magic()    — 0x1A45DFA3 bytes → Webm, confidence 1.0
test_mp3_magic()     — ID3 bytes → Mp3, confidence 1.0
test_wav_magic()     — RIFF...WAVE bytes → Wav, confidence 1.0
test_ogg_magic()     — OggS bytes → Ogg, confidence 1.0
test_zip_magic()     — PK\x03\x04 bytes → Zip, confidence 1.0
```

### Heuristic text tests (10 cases)

```rust
test_json_valid()           — r#"{"key":"value"}"# → Json, confidence 0.8
test_json_array()           — "[1,2,3]" → Json, confidence 0.8
test_markdown_heading()     — "# Title\n\nBody" → Markdown, confidence 0.8
test_markdown_heading_only()— "# Title Only" → Markdown (Wave-1 fix validated)
test_markdown_multi_signal()— "- item\n```code```" → Markdown (2+ signals)
test_code_typescript()      — "const x: string = 'hi';" → TypeScript
test_code_python()          — "def foo():\n    return 1" → Python
test_code_rust()            — "pub fn main() { let x = 1; }" → Rust
test_plain_text()           — "Hello world." → PlainText
test_empty_input()          — b"" → Unknown, confidence 0.0
```

### BOM handling tests (3 cases)

```rust
test_utf8_bom_json()     — "\xEF\xBB\xBF{\"a\":1}" → Json (BOM stripped)
test_utf16_le_bom()      — "\xFF\xFE" + UTF-16 text → Text category
test_utf16_be_bom()      — "\xFE\xFF" + UTF-16 text → Text category
```

### Edge cases (4 cases)

```rust
test_partial_json_signals() — malformed JSON with 2+ signals → Json confidence 0.5
test_binary_not_magic()     — random binary bytes → Binary Unknown confidence 0.5
test_svg_text_detection()   — SVG XML content (text path) → Svg or PlainText
test_code_weak_signal()     — single code signal only → PlainText (not code)
```

---

## Integration with Back-Compat Reroute (T828)

After Wave-2 lands, `disclosure/mod.rs` is updated:

```rust
// In crates/llmtxt-core/src/disclosure/mod.rs
use crate::classify::{classify_content, ContentFormat};

pub fn detect_document_format(content: &str) -> &'static str {
    let result = classify_content(content.as_bytes());
    match result.format {
        ContentFormat::Json                                              => "json",
        ContentFormat::Markdown                                          => "markdown",
        ContentFormat::JavaScript | ContentFormat::TypeScript
        | ContentFormat::Python | ContentFormat::Rust | ContentFormat::Go => "code",
        _ => "text",  // PlainText, Binary formats, Unknown all → "text"
    }
}
```

The Wave-1 markdown heading fix (short-circuit in `heuristic.rs`) is the SSoT for this logic after Wave-2 lands. The previously inlined logic in `mod.rs` is REMOVED and replaced by this delegation.

---

## WASM Module Registration

In `crates/llmtxt-core/src/lib.rs`, add the module declaration:

```rust
pub mod classify;
```

Ensure `classify_content_wasm` is re-exported at the crate root or accessible via the module path for wasm-pack. The `#[wasm_bindgen]` attribute on `classify_content_wasm` in `wasm_bindings.rs` registers it automatically when wasm-pack builds with `--target bundler` or `--target web`.

---

## Quality Gates

Before merging Wave-2 implementation:

- [ ] `cargo fmt --check` exits 0 on `crates/llmtxt-core`
- [ ] `cargo clippy -- -D warnings` exits 0 on `crates/llmtxt-core`
- [ ] `cargo test -p llmtxt-core` — all 30+ classify tests pass
- [ ] `ferrous-forge validate` exits 0
- [ ] WASM binary size: `wc -c packages/llmtxt/wasm/llmtxt_core_bg.wasm` ≤ 3,160,021 bytes
- [ ] `classify_content_wasm` accessible from `packages/llmtxt/wasm/llmtxt_core.js`
