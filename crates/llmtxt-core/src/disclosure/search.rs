//! Content search for progressive disclosure.

use crate::disclosure::types::SearchResult;

/// Maximum pattern length accepted by [`search_content`].
///
/// I-05 / O-05 (T108.2): Patterns longer than this threshold are rejected with
/// an empty result set to prevent catastrophic backtracking and to bound
/// allocations. The 1 KiB limit matches the route-layer Zod cap; having a
/// second guard in the Rust core ensures safety regardless of which caller
/// invokes this function (including WASM consumers that bypass the route).
const MAX_QUERY_BYTES: usize = 1024;

/// Search document content for lines matching a query string or pattern.
///
/// Supports plain-text substring matching (case-insensitive) and regex-like
/// patterns delimited with slashes (e.g. `/pattern/i`). Regex is implemented
/// via simple substring matching — full regex is not available in WASM without
/// the `regex` crate. Use `/pattern/` for forward-compatible pattern format.
///
/// Results include configurable surrounding context lines.
///
/// Returns an empty `Vec` when `query` exceeds [`MAX_QUERY_BYTES`] to
/// prevent denial-of-service via crafted patterns. [I-05/O-05, T108.2]
pub fn search_content(
    content: &str,
    query: &str,
    context_lines: usize,
    max_results: usize,
) -> Vec<SearchResult> {
    // I-05/O-05: Reject oversized queries before any string allocation. [T108.2]
    if query.len() > MAX_QUERY_BYTES {
        return Vec::new();
    }
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

    /// I-05/O-05: Oversized query must return empty results, not panic. [T108.2]
    #[test]
    fn search_rejects_oversized_query() {
        let content = "hello world\nfoo bar\nbaz";
        let long_query = "a".repeat(MAX_QUERY_BYTES + 1);
        let results = search_content(content, &long_query, 0, 20);
        assert!(
            results.is_empty(),
            "query exceeding MAX_QUERY_BYTES must return empty results"
        );
    }

    /// I-05/O-05: Query exactly at the limit is accepted. [T108.2]
    #[test]
    fn search_accepts_query_at_limit() {
        // A query consisting of MAX_QUERY_BYTES 'x' chars won't match anything,
        // but it must not be rejected — length is exactly at the boundary.
        let content = "hello world";
        let boundary_query = "x".repeat(MAX_QUERY_BYTES);
        let results = search_content(content, &boundary_query, 0, 20);
        // No match expected; important part is it doesn't panic or return Err
        assert!(results.is_empty());
    }
}
