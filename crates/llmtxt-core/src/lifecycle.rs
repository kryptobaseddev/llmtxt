//! Document lifecycle state machine.
//!
//! Defines the allowed states for collaborative documents and validates
//! transitions between them. All functions are pure.

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

/// Lifecycle state of a collaborative document.
///
/// Matches the TypeScript `DocumentState` type exactly.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DocumentState {
    Draft = 0,
    Review = 1,
    Locked = 2,
    Archived = 3,
}

impl DocumentState {
    /// Parse a state from its string representation (case-insensitive).
    pub fn from_str_name(s: &str) -> Option<Self> {
        match s.to_uppercase().as_str() {
            "DRAFT" => Some(Self::Draft),
            "REVIEW" => Some(Self::Review),
            "LOCKED" => Some(Self::Locked),
            "ARCHIVED" => Some(Self::Archived),
            _ => None,
        }
    }

    /// Return the canonical uppercase string name.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Draft => "DRAFT",
            Self::Review => "REVIEW",
            Self::Locked => "LOCKED",
            Self::Archived => "ARCHIVED",
        }
    }

    /// Return the allowed transition targets from this state.
    pub fn allowed_targets(&self) -> &'static [DocumentState] {
        match self {
            Self::Draft => &[Self::Review, Self::Locked],
            Self::Review => &[Self::Draft, Self::Locked],
            Self::Locked => &[Self::Archived],
            Self::Archived => &[],
        }
    }
}

impl std::fmt::Display for DocumentState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Check whether a state transition is allowed.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn is_valid_transition(from: DocumentState, to: DocumentState) -> bool {
    from.allowed_targets().contains(&to)
}

/// Check whether a document state allows content modifications.
///
/// Only DRAFT and REVIEW states accept new versions/patches.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn is_editable(state: DocumentState) -> bool {
    matches!(state, DocumentState::Draft | DocumentState::Review)
}

/// Check whether a document state is terminal (no further transitions).
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn is_terminal(state: DocumentState) -> bool {
    state.allowed_targets().is_empty()
}

// ── WASM string helpers ────────────────────────────────────────

/// Parse a state string and check if the transition is valid.
/// Accepts uppercase state names ("DRAFT", "REVIEW", etc.).
/// Returns false for unrecognized state names.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn is_valid_transition_str(from: &str, to: &str) -> bool {
    match (
        DocumentState::from_str_name(from),
        DocumentState::from_str_name(to),
    ) {
        (Some(f), Some(t)) => is_valid_transition(f, t),
        _ => false,
    }
}

/// Parse a state string and check if it's editable.
/// Returns false for unrecognized state names.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn is_editable_str(state: &str) -> bool {
    DocumentState::from_str_name(state).is_some_and(is_editable)
}

/// Parse a state string and check if it's terminal.
/// Returns false for unrecognized state names.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn is_terminal_str(state: &str) -> bool {
    DocumentState::from_str_name(state).is_some_and(is_terminal)
}

