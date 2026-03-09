/**
 * Progressive disclosure utilities for querying document content.
 * Allows agents to access only the portions they need, reducing token costs.
 */

import { calculateTokens } from './compression.js';

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

export interface Section {
  /** Section title or key name */
  title: string;
  /** Nesting depth (0 = top-level) */
  depth: number;
  /** 1-indexed start line */
  startLine: number;
  /** 1-indexed end line (inclusive) */
  endLine: number;
  /** Estimated token count for this section */
  tokenCount: number;
  /** Section type */
  type: 'heading' | 'json-key' | 'code-block' | 'function' | 'class';
}

export interface DocumentOverview {
  /** Detected format */
  format: 'json' | 'markdown' | 'code' | 'text';
  /** Total line count */
  lineCount: number;
  /** Total token count */
  tokenCount: number;
  /** Document sections/structure */
  sections: Section[];
  /** For JSON: top-level keys with types */
  keys?: Array<{ key: string; type: string; preview: string }>;
  /** For markdown: table of contents */
  toc?: Array<{ title: string; depth: number; line: number }>;
}

export interface SearchResult {
  /** 1-indexed line number */
  line: number;
  /** Line content */
  content: string;
  /** Match context: lines before */
  contextBefore: string[];
  /** Match context: lines after */
  contextAfter: string[];
}

export interface LineRangeResult {
  /** 1-indexed start line (actual) */
  startLine: number;
  /** 1-indexed end line (actual, inclusive) */
  endLine: number;
  /** Content for the range */
  content: string;
  /** Token count for the returned content */
  tokenCount: number;
  /** Total lines in document */
  totalLines: number;
  /** Token count for entire document */
  totalTokens: number;
  /** Tokens saved by using this range */
  tokensSaved: number;
}

// ──────────────────────────────────────────────────────────────────
// Line range access
// ──────────────────────────────────────────────────────────────────

/**
 * Get a specific range of lines from content.
 * @param content - Full document content
 * @param start - 1-indexed start line
 * @param end - 1-indexed end line (inclusive)
 */
export function getLineRange(content: string, start: number, end: number): LineRangeResult {
  const lines = content.split('\n');
  const totalLines = lines.length;
  const totalTokens = calculateTokens(content);

  // Clamp to valid range
  const s = Math.max(1, Math.min(start, totalLines));
  const e = Math.max(s, Math.min(end, totalLines));

  // Extract lines (convert from 1-indexed to 0-indexed)
  const selectedLines = lines.slice(s - 1, e);
  const selectedContent = selectedLines.join('\n');
  const selectedTokens = calculateTokens(selectedContent);

  return {
    startLine: s,
    endLine: e,
    content: selectedContent,
    tokenCount: selectedTokens,
    totalLines,
    totalTokens,
    tokensSaved: totalTokens - selectedTokens,
  };
}

// ──────────────────────────────────────────────────────────────────
// Content search
// ──────────────────────────────────────────────────────────────────

/**
 * Search content for a query string or regex.
 * Returns matching lines with surrounding context.
 * @param content - Full document content
 * @param query - Search string or /regex/
 * @param contextLines - Number of context lines before/after (default: 2)
 * @param maxResults - Maximum results to return (default: 20)
 */
export function searchContent(
  content: string,
  query: string,
  contextLines = 2,
  maxResults = 20,
): SearchResult[] {
  const lines = content.split('\n');
  const results: SearchResult[] = [];

  // Determine if query is regex (wrapped in /)
  let matcher: (line: string) => boolean;
  if (query.startsWith('/') && query.lastIndexOf('/') > 0) {
    const lastSlash = query.lastIndexOf('/');
    const pattern = query.slice(1, lastSlash);
    const flags = query.slice(lastSlash + 1) || 'i';
    try {
      const regex = new RegExp(pattern, flags);
      matcher = (line) => regex.test(line);
    } catch {
      // Invalid regex, fall back to string search
      const lowerQuery = query.toLowerCase();
      matcher = (line) => line.toLowerCase().includes(lowerQuery);
    }
  } else {
    const lowerQuery = query.toLowerCase();
    matcher = (line) => line.toLowerCase().includes(lowerQuery);
  }

  for (let i = 0; i < lines.length && results.length < maxResults; i++) {
    if (matcher(lines[i])) {
      const beforeStart = Math.max(0, i - contextLines);
      const afterEnd = Math.min(lines.length - 1, i + contextLines);

      results.push({
        line: i + 1, // 1-indexed
        content: lines[i],
        contextBefore: lines.slice(beforeStart, i),
        contextAfter: lines.slice(i + 1, afterEnd + 1),
      });
    }
  }

  return results;
}

