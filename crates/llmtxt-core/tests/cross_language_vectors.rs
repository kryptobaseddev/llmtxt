//! Cross-language test vector validation.
//!
//! These tests load the shared JSON test vectors from `tests/vectors/`
//! and verify that the Rust implementation produces identical results
//! to the TypeScript SDK.

use llmtxt_core::{
    compute_diff, compute_sections_modified_native, create_patch, evaluate_approvals,
    is_editable_str, is_terminal_str, is_valid_transition_str, reconstruct_version,
};

// ── Lifecycle ──────────────────────────────────────────────────

#[test]
fn test_lifecycle_vectors() {
    let json = include_str!("../../../tests/vectors/lifecycle-transitions.json");
    let doc: serde_json::Value = serde_json::from_str(json).expect("parse lifecycle vectors");

    // Valid transitions
    for case in doc["validTransitions"]
        .as_array()
        .expect("validTransitions array")
    {
        let from = case["from"].as_str().expect("from");
        let to = case["to"].as_str().expect("to");
        assert!(
            is_valid_transition_str(from, to),
            "{from} -> {to} should be valid"
        );
    }

    // Invalid transitions
    for case in doc["invalidTransitions"]
        .as_array()
        .expect("invalidTransitions array")
    {
        let from = case["from"].as_str().expect("from");
        let to = case["to"].as_str().expect("to");
        assert!(
            !is_valid_transition_str(from, to),
            "{from} -> {to} should be invalid"
        );
    }

    // Editable states
    for state in doc["editableStates"].as_array().expect("editableStates") {
        let s = state.as_str().expect("state string");
        assert!(is_editable_str(s), "{s} should be editable");
    }
    for state in doc["nonEditableStates"]
        .as_array()
        .expect("nonEditableStates")
    {
        let s = state.as_str().expect("state string");
        assert!(!is_editable_str(s), "{s} should not be editable");
    }

    // Terminal states
    for state in doc["terminalStates"].as_array().expect("terminalStates") {
        let s = state.as_str().expect("state string");
        assert!(is_terminal_str(s), "{s} should be terminal");
    }
    for state in doc["nonTerminalStates"]
        .as_array()
        .expect("nonTerminalStates")
    {
        let s = state.as_str().expect("state string");
        assert!(!is_terminal_str(s), "{s} should not be terminal");
    }
}

// ── Consensus ──────────────────────────────────────────────────

#[test]
fn test_consensus_vectors() {
    let json = include_str!("../../../tests/vectors/consensus-evaluation.json");
    let doc: serde_json::Value = serde_json::from_str(json).expect("parse consensus vectors");

    for case in doc["cases"].as_array().expect("cases array") {
        let name = case["name"].as_str().expect("name");
        let reviews_json = serde_json::to_string(&case["reviews"]).expect("serialize reviews");
        let policy_json = serde_json::to_string(&case["policy"]).expect("serialize policy");
        let current_version = case["currentVersion"].as_u64().expect("currentVersion") as u32;
        let now = case["now"].as_f64().expect("now");

        let result_json =
            evaluate_approvals(&reviews_json, &policy_json, current_version, now).expect(name);
        let result: serde_json::Value = serde_json::from_str(&result_json).expect("parse result");
        let expected = &case["expected"];

        // Check approved status
        if let Some(exp_approved) = expected["approved"].as_bool() {
            assert_eq!(
                result["approved"].as_bool().expect("approved"),
                exp_approved,
                "case '{name}': approved mismatch"
            );
        }

        // Check approvedBy
        if let Some(exp_by) = expected["approvedBy"].as_array() {
            let result_by = result["approvedBy"].as_array().expect("approvedBy");
            assert_eq!(
                result_by.len(),
                exp_by.len(),
                "case '{name}': approvedBy count mismatch"
            );
        }

        // Check rejectedBy
        if let Some(exp_by) = expected["rejectedBy"].as_array() {
            let result_by = result["rejectedBy"].as_array().expect("rejectedBy");
            assert_eq!(
                result_by.len(),
                exp_by.len(),
                "case '{name}': rejectedBy count mismatch"
            );
        }

        // Check pendingFrom
        if let Some(exp_by) = expected["pendingFrom"].as_array() {
            let result_by = result["pendingFrom"].as_array().expect("pendingFrom");
            assert_eq!(
                result_by.len(),
                exp_by.len(),
                "case '{name}': pendingFrom count mismatch"
            );
        }

        // Check staleFrom
        if let Some(exp_by) = expected["staleFrom"].as_array() {
            let result_by = result["staleFrom"].as_array().expect("staleFrom");
            assert_eq!(
                result_by.len(),
                exp_by.len(),
                "case '{name}': staleFrom count mismatch"
            );
        }
    }
}

