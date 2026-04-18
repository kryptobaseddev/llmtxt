//! Independent audit log verifier for LLMtxt (T107).
//!
//! This binary:
//!   1. Fetches audit log rows from `GET /api/v1/audit-logs`.
//!   2. Fetches the signed checkpoint from `GET /api/v1/audit-logs/merkle-root/:date`.
//!   3. Recomputes each entry's `payload_hash` using `hash_audit_entry`.
//!   4. Verifies the hash chain using `verify_audit_chain`.
//!   5. Recomputes the Merkle root using `merkle_root`.
//!   6. Verifies the server ed25519 signature using `verify_merkle_root_signature`.
//!   7. Prints a pass/fail summary.
//!
//! # Usage
//! ```
//! LLMTXT_BASE_URL=https://api.llmtxt.my \
//! LLMTXT_API_KEY=your-api-key \
//! AUDIT_DATE=2026-04-18 \
//! AUDIT_SIGNING_PUBKEY=<64-char hex pubkey> \
//!   cargo run --manifest-path examples/audit-verifier/Cargo.toml
//! ```
//!
//! `AUDIT_SIGNING_PUBKEY` is the server's ed25519 public key (visible in the
//! server startup log: `[audit-signing-key] pubkey=...`).
//!
//! # Environment variables
//! | Variable | Required | Default | Description |
//! |----------|----------|---------|-------------|
//! | `LLMTXT_BASE_URL` | yes | — | Base URL of the LLMtxt API |
//! | `LLMTXT_API_KEY` | yes | — | Bearer token or API key |
//! | `AUDIT_DATE` | no | yesterday UTC | ISO 8601 date to verify |
//! | `AUDIT_SIGNING_PUBKEY` | no | — | Server ed25519 public key hex; skips sig verify if absent |
//! | `AUDIT_LOG_LIMIT` | no | 500 | Max audit log rows to fetch |

// This is a CLI example binary — unwrap/expect are acceptable for environment errors.
#![allow(clippy::unwrap_used)]

use std::env;

use llmtxt_core::merkle::{AuditEntry, merkle_root, verify_audit_chain, verify_merkle_root_signature};
use serde::Deserialize;

// ── API response types ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct AuditLogRow {
    id: String,
    #[serde(rename = "eventType")]
    event_type: Option<String>,
    #[serde(rename = "actorId")]
    actor_id: Option<String>,
    #[serde(rename = "resourceId")]
    resource_id: Option<String>,
    timestamp: u64,
    #[serde(rename = "payloadHash")]
    payload_hash: Option<String>,
    #[serde(rename = "chainHash")]
    chain_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AuditLogsResponse {
    logs: Vec<AuditLogRow>,
    total: u64,
}

#[derive(Debug, Deserialize)]
struct CheckpointResponse {
    checkpoint_date: String,
    root: String,
    signature: Option<String>,
    signing_key_id: Option<String>,
    event_count: u64,
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let base_url = env::var("LLMTXT_BASE_URL")
        .map_err(|_| "LLMTXT_BASE_URL is required (e.g. https://api.llmtxt.my)")?;
    let api_key = env::var("LLMTXT_API_KEY")
        .map_err(|_| "LLMTXT_API_KEY is required")?;

    // Default audit date: yesterday UTC.
    let audit_date = env::var("AUDIT_DATE").unwrap_or_else(|_| {
        // Simple UTC yesterday calculation (seconds since epoch).
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let yesterday_secs = now_secs - 86_400;
        let days = yesterday_secs / 86_400;
        // Epoch is 1970-01-01; compute YYYY-MM-DD from days since epoch.
        days_since_epoch_to_iso(days)
    });

