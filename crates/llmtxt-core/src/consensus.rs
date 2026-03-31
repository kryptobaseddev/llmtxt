//! Consensus and approval workflow evaluation.
//!
//! Pure functions for multi-agent review/approval workflows.
//! No storage, no side effects -- just evaluation logic.
//!
//! Accepts and returns JSON for WASM compatibility. Native callers
//! can use the struct-based variants directly.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

/// A single review from an agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    /// Agent that submitted the review.
    pub reviewer_id: String,
    /// Current status: PENDING, APPROVED, REJECTED, STALE.
    pub status: String,
    /// Timestamp of the review action (ms since epoch).
    pub timestamp: f64,
    /// Reason or comment provided with the review.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Version number the review applies to.
    pub at_version: u32,
}

/// Policy governing how approvals are evaluated.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalPolicy {
    /// Minimum number of approvals required (absolute count).
    /// Ignored when `required_percentage` is set (> 0).
    pub required_count: u32,
    /// If true, all allowed reviewers must approve (overrides count/percentage).
    pub require_unanimous: bool,
    /// Agent IDs allowed to review. Empty means anyone can review.
    pub allowed_reviewer_ids: Vec<String>,
    /// Auto-expire reviews older than this (ms). 0 means no timeout.
    pub timeout_ms: f64,
    /// Percentage of effective reviewers required to approve (0-100).
    /// 0 means use `required_count` instead. When > 0, the required count
    /// is computed as `ceil(percentage * effective_reviewer_count / 100)`.
    #[serde(default)]
    pub required_percentage: u32,
}

/// Result of evaluating reviews against a policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalResult {
    /// Whether the approval threshold is met.
    pub approved: bool,
    /// Reviewers that have approved.
    pub approved_by: Vec<String>,
    /// Reviewers that have rejected.
    pub rejected_by: Vec<String>,
    /// Reviewers that are still pending.
    pub pending_from: Vec<String>,
    /// Reviewers whose reviews are stale.
    pub stale_from: Vec<String>,
    /// Human-readable summary.
    pub reason: String,
}

/// Evaluate reviews against an approval policy (native API).
///
/// Filters out stale and timed-out reviews, then checks whether the
/// remaining approvals meet the policy threshold.
pub fn evaluate_approvals_native(
    reviews: &[Review],
    policy: &ApprovalPolicy,
    current_version: u32,
    now: f64,
) -> ApprovalResult {
    let mut approved_by = Vec::new();
    let mut rejected_by = Vec::new();
    let mut pending_from = Vec::new();
    let mut stale_from = Vec::new();

    // Determine effective reviewers
    let effective_reviewers: Vec<String> = if !policy.allowed_reviewer_ids.is_empty() {
        policy.allowed_reviewer_ids.clone()
    } else {
        let mut seen = HashSet::new();
        reviews
            .iter()
            .filter(|r| seen.insert(r.reviewer_id.clone()))
            .map(|r| r.reviewer_id.clone())
            .collect()
    };

    // Keep latest review per reviewer
    let mut review_map: HashMap<&str, &Review> = HashMap::new();
    for review in reviews {
        let dominated = match review_map.get(review.reviewer_id.as_str()) {
            None => true,
            Some(existing) => review.timestamp > existing.timestamp,
        };
        if dominated {
            review_map.insert(&review.reviewer_id, review);
        }
    }

    for reviewer_id in &effective_reviewers {
        let Some(review) = review_map.get(reviewer_id.as_str()) else {
            pending_from.push(reviewer_id.clone());
            continue;
        };

        // Stale if review was for an older version
        if review.at_version < current_version {
            stale_from.push(reviewer_id.clone());
            continue;
        }

        // Stale if review timed out
        if policy.timeout_ms > 0.0 && (now - review.timestamp) > policy.timeout_ms {
            stale_from.push(reviewer_id.clone());
            continue;
        }

        match review.status.to_uppercase().as_str() {
            "APPROVED" => approved_by.push(reviewer_id.clone()),
            "REJECTED" => rejected_by.push(reviewer_id.clone()),
            "STALE" => stale_from.push(reviewer_id.clone()),
            _ => pending_from.push(reviewer_id.clone()),
        }
    }

    // Evaluate threshold
    let (approved, reason) = if !rejected_by.is_empty() {
        (false, format!("Rejected by {}", rejected_by.join(", ")))
    } else if policy.require_unanimous {
        let all_approved = approved_by.len() == effective_reviewers.len()
            && pending_from.is_empty()
            && stale_from.is_empty();
        let reason = if all_approved {
            format!(
                "Unanimous approval ({}/{})",
                approved_by.len(),
                effective_reviewers.len()
            )
        } else {
            format!(
                "Awaiting unanimous approval ({}/{})",
                approved_by.len(),
                effective_reviewers.len()
            )
        };
        (all_approved, reason)
    } else {
        // Compute effective threshold: percentage overrides count when > 0
        let threshold = if policy.required_percentage > 0 {
            let pct = policy.required_percentage.min(100) as f64 / 100.0;
            (pct * effective_reviewers.len() as f64).ceil() as u32
        } else {
            policy.required_count
        };
        let met = approved_by.len() as u32 >= threshold;
        let threshold_label = if policy.required_percentage > 0 {
            format!("{}% = {}", policy.required_percentage, threshold)
        } else {
            format!("{}", threshold)
        };
        let reason = if met {
            format!(
                "Approved ({}/{} required)",
                approved_by.len(),
                threshold_label
            )
        } else {
            let remaining = threshold.saturating_sub(approved_by.len() as u32);
            format!(
                "Needs {} more approval(s) ({}/{} required)",
                remaining,
                approved_by.len(),
                threshold_label
            )
        };
        (met, reason)
    };

    ApprovalResult {
        approved,
        approved_by,
        rejected_by,
        pending_from,
        stale_from,
        reason,
    }
}