/// Validate a proposed transition and return a JSON result.
///
/// Returns a JSON object with `valid`, `reason`, and `allowedTargets` fields.
/// Matches the TypeScript `TransitionResult` interface.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn validate_transition(from: &str, to: &str) -> String {
    let from_state = match DocumentState::from_str_name(from) {
        Some(s) => s,
        None => {
            return serde_json::json!({
                "valid": false,
                "reason": format!("Unknown state: {from}"),
                "allowedTargets": []
            })
            .to_string();
        }
    };

    let to_state = match DocumentState::from_str_name(to) {
        Some(s) => s,
        None => {
            return serde_json::json!({
                "valid": false,
                "reason": format!("Unknown state: {to}"),
                "allowedTargets": from_state.allowed_targets().iter().map(|s| s.as_str()).collect::<Vec<_>>()
            })
            .to_string();
        }
    };

    let allowed: Vec<&str> = from_state
        .allowed_targets()
        .iter()
        .map(|s| s.as_str())
        .collect();

    if from_state == to_state {
        return serde_json::json!({
            "valid": false,
            "reason": format!("Document is already in {} state", from_state),
            "allowedTargets": allowed
        })
        .to_string();
    }

    if !is_valid_transition(from_state, to_state) {
        let allowed_str = if allowed.is_empty() {
            "none (terminal state)".to_string()
        } else {
            allowed.join(", ")
        };
        return serde_json::json!({
            "valid": false,
            "reason": format!("Cannot transition from {} to {}. Allowed: {}", from_state, to_state, allowed_str),
            "allowedTargets": allowed
        })
        .to_string();
    }

    serde_json::json!({
        "valid": true,
        "allowedTargets": allowed
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_transitions() {
        assert!(is_valid_transition(
            DocumentState::Draft,
            DocumentState::Review
        ));
        assert!(is_valid_transition(
            DocumentState::Draft,
            DocumentState::Locked
        ));
        assert!(is_valid_transition(
            DocumentState::Review,
            DocumentState::Draft
        ));
        assert!(is_valid_transition(
            DocumentState::Review,
            DocumentState::Locked
        ));
        assert!(is_valid_transition(
            DocumentState::Locked,
            DocumentState::Archived
        ));
    }

    #[test]
    fn test_invalid_transitions() {
        assert!(!is_valid_transition(
            DocumentState::Draft,
            DocumentState::Archived
        ));
        assert!(!is_valid_transition(
            DocumentState::Review,
            DocumentState::Archived
        ));
        assert!(!is_valid_transition(
            DocumentState::Locked,
            DocumentState::Draft
        ));
        assert!(!is_valid_transition(
            DocumentState::Locked,
            DocumentState::Review
        ));
        assert!(!is_valid_transition(
            DocumentState::Archived,
            DocumentState::Draft
        ));
        assert!(!is_valid_transition(
            DocumentState::Archived,
            DocumentState::Review
        ));
        assert!(!is_valid_transition(
            DocumentState::Archived,
            DocumentState::Locked
        ));
    }

    #[test]
    fn test_self_transitions_invalid() {
        assert!(!is_valid_transition(
            DocumentState::Draft,
            DocumentState::Draft
        ));
        assert!(!is_valid_transition(
            DocumentState::Review,
            DocumentState::Review
        ));
        assert!(!is_valid_transition(
            DocumentState::Locked,
            DocumentState::Locked
        ));
        assert!(!is_valid_transition(
            DocumentState::Archived,
            DocumentState::Archived
        ));
    }

    #[test]
    fn test_editable() {
        assert!(is_editable(DocumentState::Draft));
        assert!(is_editable(DocumentState::Review));
        assert!(!is_editable(DocumentState::Locked));
        assert!(!is_editable(DocumentState::Archived));
    }

    #[test]
    fn test_terminal() {
        assert!(!is_terminal(DocumentState::Draft));
        assert!(!is_terminal(DocumentState::Review));
        assert!(!is_terminal(DocumentState::Locked));
        assert!(is_terminal(DocumentState::Archived));
    }

    #[test]
    fn test_string_helpers() {
        assert!(is_valid_transition_str("DRAFT", "REVIEW"));
        assert!(is_valid_transition_str("draft", "review")); // case-insensitive
        assert!(!is_valid_transition_str("DRAFT", "ARCHIVED"));
        assert!(!is_valid_transition_str("DRAFT", "UNKNOWN"));
        assert!(!is_valid_transition_str("UNKNOWN", "DRAFT"));
    }

    #[test]
    fn test_editable_str() {
        assert!(is_editable_str("DRAFT"));
        assert!(is_editable_str("REVIEW"));
        assert!(!is_editable_str("LOCKED"));
        assert!(!is_editable_str("ARCHIVED"));
        assert!(!is_editable_str("UNKNOWN"));
    }

    #[test]
    fn test_terminal_str() {
        assert!(!is_terminal_str("DRAFT"));
        assert!(is_terminal_str("ARCHIVED"));
        assert!(!is_terminal_str("UNKNOWN"));
    }

    #[test]
    fn test_validate_transition_json() {
        let result: serde_json::Value =
            serde_json::from_str(&validate_transition("DRAFT", "REVIEW")).unwrap();
        assert_eq!(result["valid"], true);

        let result: serde_json::Value =
            serde_json::from_str(&validate_transition("DRAFT", "ARCHIVED")).unwrap();
        assert_eq!(result["valid"], false);
        assert!(
            result["reason"]
                .as_str()
                .unwrap()
                .contains("Cannot transition")
        );

        let result: serde_json::Value =
            serde_json::from_str(&validate_transition("DRAFT", "DRAFT")).unwrap();
        assert_eq!(result["valid"], false);
        assert!(result["reason"].as_str().unwrap().contains("already in"));

        let result: serde_json::Value =
            serde_json::from_str(&validate_transition("ARCHIVED", "DRAFT")).unwrap();
        assert_eq!(result["valid"], false);
        assert!(result["reason"].as_str().unwrap().contains("terminal"));
    }

    #[test]
    fn test_from_str_name() {
        assert_eq!(
            DocumentState::from_str_name("DRAFT"),
            Some(DocumentState::Draft)
        );
        assert_eq!(
            DocumentState::from_str_name("draft"),
            Some(DocumentState::Draft)
        );
        assert_eq!(
            DocumentState::from_str_name("Draft"),
            Some(DocumentState::Draft)
        );
        assert_eq!(
            DocumentState::from_str_name("REVIEW"),
            Some(DocumentState::Review)
        );
        assert_eq!(
            DocumentState::from_str_name("LOCKED"),
            Some(DocumentState::Locked)
        );
        assert_eq!(
            DocumentState::from_str_name("ARCHIVED"),
            Some(DocumentState::Archived)
        );
        assert_eq!(DocumentState::from_str_name("unknown"), None);
    }
}
