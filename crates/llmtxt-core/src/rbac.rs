//! Role-Based Access Control primitives for llmtxt documents.
//!
//! Defines the canonical Permission and Role types, plus the
//! ROLE_PERMISSIONS matrix. These are exported from the SDK so all
//! consumers share the same definitions.
//!
//! The Fastify RBAC middleware (`apps/backend/src/middleware/rbac.ts`)
//! imports types from `llmtxt` (the SDK) and uses the JSON-serialised
//! matrix for permission lookups.

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

use serde::{Deserialize, Serialize};

// ── Permission enum ───────────────────────────────────────────────

/// Fine-grained permission on a document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Permission {
    Read,
    Write,
    Delete,
    Manage,
    Approve,
}

impl Permission {
    /// Lowercase string representation, matching the TypeScript union literal.
    pub fn as_str(&self) -> &'static str {
        match self {
            Permission::Read => "read",
            Permission::Write => "write",
            Permission::Delete => "delete",
            Permission::Manage => "manage",
            Permission::Approve => "approve",
        }
    }
}

impl std::fmt::Display for Permission {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// ── DocumentRole enum ─────────────────────────────────────────────

/// Role a user can hold on a document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentRole {
    Owner,
    Editor,
    Viewer,
}

impl DocumentRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            DocumentRole::Owner => "owner",
            DocumentRole::Editor => "editor",
            DocumentRole::Viewer => "viewer",
        }
    }

    /// Return the canonical permission set for this role.
    pub fn permissions(&self) -> &'static [Permission] {
        match self {
            DocumentRole::Owner => &[
                Permission::Read,
                Permission::Write,
                Permission::Delete,
                Permission::Manage,
                Permission::Approve,
            ],
            DocumentRole::Editor => &[Permission::Read, Permission::Write, Permission::Approve],
            DocumentRole::Viewer => &[Permission::Read],
        }
    }
}

impl std::fmt::Display for DocumentRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// ── OrgRole enum ──────────────────────────────────────────────────

/// Role a user holds within an organisation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrgRole {
    Admin,
    Member,
    Viewer,
}

impl OrgRole {
    /// Map an org-level role to the effective document role.
    /// Org admins get editor-level access; all others get viewer-level.
    pub fn to_document_role(&self) -> DocumentRole {
        match self {
            OrgRole::Admin => DocumentRole::Editor,
            OrgRole::Member | OrgRole::Viewer => DocumentRole::Viewer,
        }
    }
}

// ── WASM helpers ──────────────────────────────────────────────────

/// Return the permissions for a document role as a JSON array of strings.
///
/// Accepts `"owner"`, `"editor"`, or `"viewer"`.
/// Returns `["read","write","delete","manage","approve"]` etc.
/// Returns `"[]"` for unknown roles.
///
/// # Examples (TypeScript via WASM)
/// ```ts
/// import { rolePermissions } from 'llmtxt';
/// rolePermissions('owner');  // '["read","write","delete","manage","approve"]'
/// rolePermissions('viewer'); // '["read"]'
/// ```
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn role_permissions(role: &str) -> String {
    let perms = match role {
        "owner" => DocumentRole::Owner.permissions(),
        "editor" => DocumentRole::Editor.permissions(),
        "viewer" => DocumentRole::Viewer.permissions(),
        _ => return "[]".to_string(),
    };
    let strs: Vec<&str> = perms.iter().map(|p| p.as_str()).collect();
    serde_json::to_string(&strs).unwrap_or_else(|_| "[]".to_string())
}

/// Check if a role has a specific permission.
///
/// Returns `true` if `role` (e.g. `"editor"`) has the given `permission`
/// (e.g. `"write"`). Unknown roles or permissions return `false`.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn role_has_permission(role: &str, permission: &str) -> bool {
    let doc_role = match role {
        "owner" => DocumentRole::Owner,
        "editor" => DocumentRole::Editor,
        "viewer" => DocumentRole::Viewer,
        _ => return false,
    };
    let target = match permission {
        "read" => Permission::Read,
        "write" => Permission::Write,
        "delete" => Permission::Delete,
        "manage" => Permission::Manage,
        "approve" => Permission::Approve,
        _ => return false,
    };
    doc_role.permissions().contains(&target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_has_all_permissions() {
        let perms = DocumentRole::Owner.permissions();
        assert!(perms.contains(&Permission::Read));
        assert!(perms.contains(&Permission::Write));
        assert!(perms.contains(&Permission::Delete));
        assert!(perms.contains(&Permission::Manage));
        assert!(perms.contains(&Permission::Approve));
    }

    #[test]
    fn editor_permissions() {
        let perms = DocumentRole::Editor.permissions();
        assert!(perms.contains(&Permission::Read));
        assert!(perms.contains(&Permission::Write));
        assert!(perms.contains(&Permission::Approve));
        assert!(!perms.contains(&Permission::Delete));
        assert!(!perms.contains(&Permission::Manage));
    }

    #[test]
    fn viewer_permissions() {
        let perms = DocumentRole::Viewer.permissions();
        assert_eq!(perms, &[Permission::Read]);
    }

    #[test]
    fn org_admin_maps_to_editor() {
        assert_eq!(OrgRole::Admin.to_document_role(), DocumentRole::Editor);
    }

    #[test]
    fn org_member_maps_to_viewer() {
        assert_eq!(OrgRole::Member.to_document_role(), DocumentRole::Viewer);
    }

    #[test]
    fn role_permissions_wasm_owner() {
        let json = role_permissions("owner");
        assert!(json.contains("\"read\""));
        assert!(json.contains("\"write\""));
        assert!(json.contains("\"delete\""));
        assert!(json.contains("\"manage\""));
        assert!(json.contains("\"approve\""));
    }

    #[test]
    fn role_permissions_wasm_viewer() {
        let json = role_permissions("viewer");
        assert_eq!(json, "[\"read\"]");
    }

    #[test]
    fn role_permissions_wasm_unknown() {
        assert_eq!(role_permissions("superadmin"), "[]");
    }

    #[test]
    fn role_has_permission_positive() {
        assert!(role_has_permission("owner", "delete"));
        assert!(role_has_permission("editor", "write"));
        assert!(role_has_permission("viewer", "read"));
    }

    #[test]
    fn role_has_permission_negative() {
        assert!(!role_has_permission("viewer", "write"));
        assert!(!role_has_permission("editor", "delete"));
    }

    #[test]
    fn role_has_permission_unknown() {
        assert!(!role_has_permission("superadmin", "read"));
        assert!(!role_has_permission("owner", "fly"));
    }

    // Byte-identity vectors matching TypeScript rbac.ts ROLE_PERMISSIONS
    #[test]
    fn byte_identity_owner_vec1() {
        let json = role_permissions("owner");
        let parsed: Vec<String> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, vec!["read", "write", "delete", "manage", "approve"]);
    }

    #[test]
    fn byte_identity_editor_vec2() {
        let json = role_permissions("editor");
        let parsed: Vec<String> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, vec!["read", "write", "approve"]);
    }

    #[test]
    fn byte_identity_viewer_vec3() {
        let json = role_permissions("viewer");
        let parsed: Vec<String> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, vec!["read"]);
    }
}
