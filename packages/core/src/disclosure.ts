/**
 * Progressive disclosure: structural analysis, section extraction,
 * line-range access, content search, and JSONPath queries.
 *
 * Allows consumers to access only the portions of a document they need,
 * dramatically reducing token costs for LLM agent workflows.
 */
import { calculateTokens } from './compression.js';

// ── Types ───────────────────────────────────────────────────────

export interface Section {
  title: string;
  depth: number;
  startLine: number;
  endLine: number;
  tokenCount: number;
  type: 'heading' | 'json-key' | 'code-block' | 'function' | 'class';
}

export interface DocumentOverview {
  format: 'json' | 'markdown' | 'code' | 'text';
  lineCount: number;
  tokenCount: number;
  sections: Section[];
  keys?: Array<{ key: string; type: string; preview: string }>;
  toc?: Array<{ title: string; depth: number; line: number }>;
}

export interface SearchResult {
  line: number;
  content: string;
  contextBefore: string[];
  contextAfter: string[];
}

export interface LineRangeResult {
  startLine: number;
  endLine: number;
  content: string;
  tokenCount: number;
  totalLines: number;
  totalTokens: number;
  tokensSaved: number;
}

// ── Line Range Access ───────────────────────────────────────────

export function getLineRange(content: string, start: number, end: number): LineRangeResult {
  const lines = content.split('\n');
  const totalLines = lines.length;
  const totalTokens = calculateTokens(content);

  const s = Math.max(1, Math.min(start, totalLines));
  const e = Math.max(s, Math.min(end, totalLines));

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

// ── Content Search ──────────────────────────────────────────────

export function searchContent(
  content: string,
  query: string,
  contextLines = 2,
  maxResults = 20,
): SearchResult[] {
  const lines = content.split('\n');
  const results: SearchResult[] = [];

  let matcher: (line: string) => boolean;
  if (query.startsWith('/') && query.lastIndexOf('/') > 0) {
    const lastSlash = query.lastIndexOf('/');
    const pattern = query.slice(1, lastSlash);
    const flags = query.slice(lastSlash + 1) || 'i';
    try {
      const regex = new RegExp(pattern, flags);
      matcher = (line) => regex.test(line);
    } catch {
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
        line: i + 1,
        content: lines[i],
        contextBefore: lines.slice(beforeStart, i),
        contextAfter: lines.slice(i + 1, afterEnd + 1),
      });
    }
  }

  return results;
}

// ── Format Detection ────────────────────────────────────────────

