# llmtxt — Configuration Reference

## `LlmtxtClientConfig`

```typescript
import type { LlmtxtClientConfig } from "llmtxt";

const config: Partial<LlmtxtClientConfig> = {
  apiBase: "...",
  apiKey: "...",
  agentId: "...",
};
```

| Property | Type | Description |
|----------|------|-------------|
| `apiBase` | `string` |  |
| `apiKey` | `string` |  |
| `agentId` | `string` |  |

## `SignedUrlConfig`

Configuration for generating and verifying signed URLs.

```typescript
import type { SignedUrlConfig } from "llmtxt";

const config: Partial<SignedUrlConfig> = {
  secret: "...",
  baseUrl: "...",
  // Optional path prefix like `/attachments`. Default: root path.
  pathPrefix: "...",
  // Signature length in hex chars. Default: 16.
  signatureLength: 0,
};
```

| Property | Type | Description |
|----------|------|-------------|
| `secret` | `string` |  |
| `baseUrl` | `string` |  |
| `pathPrefix` | `string | undefined` | Optional path prefix like `/attachments`. Default: root path. |
| `signatureLength` | `number | undefined` | Signature length in hex chars. Default: 16. |

## `StandaloneConfig`

Config for standalone topology.  One agent, one local `.db` file, zero network dependency. Use for single developer or single agent, offline-first operation, local testing.

```typescript
import type { StandaloneConfig } from "llmtxt";

const config: Partial<StandaloneConfig> = {
  topology: undefined,
  // Path for the local .db file. Defaults to '.llmtxt'.
  storagePath: "...",
  // Optional path to agent identity keypair.
  identityPath: "...",
  // Set true to enable cr-sqlite (T385). Default: false.
  crsqlite: true,
  // Path to crsqlite extension (optional, see P2-cr-sqlite.md).
  crsqliteExtPath: "...",
};
```

| Property | Type | Description |
|----------|------|-------------|
| `topology` | `"standalone"` |  |
| `storagePath` | `string | undefined` | Path for the local .db file. Defaults to '.llmtxt'. |
| `identityPath` | `string | undefined` | Optional path to agent identity keypair. |
| `crsqlite` | `boolean | undefined` | Set true to enable cr-sqlite (T385). Default: false. |
| `crsqliteExtPath` | `string | undefined` | Path to crsqlite extension (optional, see P2-cr-sqlite.md). |

## `HubSpokeConfig`

Config for hub-and-spoke topology.  One hub (PostgresBackend or a designated LocalBackend) is the Single Source of Truth. N spokes are RemoteBackend clients that write to and read from the hub. Ephemeral swarm workers are spokes with no local `.db` file.

```typescript
import type { HubSpokeConfig } from "llmtxt";

const config: Partial<HubSpokeConfig> = {
  topology: undefined,
  // URL of the hub API instance (e.g. 'https://api.llmtxt.my'). REQUIRED — validation MUST fail fast if absent.
  hubUrl: "...",
  // API key for authenticating with the hub. MUST be present for write operations.
  apiKey: "...",
  // Ed25519 private key hex for signing writes (alternative to apiKey). If both are supplied, Ed25519 signed writes take precedence.
  identityPath: "...",
  // When true, this spoke maintains a local cr-sqlite replica. Requires T385 (cr-sqlite) to be installed. Default: false (ephemeral swarm worker mode — no .db file).
  persistLocally: true,
  // Required when persistLocally=true. Path to local .db file.
  storagePath: "...",
};
```

| Property | Type | Description |
|----------|------|-------------|
| `topology` | `"hub-spoke"` |  |
| `hubUrl` | `string` | URL of the hub API instance (e.g. 'https://api.llmtxt.my'). REQUIRED — validation MUST fail fast if absent. |
| `apiKey` | `string | undefined` | API key for authenticating with the hub. MUST be present for write operations. |
| `identityPath` | `string | undefined` | Ed25519 private key hex for signing writes (alternative to apiKey). If both are supplied, Ed25519 signed writes take precedence. |
| `persistLocally` | `boolean | undefined` | When true, this spoke maintains a local cr-sqlite replica. Requires T385 (cr-sqlite) to be installed. Default: false (ephemeral swarm worker mode — no .db file). |
| `storagePath` | `string | undefined` | Required when persistLocally=true. Path to local .db file. |

