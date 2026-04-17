/**
 * server-peer-adapter.ts — P3.11: Server-as-Peer (PostgresChangesetAdapter)
 *
 * Makes api.llmtxt.my join the P2P mesh as an optional peer by translating
 * between the cr-sqlite binary changeset wire format used by LocalBackend agents
 * and the Postgres row operations of PostgresBackend.
 *
 * ## Architecture
 *
 * ```
 * LocalBackend agent ──[cr-sqlite changeset]──▶ PostgresChangesetAdapter
 *                                                        │
 *                                              deserialize + apply
 *                                                        │
 *                                                        ▼
 *                                              PostgresBackend (Postgres rows)
 *
 * PostgresBackend ──[row query]──▶ PostgresChangesetAdapter
 *                                          │
 *                                 serialize to changeset format
 *                                          │
 *                                          ▼
 *                             LocalBackend agent [applyChanges()]
 * ```
 *
 * ## Decision Record: DR-P3-06
 *
 * Server-as-peer is an optional bolt-on in Phase 3. It MUST NOT be required
 * for local-only mesh operation. Per DR-P3-06, this is explicitly lower
 * priority than the local-first sync engine. The adapter is a Phase 3
 * deliverable but ships as a well-documented stub with clear TODO markers
 * for the full implementation.
 *
 * ## Implementation Status
 *
 * Current: STUB — method signatures, types, and documentation are complete.
 * The serialization / deserialization logic is stubbed with TODO markers.
 *
 * Full implementation requires:
 *   1. A shared schema for the cr-sqlite changeset binary format
 *      (defined in LocalBackend.getChangesSince / applyChanges — P2.6/P2.7).
 *   2. A Postgres LISTEN/NOTIFY or CDC (change-data-capture) mechanism to
 *      capture row-level changes since a given Postgres LSN (log sequence number).
 *   3. A bidirectional row-to-changeset translation for all LLMtxt tables
 *      (documents, versions, events, approvals, etc.).
 *
 * Activation trigger (per memory-bridge.md D004 / YAGNI):
 *   Implement when production benchmark evidence shows the server-as-peer
 *   pattern is needed on a hot-path. Until then, agents use LocalBackend
 *   with cr-sqlite for full mesh sync.
 *
 * Spec: docs/specs/P3-p2p-mesh.md §9 (Server-as-Peer)
 * Task: T423 (P3.11)
 */

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * A single row-level change captured from Postgres.
 *
 * In a full implementation this would be populated via Postgres LISTEN/NOTIFY
 * on a changes table, or via logical decoding (pg_logical_emit_message).
 */
export interface PostgresRowChange {
  /** Name of the table that changed (e.g., "documents", "versions"). */
  table: string;
  /** Operation type. */
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  /** The row data after the change (null for DELETE). */
  newRow: Record<string, unknown> | null;
  /** The row data before the change (null for INSERT). */
  oldRow: Record<string, unknown> | null;
  /** Postgres transaction ID (xid) — used as a logical "db_version". */
  txid: number;
  /** ISO-8601 timestamp of the change. */
  changedAt: string;
}

/**
 * Wire format for a PostgresChangeset batch.
 *
 * TODO: Align with the binary format produced by LocalBackend.getChangesSince()
 * once the cr-sqlite changeset schema is stabilised in P2.6.
 */
export interface PostgresChangeset {
  /** Postgres transaction IDs included in this batch. */
  txids: number[];
  /** Serialized row changes (JSON for now; binary in full implementation). */
  changes: PostgresRowChange[];
  /** The highest txid in this batch (used as "sinceVersion" by the receiver). */
  maxTxid: number;
}

/**
 * Options for constructing a PostgresChangesetAdapter.
 */
export interface PostgresChangesetAdapterOptions {
  /**
   * Postgres client or connection pool used for querying row changes.
   *
   * TODO: Replace `unknown` with the concrete postgres.js client type once
   * the full implementation is written.
   * ```ts
   * import postgres from 'postgres';
   * const sql = postgres(process.env.DATABASE_URL!);
   * new PostgresChangesetAdapter({ db: sql, ... });
   * ```
   */
  db: unknown;

  /**
   * The last synced Postgres transaction ID (xid) for a given peer.
   * Rows with txid > sinceXid will be included in the next changeset.
   * Defaults to 0 (full snapshot).
   */
  sinceXid?: number;
}

// ── PostgresChangesetAdapter ───────────────────────────────────────────────

