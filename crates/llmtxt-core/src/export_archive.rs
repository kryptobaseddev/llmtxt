//! Export archive primitives for GDPR data portability (T094).
//!
//! This module defines the canonical [`ExportArchive`] schema and two pure
//! functions:
//!
//! * [`serialize_export_archive`] — produce a deterministic, versioned JSON
//!   representation of a user export archive.  The output is byte-identical
//!   across every platform (native Rust, WASM) for the same input.
//!
//! * [`deserialize_export_archive`] — parse the JSON representation back into
//!   an [`ExportArchive`] and verify the embedded [`ExportArchive::content_hash`]
//!   field so consumers can detect tampering or truncation.
//!
//! # Versioning
//!
//! The `archive_version` field MUST be incremented whenever the schema changes
//! in a backwards-incompatible way.  Deserializers SHOULD reject archives whose
//! `archive_version` is greater than the version they understand.
//!
//! # Security
//!
//! The `content_hash` is the SHA-256 hex digest of the canonical payload bytes
//! (the UTF-8 serialisation of the archive with `content_hash` set to an empty
//! string placeholder).  This means the hash covers all user data, preventing
//! partial-data delivery without detection.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

/// Current archive format version.
pub const ARCHIVE_VERSION: u32 = 1;

// ── Schema ──────────────────────────────────────────────────────────────────

/// Canonical schema for a GDPR user-data export archive (T094).
///
/// All fields are serialised deterministically: `serde_json` with the default
/// feature set preserves insertion order for struct fields, so the output is
/// byte-identical on every platform for the same `ExportArchive` value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportArchive {
    /// Format version.  Consumers MUST reject archives with a higher version.
    pub archive_version: u32,

    /// ISO 8601 timestamp at which the archive was generated (e.g.
    /// `"2026-04-18T00:00:00Z"`).  Injected by the backend at export time.
    pub exported_at: String,

    // ── User profile ──────────────────────────────────────────────────────
    /// Internal user ID (opaque string).
    pub user_id: String,
    /// Display name (may be empty for anonymous users).
    pub user_name: String,
    /// Email address.  Empty string for anonymous / email-less accounts.
    pub user_email: String,
    /// ISO 8601 account creation timestamp.
    pub user_created_at: String,

    // ── Documents ─────────────────────────────────────────────────────────
    /// All documents owned by the user at export time.
    pub documents: Vec<ExportDocument>,

    // ── API keys ─────────────────────────────────────────────────────────
    /// SHA-256 hashes of all API keys (raw key values are never stored).
    pub api_key_hashes: Vec<ExportApiKey>,

    // ── Audit log ────────────────────────────────────────────────────────
    /// The user's audit-log slice (actions performed by or on their behalf).
    /// Entries are pseudonymised — no raw IP addresses are included.
    pub audit_log: Vec<ExportAuditEntry>,

    // ── Webhooks ─────────────────────────────────────────────────────────
    /// Webhook registrations owned by the user.  Signing secrets are NOT
    /// exported for security reasons.
    pub webhooks: Vec<ExportWebhook>,

    // ── Integrity ────────────────────────────────────────────────────────
    /// SHA-256 hex digest of the canonical archive bytes (computed with this
    /// field set to `""`).  Verified by [`deserialize_export_archive`].
    pub content_hash: String,
}

/// A single owned document in the export archive.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocument {
    /// Internal document ID.
    pub id: String,
    /// Short URL slug (8 chars).
    pub slug: String,
    /// Document title / first heading.
    pub title: Option<String>,
    /// Lifecycle state at export time: `DRAFT | REVIEW | LOCKED | ARCHIVED`.
    pub state: String,
    /// Document format: `json | text | markdown`.
    pub format: String,
    /// ISO 8601 creation timestamp.
    pub created_at: String,
    /// ISO 8601 last-updated timestamp.
    pub updated_at: Option<String>,
    /// Current document content (UTF-8 text; decompressed inline).
    pub content: String,
    /// All version snapshots.
    pub versions: Vec<ExportVersion>,
}

/// A single version snapshot in the export archive.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportVersion {
    /// Monotonically increasing version number (starts at 0).
    pub version_number: u32,
    /// SHA-256 hex of the uncompressed content at this version.
    pub content_hash: String,
    /// ISO 8601 creation timestamp.
    pub created_at: String,
    /// Agent / user that authored this version.
    pub created_by: Option<String>,
    /// Human-readable changelog entry for this version.
    pub changelog: Option<String>,
}