export function detectDocumentFormat(content: string): 'json' | 'markdown' | 'code' | 'text' {
  const trimmed = content.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch { /* not JSON */ }
  }

  const markdownSignals = [
    /^#{1,6}\s/m,
    /^\s*[-*]\s/m,
    /^\s*\d+\.\s/m,
    /```/,
    /\[.+\]\(.+\)/,
  ];
  if (markdownSignals.filter(r => r.test(content)).length >= 2) return 'markdown';

  const codeSignals = [
    /^(import|export|const|let|var|function|class|def|fn|pub|use)\s/m,
    /[{};]\s*$/m,
    /^\s*(if|for|while|return|switch)\s*[({]/m,
    /=>/,
    /:\s*(string|number|boolean|int|float|void|any)\b/,
  ];
  if (codeSignals.filter(r => r.test(content)).length >= 2) return 'code';

  return 'text';
}

// ── Document Overview ───────────────────────────────────────────

export function generateOverview(content: string): DocumentOverview {
  const format = detectDocumentFormat(content);
  const lines = content.split('\n');
  const lineCount = lines.length;
  const tokenCount = calculateTokens(content);

  const overview: DocumentOverview = { format, lineCount, tokenCount, sections: [] };

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

// ── JSONPath Queries ────────────────────────────────────────────

export function queryJsonPath(content: string, path: string): {
  result: unknown;
  tokenCount: number;
  path: string;
} {
  try {
    const parsed = JSON.parse(content);
    const result = resolvePath(parsed, path);
    const resultStr = JSON.stringify(result, null, 2);
    return { result, tokenCount: calculateTokens(resultStr), path };
  } catch (err) {
    throw new Error(`JSONPath query failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Section Extraction ──────────────────────────────────────────

export function getSection(content: string, sectionName: string, depthAll = false): {
  section: Section;
  content: string;
  tokenCount: number;
  totalTokens: number;
  tokensSaved: number;
} | null {
  const overview = generateOverview(content);
  const lowerName = sectionName.toLowerCase();

  let sectionIndex = overview.sections.findIndex(
    s => s.title.toLowerCase() === lowerName,
  );
  if (sectionIndex === -1) {
    sectionIndex = overview.sections.findIndex(
      s => s.title.toLowerCase().includes(lowerName),
    );
  }
  if (sectionIndex === -1) {
    const clean = lowerName.replace(/[^a-z0-9]/g, '');
    if (clean.length > 0) {
      sectionIndex = overview.sections.findIndex(
        s => s.title.toLowerCase().replace(/[^a-z0-9]/g, '').includes(clean),
      );
    }
  }
  if (sectionIndex === -1) return null;

  const section = overview.sections[sectionIndex];
  let endLine = section.endLine;

  if (depthAll) {
    for (let i = sectionIndex + 1; i < overview.sections.length; i++) {
      if (overview.sections[i].depth <= section.depth) break;
      endLine = overview.sections[i].endLine;
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

// ── Internal Parsers ────────────────────────────────────────────

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
      sections.push({
        title: `array[${parsed.length}]`,
        depth: 0,
        startLine: 1,
        endLine: lines.length,
        tokenCount: calculateTokens(content),
        type: 'json-key',
      });
    } else {
      const keys = Object.keys(parsed);
      for (const key of keys) {
        const keyPattern = new RegExp(`"${escapeRegex(key)}"\\s*:`);
        const lineIdx = lines.findIndex(l => keyPattern.test(l));
        if (lineIdx >= 0) {
          const nextKeyIdx = keys.indexOf(key) < keys.length - 1
            ? lines.findIndex((l, i) => i > lineIdx && !keyPattern.test(l) && /^\s*"[^"]+"\s*:/.test(l))
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
  } catch { /* not valid JSON */ }
  return sections;
}

function parseMarkdownSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  let currentSection: Partial<Section> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const headerMatch = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (headerMatch) {
      if (currentSection && currentSection.startLine !== undefined) {
        const sectionLines = lines.slice(currentSection.startLine! - 1, i);
        currentSection.endLine = i;
        currentSection.tokenCount = calculateTokens(sectionLines.join('\n'));
        sections.push(currentSection as Section);
      }
      currentSection = {
        title: headerMatch[2].trim(),
        depth: headerMatch[1].length - 1,
        startLine: i + 1,
        type: 'heading',
      };
    }
  }

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
      toc.push({ title: match[2].trim(), depth: match[1].length, line: i + 1 });
    }
  }
  return toc;
}

function parseCodeSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  const patterns = [
    { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, type: 'function' as const },
    { regex: /^(?:export\s+)?class\s+(\w+)/, type: 'class' as const },
    { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/, type: 'function' as const },
    { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/, type: 'function' as const },
    { regex: /^def\s+(\w+)\s*\(/, type: 'function' as const },
    { regex: /^(?:pub\s+)?fn\s+(\w+)/, type: 'function' as const },
    { regex: /^func\s+(\w+)/, type: 'function' as const },
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { regex, type } of patterns) {
      const match = lines[i].match(regex);
      if (match) {
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

function parseTextSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  let currentStart = 0;
  let paragraphNum = 0;

  for (let i = 0; i <= lines.length; i++) {
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
        type: 'heading',
      });
    }
    if (isBlank) currentStart = i + 1;
  }

  return sections;
}

// ── JSONPath Resolution ─────────────────────────────────────────

function resolvePath(obj: unknown, path: string): unknown {
  const segments = path.replace(/^\$\.?/, '');
  if (!segments) return obj;

  const parts = parsePathSegments(segments);
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      throw new Error(`Cannot access '${part}' on null/undefined`);
    }

    if (part === '*') {
      if (Array.isArray(current)) return current;
      if (typeof current === 'object') return Object.values(current as Record<string, unknown>);
      throw new Error('Wildcard (*) can only be used on arrays or objects');
    }

    if (/^\d+$/.test(part) && Array.isArray(current)) {
      const idx = parseInt(part, 10);
      if (idx >= current.length) {
        throw new Error(`Array index ${idx} out of bounds (length: ${current.length})`);
      }
      current = current[idx];
      continue;
    }

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

// ── Utilities ───────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
