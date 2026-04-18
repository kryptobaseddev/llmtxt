/**
 * Progressive disclosure: structural analysis, section extraction,
 * line-range access, content search, and JSONPath queries.
 *
 * All logic now lives in `crates/llmtxt-core::disclosure` (Rust/WASM).
 * This module is a thin TypeScript wrapper that delegates to the WASM
 * entry-points via `wasm.ts`.
 *
 * @see {@link https://github.com/kryptobaseddev/llmtxt/tree/main/crates/llmtxt-core/src/disclosure}
 */
/**
 * A logical section identified within a document.
 *
 * @remarks
 * Sections are detected by format-specific heuristics (headings in
 * markdown, top-level keys in JSON, function/class declarations in code).
 */
export interface Section {
    /** Display title of the section (heading text, JSON key, or symbol name). */
    title: string;
    /** Nesting depth (0-based). Headings use depth = level - 1. */
    depth: number;
    /** 1-based line number where the section begins. */
    startLine: number;
    /** 1-based line number where the section ends (inclusive). */
    endLine: number;
    /** Estimated token count for the section content. */
    tokenCount: number;
    /** The structural type of the section. */
    type: 'heading' | 'json-key' | 'code-block' | 'function' | 'class';
}
/**
 * High-level structural overview of a document.
 *
 * @remarks
 * Produced by {@link generateOverview}. Provides format detection,
 * token counts, section listings, and format-specific extras (JSON keys
 * or a markdown table of contents).
 */
export interface DocumentOverview {
    /** The detected document format. */
    format: 'json' | 'markdown' | 'code' | 'text';
    /** Total number of lines in the document. */
    lineCount: number;
    /** Estimated total token count for the entire document. */
    tokenCount: number;
    /** Ordered list of sections found in the document. */
    sections: Section[];
    /** Top-level JSON keys with type info and preview (JSON documents only). */
    keys?: Array<{
        key: string;
        type: string;
        preview: string;
    }>;
    /** Markdown table of contents entries (markdown documents only). */
    toc?: Array<{
        title: string;
        depth: number;
        line: number;
    }>;
}
/**
 * A single match returned by {@link searchContent}.
 */
export interface SearchResult {
    /** 1-based line number of the matching line. */
    line: number;
    /** The full text of the matching line. */
    content: string;
    /** Lines immediately preceding the match (up to `contextLines`). */
    contextBefore: string[];
    /** Lines immediately following the match (up to `contextLines`). */
    contextAfter: string[];
}
/**
 * Result of extracting a line range from a document via {@link getLineRange}.
 */
export interface LineRangeResult {
    /** 1-based line number where the extracted range begins. */
    startLine: number;
    /** 1-based line number where the extracted range ends (inclusive). */
    endLine: number;
    /** The extracted text content for the requested line range. */
    content: string;
    /** Estimated token count for the extracted content. */
    tokenCount: number;
    /** Total number of lines in the full document. */
    totalLines: number;
    /** Estimated total token count for the full document. */
    totalTokens: number;
    /** Number of tokens saved by extracting only this range. */
    tokensSaved: number;
}
export { detectDocumentFormat, generateOverview, getLineRange, searchContent, queryJsonPath, getSection, } from './wasm.js';
//# sourceMappingURL=disclosure.d.ts.map