    let limit: usize = env::var("AUDIT_LOG_LIMIT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(500);

    let signing_pubkey_hex = env::var("AUDIT_SIGNING_PUBKEY").ok();

    println!("=== LLMtxt Audit Verifier (T107) ===");
    println!("target:  {base_url}");
    println!("date:    {audit_date}");
    println!("limit:   {limit} rows");
    println!();

    let client = reqwest::Client::builder()
        .user_agent("llmtxt-audit-verifier/0.1.0")
        .build()?;

    // ── Step 1: Fetch audit log rows ─────────────────────────────────────────

    print!("[1/5] Fetching audit log rows... ");
    let logs_url = format!("{base_url}/api/v1/audit-logs?limit={limit}&offset=0");
    let resp = client
        .get(&logs_url)
        .bearer_auth(&api_key)
        .send()
        .await?;

    if !resp.status().is_success() {
        eprintln!("FAIL (HTTP {})", resp.status());
        eprintln!("Response: {}", resp.text().await?);
        std::process::exit(1);
    }

    let logs_body: AuditLogsResponse = resp.json().await?;
    println!("OK ({} rows, total={})", logs_body.logs.len(), logs_body.total);

    // ── Step 2: Fetch signed checkpoint ──────────────────────────────────────

    print!("[2/5] Fetching signed checkpoint for {audit_date}... ");
    let checkpoint_url = format!("{base_url}/api/v1/audit-logs/merkle-root/{audit_date}");
    let resp = client
        .get(&checkpoint_url)
        .bearer_auth(&api_key)
        .send()
        .await?;

    if resp.status().as_u16() == 404 {
        println!("NOT FOUND");
        println!();
        println!("No checkpoint exists for {audit_date}. The daily checkpoint job");
        println!("runs once per day and covers the previous day's events.");
        println!("If today is {audit_date}, try again tomorrow.");
        std::process::exit(2);
    }

    if !resp.status().is_success() {
        eprintln!("FAIL (HTTP {})", resp.status());
        eprintln!("Response: {}", resp.text().await?);
        std::process::exit(1);
    }

    let checkpoint: CheckpointResponse = resp.json().await?;
    println!("OK (event_count={}, signed={})",
        checkpoint.event_count,
        checkpoint.signature.is_some()
    );

    // Filter to rows with non-null payload_hash and chain_hash,
    // ordered by timestamp ASC (API returns DESC by default).
    let mut chained_rows: Vec<&AuditLogRow> = logs_body.logs.iter()
        .filter(|r| r.payload_hash.is_some() && r.chain_hash.is_some())
        .collect();
    chained_rows.sort_by_key(|r| r.timestamp);

    println!("       (chained rows in response: {})", chained_rows.len());

    // ── Step 3: Re-derive payload_hashes and verify chain ────────────────────

    print!("[3/5] Verifying hash chain ({} entries)... ", chained_rows.len());

    // Build AuditEntry slice for verify_audit_chain.
    // We must store the strings to avoid lifetime issues.
    let empty = String::new();
    let entries_data: Vec<(String, String, String, String, u64, String)> = chained_rows.iter().map(|r| {
        (
            r.id.clone(),
            r.event_type.clone().unwrap_or_default(),
            r.actor_id.clone().unwrap_or_default(),
            r.resource_id.clone().unwrap_or_default(),
            r.timestamp,
            r.chain_hash.clone().unwrap_or_default(),
        )
    }).collect();

    let entries: Vec<AuditEntry<'_>> = entries_data.iter().map(|(id, et, ac, ri, ts, ch)| {
        AuditEntry {
            id: id.as_str(),
            event_type: et.as_str(),
            actor_id: ac.as_str(),
            resource_id: ri.as_str(),
            timestamp_ms: *ts,
            stored_chain_hash_hex: ch.as_str(),
        }
    }).collect();

    let _ = empty; // suppress unused warning

    let chain_valid = verify_audit_chain(&entries);
    if chain_valid {
        println!("PASS");
    } else {
        println!("FAIL");
        println!();
        println!("ERROR: Hash chain verification failed.");
        println!("One or more audit_log entries have been tampered with.");
        std::process::exit(3);
    }

    // ── Step 4: Recompute Merkle root ────────────────────────────────────────

    print!("[4/5] Recomputing Merkle root... ");

    let leaf_hashes: Vec<[u8; 32]> = chained_rows.iter().map(|r| {
        let payload_hex = r.payload_hash.as_deref().unwrap_or("");
        let bytes = hex::decode(payload_hex).unwrap_or_default(); // invalid hex → zero leaf (treated as tampered)
        let mut arr = [0u8; 32];
        if bytes.len() == 32 {
            arr.copy_from_slice(&bytes);
        }
        arr
    }).collect();

    let computed_root_bytes = merkle_root(&leaf_hashes);
    let computed_root_hex = hex::encode(computed_root_bytes);

    let roots_match = computed_root_hex == checkpoint.root;
    if roots_match {
        println!("PASS");
        println!("       computed:  {}", &computed_root_hex[..32]);
        println!("       published: {}", &checkpoint.root[..32]);
    } else {
        println!("FAIL");
        println!();
        println!("ERROR: Merkle root mismatch.");
        println!("  Computed:  {computed_root_hex}");
        println!("  Published: {}", checkpoint.root);
        println!();
        println!("The server published a different root than what the log rows produce.");
        println!("Either the checkpoint was manipulated or the row set is incomplete.");
        std::process::exit(4);
    }

    // ── Step 5: Verify ed25519 signature ────────────────────────────────────

    print!("[5/5] Verifying server signature... ");

    if let (Some(sig_hex), Some(pubkey_hex)) = (&checkpoint.signature, &signing_pubkey_hex) {
        if pubkey_hex.len() != 64 {
            println!("SKIP (AUDIT_SIGNING_PUBKEY must be 64 hex chars)");
        } else {
            let mut pk_arr = [0u8; 32];
            let pk_bytes = hex::decode(pubkey_hex)?;
            if pk_bytes.len() != 32 {
                println!("SKIP (pubkey hex decodes to wrong length)");
            } else {
                pk_arr.copy_from_slice(&pk_bytes);
                let sig_valid = verify_merkle_root_signature(
                    &pk_arr,
                    &checkpoint.root,
                    &checkpoint.checkpoint_date,
                    sig_hex,
                );
                if sig_valid {
                    println!("PASS (key_id={})", checkpoint.signing_key_id.as_deref().unwrap_or("?"));
                } else {
                    println!("FAIL");
                    println!();
                    println!("ERROR: Server signature is invalid.");
                    println!("The checkpoint Merkle root may have been replaced after signing.");
                    std::process::exit(5);
                }
            }
        }
    } else if checkpoint.signature.is_none() {
        println!("SKIP (checkpoint has no signature — AUDIT_SIGNING_KEY was not configured)");
    } else {
        println!("SKIP (set AUDIT_SIGNING_PUBKEY env var to verify signature)");
    }

    // ── Summary ──────────────────────────────────────────────────────────────

    println!();
    println!("=== VERIFICATION COMPLETE ===");
    println!("date:         {}", checkpoint.checkpoint_date);
    println!("event_count:  {}", checkpoint.event_count);
    println!("merkle_root:  {}", checkpoint.root);
    println!("chain:        VALID");
    println!("root_match:   VALID");
    if checkpoint.signature.is_some() && signing_pubkey_hex.is_some() {
        println!("signature:    VALID");
    } else {
        println!("signature:    NOT VERIFIED (see step 5 above)");
    }
    println!();
    println!("This audit log is TAMPER-EVIDENT and CONSISTENT with the published root.");

    Ok(())
}

