# reviewer-agent

A standalone reference agent that subscribes to a document's SSE event stream,
fetches content on each version event, applies review rules, posts comments to
the scratchpad, and sends an A2A recommendation to the consensus agent.

## What it does

1. Generates an ephemeral Ed25519 keypair via `llmtxt/identity`.
2. Registers the public key with the API.
3. Subscribes to `watchDocument()` SSE stream (from `llmtxt`).
4. On each `version_created` / `document.updated` event:
   - Fetches the document's raw markdown content.
   - Parses sections and applies review rules.
   - Posts comments to `/api/v1/documents/:slug/scratchpad`.
   - Sends a signed A2A envelope to `consensus-agent` with the recommendation.

## Prerequisites

- Node.js >= 22
- An LLMtxt API key from https://llmtxt.my/settings
- A document to review (create one with the writer-agent)

## Setup

```bash
cp .env.example .env
# Edit .env and set LLMTXT_API_KEY

npm install
```

## Run

```bash
# Watch a document with default review rules
node index.js --slug my-doc

# Watch with custom rules loaded from a JSON file
node index.js --slug my-doc --review-rules ./rules.example.json

# Set a custom timeout (in ms)
node index.js --slug my-doc --timeout 60000
```

## Review rules file format

Rules are loaded from a JSON array. Each rule has a declarative `test` name:

```json
[
  {
    "id": "no-code-example",
    "test": "no-code",
    "comment": "Add a code example.",
    "severity": "warning"
  }
]
```

Supported `test` values:

| Value | Triggers when |
|-------|--------------|
| `no-code` | Section has no markdown code fence |
| `too-short` | Section has fewer than 3 non-empty lines |
| `no-links` | Section is > 200 chars and has no URLs |

## Expected output

```
[reviewer-agent] Generating Ed25519 identity...
[reviewer-agent] Agent ID  : reviewer-agent-a1b2c3d4
[reviewer-agent] Pubkey    : a1b2c3d4e5f60718...
[reviewer-agent] Document  : my-doc
[reviewer-agent] Rules     : 3 loaded
[reviewer-agent] Pubkey registered.
[reviewer-agent] Subscribing to SSE stream for "my-doc"...
[reviewer-agent] (Watching for up to 120000ms)

[reviewer-agent] New version detected: 1
[reviewer-agent] Reviewing 3 section(s)...
[reviewer-agent] Found 2 comment(s):
[reviewer-agent]   [suggestion] "Introduction": no-code-example
[reviewer-agent]   [warning] "Getting Started": too-short
[reviewer-agent] A2A -> consensus-agent: recommendation=changes-requested

[reviewer-agent] Done. Reviewed 1 version(s).
```

## Key SDK imports

| Import | Purpose |
|--------|---------|
| `createIdentity` from `llmtxt/identity` | Generate Ed25519 keypair |
| `watchDocument` from `llmtxt` | Subscribe to SSE event stream |
| `identity.buildSignatureHeaders(...)` | Sign scratchpad POST requests |
| `identity.sign(...)` | Sign A2A envelope payload |

## CLI options

| Flag | Short | Description |
|------|-------|-------------|
| `--slug` | `-s` | Document slug to watch (required) |
| `--review-rules` | `-r` | Path to JSON rules file |
| `--timeout` | `-t` | Watch duration in ms (default: 120000) |
| `--help` | `-h` | Show help |
