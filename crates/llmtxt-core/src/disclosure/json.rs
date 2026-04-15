//! JSON section parsing for progressive disclosure.

use crate::calculate_tokens;
use crate::disclosure::types::{JsonKey, Section};

fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        // Find char boundary
        let mut end = max_len.saturating_sub(3);
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}...", &s[..end])
    }
}

fn escape_regex_chars(s: &str) -> String {
    let special = [
        '\\', '.', '+', '*', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']',
    ];
    let mut result = String::with_capacity(s.len() * 2);
    for c in s.chars() {
        if special.contains(&c) {
            result.push('\\');
        }
        result.push(c);
    }
    result
}

fn get_json_type(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Array(a) => format!("array[{}]", a.len()),
        serde_json::Value::Object(o) => format!("object{{{}}}", o.len()),
        serde_json::Value::String(_) => "string".to_string(),
        serde_json::Value::Number(_) => "number".to_string(),
        serde_json::Value::Bool(_) => "boolean".to_string(),
    }
}

/// Extract top-level JSON keys with type info and previews.
pub fn extract_json_keys(content: &str) -> Vec<JsonKey> {
    let parsed: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    match &parsed {
        serde_json::Value::Object(obj) => obj
            .iter()
            .map(|(key, value)| JsonKey {
                key: key.clone(),
                key_type: get_json_type(value),
                preview: truncate(&serde_json::to_string(value).unwrap_or_default(), 80),
            })
            .collect(),
        serde_json::Value::Array(arr) => {
            let preview = arr.first().map_or("[]".to_string(), |v| {
                truncate(&serde_json::to_string(v).unwrap_or_default(), 80)
            });
            vec![JsonKey {
                key: "(array)".to_string(),
                key_type: format!("array[{}]", arr.len()),
                preview,
            }]
        }
        _ => vec![],
    }
}

/// Parse JSON content into sections (one per top-level key or array).
pub fn parse_json_sections(content: &str, lines: &[&str]) -> Vec<Section> {
    let mut sections: Vec<Section> = Vec::new();

    let parsed: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => {
            // Fallback: regex-based parse for malformed JSON
            return parse_json_sections_regex(lines);
        }
    };

    match &parsed {
        serde_json::Value::Array(arr) => {
            sections.push(Section {
                title: format!("array[{}]", arr.len()),
                depth: 0,
                start_line: 1,
                end_line: lines.len(),
                token_count: calculate_tokens(content),
                section_type: "json-key".to_string(),
            });
        }
        serde_json::Value::Object(obj) => {
            let keys: Vec<&str> = obj.keys().map(String::as_str).collect();

            for (ki, key) in keys.iter().enumerate() {
                let escaped = escape_regex_chars(key);
                let pattern = format!("\"{}\"", escaped);

                // Find first line that contains `"key":`
                let line_idx = lines
                    .iter()
                    .position(|l| l.contains(&format!("{pattern}:")));

                if let Some(li) = line_idx {
                    // Find start of next top-level key
                    let end_line = if ki + 1 < keys.len() {
                        let next_key = keys[ki + 1];
                        let next_pattern = format!("\"{}\":", escape_regex_chars(next_key));
                        lines
                            .iter()
                            .enumerate()
                            .skip(li + 1)
                            .find(|(_, l)| l.contains(&next_pattern))
                            .map(|(j, _)| j)
                            .unwrap_or(lines.len())
                    } else {
                        lines.len()
                    };

                    let section_content = lines[li..end_line].join("\n");
                    sections.push(Section {
                        title: key.to_string(),
                        depth: 0,
                        start_line: li + 1,
                        end_line,
                        token_count: calculate_tokens(&section_content),
                        section_type: "json-key".to_string(),
                    });
                }
            }
        }
        _ => {}
    }

    sections
}

/// Fallback JSON section parser using simple line scanning.
fn parse_json_sections_regex(lines: &[&str]) -> Vec<Section> {
    let mut sections: Vec<Section> = Vec::new();
    let mut section_start: Option<(String, usize)> = None;

    for (i, line) in lines.iter().enumerate() {
        // Match lines like `  "keyName":`
        if let Some(key_str) = extract_top_level_key(line) {
            if let Some((prev_key, prev_start)) = section_start.take() {
                let section_content = lines[prev_start..i].join("\n");
                sections.push(Section {
                    title: prev_key,
                    depth: 0,
                    start_line: prev_start + 1,
                    end_line: i,
                    token_count: calculate_tokens(&section_content),
                    section_type: "json-key".to_string(),
                });
            }
            section_start = Some((key_str, i));
        }
    }

    // Push last section
    if let Some((key, start)) = section_start {
        let section_content = lines[start..].join("\n");
        sections.push(Section {
            title: key,
            depth: 0,
            start_line: start + 1,
            end_line: lines.len(),
            token_count: calculate_tokens(&section_content),
            section_type: "json-key".to_string(),
        });
    }

    sections
}

/// Extract the top-level key name from a line like `  "keyName": ...`.
fn extract_top_level_key(line: &str) -> Option<String> {
    let trimmed = line.trim_start_matches("  "); // exactly 2 spaces for top-level
    if line.starts_with("  ") && !line.starts_with("   ") && trimmed.starts_with('"') {
        let rest = &trimmed[1..];
        let end = rest.find('"')?;
        let key = rest[..end].to_string();
        if rest[end + 1..].trim_start().starts_with(':') {
            return Some(key);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_keys_object() {
        let json = r#"{"name":"Alice","age":30}"#;
        let keys = extract_json_keys(json);
        assert_eq!(keys.len(), 2);
        assert!(keys.iter().any(|k| k.key == "name"));
        assert!(keys.iter().any(|k| k.key == "age"));
    }

    #[test]
    fn json_keys_array() {
        let json = r#"[1,2,3]"#;
        let keys = extract_json_keys(json);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].key, "(array)");
    }

    #[test]
    fn json_sections_array() {
        let json = "[1,2,3]";
        let lines: Vec<&str> = json.lines().collect();
        let sections = parse_json_sections(json, &lines);
        assert_eq!(sections.len(), 1);
        assert!(sections[0].title.starts_with("array["));
    }
}