/**
 * PostgresChangesetAdapter — bridges PostgresBackend and the cr-sqlite mesh.
 *
 * This adapter translates between:
 *   - cr-sqlite binary changesets (used by LocalBackend for P2P sync), and
 *   - Postgres row operations (used by PostgresBackend for persistence).
 *
 * It is used by the optional POST /mesh/changeset route in apps/backend to
 * allow api.llmtxt.my to participate as a mesh peer.
 *
 * ## Usage (when fully implemented)
 *
 * ```ts
 * import { PostgresChangesetAdapter } from 'llmtxt/mesh/server-peer-adapter';
 * import postgres from 'postgres';
 *
 * const sql = postgres(process.env.DATABASE_URL!);
 * const adapter = new PostgresChangesetAdapter({ db: sql });
 *
 * // Inbound: receive changeset from LocalBackend agent, apply to Postgres.
 * await adapter.applyChangeset(changesetBytes);
 *
 * // Outbound: serialize Postgres rows to changeset format for local agents.
 * const changeset = await adapter.getChangesSince(peerLastSyncXid);
 * ```
 */
export class PostgresChangesetAdapter {
  private readonly options: PostgresChangesetAdapterOptions;

  constructor(options: PostgresChangesetAdapterOptions) {
    this.options = options;
  }

  // ── Inbound (LocalBackend → Postgres) ────────────────────────────────────

  /**
   * Apply a cr-sqlite binary changeset received from a LocalBackend mesh peer.
   *
   * Steps (full implementation):
   *   1. Deserialize the changeset using the cr-sqlite wire format.
   *   2. For each row change, translate to a Postgres INSERT/UPDATE/DELETE.
   *   3. Apply with LWW (Last-Write-Wins) conflict resolution using the
   *      `crdt_state_hash` column for CRDT blob columns.
   *   4. Return the new Postgres LSN/txid as the "applied db_version".
   *
   * @param changesetBytes - cr-sqlite binary changeset from a peer.
   * @returns The Postgres txid after applying the changeset (used as sinceVersion).
   *
   * TODO: Implement cr-sqlite → Postgres row translation.
   *       See LocalBackend.applyChanges() for the cr-sqlite changeset format.
   */
  async applyChangeset(_changesetBytes: Uint8Array): Promise<number> {
    // TODO: Deserialize cr-sqlite binary changeset.
    //   const changes = deserializeCrSqliteChangeset(changesetBytes);
    //
    // TODO: For each change, determine the target table and apply via Postgres:
    //   for (const change of changes) {
    //     await this.applyRowChange(change);
    //   }
    //
    // TODO: Return the new max txid.
    //   const { txid } = await this.db`SELECT txid_current() AS txid`;
    //   return txid;

    throw new Error(
      '[PostgresChangesetAdapter] applyChangeset() not yet implemented. ' +
        'See docs/specs/P3-p2p-mesh.md §9 and DR-P3-06. ' +
        'Full implementation requires cr-sqlite changeset format (P2.6/P2.7) to stabilise.'
    );
  }

  /**
   * Apply a single row change to Postgres.
   *
   * For INSERT/UPDATE: use ON CONFLICT DO UPDATE (upsert) for idempotency.
   * For DELETE: soft-delete via a `deleted_at` timestamp if the schema
   * supports it; hard-delete otherwise.
   *
   * TODO: Implement per-table upsert logic.
   */
  private async _applyRowChange(_change: PostgresRowChange): Promise<void> {
    // TODO: Route to per-table handler:
    //   switch (change.table) {
    //     case 'documents': await this.upsertDocument(change); break;
    //     case 'versions': await this.upsertVersion(change); break;
    //     case 'events': await this.upsertEvent(change); break;
    //     // ... other tables
    //   }
    throw new Error(
      '[PostgresChangesetAdapter] _applyRowChange() not implemented. TODO: per-table upsert.'
    );
  }

  // ── Outbound (Postgres → LocalBackend) ───────────────────────────────────

  /**
   * Serialize Postgres row changes since `sinceXid` into a cr-sqlite-compatible
   * changeset binary for delivery to LocalBackend mesh peers.
   *
   * Steps (full implementation):
   *   1. Query all changed rows with txid > sinceXid from a Postgres audit/CDC table
   *      (or use Postgres logical replication + pg_logical_emit_message).
   *   2. Translate each Postgres row to a cr-sqlite changeset row entry.
   *   3. Serialize to binary cr-sqlite changeset format.
   *   4. Sign the changeset bytes (for SyncEngine signature verification).
   *
   * @param sinceXid - Postgres transaction ID of the last sync point.
   *   Pass 0 for a full snapshot.
   * @returns cr-sqlite binary changeset bytes, ready for SyncEngine.sendChangeset().
   *
   * TODO: Implement Postgres row → cr-sqlite changeset translation.
   *       Requires pg_stat_activity or logical decoding to capture row changes.
   */
  async getChangesSince(_sinceXid: number): Promise<Uint8Array> {
    // TODO: Query Postgres for changes since sinceXid.
    //   const rows = await this.db`
    //     SELECT table_name, op, new_row, old_row, txid, changed_at
    //       FROM llmtxt_cdc_log
    //      WHERE txid > ${sinceXid}
    //      ORDER BY txid, changed_at
    //   `;
    //
    // TODO: Translate Postgres rows to cr-sqlite changeset format.
    //   const changeset = serializeToCrSqlite(rows);
    //
    // TODO: Return the binary changeset.
    //   return changeset;

    throw new Error(
      '[PostgresChangesetAdapter] getChangesSince() not yet implemented. ' +
        'See docs/specs/P3-p2p-mesh.md §9 and DR-P3-06. ' +
        'Requires CDC log table or Postgres logical replication.'
    );
  }

