//! JSONPath resolution helpers for the disclosure module.

/// Execute a JSONPath-style query against a parsed JSON value.
pub fn resolve_path(obj: &serde_json::Value, path: &str) -> Result<serde_json::Value, String> {
    let segments = path.trim_start_matches("$.").trim_start_matches('$');
    if segments.is_empty() {
        return Ok(obj.clone());
    }

    let parts = parse_path_segments(segments);
    let mut current = obj.clone();

    for part in &parts {
        if current.is_null() {
            return Err(format!("Cannot access '{part}' on null"));
        }

        if part == "*" {
            return match &current {
                serde_json::Value::Array(a) => Ok(serde_json::Value::Array(a.clone())),
                serde_json::Value::Object(o) => {
                    Ok(serde_json::Value::Array(o.values().cloned().collect()))
                }
                _ => Err("Wildcard (*) can only be used on arrays or objects".to_string()),
            };
        }

        if let Ok(idx) = part.parse::<usize>() {
            match &current {
                serde_json::Value::Array(a) => {
                    if idx >= a.len() {
                        return Err(format!(
                            "Array index {idx} out of bounds (length: {})",
                            a.len()
                        ));
                    }
                    current = a[idx].clone();
                }
                _ => {
                    return Err(format!("Cannot index '{part}' on non-array"));
                }
            }
        } else {
            match &current {
                serde_json::Value::Object(o) => {
                    current = o
                        .get(part.as_str())
                        .ok_or_else(|| {
                            format!(
                                "Key '{part}' not found. Available keys: {}",
                                o.keys().cloned().collect::<Vec<_>>().join(", ")
                            )
                        })?
                        .clone();
                }
                _ => {
                    return Err(format!(
                        "Cannot access '{part}' on {}",
                        json_type_name(&current)
                    ));
                }
            }
        }
    }

    Ok(current)
}

/// Return a static type name for a JSON value.
pub fn json_type_name(v: &serde_json::Value) -> &'static str {
    match v {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
}

/// Parse a JSONPath expression into individual path segments.
///
/// Handles dot notation (`a.b.c`) and bracket notation (`a[0].b`).
pub fn parse_path_segments(path: &str) -> Vec<String> {
    let mut segments: Vec<String> = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = path.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        match chars[i] {
            '.' => {
                if !current.is_empty() {
                    segments.push(current.clone());
                    current.clear();
                }
            }
            '[' => {
                if !current.is_empty() {
                    segments.push(current.clone());
                    current.clear();
                }
                i += 1;
                while i < chars.len() && chars[i] != ']' {
                    current.push(chars[i]);
                    i += 1;
                }
                segments.push(current.clone());
                current.clear();
            }
            c => current.push(c),
        }
        i += 1;
    }

    if !current.is_empty() {
        segments.push(current);
    }
    segments
}
