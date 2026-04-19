# writer-agent

A standalone reference agent that demonstrates how to write a document section
using the LLMtxt SDK. Every PUT request is signed with an ephemeral Ed25519
keypair so the backend can verify authorship.

## What it does

1. Generates a fresh Ed25519 keypair via `llmtxt/identity` (runtime only, never persisted).
2. Registers the public key with the API (`POST /api/v1/agents/keys`).
3. Creates a document (or adopts an existing one via `--slug`).
4. Writes the specified section content with a signed `PUT /api/v1/documents/:slug/sections/:id`.
5. Submits a version snapshot.
6. Transitions the document to `REVIEW` state.

## Prerequisites

- Node.js >= 22
- An LLMtxt API key from https://llmtxt.my/settings

## Setup

```bash
cp .env.example .env
# Edit .env and set LLMTXT_API_KEY

npm install
```

## Run

```bash
# Create a new document and write a section to it
node index.js --section-id introduction --content "# Introduction

This section was written by writer-agent."

# Write to an existing document
node index.js --slug my-existing-doc --section-id summary --content "Summary text."
```

## Expected output

```
[writer-agent] Generating Ed25519 identity...
[writer-agent] Agent ID : writer-agent-a1b2c3d4
[writer-agent] Pubkey   : a1b2c3d4e5f60718...
[writer-agent] Registering pubkey...
[writer-agent] Pubkey registered (or already known).
[writer-agent] No --slug provided; creating new document...
[writer-agent] Created document: aBcDeFg1
[writer-agent] Writing section "introduction"...
[writer-agent] Section "introduction" written (signed PUT).
[writer-agent] Submitting version...
[writer-agent] Version submitted: 1
[writer-agent] Transitioning document to REVIEW...
[writer-agent] Document is now in REVIEW state.

[writer-agent] === Summary ===
  Document  : https://api.llmtxt.my/api/v1/documents/aBcDeFg1
  Section   : introduction
  Agent ID  : writer-agent-a1b2c3d4
  Pubkey    : a1b2c3d4e5f60718...
  All writes signed with Ed25519 (32 byte key)
```

## Key SDK imports

| Import | Purpose |
|--------|---------|
| `createIdentity` from `llmtxt/identity` | Generate Ed25519 keypair |
| `identity.buildSignatureHeaders(...)` | Build X-Agent-* request signing headers |
| `identity.pubkeyHex` | Public key for registration |

## CLI options

| Flag | Short | Description |
|------|-------|-------------|
| `--slug` | `-s` | Document slug (creates new doc if omitted) |
| `--section-id` | `-i` | Section ID to write (default: `main`) |
| `--content` | `-c` | Text content for the section |
| `--help` | `-h` | Show help |
