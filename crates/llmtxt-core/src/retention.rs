/*!
 * Retention policy DSL — T168.2 (T614).
 *
 * Defines the [`RetentionPolicy`] struct and the [`apply_retention`] function
 * that computes an eviction set for a batch of timestamped rows.
 *
 * # Design
 *
 * A `RetentionPolicy` is applied to any table that holds time-stamped PII rows.
 * The caller supplies a slice of [`RetentionRow`] (id + timestamp_ms) and a
 * policy; the function returns the [`EvictionSet`] of row IDs that should be
 * evicted (pseudonymized or hard-deleted, depending on `action`).
 *
 * WASM bindings are provided via `retention_apply_wasm` — takes/returns JSON
 * so callers don't need to share Rust memory layouts.
 *
 * # Non-negotiables
 * - `exp_ts_ms == 0` means "never expires" — guard applied in `is_expired`.
 * - Audit log rows are NEVER hard-deleted; action must be `Pseudonymize`.
 * - `max_age_days == 0` means "no age-based eviction" (retain forever).
 */

use serde::{Deserialize, Serialize};

// ── Public types ─────────────────────────────────────────────────────────────

/// The lawful basis under GDPR Article 6 for processing this PII category.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LawfulBasis {
    /// Art. 6(1)(a) — data subject has given explicit consent.
    Consent,
    /// Art. 6(1)(b) — processing necessary for contract performance.
    ContractPerformance,
    /// Art. 6(1)(c) — processing necessary for compliance with legal obligation.
    LegalObligation,
    /// Art. 6(1)(f) — legitimate interests pursued by the controller.
    LegitimateInterests,
    /// Processing is exempt from deletion (e.g., anonymized analytics).
    Anonymous,
}

/// What the retention job does to rows that have aged out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RetentionAction {
    /// Replace PII fields with a pseudonym — row is kept; hash chain preserved.
    /// Required for audit_log rows (T164 non-negotiable).
    Pseudonymize,
    /// Permanently delete the row from the database.
    HardDelete,
    /// Move to cold/archive storage before (optional) hard delete.
    Archive,
}

/// Retention tier — controls the urgency and policy strictness.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RetentionTier {
    /// Sensitive PII that must be handled with highest priority (email, name, IP).
    Critical,
    /// Standard PII (agent IDs, user-generated content).
    Standard,
    /// Operational data with long retention windows (audit chains, certificates).
    Operational,
    /// Anonymous / aggregated data — no retention limit.
    Anonymous,
}

/// A single retention policy definition.
///
/// Policies are typically loaded from `docs/compliance/pii-inventory.md` at
/// server startup and applied nightly by the retention job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetentionPolicy {
    /// Human-readable name (e.g., `"audit_logs"`, `"sessions"`).
    pub name: String,
    /// Table name in the database.
    pub table: String,
    /// The PII category this policy governs.
    pub pii_category: String,
    /// Tier controls urgency of enforcement.
    pub tier: RetentionTier,
    /// Maximum age in days before a row is eligible for eviction.
    /// `0` = no age-based eviction (retain forever, e.g. anonymous data).
    pub max_age_days: u32,
    /// Lawful basis under GDPR Art. 6.
    pub lawful_basis: LawfulBasis,
    /// Action to take on eviction.
    pub action: RetentionAction,
    /// Optional: hard-delete after this many days in cold/archive storage.
    /// `None` = never hard-delete after archiving (legal hold semantics).
    pub archive_then_delete_after_days: Option<u32>,
}

/// A single row submitted for retention evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetentionRow {
    /// Opaque row identifier (UUID or custom ID string).
    pub id: String,
    /// Unix timestamp in milliseconds for when the row was created / last active.
    pub timestamp_ms: i64,
    /// Optional: if `true`, this row is under a legal hold and must NOT be evicted.
    #[serde(default)]
    pub legal_hold: bool,
}

/// Result of [`apply_retention`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvictionSet {
    /// IDs of rows that should be evicted according to the policy.
    pub evict: Vec<String>,
    /// IDs of rows that are exempt (legal hold, or not yet aged out).
    pub retain: Vec<String>,
    /// The policy action that should be applied to all rows in `evict`.
    pub action: RetentionAction,
    /// Human-readable description of why rows were evicted.
    pub reason: String,
    /// The cutoff timestamp (ms) that was used for age comparison.
    pub cutoff_ms: i64,
}