  // ── Health ────────────────────────────────────────────────────────────────

  /**
   * Returns true if the adapter has been configured with a valid Postgres
   * connection and is ready to accept inbound changesets.
   *
   * In the stub implementation, always returns false (adapter not functional).
   * Full implementation should ping the database.
   */
  isReady(): boolean {
    // TODO: Ping database and verify CDC log table exists.
    //   return this.options.db !== null;
    return false;
  }
}

// ── Route Handler Factory ─────────────────────────────────────────────────

/**
 * Options for the POST /mesh/changeset route handler.
 */
export interface MeshChangesetRouteOptions {
  /** PostgresChangesetAdapter instance wired to the PostgresBackend. */
  adapter: PostgresChangesetAdapter;
  /** Maximum changeset size in bytes (default: 10 MB per P3 spec §10). */
  maxChangesetBytes?: number;
}

/**
 * Generic POST /mesh/changeset handler result.
 *
 * The route handler is framework-agnostic: the caller (Hono/Express/etc.)
 * provides the request body and receives a structured result to render.
 */
export interface MeshChangesetResult {
  /** HTTP status code to return. */
  status: number;
  /** Response body as an object (caller serializes to JSON). */
  body: Record<string, unknown>;
  /** Delta changeset bytes to return in the response body (bidirectional sync). */
  delta?: Uint8Array;
}

/**
 * Create a framework-agnostic handler for the POST /mesh/changeset endpoint.
 *
 * Intended usage in apps/backend (Hono):
 *
 * ```ts
 * import { createMeshChangesetHandler } from 'llmtxt/mesh/server-peer-adapter';
 *
 * const handler = createMeshChangesetHandler({ adapter });
 *
 * app.post('/mesh/changeset', async (c) => {
 *   const body = await c.req.arrayBuffer();
 *   const peerSinceXid = Number(c.req.header('X-Peer-Since-Xid') ?? '0');
 *   const result = await handler(new Uint8Array(body), peerSinceXid);
 *   c.status(result.status as StatusCode);
 *   if (result.delta) {
 *     return c.body(result.delta, 200, { 'Content-Type': 'application/octet-stream' });
 *   }
 *   return c.json(result.body, result.status as StatusCode);
 * });
 * ```
 *
 * @param options - Route handler options.
 * @returns An async handler function `(changesetBytes, peerSinceXid) => MeshChangesetResult`.
 *
 * TODO: Wire into apps/backend/src/routes/ once adapter is fully implemented.
 */
export function createMeshChangesetHandler(options: MeshChangesetRouteOptions): (
  changesetBytes: Uint8Array,
  peerSinceXid: number
) => Promise<MeshChangesetResult> {
  const maxBytes = options.maxChangesetBytes ?? 10 * 1024 * 1024;

  return async (changesetBytes: Uint8Array, peerSinceXid: number): Promise<MeshChangesetResult> => {
    // Guard: adapter not yet ready.
    if (!options.adapter.isReady()) {
      return {
        status: 503,
        body: {
          error: 'SERVER_AS_PEER_NOT_READY',
          message:
            'PostgresChangesetAdapter is not yet fully implemented (DR-P3-06 stub). ' +
            'Local-only mesh operation does not require the server as a peer.',
        },
      };
    }

    // Guard: changeset size.
    if (changesetBytes.length > maxBytes) {
      return {
        status: 413,
        body: { error: 'CHANGESET_TOO_LARGE', maxBytes },
      };
    }

    // Apply inbound changeset.
    let newXid: number;
    try {
      newXid = await options.adapter.applyChangeset(changesetBytes);
    } catch (err) {
      console.error('[mesh/changeset] applyChangeset error:', err);
      return {
        status: 500,
        body: { error: 'APPLY_FAILED', message: (err as Error).message },
      };
    }

    // Compute and return delta (changes the server has that the peer doesn't).
    let delta: Uint8Array | undefined;
    try {
      const deltaBytes = await options.adapter.getChangesSince(peerSinceXid);
      if (deltaBytes.length > 0) {
        delta = deltaBytes;
      }
    } catch (err) {
      // Non-fatal: return 200 without delta if outbound serialization fails.
      console.warn('[mesh/changeset] getChangesSince error (non-fatal):', err);
    }

    return {
      status: 200,
      body: { ok: true, appliedXid: newXid },
      delta,
    };
  };
}

// ── Re-exports for convenience ────────────────────────────────────────────

export type {
  PostgresChangesetAdapterOptions as AdapterOptions,
  MeshChangesetRouteOptions as RouteOptions,
  MeshChangesetResult as RouteResult,
};
