//! Tier limit evaluation — Single Source of Truth for billing policy.
//!
//! All tier limits and the evaluation function live here. The TypeScript
//! backend imports these through the WASM binding so that limit values
//! are never duplicated across the codebase.
//!
//! # Design invariants
//! - `evaluate_tier_limits` is a pure function: no I/O, no global state.
//! - Same inputs always produce the same output.
//! - `None` in `TierLimits` means "no cap enforced" (Enterprise unlimited fields).

use serde::{Deserialize, Serialize};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

// ── Tier kinds ───────────────────────────────────────────────────────────────

/// The billing tier a user is subscribed to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TierKind {
    Free,
    Pro,
    Enterprise,
}

impl TierKind {
    /// Parse a string (case-insensitive) into a `TierKind`.
    /// Unknown strings default to `Free`.
    pub fn from_str(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "pro" => TierKind::Pro,
            "enterprise" => TierKind::Enterprise,
            _ => TierKind::Free,
        }
    }
}

// ── Limits ───────────────────────────────────────────────────────────────────

/// The maximum allowed values for a given tier.
/// `None` means "no cap" (unlimited).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierLimits {
    /// Maximum number of documents owned.
    pub max_documents: Option<u64>,
    /// Maximum bytes per single document (content size).
    pub max_doc_bytes: Option<u64>,
    /// Maximum API calls (all routes) per billing month.
    pub max_api_calls_per_month: Option<u64>,
    /// Maximum CRDT operations per billing month.
    pub max_crdt_ops_per_month: Option<u64>,
    /// Maximum registered agent seats.
    pub max_agent_seats: Option<u64>,
    /// Maximum total storage bytes.
    pub max_storage_bytes: Option<u64>,
}

/// Return the hard limits for a given tier.
///
/// This is the canonical source — all tier checks in the backend
/// call this function (via WASM or native) rather than defining
/// constants locally.
pub fn tier_limits(tier: TierKind) -> TierLimits {
    match tier {
        TierKind::Free => TierLimits {
            max_documents: Some(50),
            max_doc_bytes: Some(500 * 1024), // 500 KB
            max_api_calls_per_month: Some(1_000),
            max_crdt_ops_per_month: Some(500),
            max_agent_seats: Some(3),
            max_storage_bytes: Some(25 * 1024 * 1024), // 25 MB
        },
        TierKind::Pro => TierLimits {
            max_documents: Some(500),
            max_doc_bytes: Some(10 * 1024 * 1024), // 10 MB
            max_api_calls_per_month: Some(50_000),
            max_crdt_ops_per_month: Some(25_000),
            max_agent_seats: Some(25),
            max_storage_bytes: Some(5 * 1024 * 1024 * 1024), // 5 GB
        },
        TierKind::Enterprise => TierLimits {
            max_documents: None,
            max_doc_bytes: Some(100 * 1024 * 1024), // 100 MB per doc
            max_api_calls_per_month: None,
            max_crdt_ops_per_month: None,
            max_agent_seats: None,
            max_storage_bytes: None,
        },
    }
}

// ── Usage snapshot ───────────────────────────────────────────────────────────

/// A point-in-time snapshot of a user's resource consumption.
/// Collected by the backend and passed here for evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSnapshot {
    /// Total documents currently owned by the user.
    pub document_count: u64,
    /// API calls made in the current billing period.
    pub api_calls_this_month: u64,
    /// CRDT operations in the current billing period.
    pub crdt_ops_this_month: u64,
    /// Number of registered agent identities.
    pub agent_seat_count: u64,
    /// Total bytes stored across all documents and blobs.
    pub storage_bytes: u64,
    /// Bytes of the document being written (0 if not a write operation).
    pub current_doc_bytes: u64,
}

// ── Decision ─────────────────────────────────────────────────────────────────

/// Result of evaluating a usage snapshot against tier limits.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum TierDecision {
    /// The operation is within limits.
    Allowed,
    /// The operation exceeds a limit. The request MUST be rejected (HTTP 402).
    Blocked {
        /// Which limit was exceeded (matches field name in `TierLimits`).
        limit_type: String,
        /// Current usage value.
        current: u64,
        /// The maximum allowed value.
        limit: u64,
    },
}

// ── Evaluation ───────────────────────────────────────────────────────────────

