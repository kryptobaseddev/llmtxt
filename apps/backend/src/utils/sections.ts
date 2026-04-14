/**
 * Section parser: split markdown/text content into heading-delimited sections.
 *
 * Used by semantic routes to produce the per-section units that get embedded
 * and compared. The parser is intentionally simple — it splits on ATX headings
 * (`#` through `######`) and treats everything before the first heading as an
 * implicit "Introduction" section.
 */

export interface Section {
  /** Heading text (without the `#` prefix characters). */
  title: string;
  /** Full section content including the heading line. */
  content: string;
  /** ATX heading level: 1 for `#`, 2 for `##`, … 6 for `######`. */
  level: number;
  /** 1-based index of the first line of this section. */
  startLine: number;
  /** 1-based index of the last line of this section (inclusive). */
  endLine: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/**
 * Parse `content` into an ordered array of sections.
 *
 * - Content before the first heading becomes a section with title
 *   `"Introduction"` and level `0`.
 * - Empty preamble sections (no non-blank lines) are omitted.
 * - Trailing whitespace is stripped from each section's content.
 */
export function parseSections(content: string): Section[] {
  const lines = content.split('\n');
  const sections: Section[] = [];

  let currentTitle = 'Introduction';
  let currentLevel = 0;
  let currentStart = 1; // 1-based
  let currentLines: string[] = [];

  const flush = (endLine: number) => {
    const sectionContent = currentLines.join('\n').trimEnd();
    // Skip empty preamble (no content at all, or only blank lines).
    if (sectionContent.length === 0 && currentTitle === 'Introduction') return;
    sections.push({
      title: currentTitle,
      content: sectionContent,
      level: currentLevel,
      startLine: currentStart,
      endLine,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1; // 1-based

    const match = HEADING_RE.exec(line);
    if (match) {
      // Flush the previous section (ends on the line before this heading).
      flush(lineNumber - 1 > 0 ? lineNumber - 1 : lineNumber);

      // Start new section.
      currentTitle = match[2].trim();
      currentLevel = match[1].length;
      currentStart = lineNumber;
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  // Flush the final section.
  flush(lines.length);

  return sections;
}
