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

async function cmdSync(args: CliArgs) {
  if (!args.remote) {
    console.error('sync requires --remote <url>');
    process.exit(1);
  }

  const { LocalBackend } = await import('../local/local-backend.js');
  const { RemoteBackend } = await import('../remote/remote-backend.js');

  const local = new LocalBackend({ storagePath: path.resolve(args.storage) });
  const remote = new RemoteBackend({ baseUrl: args.remote, apiKey: args.apiKey });

  await local.open();
  await remote.open();

  console.log('Syncing local ↔ remote...');

  // Phase 1: pull remote documents not in local
  const remoteList = await remote.listDocuments({ limit: 100 });
  let pulled = 0;

  for (const remoteDoc of remoteList.items) {
    const localDoc = await local.getDocument(remoteDoc.id);
    if (!localDoc) {
      // Create document locally with same id (best-effort)
      await local.createDocument({
        title: remoteDoc.title,
        createdBy: remoteDoc.createdBy,
        slug: remoteDoc.slug,
      });

      // Pull versions
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

  // Phase 2: push local documents not in remote
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

  console.log(`Sync complete. Pulled: ${pulled}, Pushed: ${pushed}`);
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
  sync                       Sync local ↔ remote (requires --remote)

EXAMPLES
  llmtxt init
  llmtxt create-doc "My Spec"
  echo "# Hello" | llmtxt push-version my-spec
  llmtxt pull my-spec
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
      case 'sync':
        await cmdSync(args);
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