// ── Patch/Diff ─────────────────────────────────────────────────

#[test]
fn test_patch_diff_vectors() {
    let json = include_str!("../../../tests/vectors/patch-diff.json");
    let doc: serde_json::Value = serde_json::from_str(json).expect("parse patch-diff vectors");

    // Patch roundtrip
    for case in doc["patchRoundtrip"]
        .as_array()
        .expect("patchRoundtrip array")
    {
        let name = case["name"].as_str().expect("name");
        let original = case["original"].as_str().expect("original");
        let modified = case["modified"].as_str().expect("modified");

        let patch = create_patch(original, modified);
        assert!(
            patch.contains("@@"),
            "case '{name}': patch should contain @@ markers"
        );

        let applied =
            llmtxt_core::apply_patch(original, &patch).expect(&format!("case '{name}': apply"));
        assert_eq!(applied, modified, "case '{name}': roundtrip mismatch");
    }

    // Version reconstruction
    for case in doc["versionReconstruction"]
        .as_array()
        .expect("versionReconstruction array")
    {
        let name = case["name"].as_str().expect("name");
        let base = case["base"].as_str().expect("base");
        let versions: Vec<&str> = case["versions"]
            .as_array()
            .expect("versions")
            .iter()
            .map(|v| v.as_str().expect("version string"))
            .collect();

        // Build patch chain
        let mut patches = Vec::new();
        let mut prev = base.to_string();
        for v in &versions {
            patches.push(create_patch(&prev, v));
            prev = v.to_string();
        }
        let patches_json = serde_json::to_string(&patches).expect("serialize patches");

        let expectations = case["expectations"].as_object().expect("expectations");
        for (version_str, expected_content) in expectations {
            let version: u32 = version_str.parse().expect("version number");
            let result = reconstruct_version(base, &patches_json, version)
                .expect(&format!("case '{name}': reconstruct v{version}"));
            assert_eq!(
                result,
                expected_content.as_str().expect("expected content"),
                "case '{name}': v{version} mismatch"
            );
        }
    }

    // Diff stats
    for case in doc["diffStats"].as_array().expect("diffStats array") {
        let name = case["name"].as_str().expect("name");
        let old = case["old"].as_str().expect("old");
        let new = case["new"].as_str().expect("new");
        let expected = &case["expected"];

        let result = compute_diff(old, new);

        if let Some(added) = expected["addedLines"].as_u64() {
            assert_eq!(
                result.added_lines() as u64,
                added,
                "case '{name}': addedLines"
            );
        }
        if let Some(removed) = expected["removedLines"].as_u64() {
            assert_eq!(
                result.removed_lines() as u64,
                removed,
                "case '{name}': removedLines"
            );
        }
    }

    // Sections modified
    for case in doc["sectionsModified"]
        .as_array()
        .expect("sectionsModified array")
    {
        let name = case["name"].as_str().expect("name");
        let old = case["old"].as_str().expect("old");
        let new = case["new"].as_str().expect("new");
        let expected: Vec<String> = case["expected"]
            .as_array()
            .expect("expected array")
            .iter()
            .map(|v| v.as_str().expect("string").to_string())
            .collect();

        let result = compute_sections_modified_native(old, new);
        assert_eq!(result, expected, "case '{name}': sections mismatch");
    }
}
