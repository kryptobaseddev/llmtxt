/**
 * Topology configuration for LLMtxt agent deployments.
 *
 * Defines three topology modes — standalone, hub-spoke, and mesh — each with
 * its own configuration shape. Provides Zod schemas for runtime validation and
 * a {@link validateTopologyConfig} function that throws {@link TopologyConfigError}
 * with exact messages from ARCH-T429 §3.3.
 *
 * @module topology
 */
import { z } from 'zod';

// ── Error class ─────────────────────────────────────────────────────────────

/**
 * Thrown when a topology config fails validation.
 *
 * @remarks
 * The `code` property is a machine-readable identifier for the failure kind.
 * The `field` property (optional) names the specific config field that is
 * invalid or missing.
 *
 * Error codes:
 * - `MISSING_HUB_URL` — hub-spoke topology missing required `hubUrl`
 * - `MISSING_STORAGE_PATH_PERSIST` — hub-spoke with persistLocally=true missing `storagePath`
 * - `MISSING_STORAGE_PATH_MESH` — mesh topology missing required `storagePath`
 * - `INVALID_TOPOLOGY_MODE` — unknown `topology` value
 */
export class TopologyConfigError extends Error {
  readonly code: string;
  readonly field?: string;

  constructor(message: string, code: string, field?: string) {
    super(message);
    this.name = 'TopologyConfigError';
    this.code = code;
    if (field !== undefined) {
      this.field = field;
    }
    // Restore prototype chain (needed when targeting ES5 and below, harmless otherwise)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── TopologyMode ─────────────────────────────────────────────────────────────

/**
 * The three supported deployment topologies.
 *
 * - `standalone` — one agent, one local .db file, zero network dependency.
 * - `hub-spoke` — N ephemeral or persistent spokes connected to a central hub.
 * - `mesh` — N persistent peers syncing via P2P transport (T386).
 */
export type TopologyMode = 'standalone' | 'hub-spoke' | 'mesh';

// ── Config interfaces ─────────────────────────────────────────────────────────

/**
 * Config for standalone topology.
 *
 * One agent, one local `.db` file, zero network dependency. Use for single
 * developer or single agent, offline-first operation, local testing.
 */
export interface StandaloneConfig {
  topology: 'standalone';
  /** Path for the local .db file. Defaults to '.llmtxt'. */
  storagePath?: string;
  /** Optional path to agent identity keypair. */
  identityPath?: string;
  /** Set true to enable cr-sqlite (T385). Default: false. */
  crsqlite?: boolean;
  /** Path to crsqlite extension (optional, see P2-cr-sqlite.md). */
  crsqliteExtPath?: string;
}

/**
 * Config for hub-and-spoke topology.
 *
 * One hub (PostgresBackend or a designated LocalBackend) is the Single Source
 * of Truth. N spokes are RemoteBackend clients that write to and read from the
 * hub. Ephemeral swarm workers are spokes with no local `.db` file.
 */
export interface HubSpokeConfig {
  topology: 'hub-spoke';
  /**
   * URL of the hub API instance (e.g. 'https://api.llmtxt.my').
   * REQUIRED — validation MUST fail fast if absent.
   */
  hubUrl: string;
  /**
   * API key for authenticating with the hub.
   * MUST be present for write operations.
   */
  apiKey?: string;
  /**
   * Ed25519 private key hex for signing writes (alternative to apiKey).
   * If both are supplied, Ed25519 signed writes take precedence.
   */
  identityPath?: string;
  /**
   * When true, this spoke maintains a local cr-sqlite replica.
   * Requires T385 (cr-sqlite) to be installed.
   * Default: false (ephemeral swarm worker mode — no .db file).
   */
  persistLocally?: boolean;
  /** Required when persistLocally=true. Path to local .db file. */
  storagePath?: string;
}

/**
 * Config for mesh topology.
 *
 * N persistent peers, each with their own cr-sqlite LocalBackend. No central
 * hub is required. Peers sync directly with each other via the P2P transport
 * defined in T386. Use for offline-first P2P collaboration, air-gapped
 * environments, or small teams of persistent agents (≤10 peers).
 */
export interface MeshConfig {
  topology: 'mesh';
  /** Path for the local cr-sqlite .db file. REQUIRED for mesh. */
  storagePath: string;
  /** Optional path to agent identity keypair. Defaults to storagePath/identity.json. */
  identityPath?: string;
  /**
   * Known peers at startup. Each entry is a transport address.
   * Format: 'unix:/path/to/sock' | 'http://host:port'
   */
  peers?: string[];
  /**
   * Directory where peer advertisement files are written and read.
   * Defaults to $LLMTXT_MESH_DIR or '/tmp/llmtxt-mesh'.
   */
  meshDir?: string;
  /** Transport to listen on. Default: 'unix'. */
  transport?: 'unix' | 'http';
  /** Port for http transport. Default: 7642. */
  port?: number;
}

/**
 * Discriminated union of all topology configs, keyed on the `topology` field.
 */
export type TopologyConfig = StandaloneConfig | HubSpokeConfig | MeshConfig;

// ── Zod schemas ───────────────────────────────────────────────────────────────

/**
 * Zod schema for {@link StandaloneConfig}.
 */
export const standaloneConfigSchema = z.object({
  topology: z.literal('standalone'),
  storagePath: z.string().optional(),
  identityPath: z.string().optional(),
  crsqlite: z.boolean().optional(),
  crsqliteExtPath: z.string().optional(),
});

/**
 * Zod schema for {@link HubSpokeConfig}.
 *
 * @remarks
 * Zod validates the shape; {@link validateTopologyConfig} performs the
 * cross-field business rules (e.g. persistLocally=true requires storagePath).
 */
export const hubSpokeConfigSchema = z.object({
  topology: z.literal('hub-spoke'),
  hubUrl: z.string().min(1),
  apiKey: z.string().optional(),
  identityPath: z.string().optional(),
  persistLocally: z.boolean().optional(),
  storagePath: z.string().optional(),
});

/**
 * Zod schema for {@link MeshConfig}.
 */
export const meshConfigSchema = z.object({
  topology: z.literal('mesh'),
  storagePath: z.string().min(1),
  identityPath: z.string().optional(),
  peers: z.array(z.string()).optional(),
  meshDir: z.string().optional(),
  transport: z.enum(['unix', 'http']).optional(),
  port: z.number().int().positive().optional(),
});

/**
 * Discriminated-union Zod schema for any {@link TopologyConfig}.
 *
 * @remarks
 * Uses `z.discriminatedUnion` on the `topology` field for efficient parsing
 * and precise field-level error messages.
 */
export const topologyConfigSchema = z.discriminatedUnion('topology', [
  standaloneConfigSchema,
  hubSpokeConfigSchema,
  meshConfigSchema,
]);

// ── Validation function ───────────────────────────────────────────────────────

/**
 * Validate an unknown value as a {@link TopologyConfig}.
 *
 * Throws {@link TopologyConfigError} with exact messages from
 * ARCH-T429 spec §3.3 on any validation failure.
 *
 * @param config - The unknown input to validate.
 * @returns The validated {@link TopologyConfig}.
 *
 * @throws {@link TopologyConfigError}
 *   - `INVALID_TOPOLOGY_MODE` — topology field is not a recognized value.
 *   - `MISSING_HUB_URL` — hub-spoke topology missing `hubUrl`.
 *   - `MISSING_STORAGE_PATH_PERSIST` — hub-spoke with persistLocally=true missing `storagePath`.
 *   - `MISSING_STORAGE_PATH_MESH` — mesh topology missing `storagePath`.
 */
export function validateTopologyConfig(config: unknown): TopologyConfig {
  // First check if the topology field is a known value so we can give a precise
  // INVALID_TOPOLOGY_MODE error before Zod's generic discriminated-union message.
  if (
    config !== null &&
    typeof config === 'object' &&
    !Array.isArray(config)
  ) {
    const raw = config as Record<string, unknown>;
    const mode = raw['topology'];

    if (
      mode !== undefined &&
      mode !== 'standalone' &&
      mode !== 'hub-spoke' &&
      mode !== 'mesh'
    ) {
      throw new TopologyConfigError(
        `unknown topology: ${String(mode)}`,
        'INVALID_TOPOLOGY_MODE',
        'topology',
      );
    }

    // hub-spoke: missing hubUrl check (before full Zod parse)
    if (mode === 'hub-spoke') {
      if (raw['hubUrl'] === undefined || raw['hubUrl'] === null || raw['hubUrl'] === '') {
        throw new TopologyConfigError(
          'hub-spoke topology requires hubUrl',
          'MISSING_HUB_URL',
          'hubUrl',
        );
      }

      // hub-spoke: persistLocally=true requires storagePath
      if (raw['persistLocally'] === true) {
        if (raw['storagePath'] === undefined || raw['storagePath'] === null || raw['storagePath'] === '') {
          throw new TopologyConfigError(
            'hub-spoke with persistLocally=true requires storagePath',
            'MISSING_STORAGE_PATH_PERSIST',
            'storagePath',
          );
        }
      }
    }

    // mesh: missing storagePath check (before full Zod parse)
    if (mode === 'mesh') {
      if (raw['storagePath'] === undefined || raw['storagePath'] === null || raw['storagePath'] === '') {
        throw new TopologyConfigError(
          'mesh topology requires storagePath (cr-sqlite)',
          'MISSING_STORAGE_PATH_MESH',
          'storagePath',
        );
      }
    }
  }

  // Full structural validation via Zod
  const result = topologyConfigSchema.safeParse(config);
  if (!result.success) {
    // Surface the first Zod error as a TopologyConfigError.
    // At this point the topology field is valid (checked above), so any
    // remaining Zod errors are field-level structural issues.
    const firstIssue = result.error.issues[0];
    const field = firstIssue?.path?.map(String).join('.') ?? undefined;
    const message = firstIssue?.message ?? 'invalid topology config';
    throw new TopologyConfigError(message, 'INVALID_TOPOLOGY_MODE', field);
  }

  return result.data as TopologyConfig;
}
