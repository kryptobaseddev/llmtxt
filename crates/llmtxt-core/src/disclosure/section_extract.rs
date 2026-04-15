//! Section extraction by name for progressive disclosure.

use super::generate_overview;
use crate::calculate_tokens;

/// Extract a named section from a document by title.
///
/// Performs fuzzy name matching in three passes:
/// 1. Exact case-insensitive match.
/// 2. Substring match.
/// 3. Alphanumeric-only substring match.
///
/// When `depth_all` is `true`, the returned content spans the matched section
/// AND all its sub-sections (depth > matched depth).
pub fn get_section(
    content: &str,
    section_name: &str,
    depth_all: bool,
) -> Option<serde_json::Value> {
    let overview = generate_overview(content);
    let lower_name = section_name.to_lowercase();

    let section_index = overview
        .sections
        .iter()
        .position(|s| s.title.to_lowercase() == lower_name)
        .or_else(|| {
            overview
                .sections
                .iter()
                .position(|s| s.title.to_lowercase().contains(&lower_name))
        })
        .or_else(|| {
            let clean: String = lower_name.chars().filter(|c| c.is_alphanumeric()).collect();
            if clean.is_empty() {
                None
            } else {
                overview.sections.iter().position(|s| {
                    s.title
                        .to_lowercase()
                        .chars()
                        .filter(|c| c.is_alphanumeric())
                        .collect::<String>()
                        .contains(&clean)
                })
            }
        })?;

    let section = &overview.sections[section_index];
    let mut end_line = section.end_line;

    if depth_all {
        for i in (section_index + 1)..overview.sections.len() {
            if overview.sections[i].depth <= section.depth {
                break;
            }
            end_line = overview.sections[i].end_line;
        }
    }

    let lines: Vec<&str> = content.split('\n').collect();
    let section_content = lines[section.start_line - 1..end_line].join("\n");
    let section_tokens = calculate_tokens(&section_content);

    Some(serde_json::json!({
        "section": section,
        "content": section_content,
        "tokenCount": section_tokens,
        "totalTokens": overview.token_count,
        "tokensSaved": overview.token_count as i64 - section_tokens as i64,
    }))
}