// ──────────────────────────────────────────────────────────────────
// Document overview / structure detection
// ──────────────────────────────────────────────────────────────────

/**
 * Detect the format of a document.
 */
export function detectDocumentFormat(content: string): 'json' | 'markdown' | 'code' | 'text' {
  const trimmed = content.trim();

  // JSON detection
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Not valid JSON
    }
  }

  // Markdown detection (headers, links, code blocks)
  const markdownSignals = [
    /^#{1,6}\s/m,         // Headers
    /^\s*[-*]\s/m,        // Lists
    /^\s*\d+\.\s/m,       // Ordered lists
    /```/,                // Code blocks
    /\[.+\]\(.+\)/,      // Links
  ];
  const markdownScore = markdownSignals.filter(r => r.test(content)).length;
  if (markdownScore >= 2) return 'markdown';

  // Code detection (common patterns)
  const codeSignals = [
    /^(import|export|const|let|var|function|class|def|fn|pub|use)\s/m,
    /[{};]\s*$/m,
    /^\s*(if|for|while|return|switch)\s*[({]/m,
    /=>/,
    /:\s*(string|number|boolean|int|float|void|any)\b/,
  ];
  const codeScore = codeSignals.filter(r => r.test(content)).length;
  if (codeScore >= 2) return 'code';

  return 'text';
}

/**
 * Generate a structural overview of a document.
 */
export function generateOverview(content: string): DocumentOverview {
  const format = detectDocumentFormat(content);
  const lines = content.split('\n');
  const lineCount = lines.length;
  const tokenCount = calculateTokens(content);

  const overview: DocumentOverview = {
    format,
    lineCount,
    tokenCount,
    sections: [],
  };

  switch (format) {
    case 'json':
      overview.sections = parseJsonSections(content, lines);
      overview.keys = extractJsonKeys(content);
      break;
    case 'markdown':
      overview.sections = parseMarkdownSections(lines);
      overview.toc = extractMarkdownToc(lines);
      break;
    case 'code':
      overview.sections = parseCodeSections(lines);
      break;
    default:
      overview.sections = parseTextSections(lines);
      break;
  }

  return overview;
}

// ──────────────────────────────────────────────────────────────────
// JSON structure parsing
// ──────────────────────────────────────────────────────────────────

function extractJsonKeys(content: string): Array<{ key: string; type: string; preview: string }> {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) return [];

    if (Array.isArray(parsed)) {
      return [{
        key: '(array)',
        type: `array[${parsed.length}]`,
        preview: parsed.length > 0 ? truncate(JSON.stringify(parsed[0]), 80) : '[]',
      }];
    }

    return Object.entries(parsed).map(([key, value]) => ({
      key,
      type: getJsonType(value),
      preview: truncate(JSON.stringify(value), 80),
    }));
  } catch {
    return [];
  }
}

function getJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value === 'object') return `object{${Object.keys(value as Record<string, unknown>).length}}`;
  return typeof value;
}

function parseJsonSections(content: string, lines: string[]): Section[] {
  const sections: Section[] = [];
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) return sections;

    if (Array.isArray(parsed)) {
      // For arrays, each element is a section
      sections.push({
        title: `array[${parsed.length}]`,
        depth: 0,
        startLine: 1,
        endLine: lines.length,
        tokenCount: calculateTokens(content),
        type: 'json-key',
      });
    } else {
      // For objects, top-level keys are sections
      // Find key positions in the formatted/original content
      const keys = Object.keys(parsed);
      for (const key of keys) {
        const keyPattern = new RegExp(`"${escapeRegex(key)}"\\s*:`);
        const lineIdx = lines.findIndex(l => keyPattern.test(l));
        if (lineIdx >= 0) {
          // Find end of this key's value (simplified: next key at same depth or end)
          const nextKeyIdx = keys.indexOf(key) < keys.length - 1
            ? lines.findIndex((l, i) => i > lineIdx && keyPattern.test(l) === false && /^\s*"[^"]+"\s*:/.test(l))
            : lines.length;
          const endLine = nextKeyIdx > lineIdx ? nextKeyIdx : lines.length;
          const sectionContent = lines.slice(lineIdx, endLine).join('\n');

          sections.push({
            title: key,
            depth: 0,
            startLine: lineIdx + 1,
            endLine,
            tokenCount: calculateTokens(sectionContent),
            type: 'json-key',
          });
        }
      }
    }
  } catch {
    // Not valid JSON, return empty
  }
  return sections;
}

// ──────────────────────────────────────────────────────────────────
// Markdown structure parsing
// ──────────────────────────────────────────────────────────────────

function parseMarkdownSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  let currentSection: Partial<Section> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const headerMatch = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (headerMatch) {
      // Close previous section
      if (currentSection && currentSection.startLine !== undefined) {
        const sectionLines = lines.slice(currentSection.startLine! - 1, i);
        currentSection.endLine = i; // previous line
        currentSection.tokenCount = calculateTokens(sectionLines.join('\n'));
        sections.push(currentSection as Section);
      }

      currentSection = {
        title: headerMatch[2].trim(),
        depth: headerMatch[1].length - 1, // h1=0, h2=1, etc.
        startLine: i + 1,
        type: 'heading',
      };
    }
  }

  // Close last section
  if (currentSection && currentSection.startLine !== undefined) {
    const sectionLines = lines.slice(currentSection.startLine! - 1);
    currentSection.endLine = lines.length;
    currentSection.tokenCount = calculateTokens(sectionLines.join('\n'));
    sections.push(currentSection as Section);
  }

  return sections;
}

function extractMarkdownToc(lines: string[]): Array<{ title: string; depth: number; line: number }> {
  const toc: Array<{ title: string; depth: number; line: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (match) {
      toc.push({
        title: match[2].trim(),
        depth: match[1].length,
        line: i + 1,
      });
    }
  }
  return toc;
}

// ──────────────────────────────────────────────────────────────────
// Code structure parsing
// ──────────────────────────────────────────────────────────────────

function parseCodeSections(lines: string[]): Section[] {
  const sections: Section[] = [];

  // Detect functions, classes, exports
  const patterns = [
    { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, type: 'function' as const },
    { regex: /^(?:export\s+)?class\s+(\w+)/, type: 'class' as const },
    { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/, type: 'function' as const },
    { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/, type: 'function' as const },
    { regex: /^def\s+(\w+)\s*\(/, type: 'function' as const },        // Python
    { regex: /^(?:pub\s+)?fn\s+(\w+)/, type: 'function' as const },   // Rust
    { regex: /^func\s+(\w+)/, type: 'function' as const },             // Go
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { regex, type } of patterns) {
      const match = lines[i].match(regex);
      if (match) {
        // Find the end of this block (simplified: next function/class or end of file)
        let endLine = lines.length;
        for (let j = i + 1; j < lines.length; j++) {
          if (patterns.some(p => p.regex.test(lines[j]))) {
            endLine = j;
            break;
          }
        }

        const sectionContent = lines.slice(i, endLine).join('\n');
        sections.push({
          title: match[1],
          depth: 0,
          startLine: i + 1,
          endLine,
          tokenCount: calculateTokens(sectionContent),
          type,
        });
        break;
      }
    }
  }

  return sections;
}

// ──────────────────────────────────────────────────────────────────
// Plain text section parsing (paragraph-based)
// ──────────────────────────────────────────────────────────────────

function parseTextSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  let currentStart = 0;
  let paragraphNum = 0;

  for (let i = 0; i <= lines.length; i++) {
    // Paragraph boundary: empty line or end of file
    const isBlank = i === lines.length || lines[i].trim() === '';
    if (isBlank && i > currentStart) {
      paragraphNum++;
      const sectionContent = lines.slice(currentStart, i).join('\n');
      sections.push({
        title: `Paragraph ${paragraphNum}`,
        depth: 0,
        startLine: currentStart + 1,
        endLine: i,
        tokenCount: calculateTokens(sectionContent),
        type: 'heading', // closest type
      });
    }
    if (isBlank) {
      currentStart = i + 1;
    }
  }

  return sections;
}

// ──────────────────────────────────────────────────────────────────
// JSONPath-style queries
// ──────────────────────────────────────────────────────────────────

/**
 * Query JSON content using a simplified JSONPath syntax.
 * Supports: $.key, $.key.nested, $.array[0], $.array[*].field
 * @param content - JSON string
 * @param path - JSONPath expression (e.g., "$.users[0].name")
 */
export function queryJsonPath(content: string, path: string): {
  result: unknown;
  tokenCount: number;
  path: string;
} {
  try {
    const parsed = JSON.parse(content);
    const result = resolvePath(parsed, path);
    const resultStr = JSON.stringify(result, null, 2);
    return {
      result,
      tokenCount: calculateTokens(resultStr),
      path,
    };
  } catch (err) {
    throw new Error(`JSONPath query failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function resolvePath(obj: unknown, path: string): unknown {
  // Remove leading $. or $
  let segments = path.replace(/^\$\.?/, '');
  if (!segments) return obj;

  // Parse path into segments
  const parts = parsePathSegments(segments);

  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) {
      throw new Error(`Cannot access '${part}' on null/undefined`);
    }

    if (part === '*') {
      // Wildcard: return all elements of array or all values of object
      if (Array.isArray(current)) {
        return current;
      } else if (typeof current === 'object') {
        return Object.values(current as Record<string, unknown>);
      }
      throw new Error('Wildcard (*) can only be used on arrays or objects');
    }

    // Array index
    const indexMatch = part.match(/^(\d+)$/);
    if (indexMatch && Array.isArray(current)) {
      const idx = parseInt(indexMatch[1], 10);
      if (idx >= (current as unknown[]).length) {
        throw new Error(`Array index ${idx} out of bounds (length: ${(current as unknown[]).length})`);
      }
      current = (current as unknown[])[idx];
      continue;
    }

    // Object key
    if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
      const record = current as Record<string, unknown>;
      if (!(part in record)) {
        throw new Error(`Key '${part}' not found. Available keys: ${Object.keys(record).join(', ')}`);
      }
      current = record[part];
      continue;
    }

    throw new Error(`Cannot access '${part}' on ${typeof current}`);
  }

  return current;
}

