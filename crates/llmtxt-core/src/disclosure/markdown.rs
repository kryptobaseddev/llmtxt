//! Markdown section parsing for progressive disclosure.

use crate::calculate_tokens;
use crate::disclosure::types::{Section, TocEntry};

/// Parse markdown content into sections based on heading levels.
pub fn parse_markdown_sections(lines: &[&str]) -> Vec<Section> {
    let mut sections: Vec<Section> = Vec::new();
    let mut current: Option<(String, u32, usize)> = None; // (title, depth, start_line_1based)

    for (i, line) in lines.iter().enumerate() {
        if let Some(stripped) = line.strip_prefix('#') {
            let level = 1 + stripped.chars().take_while(|&c| c == '#').count();
            if level <= 6 {
                let rest = &stripped[level - 1..];
                if rest.starts_with(' ') || rest.is_empty() {
                    let title = rest.trim().to_string();
                    // Close previous section
                    if let Some((prev_title, prev_depth, prev_start)) = current.take() {
                        let section_lines = lines[prev_start - 1..i].join("\n");
                        sections.push(Section {
                            title: prev_title,
                            depth: prev_depth,
                            start_line: prev_start,
                            end_line: i,
                            token_count: calculate_tokens(&section_lines),
                            section_type: "heading".to_string(),
                        });
                    }
                    current = Some((title, (level - 1) as u32, i + 1));
                    continue;
                }
            }
        }
    }

    // Close last section
    if let Some((title, depth, start)) = current {
        let section_lines = lines[start - 1..].join("\n");
        sections.push(Section {
            title,
            depth,
            start_line: start,
            end_line: lines.len(),
            token_count: calculate_tokens(&section_lines),
            section_type: "heading".to_string(),
        });
    }

    sections
}

/// Extract markdown table of contents from lines.
pub fn extract_markdown_toc(lines: &[&str]) -> Vec<TocEntry> {
    let mut toc = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if let Some(stripped) = line.strip_prefix('#') {
            let level = 1 + stripped.chars().take_while(|&c| c == '#').count();
            if level <= 6 {
                let rest = &stripped[level - 1..];
                if rest.starts_with(' ') || rest.is_empty() {
                    toc.push(TocEntry {
                        title: rest.trim().to_string(),
                        depth: level as u32,
                        line: i + 1,
                    });
                }
            }
        }
    }
    toc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_single_heading() {
        let lines = vec!["# Title", "content line"];
        let sections = parse_markdown_sections(&lines);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].title, "Title");
        assert_eq!(sections[0].depth, 0);
    }

    #[test]
    fn parse_multiple_headings() {
        let lines = vec!["# H1", "text", "## H2", "more text", "# H3"];
        let sections = parse_markdown_sections(&lines);
        assert_eq!(sections.len(), 3);
        assert_eq!(sections[0].title, "H1");
        assert_eq!(sections[1].title, "H2");
        assert_eq!(sections[2].title, "H3");
    }

    #[test]
    fn extract_toc_correct_depths() {
        let lines = vec!["# H1", "## H2", "### H3"];
        let toc = extract_markdown_toc(&lines);
        assert_eq!(toc[0].depth, 1);
        assert_eq!(toc[1].depth, 2);
        assert_eq!(toc[2].depth, 3);
    }
}
