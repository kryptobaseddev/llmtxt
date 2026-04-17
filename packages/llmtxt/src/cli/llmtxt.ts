#!/usr/bin/env node
/**
 * llmtxt CLI — embedded document management for LLM agents.
 *
 * Usage:
 *   llmtxt [--remote <url>] [--api-key <key>] <command> [args...]
 *
 * Commands:
 *   init                    Initialise .llmtxt/ with SQLite DB and identity keypair
 *   create-doc <title>      Create a new document
 *   push-version <slug>     Push a new version (reads content from stdin)
 *   pull <slug>             Print the latest version content to stdout
 *   watch <slug>            Watch a document's event stream (streaming)
 *   approve <slug> <v>      Submit an approval for version v
 *   search <query>          Semantic search across documents
 *   keys generate           Generate a new Ed25519 keypair for this agent
 *   keys list               List registered agent public keys
 *   keys revoke <agentId>   Revoke an agent's public key
 *   sync                    Sync local backend with remote (requires --remote)
 *
 * Flags:
 *   --remote <url>          Use RemoteBackend against this URL
 *   --api-key <key>         API key for RemoteBackend auth
 *   --storage <path>        LocalBackend storage directory (default: .llmtxt)
 *   --agent <id>            Agent identity id (default: read from identity.json)
 *   --version               Print version and exit
 *   --help                  Print help and exit
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

// ── Version ───────────────────────────────────────────────────────
// Loaded from package.json at runtime. If unavailable, falls back to 'unknown'.
let PKG_VERSION = 'unknown';
try {
  const pkgPath = new URL('../../package.json', import.meta.url);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
  PKG_VERSION = pkg.version ?? 'unknown';
} catch (_) {
  // Running from source or in a context where package.json is not adjacent
}

// ── Arg parsing ───────────────────────────────────────────────────

interface CliArgs {
  command: string;
  positional: string[];
  remote?: string;
  apiKey?: string;
  storage: string;
  agentId?: string;
  // Export/import flags
  format?: string;
  output?: string;
  sign?: boolean;
  onConflict?: string;
  importedBy?: string;
  // Sync flags
  from?: string;
  db?: string;
  since?: string;
  // Blob flags
  name?: string;
  contentType?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: '',
    positional: [],
    storage: '.llmtxt',
  };

  const rest: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--remote' && argv[i + 1]) {
      args.remote = argv[++i];
    } else if (arg === '--api-key' && argv[i + 1]) {
      args.apiKey = argv[++i];
    } else if (arg === '--storage' && argv[i + 1]) {
      args.storage = argv[++i];
    } else if (arg === '--agent' && argv[i + 1]) {
      args.agentId = argv[++i];
    } else if ((arg === '--format' || arg === '-f') && argv[i + 1]) {
      args.format = argv[++i];
    } else if ((arg === '--output' || arg === '-o') && argv[i + 1]) {
      args.output = argv[++i];
    } else if (arg === '--sign') {
      args.sign = true;
    } else if (arg === '--on-conflict' && argv[i + 1]) {
      args.onConflict = argv[++i];
    } else if (arg === '--imported-by' && argv[i + 1]) {
      args.importedBy = argv[++i];
    } else if (arg === '--from' && argv[i + 1]) {
      args.from = argv[++i];
    } else if (arg === '--db' && argv[i + 1]) {
      args.db = argv[++i];
    } else if (arg === '--since' && argv[i + 1]) {
      args.since = argv[++i];
    } else if (arg === '--name' && argv[i + 1]) {
      args.name = argv[++i];
    } else if ((arg === '--content-type' || arg === '--mime') && argv[i + 1]) {
      args.contentType = argv[++i];
    } else {
      rest.push(arg!);
    }
    i++;
  }

  // First non-flag is the command; rest are positional
  if (rest.length > 0) {
    args.command = rest[0]!;
    args.positional = rest.slice(1);
  }

  return args;
}

// ── Identity helpers ──────────────────────────────────────────────

interface IdentityFile {
  agentId: string;
  pubkeyHex: string;
  privkeyHex: string;
}

function identityPath(storagePath: string): string {
  return path.join(storagePath, 'identity.json');
}

function loadIdentity(storagePath: string): IdentityFile | null {
  const p = identityPath(storagePath);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as IdentityFile;
  } catch (_) {
    return null;
  }
}

async function generateIdentity(): Promise<IdentityFile> {
  const ed = await import('@noble/ed25519');
  const { sha512 } = await import('@noble/hashes/sha2.js');

  // noble/ed25519 v3 requires sha512 to be set for Node.js sync hash calls
  ed.hashes.sha512 = sha512;

  // keygen() returns { secretKey, publicKey } in v3
  const keypair = ed.keygen();
  const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    agentId,
    pubkeyHex: Buffer.from(keypair.publicKey).toString('hex'),
    privkeyHex: Buffer.from(keypair.secretKey).toString('hex'),
  };
}

// ── Backend factory ───────────────────────────────────────────────

async function createBackend(args: CliArgs) {
  if (args.remote) {
    const { RemoteBackend } = await import('../remote/remote-backend.js');
    return new RemoteBackend({ baseUrl: args.remote, apiKey: args.apiKey });
  } else {
    const { LocalBackend } = await import('../local/local-backend.js');
    return new LocalBackend({ storagePath: args.storage });
  }
}

// ── Read stdin ────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    chunks.push(line);
  }
  return chunks.join('\n');
}

// ── Commands ──────────────────────────────────────────────────────

async function cmdInit(args: CliArgs) {
  const storagePath = path.resolve(args.storage);

  // Open LocalBackend to apply migrations and create the DB
  const { LocalBackend } = await import('../local/local-backend.js');
  const backend = new LocalBackend({ storagePath });
  await backend.open();

  // Generate identity keypair if not present
  const idPath = identityPath(storagePath);
  if (fs.existsSync(idPath)) {
    const identity = loadIdentity(storagePath)!;
    console.log(`Already initialised. Agent ID: ${identity.agentId}`);
    console.log(`Storage: ${storagePath}`);
  } else {
    const identity = await generateIdentity();
    fs.writeFileSync(idPath, JSON.stringify(identity, null, 2), { mode: 0o600 });

    // Register the pubkey
    await backend.registerAgentPubkey(identity.agentId, identity.pubkeyHex, 'primary');

    console.log(`Initialised LLMtxt at ${storagePath}`);
    console.log(`Agent ID: ${identity.agentId}`);
    console.log(`Public key: ${identity.pubkeyHex}`);
  }

  await backend.close();
}

async function cmdCreateDoc(args: CliArgs) {
  const title = args.positional[0];
  if (!title) {
    console.error('Usage: llmtxt create-doc <title> [--content <text>]');
    process.exit(1);
  }

  const identity = loadIdentity(path.resolve(args.storage));
  const createdBy = args.agentId ?? identity?.agentId ?? 'anonymous';

  const backend = await createBackend(args);
  await backend.open();

  const doc = await backend.createDocument({ title, createdBy });

  await backend.close();

  console.log(JSON.stringify({ id: doc.id, slug: doc.slug, title: doc.title, state: doc.state }, null, 2));
}

async function cmdPushVersion(args: CliArgs) {
  const slug = args.positional[0];
  if (!slug) {
    console.error('Usage: llmtxt push-version <slug> [--changelog "message"] < content.txt');
    process.exit(1);
  }

  const content = await readStdin();
  const identity = loadIdentity(path.resolve(args.storage));
  const createdBy = args.agentId ?? identity?.agentId ?? 'anonymous';

  const backend = await createBackend(args);
  await backend.open();

  const doc = await backend.getDocumentBySlug(slug);
  if (!doc) {
    console.error(`Document not found: ${slug}`);
    await backend.close();
    process.exit(1);
  }

  const version = await backend.publishVersion({
    documentId: doc.id,
    content,
    patchText: '',
    createdBy,
    changelog: args.positional[1] ?? 'CLI push',
  });

  await backend.close();

  console.log(JSON.stringify({
    documentId: doc.id,
    slug: doc.slug,
    versionNumber: version.versionNumber,
    contentHash: version.contentHash,
  }, null, 2));
}

async function cmdPull(args: CliArgs) {
  const slug = args.positional[0];
  if (!slug) {
    console.error('Usage: llmtxt pull <slug>');
    process.exit(1);
  }

  const backend = await createBackend(args);
  await backend.open();

  const doc = await backend.getDocumentBySlug(slug);
  if (!doc) {
    console.error(`Document not found: ${slug}`);
    await backend.close();
    process.exit(1);
  }

  // Get the latest version and retrieve content
  const versions = await backend.listVersions(doc.id);
  if (versions.length === 0) {
    console.error('No versions published yet.');
    await backend.close();
    process.exit(1);
  }

  const latest = versions[versions.length - 1]!;

  // For LocalBackend we read from blobs dir; for RemoteBackend we'd fetch from the API
  const blobPath = path.join(path.resolve(args.storage), 'blobs', latest.contentHash);
  if (fs.existsSync(blobPath)) {
    process.stdout.write(fs.readFileSync(blobPath, 'utf8'));
  } else {
    console.log(`Version ${latest.versionNumber} | hash: ${latest.contentHash}`);
    console.log('(Content stored inline — use the SDK to retrieve)');
  }

  await backend.close();
}

async function cmdWatch(args: CliArgs) {
  const slug = args.positional[0];
  if (!slug) {
    console.error('Usage: llmtxt watch <slug>');
    process.exit(1);
  }

  const backend = await createBackend(args);
  await backend.open();

  const doc = await backend.getDocumentBySlug(slug);
  if (!doc) {
    console.error(`Document not found: ${slug}`);
    await backend.close();
    process.exit(1);
  }

  console.log(`Watching events for: ${doc.slug} (${doc.id})`);
  console.log('Press Ctrl+C to stop.');

  const stream = backend.subscribeStream(doc.id);
  for await (const event of stream) {
    console.log(JSON.stringify(event));
  }

  await backend.close();
}

async function cmdSearch(args: CliArgs) {
  const query = args.positional.join(' ');
  if (!query) {
    console.error('Usage: llmtxt search <query>');
    process.exit(1);
  }

  const backend = await createBackend(args);
  await backend.open();
  const results = await backend.search({ query, topK: 10 });
  await backend.close();

  if (results.length === 0) {
    console.log('No results found.');
  } else {
    for (const r of results) {
      console.log(`${r.score.toFixed(3)}  ${r.slug}  ${r.title}`);
    }
  }
}

async function cmdKeys(args: CliArgs) {
  const subcommand = args.positional[0];

  if (subcommand === 'generate') {
    const identity = await generateIdentity();
    const storagePath = path.resolve(args.storage);
    const idPath = identityPath(storagePath);

    if (fs.existsSync(idPath)) {
      console.error('Identity already exists. Delete .llmtxt/identity.json first to regenerate.');
      process.exit(1);
    }

    fs.mkdirSync(storagePath, { recursive: true });
    fs.writeFileSync(idPath, JSON.stringify(identity, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ agentId: identity.agentId, pubkeyHex: identity.pubkeyHex }, null, 2));
    return;
  }

  if (subcommand === 'list') {
    // Show the local identity
    const identity = loadIdentity(path.resolve(args.storage));
    if (!identity) {
      console.log('No identity found. Run `llmtxt init` first.');
    } else {
      console.log(JSON.stringify({ agentId: identity.agentId, pubkeyHex: identity.pubkeyHex }, null, 2));
    }
    return;
  }

  if (subcommand === 'revoke') {
    const agentId = args.positional[1];
    if (!agentId) {
      console.error('Usage: llmtxt keys revoke <agentId>');
      process.exit(1);
    }

    const backend = await createBackend(args);
    await backend.open();

    const record = await backend.lookupAgentPubkey(agentId);
    if (!record) {
      console.error(`Agent not found: ${agentId}`);
      await backend.close();
      process.exit(1);
    }

    const ok = await backend.revokeAgentPubkey(agentId, record.pubkeyHex);
    await backend.close();
    console.log(ok ? `Revoked key for ${agentId}` : 'Revocation failed.');
    return;
  }

  console.error('Usage: llmtxt keys generate|list|revoke <agentId>');
  process.exit(1);
}

// ── Export format helpers ─────────────────────────────────────────

/** Normalise user-supplied format alias to an ExportFormat value. */
function normaliseFormat(raw: string | undefined): 'markdown' | 'json' | 'txt' | 'llmtxt' {
  switch (raw?.toLowerCase()) {
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'json':
      return 'json';
    case 'txt':
    case 'text':
      return 'txt';
    case 'llmtxt':
      return 'llmtxt';
    default:
      return 'markdown'; // sensible default
  }
}