/// An API key entry — raw key values are never exported, only metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportApiKey {
    /// Internal API key ID.
    pub id: String,
    /// Human-readable key name (e.g. `"CI Bot"`).
    pub name: String,
    /// Display prefix visible in the dashboard (e.g. `"llmtxt_abcd1234"`).
    pub key_prefix: String,
    /// SHA-256 hex digest of the raw key.  Allows users to identify keys.
    pub key_hash: String,
    /// ISO 8601 creation timestamp.
    pub created_at: String,
    /// ISO 8601 expiry timestamp, or `null` for no-expiry keys.
    pub expires_at: Option<String>,
    /// Whether the key was revoked at export time.
    pub revoked: bool,
}

/// A single audit log entry in the export archive.
///
/// IP addresses are NOT included to minimise personal data in the export.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportAuditEntry {
    /// Opaque audit log entry ID.
    pub id: String,
    /// Structured action name (e.g. `"document.create"`).
    pub action: String,
    /// Resource type (e.g. `"document"`).
    pub resource_type: String,
    /// Resource ID/slug.
    pub resource_id: Option<String>,
    /// Unix millisecond timestamp.
    pub timestamp: i64,
}

/// A webhook registration in the export archive.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportWebhook {
    /// Internal webhook ID.
    pub id: String,
    /// Target callback URL.
    pub url: String,
    /// JSON array of subscribed event types (e.g. `["version.created"]`).
    pub events: String,
    /// Optional document slug scope (`null` = all documents).
    pub document_slug: Option<String>,
    /// Whether the webhook is active at export time.
    pub active: bool,
    /// ISO 8601 creation timestamp.
    pub created_at: String,
}

// ── Serialisation ────────────────────────────────────────────────────────────

/// Compute the content hash of an [`ExportArchive`].
///
/// The hash covers the canonical JSON bytes with `content_hash` set to `""`
/// (empty string), so the hash field itself is not part of the payload.
fn compute_content_hash(archive: &ExportArchive) -> String {
    let mut scratch = archive.clone();
    scratch.content_hash = String::new();
    // serde_json produces deterministic output for structs (field order = declaration order).
    #[allow(clippy::expect_used)]
    let canonical = serde_json::to_vec(&scratch)
        .expect("ExportArchive serialisation must not fail — no unbounded types");
    let mut hasher = Sha256::new();
    hasher.update(&canonical);
    hex::encode(hasher.finalize())
}

/// Serialise an [`ExportArchive`] to a JSON string.
///
/// Computes and embeds the `content_hash` before serialisation, so the
/// returned JSON string contains a valid integrity field.
///
/// # Panics
///
/// Never panics — all types in [`ExportArchive`] are serialisable.
///
/// # WASM
///
/// Exposed as `serialize_export_archive(json: String) -> String` via
/// `wasm_bindgen`.  The input JSON is first deserialised into an
/// [`ExportArchive`] (so the hash is recomputed from the actual data),
/// then re-serialised with the hash embedded.
pub fn serialize_export_archive(archive: &ExportArchive) -> String {
    let mut stamped = archive.clone();
    stamped.content_hash = compute_content_hash(archive);
    #[allow(clippy::expect_used)]
    serde_json::to_string(&stamped).expect("ExportArchive serialisation must not fail")
}

/// Deserialise an [`ExportArchive`] from a JSON string and verify its integrity.
///
/// Returns `Err(String)` if:
/// - The JSON is malformed.
/// - The `archive_version` is greater than [`ARCHIVE_VERSION`].
/// - The `content_hash` does not match the recomputed hash.
pub fn deserialize_export_archive(json: &str) -> Result<ExportArchive, String> {
    let archive: ExportArchive = serde_json::from_str(json)
        .map_err(|e| format!("deserialize_export_archive: JSON parse error: {e}"))?;

    if archive.archive_version > ARCHIVE_VERSION {
        return Err(format!(
            "deserialize_export_archive: unsupported archive_version {}; max supported: {}",
            archive.archive_version, ARCHIVE_VERSION
        ));
    }

    let expected_hash = compute_content_hash(&archive);
    if archive.content_hash != expected_hash {
        return Err(format!(
            "deserialize_export_archive: content_hash mismatch — \
             expected {expected_hash}, got {}",
            archive.content_hash
        ));
    }

    Ok(archive)
}