/// Evaluate whether a usage snapshot is within the limits for a tier.
///
/// Returns `TierDecision::Allowed` when all limits are satisfied,
/// or `TierDecision::Blocked` for the first limit exceeded (checked in
/// priority order: documents → doc_bytes → api_calls → crdt_ops →
/// agent_seats → storage).
///
/// # Invariants
/// - Pure function — no I/O or global state.
/// - Deterministic — same inputs always yield the same output.
pub fn evaluate_tier_limits(usage: &UsageSnapshot, tier: TierKind) -> TierDecision {
    let limits = tier_limits(tier);

    // 1. Document count
    if let Some(max) = limits.max_documents {
        if usage.document_count >= max {
            return TierDecision::Blocked {
                limit_type: "max_documents".into(),
                current: usage.document_count,
                limit: max,
            };
        }
    }

    // 2. Per-document size (only meaningful for write events)
    if usage.current_doc_bytes > 0 {
        if let Some(max) = limits.max_doc_bytes {
            if usage.current_doc_bytes > max {
                return TierDecision::Blocked {
                    limit_type: "max_doc_bytes".into(),
                    current: usage.current_doc_bytes,
                    limit: max,
                };
            }
        }
    }

    // 3. Monthly API calls
    if let Some(max) = limits.max_api_calls_per_month {
        if usage.api_calls_this_month >= max {
            return TierDecision::Blocked {
                limit_type: "max_api_calls_per_month".into(),
                current: usage.api_calls_this_month,
                limit: max,
            };
        }
    }

    // 4. Monthly CRDT operations
    if let Some(max) = limits.max_crdt_ops_per_month {
        if usage.crdt_ops_this_month >= max {
            return TierDecision::Blocked {
                limit_type: "max_crdt_ops_per_month".into(),
                current: usage.crdt_ops_this_month,
                limit: max,
            };
        }
    }

    // 5. Agent seats
    if let Some(max) = limits.max_agent_seats {
        if usage.agent_seat_count >= max {
            return TierDecision::Blocked {
                limit_type: "max_agent_seats".into(),
                current: usage.agent_seat_count,
                limit: max,
            };
        }
    }

    // 6. Total storage
    if let Some(max) = limits.max_storage_bytes {
        if usage.storage_bytes >= max {
            return TierDecision::Blocked {
                limit_type: "max_storage_bytes".into(),
                current: usage.storage_bytes,
                limit: max,
            };
        }
    }

    TierDecision::Allowed
}

// ── WASM bindings ────────────────────────────────────────────────────────────