function parsePathSegments(path: string): string[] {
  const segments: string[] = [];
  let current = '';

  for (let i = 0; i < path.length; i++) {
    const char = path[i];
    if (char === '.') {
      if (current) segments.push(current);
      current = '';
    } else if (char === '[') {
      if (current) segments.push(current);
      current = '';
      // Read until ]
      i++;
      while (i < path.length && path[i] !== ']') {
        current += path[i];
        i++;
      }
      segments.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  if (current) segments.push(current);
  return segments;
}

// ──────────────────────────────────────────────────────────────────
// Section extraction by name
// ──────────────────────────────────────────────────────────────────

/**
 * Get a specific section by name from the document.
 * @param content - Full document content
 * @param sectionName - Name of the section to extract
 */
export function getSection(content: string, sectionName: string, depthAll: boolean = false): {
  section: Section;
  content: string;
  tokenCount: number;
  totalTokens: number;
  tokensSaved: number;
} | null {
  const overview = generateOverview(content);
  const lowerName = sectionName.toLowerCase();

  let sectionIndex = overview.sections.findIndex(
    s => s.title.toLowerCase() === lowerName
  );

  if (sectionIndex === -1) {
    sectionIndex = overview.sections.findIndex(
      s => s.title.toLowerCase().includes(lowerName)
    );
  }

  if (sectionIndex === -1) {
    const cleanLowerName = lowerName.replace(/[^a-z0-9]/g, '');
    if (cleanLowerName.length > 0) {
      sectionIndex = overview.sections.findIndex(
        s => s.title.toLowerCase().replace(/[^a-z0-9]/g, '').includes(cleanLowerName)
      );
    }
  }

  if (sectionIndex === -1) return null;

  const section = overview.sections[sectionIndex];
  let endLine = section.endLine;

  if (depthAll) {
    // Find the end line by including all child sections
    // A child section is any subsequent section with depth > section.depth
    for (let i = sectionIndex + 1; i < overview.sections.length; i++) {
      const nextSection = overview.sections[i];
      if (nextSection.depth <= section.depth) {
        break; // Found a sibling or higher-level section, stop
      }
      endLine = nextSection.endLine;
    }
  }

  const lines = content.split('\n');
  const sectionContent = lines.slice(section.startLine - 1, endLine).join('\n');
  const sectionTokens = calculateTokens(sectionContent);

  return {
    section,
    content: sectionContent,
    tokenCount: sectionTokens,
    totalTokens: overview.tokenCount,
    tokensSaved: overview.tokenCount - sectionTokens,
  };
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