// ── Core logic ────────────────────────────────────────────────────────────────

/// Compute the eviction set for `rows` under `policy`.
///
/// A row is eligible for eviction if:
/// 1. `policy.max_age_days > 0` (not an "anonymous / retain-forever" policy), AND
/// 2. `row.timestamp_ms < now_ms - (policy.max_age_days * 86_400_000)`, AND
/// 3. `row.legal_hold == false`.
///
/// # Arguments
/// - `rows`: slice of rows to evaluate.
/// - `policy`: the policy to apply.
/// - `now_ms`: current time in Unix milliseconds; use `Date.now()` / `SystemTime`.
///
/// # Returns
/// An [`EvictionSet`] with `evict` and `retain` partition of row IDs.
pub fn apply_retention(
    rows: &[RetentionRow],
    policy: &RetentionPolicy,
    now_ms: i64,
) -> EvictionSet {
    // Anonymous / no-age-limit policies never evict.
    if policy.max_age_days == 0 || policy.tier == RetentionTier::Anonymous {
        return EvictionSet {
            evict: Vec::new(),
            retain: rows.iter().map(|r| r.id.clone()).collect(),
            action: policy.action.clone(),
            reason: format!(
                "Policy '{}' has max_age_days=0 or tier=anonymous — all rows retained.",
                policy.name
            ),
            cutoff_ms: 0,
        };
    }

    let max_age_ms = (policy.max_age_days as i64) * 24 * 60 * 60 * 1000;
    let cutoff_ms = now_ms - max_age_ms;

    let mut evict = Vec::new();
    let mut retain = Vec::new();

    for row in rows {
        // exp_ts_ms == 0 means "never expires" — always retain.
        if row.timestamp_ms == 0 {
            retain.push(row.id.clone());
            continue;
        }
        // Legal-hold rows are never evicted.
        if row.legal_hold {
            retain.push(row.id.clone());
            continue;
        }
        // Age check: row is eligible if it is older than the cutoff.
        if row.timestamp_ms < cutoff_ms {
            evict.push(row.id.clone());
        } else {
            retain.push(row.id.clone());
        }
    }

    EvictionSet {
        action: policy.action.clone(),
        reason: format!(
            "Policy '{}': max_age_days={}, action={:?}, cutoff={}",
            policy.name, policy.max_age_days, policy.action, cutoff_ms
        ),
        cutoff_ms,
        evict,
        retain,
    }
}

// ── WASM binding ──────────────────────────────────────────────────────────────

/// WASM entry point for retention policy evaluation.
///
/// # Arguments (JSON strings)
/// - `rows_json`: JSON array of [`RetentionRow`] objects.
/// - `policy_json`: JSON object matching [`RetentionPolicy`].
/// - `now_ms`: current Unix timestamp in milliseconds (f64 for JS interop).
///
/// # Returns
/// JSON-serialised [`EvictionSet`], or a JSON `{"error":"..."}` on parse failure.
#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn retention_apply_wasm(rows_json: &str, policy_json: &str, now_ms: f64) -> String {
    let rows: Vec<RetentionRow> = match serde_json::from_str(rows_json) {
        Ok(r) => r,
        Err(e) => return format!("{{\"error\":\"rows parse error: {e}\"}}"),
    };
    let policy: RetentionPolicy = match serde_json::from_str(policy_json) {
        Ok(p) => p,
        Err(e) => return format!("{{\"error\":\"policy parse error: {e}\"}}"),
    };
    let result = apply_retention(&rows, &policy, now_ms as i64);
    match serde_json::to_string(&result) {
        Ok(s) => s,
        Err(e) => format!("{{\"error\":\"serialize error: {e}\"}}"),
    }
}

// ── Default policies (canonical PII inventory) ────────────────────────────────

