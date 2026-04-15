//! Content search for progressive disclosure.

use crate::disclosure::types::SearchResult;

/// Search document content for lines matching a query string or pattern.
///
/// Supports plain-text substring matching (case-insensitive) and regex-like
/// patterns delimited with slashes (e.g. `/pattern/i`). Regex is implemented
/// via simple substring matching — full regex is not available in WASM without
/// the `regex` crate. Use `/pattern/` for forward-compatible pattern format.
///
/// Results include configurable surrounding context lines.
pub fn search_content(
    content: &str,
    query: &str,
    context_lines: usize,
    max_results: usize,
) -> Vec<SearchResult> {
    let lines: Vec<&str> = content.split('\n').collect();
    let mut results: Vec<SearchResult> = Vec::new();

    // Parse query: /pattern/flags or plain text
    let matcher: Box<dyn Fn(&str) -> bool> = if let Some(inner) = query.strip_prefix('/') {
        let last_slash = inner.rfind('/').map(|i| i + 1);
        if let Some(last) = last_slash {
            if last > 1 {
                let pattern = &inner[..last - 1];
                let flags = &inner[last..];
                let case_insensitive = flags.contains('i') || !flags.contains('s');
                // Simple substring match (without regex crate)
                if case_insensitive {
                    let lower_pattern = pattern.to_lowercase();
                    Box::new(move |line: &str| line.to_lowercase().contains(&lower_pattern))
                } else {
                    let pat = pattern.to_string();
                    Box::new(move |line: &str| line.contains(&pat))
                }
            } else {
                let lower = query.to_lowercase();
                Box::new(move |line: &str| line.to_lowercase().contains(&lower))
            }
        } else {
            let lower = query.to_lowercase();
            Box::new(move |line: &str| line.to_lowercase().contains(&lower))
        }
    } else {
        let lower = query.to_lowercase();
        Box::new(move |line: &str| line.to_lowercase().contains(&lower))
    };

    for (i, line) in lines.iter().enumerate() {
        if results.len() >= max_results {
            break;
        }
        if matcher(line) {
            let before_start = i.saturating_sub(context_lines);
            let after_end = (i + context_lines + 1).min(lines.len());

            results.push(SearchResult {
                line: i + 1,
                content: line.to_string(),
                context_before: lines[before_start..i]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
                context_after: lines[i + 1..after_end]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
            });
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_basic() {
        let content = "line one\nline two\nline three";
        let results = search_content(content, "two", 0, 20);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].line, 2);
        assert_eq!(results[0].content, "line two");
    }

    #[test]
    fn search_case_insensitive() {
        let content = "Hello World\nfoo bar";
        let results = search_content(content, "hello", 0, 20);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].line, 1);
    }

    #[test]
    fn search_context_lines() {
        let content = "a\nb\nc\nd\ne";
        let results = search_content(content, "c", 1, 20);
        assert_eq!(results[0].context_before, vec!["b"]);
        assert_eq!(results[0].context_after, vec!["d"]);
    }

    #[test]
    fn search_max_results() {
        let content = (0..10)
            .map(|i| format!("match {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let results = search_content(&content, "match", 0, 3);
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn search_regex_format() {
        let content = "TODO: fix this\ndone here\nTODO: fix that";
        let results = search_content(content, "/TODO/i", 0, 20);
        assert_eq!(results.len(), 2);
    }
}