/// Mark reviews as stale when a document version changes.
///
/// Returns a new vector with updated review statuses.
pub fn mark_stale_reviews_native(reviews: &[Review], current_version: u32) -> Vec<Review> {
    reviews
        .iter()
        .map(|r| {
            if r.at_version < current_version && r.status.to_uppercase() != "STALE" {
                Review {
                    status: "STALE".to_string(),
                    ..r.clone()
                }
            } else {
                r.clone()
            }
        })
        .collect()
}

// ── WASM entry points (JSON I/O) ──────────────────────────────

/// Evaluate reviews against a policy. All inputs and output are JSON strings.
///
/// Input `reviews_json`: `[{"reviewerId":"...","status":"APPROVED","timestamp":123,"atVersion":1}]`
/// Input `policy_json`: `{"requiredCount":1,"requireUnanimous":false,"allowedReviewerIds":[],"timeoutMs":0}`
///
/// Returns a JSON string matching the TypeScript `ApprovalResult` interface.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn evaluate_approvals(
    reviews_json: &str,
    policy_json: &str,
    current_version: u32,
    now_ms: f64,
) -> Result<String, String> {
    let reviews: Vec<Review> =
        serde_json::from_str(reviews_json).map_err(|e| format!("Invalid reviews JSON: {e}"))?;
    let policy: ApprovalPolicy =
        serde_json::from_str(policy_json).map_err(|e| format!("Invalid policy JSON: {e}"))?;

    let result = evaluate_approvals_native(&reviews, &policy, current_version, now_ms);
    serde_json::to_string(&result).map_err(|e| format!("Serialization failed: {e}"))
}

