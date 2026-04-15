//! Plain text section parsing for progressive disclosure.

use crate::calculate_tokens;
use crate::disclosure::types::Section;

/// Parse plain-text content into paragraph sections.
///
/// Groups text by blank-line-separated paragraphs. If the entire document
/// is one paragraph (no blank lines) and has more than 50 lines, chunks by 50.
pub fn parse_text_sections(lines: &[&str]) -> Vec<Section> {
    let mut sections: Vec<Section> = Vec::new();
    let mut current_start: usize = 0;
    let mut paragraph_num: usize = 0;

    for i in 0..=lines.len() {
        let is_blank = i == lines.len() || lines[i].trim().is_empty();
        if is_blank && i > current_start {
            paragraph_num += 1;
            let section_content = lines[current_start..i].join("\n");
            sections.push(Section {
                title: format!("Paragraph {paragraph_num}"),
                depth: 0,
                start_line: current_start + 1,
                end_line: i,
                token_count: calculate_tokens(&section_content),
                section_type: "heading".to_string(),
            });
        }
        if is_blank {
            current_start = i + 1;
        }
    }

    // If the entire document is one paragraph (or no sections), chunk by 50 lines
    if sections.len() <= 1 && lines.len() > 50 {
        sections.clear();
        let chunk_size = 50usize;
        let mut chunk_num = 0usize;
        let mut i = 0usize;

        while i < lines.len() {
            chunk_num += 1;
            let end = (i + chunk_size).min(lines.len());
            let section_content = lines[i..end].join("\n");
            sections.push(Section {
                title: format!("Lines {}-{}", i + 1, end),
                depth: 0,
                start_line: i + 1,
                end_line: end,
                token_count: calculate_tokens(&section_content),
                section_type: "heading".to_string(),
            });
            i = end;
            let _ = chunk_num; // suppress warning
        }
    }

    sections
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_paragraphs() {
        let lines = vec!["para1 line1", "para1 line2", "", "para2 line1"];
        let sections = parse_text_sections(&lines);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].title, "Paragraph 1");
        assert_eq!(sections[1].title, "Paragraph 2");
    }

    #[test]
    fn text_chunks_long_doc() {
        let lines: Vec<&str> = (0..100).map(|_| "text").collect();
        let sections = parse_text_sections(&lines);
        // 100 / 50 = 2 chunks
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].title, "Lines 1-50");
        assert_eq!(sections[1].title, "Lines 51-100");
    }

    #[test]
    fn text_empty() {
        let sections = parse_text_sections(&[]);
        assert!(sections.is_empty());
    }
}
