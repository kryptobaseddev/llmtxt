//! Integration test: Multi-version diff and consensus workflows.
//! Tests the real scenarios an agent would encounter.

use llmtxt_core::*;

#[test]
fn test_10_version_chain_with_arbitrary_diffs() {
    // Create a document that evolves through 10 versions
    let v0 = "# Document\n\nOriginal content.\n\n## Section A\nText A.\n\n## Section B\nText B.\n";

    let version_contents = vec![
        "# Document\n\nOriginal content.\n\n## Section A\nText A updated v1.\n\n## Section B\nText B.\n",
        "# Document\n\nOriginal content.\n\n## Section A\nText A updated v1.\n\n## Section B\nText B updated v2.\n",
        "# Document\n\nOriginal content with v3 changes.\n\n## Section A\nText A updated v1.\n\n## Section B\nText B updated v2.\n\n## Section C\nNew section in v3.\n",
        "# Document v4\n\nOriginal content with v3 changes.\n\n## Section A\nText A updated v4.\n\n## Section B\nText B updated v2.\n\n## Section C\nNew section in v3.\n",
        "# Document v4\n\nOriginal content with v3 changes.\n\n## Section A\nText A updated v4.\n\n## Section B\nText B rewritten in v5.\nWith multiple lines now.\n\n## Section C\nNew section in v3.\n",
        "# Document v4\n\nOriginal content with v3 changes.\n\n## Section A\nText A updated v4.\n\n## Section B\nText B rewritten in v5.\nWith multiple lines now.\n\n## Section C\nSection C updated v6.\n",
        "# Document v7\n\nComplete rewrite of intro.\n\n## Section A\nText A updated v4.\n\n## Section B\nText B rewritten in v5.\nWith multiple lines now.\n\n## Section C\nSection C updated v6.\n\n## Section D\nBrand new section D.\n",
        "# Document v7\n\nComplete rewrite of intro.\n\n## Section A\nText A final.\n\n## Section B\nText B final.\n\n## Section C\nSection C final.\n\n## Section D\nBrand new section D.\n",
        "# Document v7\n\nComplete rewrite of intro.\n\n## Section A\nText A final.\n\n## Section B\nText B final.\n\n## Section C\nSection C final.\n\n## Section D\nSection D final.\n\n## Appendix\nAdded in v9.\n",
        "# Document FINAL\n\nComplete rewrite of intro.\n\n## Section A\nText A final.\n\n## Section B\nText B final.\n\n## Section C\nSection C final.\n\n## Section D\nSection D final.\n\n## Appendix\nAppendix finalized in v10.\n",
    ];

    // Build patch chain
    let mut patches = Vec::new();
    let mut prev = v0.to_string();
    for v in &version_contents {
        patches.push(create_patch(&prev, v));
        prev = v.to_string();
    }
    let patches_json = serde_json::to_string(&patches).unwrap();

    // Test: reconstruct every version
    let reconstructed_v0 = reconstruct_version(v0, &patches_json, 0).unwrap();
    assert_eq!(reconstructed_v0, v0, "v0 should return base");

    for (i, expected) in version_contents.iter().enumerate() {
        let version_num = (i + 1) as u32;
        let reconstructed = reconstruct_version(v0, &patches_json, version_num).unwrap();
        assert_eq!(&reconstructed, *expected, "v{version_num} content mismatch");
    }

    // Test: diff between arbitrary non-adjacent versions (v1 vs v5, v3 vs v8, v0 vs v10)
    let diff_1_5 = diff_versions(v0, &patches_json, 1, 5).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&diff_1_5).unwrap();
    assert_eq!(parsed["fromVersion"], 1);
    assert_eq!(parsed["toVersion"], 5);
    assert!(parsed["addedLines"].as_u64().unwrap() > 0);
    assert!(parsed["patchText"].as_str().unwrap().contains("@@"));

    let diff_3_8 = diff_versions(v0, &patches_json, 3, 8).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&diff_3_8).unwrap();
    assert_eq!(parsed["fromVersion"], 3);
    assert_eq!(parsed["toVersion"], 8);

    let diff_0_10 = diff_versions(v0, &patches_json, 0, 10).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&diff_0_10).unwrap();
    assert_eq!(parsed["fromVersion"], 0);
    assert_eq!(parsed["toVersion"], 10);

    // Test: reverse diff (v10 back to v3)
    let diff_10_3 = diff_versions(v0, &patches_json, 10, 3).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&diff_10_3).unwrap();
    assert_eq!(parsed["fromVersion"], 10);
    assert_eq!(parsed["toVersion"], 3);
    assert!(parsed["removedLines"].as_u64().unwrap() > 0);

    // Test: sections_modified across versions
    let v3_content = &version_contents[2]; // v3
    let v7_content = &version_contents[6]; // v7
    let modified = compute_sections_modified_native(v3_content, v7_content);
    // Between v3 and v7: Document title changed, Section B changed, Section C changed, Section D added
    assert!(modified.contains(&"Section B".to_string()));
    assert!(modified.contains(&"Section D".to_string()));

    // Test: squash all 10 patches into one
    let squashed = squash_patches(v0, &patches_json).unwrap();
    let final_from_squash = apply_patch(v0, &squashed).unwrap();
    assert_eq!(
        final_from_squash, version_contents[9],
        "squashed patch should produce v10"
    );
}