/// Returns the canonical retention policies for all PII tiers in LLMtxt.
///
/// These are the authoritative defaults referenced by `docs/compliance/pii-inventory.md`.
/// The retention job loads these at startup.
pub fn canonical_policies() -> Vec<RetentionPolicy> {
    vec![
        RetentionPolicy {
            name: "sessions".to_string(),
            table: "sessions".to_string(),
            pii_category: "session_token".to_string(),
            tier: RetentionTier::Critical,
            max_age_days: 30,
            lawful_basis: LawfulBasis::ContractPerformance,
            action: RetentionAction::HardDelete,
            archive_then_delete_after_days: None,
        },
        RetentionPolicy {
            name: "audit_logs_hot".to_string(),
            table: "audit_logs".to_string(),
            pii_category: "actor_id_in_audit_chain".to_string(),
            tier: RetentionTier::Operational,
            max_age_days: 90,
            lawful_basis: LawfulBasis::LegalObligation,
            action: RetentionAction::Archive,
            archive_then_delete_after_days: Some(2555), // 7 years
        },
        RetentionPolicy {
            name: "api_keys".to_string(),
            table: "api_keys".to_string(),
            pii_category: "api_key_hash".to_string(),
            tier: RetentionTier::Critical,
            max_age_days: 365,
            lawful_basis: LawfulBasis::ContractPerformance,
            action: RetentionAction::HardDelete,
            archive_then_delete_after_days: None,
        },
        RetentionPolicy {
            name: "webhook_deliveries".to_string(),
            table: "webhook_deliveries".to_string(),
            pii_category: "webhook_payload".to_string(),
            tier: RetentionTier::Standard,
            max_age_days: 30,
            lawful_basis: LawfulBasis::LegitimateInterests,
            action: RetentionAction::HardDelete,
            archive_then_delete_after_days: None,
        },
        RetentionPolicy {
            name: "section_embeddings".to_string(),
            table: "section_embeddings".to_string(),
            pii_category: "vector_derived_from_content".to_string(),
            tier: RetentionTier::Standard,
            max_age_days: 90,
            lawful_basis: LawfulBasis::LegitimateInterests,
            action: RetentionAction::HardDelete,
            archive_then_delete_after_days: None,
        },
        RetentionPolicy {
            name: "agent_signature_nonces".to_string(),
            table: "agent_signature_nonces".to_string(),
            pii_category: "cryptographic_nonce".to_string(),
            tier: RetentionTier::Standard,
            max_age_days: 1,
            lawful_basis: LawfulBasis::LegalObligation,
            action: RetentionAction::HardDelete,
            archive_then_delete_after_days: None,
        },
        RetentionPolicy {
            name: "agent_inbox_messages".to_string(),
            table: "agent_inbox_messages".to_string(),
            pii_category: "agent_message_payload".to_string(),
            tier: RetentionTier::Standard,
            max_age_days: 7,
            lawful_basis: LawfulBasis::LegitimateInterests,
            action: RetentionAction::HardDelete,
            archive_then_delete_after_days: None,
        },
        RetentionPolicy {
            name: "usage_events".to_string(),
            table: "usage_events".to_string(),
            pii_category: "billing_usage_record".to_string(),
            tier: RetentionTier::Operational,
            max_age_days: 730, // 2 years
            lawful_basis: LawfulBasis::LegalObligation,
            action: RetentionAction::Archive,
            archive_then_delete_after_days: Some(2555),
        },
        // Anonymous aggregated rollups — never evict.
        RetentionPolicy {
            name: "usage_rollups".to_string(),
            table: "usage_rollups".to_string(),
            pii_category: "aggregated_metrics".to_string(),
            tier: RetentionTier::Anonymous,
            max_age_days: 0,
            lawful_basis: LawfulBasis::Anonymous,
            action: RetentionAction::Archive,
            archive_then_delete_after_days: None,
        },
    ]
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_policy(max_age_days: u32, action: RetentionAction) -> RetentionPolicy {
        RetentionPolicy {
            name: "test_policy".to_string(),
            table: "test_table".to_string(),
            pii_category: "test_pii".to_string(),
            tier: RetentionTier::Standard,
            max_age_days,
            lawful_basis: LawfulBasis::LegitimateInterests,
            action,
            archive_then_delete_after_days: None,
        }
    }

    const NOW_MS: i64 = 1_000_000_000_000; // fixed reference point

    #[test]
    fn evicts_old_rows_and_retains_new() {
        let policy = make_policy(30, RetentionAction::HardDelete);

        let old_ts = NOW_MS - 31 * 24 * 60 * 60 * 1000; // 31 days ago
        let new_ts = NOW_MS - 5 * 24 * 60 * 60 * 1000; // 5 days ago

        let rows = vec![
            RetentionRow {
                id: "old".to_string(),
                timestamp_ms: old_ts,
                legal_hold: false,
            },
            RetentionRow {
                id: "new".to_string(),
                timestamp_ms: new_ts,
                legal_hold: false,
            },
        ];

        let result = apply_retention(&rows, &policy, NOW_MS);

        assert_eq!(result.evict, vec!["old"]);
        assert_eq!(result.retain, vec!["new"]);
        assert_eq!(result.action, RetentionAction::HardDelete);
    }

    #[test]
    fn legal_hold_rows_never_evicted() {
        let policy = make_policy(30, RetentionAction::HardDelete);

        let old_ts = NOW_MS - 100 * 24 * 60 * 60 * 1000; // 100 days ago
        let rows = vec![RetentionRow {
            id: "held".to_string(),
            timestamp_ms: old_ts,
            legal_hold: true,
        }];

        let result = apply_retention(&rows, &policy, NOW_MS);

        assert!(result.evict.is_empty());
        assert_eq!(result.retain, vec!["held"]);
    }

    #[test]
    fn zero_timestamp_never_evicted() {
        let policy = make_policy(30, RetentionAction::HardDelete);
        let rows = vec![RetentionRow {
            id: "immortal".to_string(),
            timestamp_ms: 0,
            legal_hold: false,
        }];

        let result = apply_retention(&rows, &policy, NOW_MS);

        assert!(result.evict.is_empty());
        assert_eq!(result.retain, vec!["immortal"]);
    }

    #[test]
    fn zero_max_age_retains_all() {
        let policy = make_policy(0, RetentionAction::HardDelete);
        let old_ts = NOW_MS - 1000 * 24 * 60 * 60 * 1000; // 1000 days ago
        let rows = vec![RetentionRow {
            id: "r1".to_string(),
            timestamp_ms: old_ts,
            legal_hold: false,
        }];

        let result = apply_retention(&rows, &policy, NOW_MS);

        assert!(result.evict.is_empty());
        assert_eq!(result.retain.len(), 1);
    }

    #[test]
    fn anonymous_tier_retains_all() {
        let mut policy = make_policy(90, RetentionAction::Archive);
        policy.tier = RetentionTier::Anonymous;

        let old_ts = NOW_MS - 200 * 24 * 60 * 60 * 1000;
        let rows = vec![RetentionRow {
            id: "anon".to_string(),
            timestamp_ms: old_ts,
            legal_hold: false,
        }];

        let result = apply_retention(&rows, &policy, NOW_MS);

        assert!(result.evict.is_empty());
    }

    #[test]
    fn pseudonymize_action_preserved_in_eviction_set() {
        let policy = make_policy(90, RetentionAction::Pseudonymize);
        let old_ts = NOW_MS - 100 * 24 * 60 * 60 * 1000;
        let rows = vec![RetentionRow {
            id: "audit_row".to_string(),
            timestamp_ms: old_ts,
            legal_hold: false,
        }];

        let result = apply_retention(&rows, &policy, NOW_MS);

        assert_eq!(result.evict, vec!["audit_row"]);
        assert_eq!(result.action, RetentionAction::Pseudonymize);
    }

    #[test]
    fn canonical_policies_are_valid() {
        let policies = canonical_policies();
        assert!(!policies.is_empty());
        // Every critical/standard policy must have max_age_days > 0.
        for p in &policies {
            if p.tier == RetentionTier::Critical || p.tier == RetentionTier::Standard {
                assert!(
                    p.max_age_days > 0,
                    "policy '{}' is critical/standard but max_age_days=0",
                    p.name
                );
            }
        }
        // Audit logs must use Pseudonymize or Archive action (never HardDelete at row level).
        let audit = policies.iter().find(|p| p.table == "audit_logs").unwrap();
        assert!(
            audit.action != RetentionAction::HardDelete,
            "audit_logs must not use HardDelete"
        );
    }

    #[test]
    fn json_roundtrip() {
        let policy = make_policy(30, RetentionAction::Archive);
        let json = serde_json::to_string(&policy).unwrap();
        let decoded: RetentionPolicy = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.name, policy.name);
        assert_eq!(decoded.max_age_days, policy.max_age_days);
    }
}