/// Mark reviews as stale for the given version. JSON I/O for WASM.
///
/// Returns a JSON array of updated reviews.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn mark_stale_reviews(reviews_json: &str, current_version: u32) -> Result<String, String> {
    let reviews: Vec<Review> =
        serde_json::from_str(reviews_json).map_err(|e| format!("Invalid reviews JSON: {e}"))?;

    let result = mark_stale_reviews_native(&reviews, current_version);
    serde_json::to_string(&result).map_err(|e| format!("Serialization failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_policy() -> ApprovalPolicy {
        ApprovalPolicy {
            required_count: 1,
            require_unanimous: false,
            allowed_reviewer_ids: vec![],
            timeout_ms: 0.0,
            required_percentage: 0,
        }
    }

    fn review(id: &str, status: &str, version: u32) -> Review {
        Review {
            reviewer_id: id.to_string(),
            status: status.to_string(),
            timestamp: 1_000_000.0,
            reason: None,
            at_version: version,
        }
    }

    #[test]
    fn test_single_approval_meets_default_policy() {
        let reviews = vec![review("agent-1", "APPROVED", 1)];
        let result = evaluate_approvals_native(&reviews, &default_policy(), 1, 2_000_000.0);
        assert!(result.approved);
        assert_eq!(result.approved_by, vec!["agent-1"]);
    }

    #[test]
    fn test_no_reviews_pending() {
        let policy = ApprovalPolicy {
            allowed_reviewer_ids: vec!["agent-1".to_string()],
            ..default_policy()
        };
        let result = evaluate_approvals_native(&[], &policy, 1, 2_000_000.0);
        assert!(!result.approved);
        assert_eq!(result.pending_from, vec!["agent-1"]);
    }

    #[test]
    fn test_rejection_overrides_approval() {
        let reviews = vec![
            review("agent-1", "APPROVED", 1),
            review("agent-2", "REJECTED", 1),
        ];
        let policy = ApprovalPolicy {
            required_count: 1,
            ..default_policy()
        };
        let result = evaluate_approvals_native(&reviews, &policy, 1, 2_000_000.0);
        assert!(!result.approved);
        assert!(result.reason.contains("Rejected"));
    }

    #[test]
    fn test_stale_review_for_old_version() {
        let reviews = vec![review("agent-1", "APPROVED", 1)];
        let result = evaluate_approvals_native(&reviews, &default_policy(), 2, 2_000_000.0);
        assert!(!result.approved);
        assert_eq!(result.stale_from, vec!["agent-1"]);
    }

    #[test]
    fn test_timed_out_review() {
        let reviews = vec![Review {
            reviewer_id: "agent-1".to_string(),
            status: "APPROVED".to_string(),
            timestamp: 1_000_000.0,
            reason: None,
            at_version: 1,
        }];
        let policy = ApprovalPolicy {
            timeout_ms: 500_000.0,
            ..default_policy()
        };
        // now is 2_000_000, review was at 1_000_000, timeout is 500_000
        let result = evaluate_approvals_native(&reviews, &policy, 1, 2_000_000.0);
        assert!(!result.approved);
        assert_eq!(result.stale_from, vec!["agent-1"]);
    }

    #[test]
    fn test_unanimous_policy() {
        let policy = ApprovalPolicy {
            required_count: 2,
            require_unanimous: true,
            allowed_reviewer_ids: vec!["agent-1".to_string(), "agent-2".to_string()],
            timeout_ms: 0.0,
            required_percentage: 0,
        };

        // Only one approved
        let reviews = vec![review("agent-1", "APPROVED", 1)];
        let result = evaluate_approvals_native(&reviews, &policy, 1, 2_000_000.0);
        assert!(!result.approved);
        assert!(result.reason.contains("Awaiting unanimous"));

        // Both approved
        let reviews = vec![
            review("agent-1", "APPROVED", 1),
            review("agent-2", "APPROVED", 1),
        ];
        let result = evaluate_approvals_native(&reviews, &policy, 1, 2_000_000.0);
        assert!(result.approved);
        assert!(result.reason.contains("Unanimous"));
    }

    #[test]
    fn test_latest_review_wins() {
        let reviews = vec![
            Review {
                reviewer_id: "agent-1".to_string(),
                status: "REJECTED".to_string(),
                timestamp: 1_000_000.0,
                reason: None,
                at_version: 1,
            },
            Review {
                reviewer_id: "agent-1".to_string(),
                status: "APPROVED".to_string(),
                timestamp: 2_000_000.0,
                reason: None,
                at_version: 1,
            },
        ];
        let result = evaluate_approvals_native(&reviews, &default_policy(), 1, 3_000_000.0);
        assert!(result.approved);
        assert_eq!(result.approved_by, vec!["agent-1"]);
    }

    #[test]
    fn test_mark_stale_reviews() {
        let reviews = vec![
            review("agent-1", "APPROVED", 1),
            review("agent-2", "APPROVED", 2),
        ];
        let result = mark_stale_reviews_native(&reviews, 2);
        assert_eq!(result[0].status, "STALE");
        assert_eq!(result[1].status, "APPROVED");
    }

    #[test]
    fn test_wasm_evaluate_approvals() {
        let reviews_json =
            r#"[{"reviewerId":"agent-1","status":"APPROVED","timestamp":1000000,"atVersion":1}]"#;
        let policy_json =
            r#"{"requiredCount":1,"requireUnanimous":false,"allowedReviewerIds":[],"timeoutMs":0}"#;
        let result_json = evaluate_approvals(reviews_json, policy_json, 1, 2_000_000.0).unwrap();
        let result: ApprovalResult = serde_json::from_str(&result_json).unwrap();
        assert!(result.approved);
    }

    #[test]
    fn test_wasm_mark_stale() {
        let reviews_json =
            r#"[{"reviewerId":"agent-1","status":"APPROVED","timestamp":1000000,"atVersion":1}]"#;
        let result_json = mark_stale_reviews(reviews_json, 2).unwrap();
        let result: Vec<Review> = serde_json::from_str(&result_json).unwrap();
        assert_eq!(result[0].status, "STALE");
    }

    #[test]
    fn test_percentage_threshold_51_percent() {
        // 51% of 10 reviewers = ceil(5.1) = 6 required
        let ids: Vec<String> = (1..=10).map(|i| format!("agent-{i}")).collect();
        let policy = ApprovalPolicy {
            required_count: 0,
            require_unanimous: false,
            allowed_reviewer_ids: ids,
            timeout_ms: 0.0,
            required_percentage: 51,
        };

        // 5 approved — not enough (need 6)
        let reviews: Vec<Review> = (1..=5)
            .map(|i| review(&format!("agent-{i}"), "APPROVED", 1))
            .collect();
        let result = evaluate_approvals_native(&reviews, &policy, 1, 2_000_000.0);
        assert!(!result.approved, "5/10 should not meet 51%");
        assert!(result.reason.contains("51%"));

        // 6 approved — enough
        let reviews: Vec<Review> = (1..=6)
            .map(|i| review(&format!("agent-{i}"), "APPROVED", 1))
            .collect();
        let result = evaluate_approvals_native(&reviews, &policy, 1, 2_000_000.0);
        assert!(result.approved, "6/10 should meet 51%");
    }

    #[test]
    fn test_percentage_threshold_20_percent() {
        // 20% of 5 reviewers = ceil(1.0) = 1 required
        let policy = ApprovalPolicy {
            required_count: 0,
            require_unanimous: false,
            allowed_reviewer_ids: vec![
                "a1".into(),
                "a2".into(),
                "a3".into(),
                "a4".into(),
                "a5".into(),
            ],
            timeout_ms: 0.0,
            required_percentage: 20,
        };

        let reviews = vec![review("a1", "APPROVED", 1)];
        let result = evaluate_approvals_native(&reviews, &policy, 1, 2_000_000.0);
        assert!(result.approved, "1/5 should meet 20%");
    }

    #[test]
    fn test_percentage_overrides_count() {
        // required_count is 10 but percentage says 20% of 5 = 1
        let policy = ApprovalPolicy {
            required_count: 10,
            require_unanimous: false,
            allowed_reviewer_ids: vec![
                "a1".into(),
                "a2".into(),
                "a3".into(),
                "a4".into(),
                "a5".into(),
            ],
            timeout_ms: 0.0,
            required_percentage: 20,
        };

        let reviews = vec![review("a1", "APPROVED", 1)];
        let result = evaluate_approvals_native(&reviews, &policy, 1, 2_000_000.0);
        assert!(result.approved, "percentage should override count");
    }
}
