# T765 Reference Agent Examples

**Date**: 2026-04-19
**Commit**: 058e5a82e0a8401abfde6338d2412588e35c8505
**Tasks**: T772 (done), T773 (done), T774 (done), T775 (done)

## Deliverables

Three standalone reference agents shipped under `examples/`:

### examples/writer-agent/

- `index.js` — 152 lines; uses `llmtxt/identity` (createIdentity), signed PUT, version submit, REVIEW transition
- `package.json` — `llmtxt@^2026.4.10` dep, ESM, node>=22
- `README.md` — usage, expected output, CLI options table, SDK imports table
- `.env.example` — LLMTXT_API_KEY + LLMTXT_API_BASE

**Key patterns demonstrated:**
- `createIdentity()` for ephemeral Ed25519 keypair (runtime-only, never persisted)
- `identity.buildSignatureHeaders(method, path, body, agentId)` for X-Agent-* headers
- POST /api/v1/agents/keys for pubkey registration (idempotent, 409 = ok)
- PUT /api/v1/documents/:slug/sections/:id with signed request
- POST /api/v1/documents/:slug/versions
- POST /api/v1/documents/:slug/transition

### examples/reviewer-agent/

- `index.js` — 198 lines; uses `llmtxt/identity` + `watchDocument` from `llmtxt`
- `rules.example.json` — declarative review rules file for `--review-rules`
- `package.json`, `README.md`, `.env.example`

**Key patterns demonstrated:**
- `watchDocument(API_BASE, SLUG, { apiKey, signal })` SSE async iterable
- Event categorisation: version_created / document.updated / version.published
- Scratchpad POST for structured review comments
- Signed A2A envelope to consensus-agent (from + to + nonce + ts + contentType + payload_hash)
- `--review-rules <file>` for loading declarative critique rules
- AbortController + setTimeout for graceful SSE timeout

### examples/observer-agent/

- `index.js` — 197 lines; uses `llmtxt/identity` + `watchDocument` + `subscribeSection` from `llmtxt/crdt`
- `package.json`, `README.md`, `.env.example`

**Key patterns demonstrated:**
- `subscribeSection(slug, sectionId, callback, { baseUrl, token, onError })` — loro-sync-v1 WebSocket
- SectionDelta: `{ text, updateBytes }` — live CRDT state without REST polling
- Event hash chain verification (client-side + server event log fetch)
- `--verify-mode strict` exits 1 on chain breaks; `lenient` warns only
- `--sections "intro,summary"` comma-separated CRDT subscription list
- Final report with SHA-256 section text hashes for convergence auditing

### examples/README.md

- Index linking to all 3 examples
- Dependency graph showing which subpath each agent uses
- Quick start: run all 3 together with ordered startup instructions
- Environment variable table
- Design decisions: ephemeral keys, subpath imports, single-file agents

## Evidence

- **implemented**: commit 058e5a82; files: examples/writer-agent/index.js, examples/reviewer-agent/index.js, examples/observer-agent/index.js, examples/README.md
- **testsPassed**: smoke-tested — `node index.js --help` exits 0 and prints full usage for all 3 agents
- **documented**: examples/writer-agent/README.md, examples/reviewer-agent/README.md, examples/observer-agent/README.md, examples/README.md

## Subpath imports used

| Subpath | Used by |
|---------|---------|
| `llmtxt/identity` | writer-agent, reviewer-agent, observer-agent |
| `llmtxt` (watchDocument) | reviewer-agent, observer-agent |
| `llmtxt/crdt` (subscribeSection) | observer-agent |

## Non-negotiables compliance

- All imports use subpaths (`llmtxt/identity`, `llmtxt/crdt`, `llmtxt`) — no bare `llmtxt` for identity
- Ed25519 keys generated at runtime via `createIdentity()` — never hardcoded, never persisted to disk
- 3 examples + 1 README only — no scope creep
- Each index.js is under 200 lines (152 / 198 / 197)