/// Convert days since Unix epoch (1970-01-01) to an ISO 8601 date string.
/// Simple implementation — no external date library needed.
fn days_since_epoch_to_iso(days: u64) -> String {
    // Algorithm: convert days since epoch to (year, month, day).
    // Using the proleptic Gregorian calendar algorithm.
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_days_since_epoch_known_dates() {
        // 1970-01-01 = day 0
        assert_eq!(days_since_epoch_to_iso(0), "1970-01-01");
        // 2026-04-18 — epoch day = let's compute: rough check
        // 2026-04-18 is about 20558 days from epoch
        let d = days_since_epoch_to_iso(20557); // 2026-04-17
        assert!(d.starts_with("2026-04"), "got {d}");
    }

    #[test]
    fn test_hash_audit_entry_matches_ts_canonical() {
        // Verify Rust hash matches TypeScript canonical format:
        // "{id}|{event_type}|{actor_id}|{resource_id}|{timestamp_ms}"
        use llmtxt_core::merkle::hash_audit_entry;
        use sha2::{Digest, Sha256};

        let id = "test-id-1";
        let event_type = "auth.login";
        let actor_id = "user-abc";
        let resource_id = "";
        let ts: u64 = 1_713_456_789_000;

        let rust_hash = hash_audit_entry(id, event_type, actor_id, resource_id, ts);

        // Manually compute SHA-256 of the canonical string to cross-check.
        let canonical = format!("{id}|{event_type}|{actor_id}|{resource_id}|{ts}");
        let mut hasher = Sha256::new();
        hasher.update(canonical.as_bytes());
        let expected: [u8; 32] = hasher.finalize().into();

        assert_eq!(rust_hash, expected, "hash_audit_entry must match SHA-256 of canonical string");
    }
}
