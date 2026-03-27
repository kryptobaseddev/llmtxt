/**
 * Token-budget-aware retrieval planning.
 *
 * Given a document overview and a token budget, determines the optimal
 * set of sections to fetch. Uses similarity ranking when a query is
 * provided, greedy packing otherwise.
 */
import type { DocumentOverview, Section } from '../disclosure.js';
import { textSimilarity } from '../similarity.js';

// -- Types --

/** A section selected for retrieval. */
export interface PlannedSection {
  /** Index into the overview's sections array. */
  sectionIndex: number;
  /** Section title. */
  title: string;
  /** Estimated token cost for this section. */
  tokenCount: number;
  /** Why this section was selected. */
  reason: 'query-match' | 'structural' | 'budget-fit';
  /** Relevance score (0-1) when selected by query match. */
  score?: number;
}

/** The output of retrieval planning. */
export interface RetrievalPlan {
  /** Sections selected for retrieval, ordered by relevance. */
  sections: PlannedSection[];
  /** Total tokens across all selected sections. */
  totalTokens: number;
  /** Remaining token budget after selection. */
  budgetRemaining: number;
  /** Tokens saved compared to fetching the full document. */
  tokensSaved: number;
  /** Whether the full document fits within budget (no planning needed). */
  fullDocumentFits: boolean;
}

/** Options for retrieval planning. */
export interface RetrievalOptions {
  /** Minimum similarity score to include a section (0-1). Default: 0.1 */
  minScore?: number;
  /** Always include the first section (typically title/intro). Default: true */
  includeIntro?: boolean;
}

// -- Planning --

/**
 * Plan which sections to retrieve given a token budget.
 *
 * When a query is provided, sections are ranked by text similarity to the
 * query and packed greedily by descending score. Without a query, sections
 * are packed in document order.
 *
 * @param overview - Structural overview from generateOverview().
 * @param tokenBudget - Maximum tokens to use.
 * @param query - Optional search query to rank sections by relevance.
 * @param options - Planning options.
 * @returns A retrieval plan with selected sections and budget accounting.
 */
export function planRetrieval(
  overview: DocumentOverview,
  tokenBudget: number,
  query?: string,
  options: RetrievalOptions = {},
): RetrievalPlan {
  const { minScore = 0.1, includeIntro = true } = options;

  // If the full document fits, no planning needed
  if (overview.tokenCount <= tokenBudget) {
    return {
      sections: overview.sections.map((s, i) => ({
        sectionIndex: i,
        title: s.title,
        tokenCount: s.tokenCount,
        reason: 'budget-fit' as const,
      })),
      totalTokens: overview.tokenCount,
      budgetRemaining: tokenBudget - overview.tokenCount,
      tokensSaved: 0,
      fullDocumentFits: true,
    };
  }

  // Score sections
  const scored: Array<{ section: Section; index: number; score: number }> = overview.sections.map(
    (section, index) => ({
      section,
      index,
      score: query ? textSimilarity(query, section.title) : 0,
    }),
  );

  // Sort by score descending (query-based) or keep document order (no query)
  if (query) {
    scored.sort((a, b) => b.score - a.score);
  }

  const selected: PlannedSection[] = [];
  let remaining = tokenBudget;
  const usedIndices = new Set<number>();

  // Always include intro if requested and it fits
  if (includeIntro && overview.sections.length > 0) {
    const intro = overview.sections[0];
    if (intro.tokenCount <= remaining) {
      selected.push({
        sectionIndex: 0,
        title: intro.title,
        tokenCount: intro.tokenCount,
        reason: 'structural',
      });
      remaining -= intro.tokenCount;
      usedIndices.add(0);
    }
  }

  // Pack remaining sections
  for (const { section, index, score } of scored) {
    if (usedIndices.has(index)) continue;
    if (section.tokenCount > remaining) continue;
    if (query && score < minScore) continue;

    selected.push({
      sectionIndex: index,
      title: section.title,
      tokenCount: section.tokenCount,
      reason: query ? 'query-match' : 'budget-fit',
      score: query ? score : undefined,
    });
    remaining -= section.tokenCount;
    usedIndices.add(index);
  }

  // Sort final selection by document order for coherent reading
  selected.sort((a, b) => a.sectionIndex - b.sectionIndex);

  const totalTokens = tokenBudget - remaining;

  return {
    sections: selected,
    totalTokens,
    budgetRemaining: remaining,
    tokensSaved: overview.tokenCount - totalTokens,
    fullDocumentFits: false,
  };
}

/**
 * Estimate the token cost of fetching specific sections.
 *
 * @param overview - Document overview.
 * @param sectionIndices - Indices of sections to fetch.
 * @returns Total token count for the requested sections.
 */
export function estimateRetrievalCost(
  overview: DocumentOverview,
  sectionIndices: number[],
): number {
  return sectionIndices.reduce((sum, i) => {
    const section = overview.sections[i];
    return sum + (section ? section.tokenCount : 0);
  }, 0);
}