/** Map ExportFormat to file extension. */
function fmtExt(format: 'markdown' | 'json' | 'txt' | 'llmtxt'): string {
  switch (format) {
    case 'markdown': return 'md';
    case 'json':     return 'json';
    case 'txt':      return 'txt';
    case 'llmtxt':   return 'llmtxt';
  }
}

// ── llmtxt export <slug> ──────────────────────────────────────────

/**
 * Export a single document to a file.
 *
 * Usage:
 *   llmtxt export <slug> [--format md] [--output <dir|file>] [--sign]
 *
 * If --output points to a directory (or ends with a path separator), the file
 * is written as <slug>.<ext> inside that directory. Otherwise it is used as
 * the literal output path.
 *
 * Prints ExportDocumentResult as JSON to stdout on success.
 */
async function cmdExport(args: CliArgs) {
  const slug = args.positional[0];
  if (!slug) {
    console.error('Usage: llmtxt export <slug> [--format md|json|txt|llmtxt] [--output <path>] [--sign]');
    process.exit(1);
  }

  const format = normaliseFormat(args.format);
  const outputBase = args.output ?? '.';

  // If the output looks like an existing directory or ends with /, write <slug>.<ext> inside it.
  let outputPath: string;
  if (
    outputBase.endsWith('/') ||
    outputBase.endsWith(path.sep) ||
    (fs.existsSync(outputBase) && fs.statSync(outputBase).isDirectory())
  ) {
    outputPath = path.join(outputBase, `${slug}.${fmtExt(format)}`);
  } else {
    outputPath = outputBase;
  }

  const backend = await createBackend(args);
  await backend.open();

  try {
    const result = await backend.exportDocument({
      slug,
      format,
      outputPath,
      sign: args.sign,
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await backend.close();
  }
}

// ── llmtxt export-all ─────────────────────────────────────────────

/**
 * Export all documents to a directory.
 *
 * Usage:
 *   llmtxt export-all [--format md] [--output <dir>] [--sign]
 *
 * Prints ExportAllResult as JSON to stdout on success.
 */
async function cmdExportAll(args: CliArgs) {
  const format = normaliseFormat(args.format);
  const outputDir = path.resolve(args.output ?? '.');

  const backend = await createBackend(args);
  await backend.open();

  try {
    const result = await backend.exportAll({
      format,
      outputDir,
      sign: args.sign,
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await backend.close();
  }
}

// ── llmtxt import <file> ──────────────────────────────────────────

/**
 * Import a document from a file.
 *
 * Usage:
 *   llmtxt import <file> [--imported-by <agentId>] [--on-conflict new_version|create]
 *
 * Supported file types: .md, .json, .txt, .llmtxt
 * Prints ImportDocumentResult as JSON to stdout on success.
 */
async function cmdImport(args: CliArgs) {
  const filePath = args.positional[0];
  if (!filePath) {
    console.error('Usage: llmtxt import <file> [--imported-by <agentId>] [--on-conflict new_version|create]');
    process.exit(1);
  }

  const identity = loadIdentity(path.resolve(args.storage));
  const importedBy = args.importedBy ?? args.agentId ?? identity?.agentId ?? 'anonymous';

  const onConflict = (args.onConflict === 'create') ? 'create' : 'new_version';

  const backend = await createBackend(args);
  await backend.open();

  try {
    const result = await backend.importDocument({
      filePath: path.resolve(filePath),
      importedBy,
      onConflict,
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await backend.close();
  }
}

/**
 * llmtxt sync — cr-sqlite changeset exchange (T406 / P2.8)
 *
 * Exchanges cr-sqlite changesets instead of HTTP REST diff.
 *
 * Flow:
 *  1. Open local LocalBackend (must have hasCRR=true).
 *  2. Read last-known dbVersion for this peer from llmtxt_sync_state.
 *  3. Call getChangesSince(lastVersion) → localChangeset.
 *  4. POST localChangeset to peer /mesh/sync or read peer DB file directly.
 *  5. Receive remoteChangeset from peer.
 *  6. Call applyChanges(remoteChangeset) → newVersion.
 *  7. Update llmtxt_sync_state with newVersion.
 *  8. Print sync summary stats.
 *
 * Usage:
 *   llmtxt sync --from <peer-url-or-path> [--db <path>] [--since <db-version>]
 *
 * --from accepts:
 *   - HTTP/HTTPS URL  → POST changeset to <url>/mesh/sync
 *   - File path       → read peer .db directly (in-process P2P via LocalBackend)
 *
 * Falls back to legacy REST sync if --from is not provided and --remote is set.
 */
async function cmdSync(args: CliArgs) {
  const peerSource = args.from ?? args.remote;

  // ── Legacy REST sync (no --from / --remote not set) ─────────────────────────
  if (!peerSource) {
    console.error(
      'sync requires --from <peer-url-or-path>  (or legacy: --remote <url>)\n' +
      'Examples:\n' +
      '  llmtxt sync --from https://api.llmtxt.my\n' +
      '  llmtxt sync --from /path/to/peer.db'
    );
    process.exit(1);
  }

  const { LocalBackend } = await import('../local/local-backend.js');

  const storagePath = path.resolve(args.db ?? args.storage);
  const local = new LocalBackend({ storagePath });
  await local.open();

  if (!local.hasCRR) {
    // cr-sqlite not loaded — fall back to legacy REST sync if peer is HTTP.
    console.warn(
      '[sync] cr-sqlite not loaded (hasCRR=false). ' +
      'Falling back to legacy REST sync. ' +
      'Install @vlcn.io/crsqlite to enable changeset exchange.'
    );
    await local.close();
    await _legacyRestSync({ ...args, remote: peerSource });
    return;
  }

  // ── cr-sqlite changeset sync ────────────────────────────────────────────────

  // 1. Determine lastSyncVersion for this peer.
  let lastSyncVersion = 0n;
  if (args.since !== undefined) {
    try {
      lastSyncVersion = BigInt(args.since);
    } catch {
      console.error(`--since must be an integer db_version, got: ${args.since}`);
      await local.close();
      process.exit(1);
    }
  } else {
    lastSyncVersion = _readLastSyncVersion(storagePath, peerSource);
  }

  console.log(`[sync] Peer: ${peerSource}`);
  console.log(`[sync] Last sync version: ${lastSyncVersion}`);

  // 2. Get local changes since lastSyncVersion.
  const localChangeset = await local.getChangesSince(lastSyncVersion);
  console.log(`[sync] Local changeset: ${localChangeset.length} bytes`);

  // 3. Exchange changesets with peer.
  let remoteChangeset: Uint8Array;
  let changesetsSent = 0;
  let changesetsReceived = 0;

  const isHttpPeer = peerSource.startsWith('http://') || peerSource.startsWith('https://');

  if (isHttpPeer) {
    // HTTP peer — POST our changeset, receive peer's.
    const { remoteChangeset: rc, sent, received } = await _httpChangesetExchange(
      peerSource,
      localChangeset,
      lastSyncVersion,
      args.apiKey
    );
    remoteChangeset = rc;
    changesetsSent = sent;
    changesetsReceived = received;
  } else {
    // Local file peer — open peer LocalBackend, exchange in-process.
    const { remoteChangeset: rc, sent, received } = await _localFileChangesetExchange(
      peerSource,
      localChangeset,
      lastSyncVersion
    );
    remoteChangeset = rc;
    changesetsSent = sent;
    changesetsReceived = received;
  }

  // 4. Apply remote changeset.
  const newLocalVersion = await local.applyChanges(remoteChangeset);

  // 5. Persist last-sync version.
  _writeLastSyncVersion(storagePath, peerSource, newLocalVersion);

  await local.close();

  // 6. Print summary.
  console.log(
    `[sync] Complete.\n` +
    `  synced ${changesetsReceived} changesets received, ${changesetsSent} changesets sent, 0 conflicts (CRDT merge)\n` +
    `  new local db_version: ${newLocalVersion}`
  );
}

// ── cr-sqlite sync helpers ────────────────────────────────────────────────────

/** Path to the peer sync-state file (stores last-known dbVersion per peer URL). */
function _syncStatePath(storagePath: string): string {
  return path.join(storagePath, 'sync-state.json');
}

/** Read the last-known dbVersion for a peer. Returns 0n if unknown. */
function _readLastSyncVersion(storagePath: string, peerUrl: string): bigint {
  try {
    const p = _syncStatePath(storagePath);
    if (!fs.existsSync(p)) return 0n;
    const state = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, string>;
    const stored = state[peerUrl];
    return stored !== undefined ? BigInt(stored) : 0n;
  } catch {
    return 0n;
  }
}

/** Persist the last-known dbVersion for a peer. */
function _writeLastSyncVersion(storagePath: string, peerUrl: string, version: bigint): void {
  try {
    const p = _syncStatePath(storagePath);
    let state: Record<string, string> = {};
    if (fs.existsSync(p)) {
      try {
        state = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, string>;
      } catch {
        state = {};
      }
    }
    state[peerUrl] = version.toString();
    fs.writeFileSync(p, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch (err) {
    console.warn('[sync] Failed to persist sync state:', (err as Error).message);
  }
}

/** Exchange changeset with an HTTP peer via POST /mesh/sync. */
async function _httpChangesetExchange(
  peerUrl: string,
  localChangeset: Uint8Array,
  lastSyncVersion: bigint,
  apiKey?: string
): Promise<{ remoteChangeset: Uint8Array; sent: number; received: number }> {
  const http = await import('node:https');
  const httpPlain = await import('node:http');

  const syncUrl = new URL('/mesh/sync', peerUrl);

  // Encode local changeset as base64 in JSON body.
  const body = JSON.stringify({
    changeset: Buffer.from(localChangeset).toString('base64'),
    sinceVersion: lastSyncVersion.toString(),
  });

  const isHttps = syncUrl.protocol === 'https:';
  const mod = isHttps ? http : httpPlain;

  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        hostname: syncUrl.hostname,
        port: syncUrl.port || (isHttps ? 443 : 80),
        path: syncUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Peer returned HTTP ${res.statusCode ?? 'unknown'}`));
            return;
          }
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString()) as {
              changeset?: string;
              received?: number;
            };
            const remoteB64 = json.changeset ?? '';
            const remoteChangeset = remoteB64
              ? new Uint8Array(Buffer.from(remoteB64, 'base64'))
              : new Uint8Array(0);
            resolve({
              remoteChangeset,
              sent: localChangeset.length,
              received: json.received ?? remoteChangeset.length,
            });
          } catch (e) {
            reject(new Error(`Failed to parse peer response: ${(e as Error).message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Exchange changesets with a local-file peer (in-process P2P). */
async function _localFileChangesetExchange(
  peerDbPath: string,
  localChangeset: Uint8Array,
  lastSyncVersion: bigint
): Promise<{ remoteChangeset: Uint8Array; sent: number; received: number }> {
  const { LocalBackend } = await import('../local/local-backend.js');

  // peerDbPath may point to either a storage directory or a .db file.
  // LocalBackend expects a storagePath (directory); if the user passed a .db
  // file path, use its parent directory.
  let peerStoragePath = peerDbPath;
  if (peerDbPath.endsWith('.db')) {
    peerStoragePath = path.dirname(peerDbPath);
  }

  const peer = new LocalBackend({ storagePath: peerStoragePath });
  await peer.open();

  try {
    if (!peer.hasCRR) {
      throw new Error(
        `Peer at ${peerDbPath} does not have cr-sqlite loaded (hasCRR=false). ` +
        'Ensure @vlcn.io/crsqlite is installed on the peer.'
      );
    }

    // Get peer's changes since the version the peer last saw from us.
    // We use lastSyncVersion as a best-effort starting point for the peer.
    const remoteChangeset = await peer.getChangesSince(lastSyncVersion);

    // Apply our local changeset to the peer (bidirectional in one call).
    if (localChangeset.length > 0) {
      await peer.applyChanges(localChangeset);
    }

    return {
      remoteChangeset,
      sent: localChangeset.length,
      received: remoteChangeset.length,
    };
  } finally {
    await peer.close();
  }
}

/**
 * Legacy REST sync (pre-cr-sqlite, documents-only).
 * Used as fallback when cr-sqlite is not available.
 */
async function _legacyRestSync(args: CliArgs) {
  if (!args.remote) {
    console.error('Legacy REST sync requires --remote <url>');
    process.exit(1);
  }

  const { LocalBackend } = await import('../local/local-backend.js');
  const { RemoteBackend } = await import('../remote/remote-backend.js');

  const local = new LocalBackend({ storagePath: path.resolve(args.storage) });
  const remote = new RemoteBackend({ baseUrl: args.remote, apiKey: args.apiKey });

  await local.open();
  await remote.open();

  console.log('[sync] Legacy REST sync: local ↔ remote...');

  const remoteList = await remote.listDocuments({ limit: 100 });
  let pulled = 0;

  for (const remoteDoc of remoteList.items) {
    const localDoc = await local.getDocument(remoteDoc.id);
    if (!localDoc) {
      await local.createDocument({
        title: remoteDoc.title,
        createdBy: remoteDoc.createdBy,
        slug: remoteDoc.slug,
      });

      const remoteVersions = await remote.listVersions(remoteDoc.id);
      for (const v of remoteVersions) {
        const localVersion = await local.getVersion(remoteDoc.id, v.versionNumber);
        if (!localVersion) {
          await local.publishVersion({
            documentId: remoteDoc.id,
            content: `(synced from remote — hash: ${v.contentHash})`,
            patchText: v.patchText,
            createdBy: v.createdBy,
            changelog: v.changelog,
          });
        }
      }

      pulled++;
    }
  }

  const localList = await local.listDocuments({ limit: 100 });
  let pushed = 0;

  for (const localDoc of localList.items) {
    const remoteDoc = await remote.getDocument(localDoc.id);
    if (!remoteDoc) {
      await remote.createDocument({
        title: localDoc.title,
        createdBy: localDoc.createdBy,
        slug: localDoc.slug,
      });

      const localVersions = await local.listVersions(localDoc.id);
      for (const v of localVersions) {
        await remote.publishVersion({
          documentId: localDoc.id,
          content: `(synced from local — hash: ${v.contentHash})`,
          patchText: v.patchText,
          createdBy: v.createdBy,
          changelog: v.changelog,
        });
      }

      pushed++;
    }
  }

  await local.close();
  await remote.close();

  console.log(`[sync] Legacy complete. Pulled: ${pulled}, Pushed: ${pushed}`);
}

// ── Blob helpers ──────────────────────────────────────────────────

/** Human-readable byte size (e.g. "42 KB", "1.2 MB"). */
function humanizeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Detect MIME type from file extension.
 * Covers the most common file types agents typically attach.
 * Falls back to 'application/octet-stream'.
 */
function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.txt':   'text/plain',
    '.md':    'text/markdown',
    '.html':  'text/html',
    '.htm':   'text/html',
    '.css':   'text/css',
    '.js':    'application/javascript',
    '.ts':    'text/typescript',
    '.json':  'application/json',
    '.xml':   'application/xml',
    '.yaml':  'application/yaml',
    '.yml':   'application/yaml',
    '.csv':   'text/csv',
    '.pdf':   'application/pdf',
    '.zip':   'application/zip',
    '.tar':   'application/x-tar',
    '.gz':    'application/gzip',
    '.png':   'image/png',
    '.jpg':   'image/jpeg',
    '.jpeg':  'image/jpeg',
    '.gif':   'image/gif',
    '.svg':   'image/svg+xml',
    '.webp':  'image/webp',
    '.mp4':   'video/mp4',
    '.webm':  'video/webm',
    '.mp3':   'audio/mpeg',
    '.wav':   'audio/wav',
    '.bin':   'application/octet-stream',
    '.wasm':  'application/wasm',
    '.proto': 'application/protobuf',
    '.npy':   'application/octet-stream',
    '.pkl':   'application/octet-stream',
  };
  return mimeMap[ext] ?? 'application/octet-stream';
}

// ── llmtxt attach <slug> <filepath> ──────────────────────────────

/**
 * Attach a file as a binary blob to a document.
 *
 * Usage:
 *   llmtxt attach <slug> <filepath> [--name <name>] [--content-type <mime>]
 *
 * Reads the file from disk, uploads via backend.attachBlob, and prints
 * the hash and humanized size on success.
 */
async function cmdAttach(args: CliArgs) {
  const slug = args.positional[0];
  const filePath = args.positional[1];

  if (!slug || !filePath) {
    console.error('Usage: llmtxt attach <slug> <filepath> [--name <name>] [--content-type <mime>]');
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const blobName = args.name ?? path.basename(resolvedPath);
  const contentType = args.contentType ?? detectMimeType(resolvedPath);
  const data = fs.readFileSync(resolvedPath);

  const identity = loadIdentity(path.resolve(args.storage));
  const uploadedBy = args.agentId ?? identity?.agentId ?? 'anonymous';

  const backend = await createBackend(args);
  await backend.open();

  try {
    const result = await backend.attachBlob({
      docSlug: slug,
      name: blobName,
      contentType,
      data,
      uploadedBy,
    });

    console.log(`Attached ${blobName} to ${slug}`);
    console.log(`Hash: ${result.hash}`);
    console.log(`Size: ${humanizeBytes(result.size)}`);
  } finally {
    await backend.close();
  }
}

// ── llmtxt detach <slug> <blobname> ──────────────────────────────

/**
 * Detach (soft-delete) a named blob from a document.
 *
 * Usage:
 *   llmtxt detach <slug> <blobname>
 */
async function cmdDetach(args: CliArgs) {
  const slug = args.positional[0];
  const blobName = args.positional[1];

  if (!slug || !blobName) {
    console.error('Usage: llmtxt detach <slug> <blobname>');
    process.exit(1);
  }

  const identity = loadIdentity(path.resolve(args.storage));
  const detachedBy = args.agentId ?? identity?.agentId ?? 'anonymous';

  const backend = await createBackend(args);
  await backend.open();

  try {
    const removed = await backend.detachBlob(slug, blobName, detachedBy);

    if (!removed) {
      console.error(`No active blob named "${blobName}" on document "${slug}"`);
      process.exit(1);
    }

    console.log(`Detached ${blobName} from ${slug}`);
  } finally {
    await backend.close();
  }
}

// ── llmtxt blobs <slug> ───────────────────────────────────────────

/**
 * List all active blob attachments for a document as a table.
 *
 * Usage:
 *   llmtxt blobs <slug>
 *
 * Output columns: NAME, SIZE, TYPE, UPLOADED BY, UPLOADED AT
 */
async function cmdBlobs(args: CliArgs) {
  const slug = args.positional[0];

  if (!slug) {
    console.error('Usage: llmtxt blobs <slug>');
    process.exit(1);
  }

  const backend = await createBackend(args);
  await backend.open();

  try {
    const blobs = await backend.listBlobs(slug);

    if (blobs.length === 0) {
      console.log(`No blobs attached to "${slug}".`);
      return;
    }

    // Column widths
    const nameWidth = Math.max(4, ...blobs.map((b) => b.blobName.length));
    const sizeWidth = Math.max(4, ...blobs.map((b) => humanizeBytes(b.size).length));
    const typeWidth = Math.max(4, ...blobs.map((b) => b.contentType.length));
    const byWidth   = Math.max(11, ...blobs.map((b) => b.uploadedBy.length));

    const pad = (s: string, w: number) => s.padEnd(w);

    // Header
    console.log(
      `${pad('NAME', nameWidth)}  ${pad('SIZE', sizeWidth)}  ${pad('TYPE', typeWidth)}  ${pad('UPLOADED BY', byWidth)}  UPLOADED AT`
    );
    console.log(
      `${'-'.repeat(nameWidth)}  ${'-'.repeat(sizeWidth)}  ${'-'.repeat(typeWidth)}  ${'-'.repeat(byWidth)}  ${'-'.repeat(24)}`
    );

    for (const blob of blobs) {
      const uploadedAt = new Date(blob.uploadedAt).toISOString();
      console.log(
        `${pad(blob.blobName, nameWidth)}  ${pad(humanizeBytes(blob.size), sizeWidth)}  ${pad(blob.contentType, typeWidth)}  ${pad(blob.uploadedBy, byWidth)}  ${uploadedAt}`
      );
    }
  } finally {
    await backend.close();
  }
}

// ── Help text ─────────────────────────────────────────────────────

function printHelp() {
  console.log(`
llmtxt v${PKG_VERSION} — Portable LLM document management

USAGE
  llmtxt [options] <command> [args]

OPTIONS
  --remote <url>       Use RemoteBackend (default: LocalBackend)
  --api-key <key>      API key for remote authentication
  --storage <path>     Local storage directory (default: .llmtxt)
  --agent <id>         Override agent identity id
  --version            Print version and exit
  --help               Print this help

COMMANDS
  init                       Create .llmtxt/ with SQLite DB and Ed25519 identity
  create-doc <title>         Create a new document
  push-version <slug>        Publish a new version (reads content from stdin)
  pull <slug>                Print the latest version content to stdout
  watch <slug>               Stream events for a document (Ctrl+C to stop)
  search <query>             Semantic search across all indexed documents
  keys generate              Generate a new Ed25519 keypair
  keys list                  Show the current agent identity
  keys revoke <agentId>      Revoke an agent's registered public key
  export <slug>              Export a document to a file
  export-all                 Export all documents to a directory
  import <file>              Import a document from a file
  sync                       Sync via cr-sqlite changeset exchange (requires --from)
  attach <slug> <filepath>   Attach a binary file to a document
  detach <slug> <blobname>   Remove a named blob attachment from a document
  blobs <slug>               List all blob attachments for a document

BLOB FLAGS
  --name <name>              Attachment name (default: basename of filepath)
  --content-type <mime>      MIME type (default: detected from extension)

SYNC FLAGS (cr-sqlite changeset exchange — T406/P2.8)
  --from <url-or-path>         Peer to sync with (HTTP URL or local .db file path)
  --db <path>                  Override local storage path for sync
  --since <db-version>         Override last-sync dbVersion (forces full re-sync from N)

EXPORT / IMPORT FLAGS
  --format md|json|txt|llmtxt  Export format (default: md)
  --output <path>              Output file or directory (default: current dir)
  --sign                       Sign export with Ed25519 identity
  --imported-by <agentId>      Agent ID for import attribution
  --on-conflict new_version|create  Conflict strategy for import (default: new_version)

EXAMPLES
  llmtxt init
  llmtxt create-doc "My Spec"
  echo "# Hello" | llmtxt push-version my-spec
  llmtxt pull my-spec
  llmtxt attach my-spec ./diagram.png
  llmtxt attach my-spec ./report.pdf --name final-report.pdf --content-type application/pdf
  llmtxt blobs my-spec
  llmtxt detach my-spec diagram.png
  llmtxt export my-spec --format md --output ./specs/
  llmtxt export-all --format json --output ./docs/
  llmtxt import ./specs/my-spec.md
  llmtxt search "authentication design"
  llmtxt sync --remote https://api.llmtxt.my --api-key $API_KEY
`.trim());
}

// ── Entry point ───────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--version')) {
    console.log(`llmtxt v${PKG_VERSION}`);
    process.exit(0);
  }

  if (argv.includes('--help') || argv.length === 0) {
    printHelp();
    process.exit(0);
  }

  const args = parseArgs(argv);

  try {
    switch (args.command) {
      case 'init':
        await cmdInit(args);
        break;
      case 'create-doc':
        await cmdCreateDoc(args);
        break;
      case 'push-version':
        await cmdPushVersion(args);
        break;
      case 'pull':
        await cmdPull(args);
        break;
      case 'watch':
        await cmdWatch(args);
        break;
      case 'search':
        await cmdSearch(args);
        break;
      case 'keys':
        await cmdKeys(args);
        break;
      case 'export':
        await cmdExport(args);
        break;
      case 'export-all':
        await cmdExportAll(args);
        break;
      case 'import':
        await cmdImport(args);
        break;
      case 'sync':
        await cmdSync(args);
        break;
      case 'attach':
        await cmdAttach(args);
        break;
      case 'detach':
        await cmdDetach(args);
        break;
      case 'blobs':
        await cmdBlobs(args);
        break;
      default:
        console.error(`Unknown command: ${args.command}`);
        console.error('Run `llmtxt --help` for usage.');
        process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