// ── WASM shims ───────────────────────────────────────────────────────────────

/// WASM binding for [`serialize_export_archive`].
///
/// Accepts a JSON string representing an [`ExportArchive`] *without*
/// a valid `content_hash`, computes the hash, and returns the JSON
/// string with the hash embedded.
///
/// Returns `{"error":"..."}` on parse failure.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn serialize_export_archive_wasm(archive_json: &str) -> String {
    let archive: ExportArchive = match serde_json::from_str(archive_json) {
        Ok(a) => a,
        Err(e) => {
            return format!(r#"{{"error":"serialize_export_archive_wasm parse error: {e}"}}"#);
        }
    };
    serialize_export_archive(&archive)
}

/// WASM binding for [`deserialize_export_archive`].
///
/// Returns the verified archive JSON on success, or `{"error":"..."}` on
/// any failure (parse error, version mismatch, hash mismatch).
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn deserialize_export_archive_wasm(archive_json: &str) -> String {
    match deserialize_export_archive(archive_json) {
        Ok(archive) => serde_json::to_string(&archive)
            .unwrap_or_else(|e| format!(r#"{{"error":"re-serialise failed: {e}"}}"#)),
        Err(e) => format!(r#"{{"error":{}}}"#, serde_json::json!(e)),
    }
}

// ── Retention policy DSL ─────────────────────────────────────────────────────

/// Retention policy configuration (T186).
///
/// Describes per-resource-type retention windows in days.  A value of `0`
/// means "retain indefinitely".  The backend enforces these policies via a
/// nightly background job.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RetentionPolicy {
    /// Policy format version (incremented on incompatible schema changes).
    pub policy_version: u32,
    /// Audit log entries: days to retain in the hot database.
    /// Entries older than this are moved to cold archive (S3).
    /// 0 = keep forever in hot DB.
    pub audit_log_hot_days: u32,
    /// Audit log entries: total retention in days (hot + cold combined).
    /// 0 = keep forever.  MUST be >= `audit_log_hot_days`.
    pub audit_log_total_days: u32,
    /// Soft-deleted documents: days before hard deletion.
    /// 0 = hard-delete immediately (not recommended).
    pub soft_deleted_docs_days: u32,
    /// Expired (anonymous) document TTL in days.
    /// 0 = purge immediately when `expires_at` passes.
    pub anonymous_doc_days: u32,
    /// Expired API keys: days before hard purge of revoked rows.
    /// 0 = purge immediately.
    pub revoked_api_key_days: u32,
    /// Agent inbox messages: days before hard purge.
    pub agent_inbox_days: u32,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            policy_version: 1,
            // Audit: 90 days hot, 7 years total (2555 days ≈ 7 * 365).
            audit_log_hot_days: 90,
            audit_log_total_days: 2555,
            // Soft-deleted documents: 30-day grace period (T187).
            soft_deleted_docs_days: 30,
            // Anonymous docs: purge 1 day after expiry.
            anonymous_doc_days: 1,
            // Revoked API keys: keep 90 days for audit reference.
            revoked_api_key_days: 90,
            // Agent inbox: 2-day TTL (matches schema).
            agent_inbox_days: 2,
        }
    }
}

/// Serialise a [`RetentionPolicy`] to a JSON string.
pub fn serialize_retention_policy(policy: &RetentionPolicy) -> String {
    #[allow(clippy::expect_used)]
    serde_json::to_string(policy).expect("RetentionPolicy serialisation must not fail")
}

