/**
 * In-memory presence registry for the T149 awareness feature.
 *
 * Tracks which agents are actively editing which sections. Data is
 * ephemeral — no persistence. Entries expire 30 seconds after last heartbeat.
 * The registry is a singleton exported as presenceRegistry.
 *
 * Design: Map<docId, Map<agentId, PresenceEntry>> where PresenceEntry holds
 * section, optional cursorOffset, and lastSeen (ms since epoch).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface PresenceEntry {
  section: string;
  cursorOffset?: number;
  lastSeen: number;
}

export interface PresenceRecord {
  agentId: string;
  section: string;
  cursorOffset?: number;
  lastSeen: number;
}

// TTL constants
const PRESENCE_TTL_MS = 30_000; // 30 seconds

// ── PresenceRegistry class ────────────────────────────────────────────────────

export class PresenceRegistry {
  /**
   * Map<docId, Map<agentId, PresenceEntry>>
   */
  private readonly registry = new Map<string, Map<string, PresenceEntry>>();

  /**
   * Upsert (insert or update) a presence entry. Sets lastSeen = Date.now().
   *
   * @param agentId     The agent identifier.
   * @param docId       The document identifier (slug).
   * @param section     The section identifier the agent is editing.
   * @param cursorOffset Optional cursor offset within the section.
   */
  upsert(agentId: string, docId: string, section: string, cursorOffset?: number): void {
    let docMap = this.registry.get(docId);
    if (!docMap) {
      docMap = new Map<string, PresenceEntry>();
      this.registry.set(docId, docMap);
    }
    const entry: PresenceEntry = { section, lastSeen: Date.now() };
    if (cursorOffset !== undefined) entry.cursorOffset = cursorOffset;
    docMap.set(agentId, entry);
  }

  /**
   * Remove entries older than TTL_MS from the registry.
   * Accepts an optional `now` timestamp for testing with fake timers.
   *
   * @param now  Current time in ms (defaults to Date.now()).
   */
  expire(now: number = Date.now()): void {
    for (const [docId, docMap] of this.registry) {
      for (const [agentId, entry] of docMap) {
        if (now - entry.lastSeen > PRESENCE_TTL_MS) {
          docMap.delete(agentId);
        }
      }
      if (docMap.size === 0) {
        this.registry.delete(docId);
      }
    }
  }

  /**
   * Get all active presence records for a document, sorted by lastSeen descending.
   *
   * @param docId  The document identifier (slug).
   * @returns Array of PresenceRecord (agentId + section + optional cursorOffset + lastSeen).
   */
  getByDoc(docId: string): PresenceRecord[] {
    const docMap = this.registry.get(docId);
    if (!docMap) return [];

    const records: PresenceRecord[] = [];
    for (const [agentId, entry] of docMap) {
      const record: PresenceRecord = {
        agentId,
        section: entry.section,
        lastSeen: entry.lastSeen,
      };
      if (entry.cursorOffset !== undefined) record.cursorOffset = entry.cursorOffset;
      records.push(record);
    }

    // Sort by lastSeen descending (most recent first)
    records.sort((a, b) => b.lastSeen - a.lastSeen);
    return records;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const presenceRegistry = new PresenceRegistry();