#[test]
fn test_consensus_threshold_scenarios() {
    // Scenario 1: 3 out of 5 required (60% threshold)
    let policy_json = r#"{"requiredCount":3,"requireUnanimous":false,"allowedReviewerIds":["a1","a2","a3","a4","a5"],"timeoutMs":0}"#;

    // Only 2 approved — should NOT be approved
    let reviews_2 = r#"[
        {"reviewerId":"a1","status":"APPROVED","timestamp":1000,"atVersion":1},
        {"reviewerId":"a2","status":"APPROVED","timestamp":1000,"atVersion":1}
    ]"#;
    let result = evaluate_approvals(reviews_2, policy_json, 1, 2000.0).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert!(
        !parsed["approved"].as_bool().unwrap(),
        "2/5 should not meet 3 required"
    );
    assert_eq!(parsed["pendingFrom"].as_array().unwrap().len(), 3);

    // 3 approved — should BE approved
    let reviews_3 = r#"[
        {"reviewerId":"a1","status":"APPROVED","timestamp":1000,"atVersion":1},
        {"reviewerId":"a2","status":"APPROVED","timestamp":1000,"atVersion":1},
        {"reviewerId":"a3","status":"APPROVED","timestamp":1000,"atVersion":1}
    ]"#;
    let result = evaluate_approvals(reviews_3, policy_json, 1, 2000.0).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert!(
        parsed["approved"].as_bool().unwrap(),
        "3/5 should meet 3 required"
    );

    // Scenario 2: One rejection blocks even when count is met
    let reviews_3_with_reject = r#"[
        {"reviewerId":"a1","status":"APPROVED","timestamp":1000,"atVersion":1},
        {"reviewerId":"a2","status":"APPROVED","timestamp":1000,"atVersion":1},
        {"reviewerId":"a3","status":"APPROVED","timestamp":1000,"atVersion":1},
        {"reviewerId":"a4","status":"REJECTED","timestamp":1000,"atVersion":1}
    ]"#;
    let result = evaluate_approvals(reviews_3_with_reject, policy_json, 1, 2000.0).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert!(
        !parsed["approved"].as_bool().unwrap(),
        "rejection should block approval"
    );

    // Scenario 3: Stale reviews don't count
    let reviews_stale = r#"[
        {"reviewerId":"a1","status":"APPROVED","timestamp":1000,"atVersion":1},
        {"reviewerId":"a2","status":"APPROVED","timestamp":1000,"atVersion":1},
        {"reviewerId":"a3","status":"APPROVED","timestamp":1000,"atVersion":1}
    ]"#;
    // Current version is 2 — all reviews are for v1, so all are stale
    let result = evaluate_approvals(reviews_stale, policy_json, 2, 2000.0).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert!(
        !parsed["approved"].as_bool().unwrap(),
        "stale reviews should not count"
    );
    assert_eq!(parsed["staleFrom"].as_array().unwrap().len(), 3);

    // Scenario 4: Unanimous with 5 reviewers — 4/5 not enough
    let unanimous_policy = r#"{"requiredCount":5,"requireUnanimous":true,"allowedReviewerIds":["a1","a2","a3","a4","a5"],"timeoutMs":0}"#;
    let reviews_4 = r#"[
        {"reviewerId":"a1","status":"APPROVED","timestamp":1000,"atVersion":1},
        {"reviewerId":"a2","status":"APPROVED","timestamp":1000,"atVersion":1},
        {"reviewerId":"a3","status":"APPROVED","timestamp":1000,"atVersion":1},
        {"reviewerId":"a4","status":"APPROVED","timestamp":1000,"atVersion":1}
    ]"#;
    let result = evaluate_approvals(reviews_4, unanimous_policy, 1, 2000.0).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert!(
        !parsed["approved"].as_bool().unwrap(),
        "4/5 should not meet unanimous"
    );

    // All 5 approved — unanimous achieved
    let reviews_5 = r#"[
        {"reviewerId":"a1","status":"APPROVED","timestamp":1000,"atVersion":1},
        {"reviewerId":"a2","status":"APPROVED","timestamp":1000,"atVersion":1},
        {"reviewerId":"a3","status":"APPROVED","timestamp":1000,"atVersion":1},
        {"reviewerId":"a4","status":"APPROVED","timestamp":1000,"atVersion":1},
        {"reviewerId":"a5","status":"APPROVED","timestamp":1000,"atVersion":1}
    ]"#;
    let result = evaluate_approvals(reviews_5, unanimous_policy, 1, 2000.0).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert!(
        parsed["approved"].as_bool().unwrap(),
        "5/5 should meet unanimous"
    );

    // Scenario 5: Timeout expires reviews
    let timeout_policy =
        r#"{"requiredCount":1,"requireUnanimous":false,"allowedReviewerIds":[],"timeoutMs":60000}"#;
    let old_review = r#"[{"reviewerId":"a1","status":"APPROVED","timestamp":1000,"atVersion":1}]"#;
    // now=100000, review at 1000, timeout 60000 => 99000ms elapsed > 60000ms timeout
    let result = evaluate_approvals(old_review, timeout_policy, 1, 100000.0).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert!(
        !parsed["approved"].as_bool().unwrap(),
        "timed-out review should not count"
    );
    assert_eq!(parsed["staleFrom"].as_array().unwrap().len(), 1);
}
