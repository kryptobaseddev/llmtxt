/**
 * Attribution tracking for collaborative documents.
 *
 * Tracks who contributed what, when, and with what token impact.
 * All functions are pure -- they take version data and return summaries.
 */
import { computeDiff } from '../compression.js';
import { generateOverview } from '../disclosure.js';
import type { VersionEntry } from './versions.js';

// ── Types ──────────────────────────────────────────────────────

/** Attribution data for a single version. */
export interface VersionAttribution {
  /** Version number this attribution describes. */
  versionNumber: number;
  /** Agent that authored the change. */
  authorId: string;
  /** Lines added in this version. */
  addedLines: number;
  /** Lines removed in this version. */
  removedLines: number;
  /** Tokens added in this version. */
  addedTokens: number;
  /** Tokens removed in this version. */
  removedTokens: number;
  /** Section titles that were modified (detected via structural analysis). */
  sectionsModified: string[];
  /** One-line change description. */
  changelog: string;
  /** Timestamp of the change. */
  createdAt: number;
}

/** Aggregated contribution summary for a single agent. */
export interface ContributorSummary {
  /** Agent identifier. */
  agentId: string;
  /** Number of versions this agent authored. */
  versionsAuthored: number;
  /** Total tokens added across all versions. */
  totalTokensAdded: number;
  /** Total tokens removed across all versions. */
  totalTokensRemoved: number;
  /** Net token impact (added - removed). */
  netTokens: number;
  /** Timestamp of first contribution. */
  firstContribution: number;
  /** Timestamp of most recent contribution. */
  lastContribution: number;
  /** Unique section titles this agent modified. */
  sectionsModified: string[];
}

// ── Attribution ────────────────────────────────────────────────

/**
 * Compute attribution data for a single version change.
 *
 * @param contentBefore - Document content before the change.
 * @param contentAfter - Document content after the change.
 * @param authorId - Agent that made the change.
 * @param entry - The version entry metadata.
 * @returns Attribution data for this version.
 */
export function attributeVersion(
  contentBefore: string,
  contentAfter: string,
  authorId: string,
  entry: Pick<VersionEntry, 'versionNumber' | 'changelog' | 'createdAt'>,
): VersionAttribution {
  const diff = computeDiff(contentBefore, contentAfter);

  // Detect which sections changed by comparing overviews
  const overviewBefore = generateOverview(contentBefore);
  const overviewAfter = generateOverview(contentAfter);

  const sectionsBefore = new Set(overviewBefore.sections.map(s => s.title));
  const sectionsAfter = new Set(overviewAfter.sections.map(s => s.title));

  const sectionsModified: string[] = [];

  // New sections
  for (const title of sectionsAfter) {
    if (!sectionsBefore.has(title)) sectionsModified.push(title);
  }

  // Removed sections
  for (const title of sectionsBefore) {
    if (!sectionsAfter.has(title)) sectionsModified.push(title);
  }

  // Modified sections (same title but different token count)
  for (const sAfter of overviewAfter.sections) {
    if (sectionsBefore.has(sAfter.title)) {
      const sBefore = overviewBefore.sections.find(s => s.title === sAfter.title);
      if (sBefore && sBefore.tokenCount !== sAfter.tokenCount) {
        sectionsModified.push(sAfter.title);
      }
    }
  }

  return {
    versionNumber: entry.versionNumber,
    authorId,
    addedLines: diff.addedLines,
    removedLines: diff.removedLines,
    addedTokens: diff.addedTokens,
    removedTokens: diff.removedTokens,
    sectionsModified: [...new Set(sectionsModified)],
    changelog: entry.changelog,
    createdAt: entry.createdAt,
  };
}

// ── Aggregation ────────────────────────────────────────────────

/**
 * Build aggregated contributor summaries from version attributions.
 *
 * @param attributions - Array of per-version attribution data.
 * @returns Contributor summaries sorted by total versions authored (descending).
 */
export function buildContributorSummary(
  attributions: VersionAttribution[],
): ContributorSummary[] {
  const map = new Map<string, ContributorSummary>();

  for (const attr of attributions) {
    const existing = map.get(attr.authorId);
    if (existing) {
      existing.versionsAuthored++;
      existing.totalTokensAdded += attr.addedTokens;
      existing.totalTokensRemoved += attr.removedTokens;
      existing.netTokens = existing.totalTokensAdded - existing.totalTokensRemoved;
      if (attr.createdAt < existing.firstContribution) existing.firstContribution = attr.createdAt;
      if (attr.createdAt > existing.lastContribution) existing.lastContribution = attr.createdAt;
      for (const section of attr.sectionsModified) {
        if (!existing.sectionsModified.includes(section)) {
          existing.sectionsModified.push(section);
        }
      }
    } else {
      map.set(attr.authorId, {
        agentId: attr.authorId,
        versionsAuthored: 1,
        totalTokensAdded: attr.addedTokens,
        totalTokensRemoved: attr.removedTokens,
        netTokens: attr.addedTokens - attr.removedTokens,
        firstContribution: attr.createdAt,
        lastContribution: attr.createdAt,
        sectionsModified: [...attr.sectionsModified],
      });
    }
  }

  return [...map.values()].sort((a, b) => b.versionsAuthored - a.versionsAuthored);
}