/// WASM binding: evaluate tier limits from JSON-serialised inputs.
///
/// `usage_json` — JSON of `UsageSnapshot`.
/// `tier_str` — `"free"` | `"pro"` | `"enterprise"` (case-insensitive).
///
/// Returns JSON of `TierDecision`, or `{"error":"..."}` on parse failure.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn evaluate_tier_limits_wasm(usage_json: &str, tier_str: &str) -> String {
    let usage: UsageSnapshot = match serde_json::from_str(usage_json) {
        Ok(u) => u,
        Err(e) => return format!(r#"{{"error":{}}}"#, serde_json::json!(e.to_string())),
    };
    let tier = TierKind::from_str(tier_str);
    let decision = evaluate_tier_limits(&usage, tier);
    match serde_json::to_string(&decision) {
        Ok(json) => json,
        Err(e) => format!(r#"{{"error":{}}}"#, serde_json::json!(e.to_string())),
    }
}

/// WASM binding: return tier limits as JSON.
///
/// `tier_str` — `"free"` | `"pro"` | `"enterprise"` (case-insensitive).
///
/// Returns JSON of `TierLimits`, or `{"error":"..."}` on serialization failure.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn get_tier_limits_wasm(tier_str: &str) -> String {
    let tier = TierKind::from_str(tier_str);
    let limits = tier_limits(tier);
    match serde_json::to_string(&limits) {
        Ok(json) => json,
        Err(e) => format!(r#"{{"error":{}}}"#, serde_json::json!(e.to_string())),
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn free_usage_under_limit() -> UsageSnapshot {
        UsageSnapshot {
            document_count: 10,
            api_calls_this_month: 100,
            crdt_ops_this_month: 50,
            agent_seat_count: 1,
            storage_bytes: 1024 * 1024, // 1 MB
            current_doc_bytes: 0,
        }
    }

    fn free_usage_at_doc_limit() -> UsageSnapshot {
        UsageSnapshot {
            document_count: 50,
            ..free_usage_under_limit()
        }
    }

    fn free_usage_at_api_limit() -> UsageSnapshot {
        UsageSnapshot {
            api_calls_this_month: 1_000,
            ..free_usage_under_limit()
        }
    }

    #[test]
    fn test_free_tier_under_limit_allowed() {
        let usage = free_usage_under_limit();
        let decision = evaluate_tier_limits(&usage, TierKind::Free);
        assert!(matches!(decision, TierDecision::Allowed));
    }

    #[test]
    fn test_free_tier_doc_limit_blocked() {
        let usage = free_usage_at_doc_limit();
        let decision = evaluate_tier_limits(&usage, TierKind::Free);
        match decision {
            TierDecision::Blocked {
                limit_type,
                current,
                limit,
            } => {
                assert_eq!(limit_type, "max_documents");
                assert_eq!(current, 50);
                assert_eq!(limit, 50);
            }
            _ => panic!("expected Blocked"),
        }
    }

    #[test]
    fn test_free_tier_api_limit_blocked() {
        let usage = free_usage_at_api_limit();
        let decision = evaluate_tier_limits(&usage, TierKind::Free);
        match decision {
            TierDecision::Blocked { limit_type, .. } => {
                assert_eq!(limit_type, "max_api_calls_per_month");
            }
            _ => panic!("expected Blocked"),
        }
    }

    #[test]
    fn test_pro_tier_allows_more() {
        let usage = UsageSnapshot {
            document_count: 200,
            api_calls_this_month: 30_000,
            crdt_ops_this_month: 10_000,
            agent_seat_count: 10,
            storage_bytes: 1024 * 1024 * 1024, // 1 GB — within Pro 5 GB
            current_doc_bytes: 0,
        };
        let decision = evaluate_tier_limits(&usage, TierKind::Pro);
        assert!(matches!(decision, TierDecision::Allowed));
    }

    #[test]
    fn test_enterprise_unlimited_allows_heavy_usage() {
        let usage = UsageSnapshot {
            document_count: 1_000_000,
            api_calls_this_month: 10_000_000,
            crdt_ops_this_month: 5_000_000,
            agent_seat_count: 10_000,
            storage_bytes: u64::MAX / 2,
            current_doc_bytes: 50 * 1024 * 1024, // 50 MB — under 100 MB cap
        };
        let decision = evaluate_tier_limits(&usage, TierKind::Enterprise);
        assert!(matches!(decision, TierDecision::Allowed));
    }

    #[test]
    fn test_enterprise_doc_byte_cap() {
        let usage = UsageSnapshot {
            current_doc_bytes: 200 * 1024 * 1024, // 200 MB — over 100 MB cap
            ..free_usage_under_limit()
        };
        let decision = evaluate_tier_limits(&usage, TierKind::Enterprise);
        match decision {
            TierDecision::Blocked { limit_type, .. } => {
                assert_eq!(limit_type, "max_doc_bytes");
            }
            _ => panic!("expected Blocked on enterprise doc byte cap"),
        }
    }

    #[test]
    fn test_tier_kind_parsing() {
        assert_eq!(TierKind::from_str("free"), TierKind::Free);
        assert_eq!(TierKind::from_str("pro"), TierKind::Pro);
        assert_eq!(TierKind::from_str("PRO"), TierKind::Pro);
        assert_eq!(TierKind::from_str("enterprise"), TierKind::Enterprise);
        assert_eq!(TierKind::from_str("unknown"), TierKind::Free);
        assert_eq!(TierKind::from_str(""), TierKind::Free);
    }

    #[test]
    fn test_wasm_binding_allowed() {
        let usage = serde_json::json!({
            "document_count": 5,
            "api_calls_this_month": 100,
            "crdt_ops_this_month": 10,
            "agent_seat_count": 1,
            "storage_bytes": 1024,
            "current_doc_bytes": 0
        });
        let result = evaluate_tier_limits_wasm(&usage.to_string(), "free");
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["status"], "allowed");
    }

    #[test]
    fn test_wasm_binding_blocked() {
        let usage = serde_json::json!({
            "document_count": 50,
            "api_calls_this_month": 100,
            "crdt_ops_this_month": 10,
            "agent_seat_count": 1,
            "storage_bytes": 1024,
            "current_doc_bytes": 0
        });
        let result = evaluate_tier_limits_wasm(&usage.to_string(), "free");
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["status"], "blocked");
        assert_eq!(parsed["limit_type"], "max_documents");
    }

    #[test]
    fn test_wasm_binding_invalid_json() {
        let result = evaluate_tier_limits_wasm("not-json", "free");
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert!(parsed["error"].is_string());
    }

    #[test]
    fn test_get_tier_limits_wasm() {
        let result = get_tier_limits_wasm("pro");
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["max_documents"], 500);
        assert_eq!(parsed["max_api_calls_per_month"], 50_000);
    }

    #[test]
    fn test_deterministic_same_inputs_same_output() {
        let usage = free_usage_at_doc_limit();
        let d1 = evaluate_tier_limits(&usage, TierKind::Free);
        let d2 = evaluate_tier_limits(&usage, TierKind::Free);
        // Both must serialize to the same JSON
        let j1 = serde_json::to_string(&d1).unwrap();
        let j2 = serde_json::to_string(&d2).unwrap();
        assert_eq!(j1, j2);
    }

    #[test]
    fn test_doc_write_blocked_by_byte_size_free() {
        let usage = UsageSnapshot {
            document_count: 5,
            api_calls_this_month: 100,
            crdt_ops_this_month: 10,
            agent_seat_count: 1,
            storage_bytes: 1024,
            current_doc_bytes: 600 * 1024, // 600 KB > 500 KB Free limit
        };
        let decision = evaluate_tier_limits(&usage, TierKind::Free);
        match decision {
            TierDecision::Blocked { limit_type, .. } => {
                assert_eq!(limit_type, "max_doc_bytes");
            }
            _ => panic!("expected Blocked"),
        }
    }
}