## `MeshConfig`

Config for mesh topology.  N persistent peers, each with their own cr-sqlite LocalBackend. No central hub is required. Peers sync directly with each other via the P2P transport defined in T386. Use for offline-first P2P collaboration, air-gapped environments, or small teams of persistent agents (≤10 peers).

```typescript
import type { MeshConfig } from "llmtxt";

const config: Partial<MeshConfig> = {
  topology: undefined,
  // Path for the local cr-sqlite .db file. REQUIRED for mesh.
  storagePath: "...",
  // Optional path to agent identity keypair. Defaults to storagePath/identity.json.
  identityPath: "...",
  // Known peers at startup. Each entry is a transport address. Format: 'unix:/path/to/sock' | 'http://host:port'
  peers: "...",
  // Directory where peer advertisement files are written and read. Defaults to $LLMTXT_MESH_DIR or '/tmp/llmtxt-mesh'.
  meshDir: "...",
  // Transport to listen on. Default: 'unix'.
  transport: undefined,
  // Port for http transport. Default: 7642.
  port: 0,
};
```

| Property | Type | Description |
|----------|------|-------------|
| `topology` | `"mesh"` |  |
| `storagePath` | `string` | Path for the local cr-sqlite .db file. REQUIRED for mesh. |
| `identityPath` | `string | undefined` | Optional path to agent identity keypair. Defaults to storagePath/identity.json. |
| `peers` | `string[] | undefined` | Known peers at startup. Each entry is a transport address. Format: 'unix:/path/to/sock' | 'http://host:port' |
| `meshDir` | `string | undefined` | Directory where peer advertisement files are written and read. Defaults to $LLMTXT_MESH_DIR or '/tmp/llmtxt-mesh'. |
| `transport` | `"unix" | "http" | undefined` | Transport to listen on. Default: 'unix'. |
| `port` | `number | undefined` | Port for http transport. Default: 7642. |

## `BackendConfig`

Configuration for a Backend instance.  BackendConfig is passed to the backend constructor. LocalBackend uses storagePath + identityPath; RemoteBackend uses baseUrl + apiKey.

```typescript
import type { BackendConfig } from "llmtxt";

const config: Partial<BackendConfig> = {
  // Directory where the backend stores its data. For LocalBackend: SQLite DB and large content blobs live here. Defaults to '.llmtxt' relative to the working directory.
  storagePath: "...",
  // Path to the agent identity keypair JSON file. Defaults to /identity.json.
  identityPath: "...",
  // Base URL of a remote LLMtxt API instance. Required for RemoteBackend. MUST include scheme (https://).
  baseUrl: "...",
  // API key for authenticating with the remote instance. Used by RemoteBackend in the Authorization header.
  apiKey: "...",
  // SQLite WAL mode. Defaults to true. Only relevant for LocalBackend.
  wal: true,
  // Lease reaper interval in milliseconds. Defaults to 10_000. Only relevant for LocalBackend.
  leaseReaperIntervalMs: 0,
  // Presence TTL in milliseconds. Defaults to 30_000. Only relevant for LocalBackend.
  presenceTtlMs: 0,
  // Absolute path to a pre-downloaded crsqlite native extension (.so / .dylib / .dll). When supplied, LocalBackend uses this path instead of resolving the extension via vlcn.io/crsqlite. Useful in air-gapped or bundled environments where the install-time binary download is not possible.  DR-P2-01: If absent, LocalBackend attempts to resolve the path from the vlcn.io/crsqlite optional peer dependency. If neither is available, LocalBackend opens without cr-sqlite (hasCRR = false, no crash).
  crsqliteExtPath: "...",
  // Maximum blob size in bytes. Defaults to 100 * 1024 * 1024 (100 MB).
  maxBlobSizeBytes: 0,
  // Blob storage mode for PostgresBackend. 's3' uses S3/R2 object storage (default). 'pg-lo' uses PostgreSQL large objects.
  blobStorageMode: undefined,
  // S3/R2 endpoint URL (e.g. "https://s3.us-east-1.amazonaws.com").
  s3Endpoint: "...",
  // S3/R2 bucket name. Required when blobStorageMode = 's3'.
  s3Bucket: "...",
  // S3/R2 region (e.g. "us-east-1").
  s3Region: "...",
  // S3/R2 access key ID.
  s3AccessKeyId: "...",
  // S3/R2 secret access key.
  s3SecretAccessKey: "...",
};
```