/// Deserialise a [`RetentionPolicy`] from a JSON string.
pub fn deserialize_retention_policy(json: &str) -> Result<RetentionPolicy, String> {
    serde_json::from_str(json).map_err(|e| format!("deserialize_retention_policy: {e}"))
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_archive() -> ExportArchive {
        ExportArchive {
            archive_version: ARCHIVE_VERSION,
            exported_at: "2026-04-18T00:00:00Z".to_string(),
            user_id: "usr_test".to_string(),
            user_name: "Test User".to_string(),
            user_email: "test@example.com".to_string(),
            user_created_at: "2026-01-01T00:00:00Z".to_string(),
            documents: vec![ExportDocument {
                id: "doc_1".to_string(),
                slug: "abcd1234".to_string(),
                title: Some("My Document".to_string()),
                state: "DRAFT".to_string(),
                format: "markdown".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: Some("2026-01-02T00:00:00Z".to_string()),
                content: "# My Document\n\nHello world.".to_string(),
                versions: vec![ExportVersion {
                    version_number: 0,
                    content_hash: "abc123".to_string(),
                    created_at: "2026-01-01T00:00:00Z".to_string(),
                    created_by: Some("agent_1".to_string()),
                    changelog: None,
                }],
            }],
            api_key_hashes: vec![ExportApiKey {
                id: "key_1".to_string(),
                name: "CI Bot".to_string(),
                key_prefix: "llmtxt_abc".to_string(),
                key_hash: "deadbeef".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
                expires_at: None,
                revoked: false,
            }],
            audit_log: vec![ExportAuditEntry {
                id: "evt_1".to_string(),
                action: "document.create".to_string(),
                resource_type: "document".to_string(),
                resource_id: Some("abcd1234".to_string()),
                timestamp: 1_700_000_000_000,
            }],
            webhooks: vec![ExportWebhook {
                id: "wh_1".to_string(),
                url: "https://example.com/hook".to_string(),
                events: r#"["version.created"]"#.to_string(),
                document_slug: None,
                active: true,
                created_at: "2026-01-01T00:00:00Z".to_string(),
            }],
            content_hash: String::new(), // will be filled by serialize
        }
    }

    #[test]
    fn test_serialize_sets_content_hash() {
        let archive = sample_archive();
        let json = serialize_export_archive(&archive);
        let parsed: ExportArchive = serde_json::from_str(&json).unwrap();
        assert!(
            !parsed.content_hash.is_empty(),
            "content_hash should be set"
        );
        assert_eq!(parsed.content_hash.len(), 64, "SHA-256 hex is 64 chars");
    }

    #[test]
    fn test_deserialize_verifies_hash() {
        let json = serialize_export_archive(&sample_archive());
        let result = deserialize_export_archive(&json);
        assert!(
            result.is_ok(),
            "valid archive should deserialise: {:?}",
            result
        );
    }

    #[test]
    fn test_tampered_archive_rejected() {
        let json = serialize_export_archive(&sample_archive());
        // Tamper: replace a character in the content field.
        let tampered = json.replace("Hello world.", "Hello tamper.");
        let result = deserialize_export_archive(&tampered);
        assert!(result.is_err(), "tampered archive must be rejected");
        assert!(
            result.unwrap_err().contains("content_hash mismatch"),
            "error should mention hash mismatch"
        );
    }

    #[test]
    fn test_roundtrip_byte_identical() {
        let archive = sample_archive();
        let json1 = serialize_export_archive(&archive);
        // Deserialise then re-serialise — must be byte-identical.
        let recovered = deserialize_export_archive(&json1).unwrap();
        let json2 = serialize_export_archive(&recovered);
        assert_eq!(json1, json2, "round-trip must be byte-identical");
    }

    #[test]
    fn test_unsupported_version_rejected() {
        let mut archive = sample_archive();
        archive.archive_version = ARCHIVE_VERSION + 1;
        archive.content_hash = String::new();
        // Manually compute hash so the hash check doesn't trip first.
        let hash = {
            let canonical = serde_json::to_vec(&archive).unwrap();
            let mut hasher = sha2::Sha256::new();
            hasher.update(&canonical);
            hex::encode(hasher.finalize())
        };
        archive.content_hash = hash;
        let json = serde_json::to_string(&archive).unwrap();
        let result = deserialize_export_archive(&json);
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("unsupported archive_version"),
            "error should mention unsupported version"
        );
    }

    #[test]
    fn test_retention_policy_default_roundtrip() {
        let policy = RetentionPolicy::default();
        let json = serialize_retention_policy(&policy);
        let recovered = deserialize_retention_policy(&json).unwrap();
        assert_eq!(policy, recovered);
    }

    #[test]
    fn test_retention_policy_defaults() {
        let p = RetentionPolicy::default();
        assert_eq!(p.audit_log_hot_days, 90);
        assert_eq!(p.audit_log_total_days, 2555);
        assert_eq!(p.soft_deleted_docs_days, 30);
        assert_eq!(p.agent_inbox_days, 2);
    }
}
