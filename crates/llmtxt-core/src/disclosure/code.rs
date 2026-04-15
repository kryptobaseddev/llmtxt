//! Code section parsing for progressive disclosure.

use crate::calculate_tokens;
use crate::disclosure::types::Section;

/// Pattern types that indicate the start of a code section.
struct Pattern {
    prefix: &'static str,
    section_type: &'static str,
}

const PATTERNS: &[Pattern] = &[
    Pattern {
        prefix: "export async function ",
        section_type: "function",
    },
    Pattern {
        prefix: "async function ",
        section_type: "function",
    },
    Pattern {
        prefix: "export function ",
        section_type: "function",
    },
    Pattern {
        prefix: "function ",
        section_type: "function",
    },
    Pattern {
        prefix: "export class ",
        section_type: "class",
    },
    Pattern {
        prefix: "class ",
        section_type: "class",
    },
    Pattern {
        prefix: "export const ",
        section_type: "function",
    },
    Pattern {
        prefix: "const ",
        section_type: "function",
    },
    Pattern {
        prefix: "export let ",
        section_type: "function",
    },
    Pattern {
        prefix: "let ",
        section_type: "function",
    },
    Pattern {
        prefix: "export var ",
        section_type: "function",
    },
    Pattern {
        prefix: "var ",
        section_type: "function",
    },
    Pattern {
        prefix: "def ",
        section_type: "function",
    },
    Pattern {
        prefix: "pub fn ",
        section_type: "function",
    },
    Pattern {
        prefix: "fn ",
        section_type: "function",
    },
    Pattern {
        prefix: "func ",
        section_type: "function",
    },
];

/// Check whether a line matches a function/class pattern and return the symbol name.
fn match_pattern(line: &str) -> Option<(&'static str, String)> {
    for pat in PATTERNS {
        if let Some(rest) = line.strip_prefix(pat.prefix) {
            // Extract identifier (stop at whitespace, '(', '<', '=', '{')
            let name: String = rest
                .chars()
                .take_while(|&c| c.is_alphanumeric() || c == '_')
                .collect();
            if !name.is_empty() {
                return Some((pat.section_type, name));
            }
        }
    }
    None
}

/// Parse code lines into sections based on function/class declarations.
pub fn parse_code_sections(lines: &[&str]) -> Vec<Section> {
    let mut sections: Vec<Section> = Vec::new();

    for (i, line) in lines.iter().enumerate() {
        if let Some((section_type, name)) = match_pattern(line.trim_start()) {
            // Find end of this section (next pattern match)
            let mut end_line = lines.len();
            for (j, next_line) in lines.iter().enumerate().skip(i + 1) {
                if match_pattern(next_line.trim_start()).is_some() {
                    end_line = j;
                    break;
                }
            }
            let section_content = lines[i..end_line].join("\n");
            sections.push(Section {
                title: name,
                depth: 0,
                start_line: i + 1,
                end_line,
                token_count: calculate_tokens(&section_content),
                section_type: section_type.to_string(),
            });
        }
    }

    sections
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_function_declaration() {
        let lines = vec!["function hello() {", "  return 42;", "}"];
        let sections = parse_code_sections(&lines);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].title, "hello");
        assert_eq!(sections[0].section_type, "function");
    }

    #[test]
    fn parse_class_declaration() {
        let lines = vec!["class MyClass {", "  constructor() {}", "}"];
        let sections = parse_code_sections(&lines);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].title, "MyClass");
        assert_eq!(sections[0].section_type, "class");
    }

    #[test]
    fn parse_export_function() {
        let lines = vec!["export function foo() {", "}"];
        let sections = parse_code_sections(&lines);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].title, "foo");
    }
}