| Property | Type | Description |
|----------|------|-------------|
| `storagePath` | `string | undefined` | Directory where the backend stores its data. For LocalBackend: SQLite DB and large content blobs live here. Defaults to '.llmtxt' relative to the working directory. |
| `identityPath` | `string | undefined` | Path to the agent identity keypair JSON file. Defaults to /identity.json. |
| `baseUrl` | `string | undefined` | Base URL of a remote LLMtxt API instance. Required for RemoteBackend. MUST include scheme (https://). |
| `apiKey` | `string | undefined` | API key for authenticating with the remote instance. Used by RemoteBackend in the Authorization header. |
| `wal` | `boolean | undefined` | SQLite WAL mode. Defaults to true. Only relevant for LocalBackend. |
| `leaseReaperIntervalMs` | `number | undefined` | Lease reaper interval in milliseconds. Defaults to 10_000. Only relevant for LocalBackend. |
| `presenceTtlMs` | `number | undefined` | Presence TTL in milliseconds. Defaults to 30_000. Only relevant for LocalBackend. |
| `crsqliteExtPath` | `string | undefined` | Absolute path to a pre-downloaded crsqlite native extension (.so / .dylib / .dll). When supplied, LocalBackend uses this path instead of resolving the extension via vlcn.io/crsqlite. Useful in air-gapped or bundled environments where the install-time binary download is not possible.  DR-P2-01: If absent, LocalBackend attempts to resolve the path from the vlcn.io/crsqlite optional peer dependency. If neither is available, LocalBackend opens without cr-sqlite (hasCRR = false, no crash). |
| `maxBlobSizeBytes` | `number | undefined` | Maximum blob size in bytes. Defaults to 100 * 1024 * 1024 (100 MB). |
| `blobStorageMode` | `"s3" | "pg-lo" | undefined` | Blob storage mode for PostgresBackend. 's3' uses S3/R2 object storage (default). 'pg-lo' uses PostgreSQL large objects. |
| `s3Endpoint` | `string | undefined` | S3/R2 endpoint URL (e.g. "https://s3.us-east-1.amazonaws.com"). |
| `s3Bucket` | `string | undefined` | S3/R2 bucket name. Required when blobStorageMode = 's3'. |
| `s3Region` | `string | undefined` | S3/R2 region (e.g. "us-east-1"). |
| `s3AccessKeyId` | `string | undefined` | S3/R2 access key ID. |
| `s3SecretAccessKey` | `string | undefined` | S3/R2 secret access key. |

## `PostgresBackendConfig`

Extended config for PostgresBackend.

```typescript
import type { PostgresBackendConfig } from "llmtxt";

const config: Partial<PostgresBackendConfig> = {
  // PostgreSQL connection string. MUST be in the format: postgresql://user:passhost:5432/dbname Defaults to DATABASE_URL environment variable.
  connectionString: "...",
  // Maximum number of connections in the pool. Defaults to 10.
  maxConnections: 0,
};
```

| Property | Type | Description |
|----------|------|-------------|
| `connectionString` | `string | undefined` | PostgreSQL connection string. MUST be in the format: postgresql://user:passhost:5432/dbname Defaults to DATABASE_URL environment variable. |
| `maxConnections` | `number | undefined` | Maximum number of connections in the pool. Defaults to 10. |
