# audit-verifier

Independent audit log verifier for LLMtxt (T107).

This binary independently verifies the tamper-evident audit log without trusting
the server. It uses the same cryptographic primitives as the server (from
`crates/llmtxt-core`) to recompute all hashes from scratch.

## What it verifies

1. **Hash chain integrity** — re-derives every `chain_hash` from the genesis sentinel
   forward and detects any tampered or missing row.
2. **Merkle root consistency** — recomputes the daily Merkle root from `payload_hash`
   values and compares against the published checkpoint.
3. **Server signature** — verifies the server's ed25519 signature on the Merkle root
   using the server's public key (optionally supplied).

## Usage

```bash
LLMTXT_BASE_URL=https://api.llmtxt.my \
LLMTXT_API_KEY=<your-api-key> \
AUDIT_DATE=2026-04-18 \
AUDIT_SIGNING_PUBKEY=<64-char-hex-pubkey> \
  cargo run --manifest-path examples/audit-verifier/Cargo.toml
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLMTXT_BASE_URL` | yes | — | Base URL of the LLMtxt API |
| `LLMTXT_API_KEY` | yes | — | Bearer token or API key |
| `AUDIT_DATE` | no | yesterday UTC | ISO 8601 date to verify |
| `AUDIT_SIGNING_PUBKEY` | no | — | Server ed25519 public key hex |
| `AUDIT_LOG_LIMIT` | no | 500 | Max audit log rows to fetch |

## Getting the server public key

The server logs its audit signing public key at startup:

```
[audit-signing-key] pubkey=<64-char-hex> key_id=<16-char-hex>
```

Set `AUDIT_SIGNING_PUBKEY` to the `pubkey=` value to enable signature verification.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | All checks passed |
| 1 | API request failed |
| 2 | No checkpoint for the requested date |
| 3 | Hash chain verification failed (tamper detected) |
| 4 | Merkle root mismatch (checkpoint may be manipulated) |
| 5 | Server signature invalid |
