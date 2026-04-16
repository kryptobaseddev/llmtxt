//! Knowledge graph extraction from message metadata.
//!
//! Builds a graph of agents, topics, and decisions from @mentions, #tags,
//! and /directives in message content.
//!
//! Ported from `packages/llmtxt/src/graph.ts`.

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::{HashMap, HashSet};

// ── Types ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub label: String,
    pub weight: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub edge_type: String,
    pub weight: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphStats {
    pub agent_count: usize,
    pub topic_count: usize,
    pub decision_count: usize,
    pub edge_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub stats: GraphStats,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageMetadata {
    pub mentions: Option<Vec<String>>,
    pub directives: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageInput {
    pub id: String,
    pub from_agent_id: String,
    pub content: String,
    pub metadata: Option<MessageMetadata>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopTopic {
    pub topic: String,
    pub agents: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopAgent {
    pub agent: String,
    pub activity: u32,
}

// ── Extraction ─────────────────────────────────────────────────────

/// Extract @mentions from message content.
///
/// Returns unique mention names (excluding `@all`), preserving first-seen order.
pub fn extract_mentions(content: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    let mut i = 0;
    let chars: Vec<char> = content.chars().collect();

    while i < chars.len() {
        if chars[i] == '@' {
            i += 1;
            let start = i;
            while i < chars.len()
                && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '-')
            {
                i += 1;
            }
            let mention: String = chars[start..i].iter().collect();
            if !mention.is_empty() && mention != "all" && seen.insert(mention.clone()) {
                result.push(mention);
            }
        } else {
            i += 1;
        }
    }
    result
}

/// Extract #tags from message content.
///
/// Returns unique tag names, preserving first-seen order.
pub fn extract_tags(content: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    let mut i = 0;
    let chars: Vec<char> = content.chars().collect();

    while i < chars.len() {
        if chars[i] == '#' {
            i += 1;
            let start = i;
            while i < chars.len()
                && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '-')
            {
                i += 1;
            }
            let tag: String = chars[start..i].iter().collect();
            if !tag.is_empty() && seen.insert(tag.clone()) {
                result.push(tag);
            }
        } else {
            i += 1;
        }
    }
    result
}

const DIRECTIVE_KEYWORDS: &[&str] = &[
    "action", "info", "review", "decision", "blocked", "claim", "done", "proposal",
];

/// Extract /directives from message content.
///
/// Returns unique directive keywords from lines starting with `/keyword`.
pub fn extract_directives(content: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();

    for line in content.lines() {
        if let Some(rest) = line.trim_start().strip_prefix('/') {
            // Find the keyword (up to first whitespace or end)
            let keyword: String = rest.chars().take_while(|c| c.is_alphabetic()).collect();
            if DIRECTIVE_KEYWORDS.contains(&keyword.as_str()) && seen.insert(keyword.clone()) {
                result.push(keyword);
            }
        }
    }
    result
}

// ── Graph Building ─────────────────────────────────────────────────

/// Build a knowledge graph from an array of messages.
///
/// Nodes: agents (from fromAgentId + @mentions), topics (#tags), decisions (/decision messages).
/// Edges: mentions (agent→agent), discusses (agent→topic), decides (agent→decision).
pub fn build_graph_native(messages: &[MessageInput]) -> KnowledgeGraph {
    let mut node_map: HashMap<String, GraphNode> = HashMap::new();
    let mut edge_map: HashMap<String, GraphEdge> = HashMap::new();

    let get_or_create =
        |node_map: &mut HashMap<String, GraphNode>, id: &str, node_type: &str, label: &str| {
            if let Some(node) = node_map.get_mut(id) {
                node.weight += 1;
            } else {
                node_map.insert(
                    id.to_string(),
                    GraphNode {
                        id: id.to_string(),
                        node_type: node_type.to_string(),
                        label: label.to_string(),
                        weight: 1,
                    },
                );
            }
        };

    let add_edge =
        |edge_map: &mut HashMap<String, GraphEdge>, source: &str, target: &str, edge_type: &str| {
            let key = format!("{}\u{2192}{}:{}", source, target, edge_type);
            if let Some(edge) = edge_map.get_mut(&key) {
                edge.weight += 1;
            } else {
                edge_map.insert(
                    key,
                    GraphEdge {
                        source: source.to_string(),
                        target: target.to_string(),
                        edge_type: edge_type.to_string(),
                        weight: 1,
                    },
                );
            }
        };

    for msg in messages {
        let agent_id = &msg.from_agent_id;
        let mentions = msg
            .metadata
            .as_ref()
            .and_then(|m| m.mentions.clone())
            .unwrap_or_else(|| extract_mentions(&msg.content));
        let tags = msg
            .metadata
            .as_ref()
            .and_then(|m| m.tags.clone())
            .unwrap_or_else(|| extract_tags(&msg.content));
        let directives = msg
            .metadata
            .as_ref()
            .and_then(|m| m.directives.clone())
            .unwrap_or_else(|| extract_directives(&msg.content));

        let agent_node_id = format!("agent:{agent_id}");
        get_or_create(&mut node_map, &agent_node_id, "agent", agent_id);

        for mentioned in &mentions {
            let mentioned_id = format!("agent:{mentioned}");
            get_or_create(&mut node_map, &mentioned_id, "agent", mentioned);
            add_edge(&mut edge_map, &agent_node_id, &mentioned_id, "mentions");
        }

        for tag in &tags {
            let topic_id = format!("topic:{tag}");
            get_or_create(&mut node_map, &topic_id, "topic", tag);
            add_edge(&mut edge_map, &agent_node_id, &topic_id, "discusses");
        }

        if directives.contains(&"decision".to_string()) {
            let decision_id = format!("decision:{}", msg.id);
            let preview: String = msg
                .content
                .chars()
                .take(80)
                .collect::<String>()
                .replace('\n', " ");
            get_or_create(&mut node_map, &decision_id, "decision", &preview);
            add_edge(&mut edge_map, &agent_node_id, &decision_id, "decides");
        }
    }

    let nodes: Vec<GraphNode> = node_map.into_values().collect();
    let edges: Vec<GraphEdge> = edge_map.into_values().collect();

    let stats = GraphStats {
        agent_count: nodes.iter().filter(|n| n.node_type == "agent").count(),
        topic_count: nodes.iter().filter(|n| n.node_type == "topic").count(),
        decision_count: nodes.iter().filter(|n| n.node_type == "decision").count(),
        edge_count: edges.len(),
    };

    KnowledgeGraph {
        nodes,
        edges,
        stats,
    }
}

/// Find the most connected topics in the graph.
///
/// Returns topics sorted by number of discussing agents, limited to `limit` entries.
pub fn top_topics_native(graph: &KnowledgeGraph, limit: usize) -> Vec<TopTopic> {
    let mut topic_agents: HashMap<String, HashSet<String>> = HashMap::new();

    for edge in &graph.edges {
        if edge.edge_type == "discusses" {
            let topic = edge.target.trim_start_matches("topic:").to_string();
            topic_agents
                .entry(topic)
                .or_default()
                .insert(edge.source.trim_start_matches("agent:").to_string());
        }
    }

    let mut result: Vec<TopTopic> = topic_agents
        .into_iter()
        .map(|(topic, agents)| TopTopic {
            topic,
            agents: agents.len(),
        })
        .collect();

    result.sort_by_key(|t| Reverse(t.agents));
    result.truncate(limit);
    result
}

/// Find the most active agents in the graph.
///
/// Returns agents sorted by total edge weight, limited to `limit` entries.
pub fn top_agents_native(graph: &KnowledgeGraph, limit: usize) -> Vec<TopAgent> {
    let mut agent_activity: HashMap<String, u32> = HashMap::new();

    for edge in &graph.edges {
        if edge.source.starts_with("agent:") {
            let agent = edge.source.trim_start_matches("agent:").to_string();
            *agent_activity.entry(agent).or_default() += edge.weight;
        }
    }

    let mut result: Vec<TopAgent> = agent_activity
        .into_iter()
        .map(|(agent, activity)| TopAgent { agent, activity })
        .collect();

    result.sort_by_key(|a| Reverse(a.activity));
    result.truncate(limit);
    result
}

// ── WASM entry points ──────────────────────────────────────────────

/// Extract @mentions from content. Returns JSON array of strings.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn extract_mentions_wasm(content: &str) -> String {
    serde_json::to_string(&extract_mentions(content)).unwrap_or_else(|_| "[]".to_string())
}

/// Extract #tags from content. Returns JSON array of strings.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn extract_tags_wasm(content: &str) -> String {
    serde_json::to_string(&extract_tags(content)).unwrap_or_else(|_| "[]".to_string())
}

/// Extract /directives from content. Returns JSON array of strings.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn extract_directives_wasm(content: &str) -> String {
    serde_json::to_string(&extract_directives(content)).unwrap_or_else(|_| "[]".to_string())
}

/// Build a knowledge graph from a JSON array of MessageInput objects.
///
/// Returns a JSON-serialised KnowledgeGraph, or `{"error":"..."}` on failure.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn build_graph_wasm(messages_json: &str) -> String {
    let messages: Vec<MessageInput> = match serde_json::from_str(messages_json) {
        Ok(m) => m,
        Err(e) => return format!(r#"{{"error":"Invalid messages JSON: {e}"}}"#),
    };
    let graph = build_graph_native(&messages);
    serde_json::to_string(&graph).unwrap_or_else(|e| format!(r#"{{"error":"Serialization: {e}"}}"#))
}

/// Find the most connected topics.
///
/// `graph_json` is a serialised KnowledgeGraph. `limit` is the max number of results.
/// Returns a JSON array of `{ topic, agents }` objects.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn top_topics_wasm(graph_json: &str, limit: u32) -> String {
    let graph: KnowledgeGraph = match serde_json::from_str(graph_json) {
        Ok(g) => g,
        Err(e) => return format!(r#"{{"error":"Invalid graph JSON: {e}"}}"#),
    };
    let result = top_topics_native(&graph, limit as usize);
    serde_json::to_string(&result)
        .unwrap_or_else(|e| format!(r#"{{"error":"Serialization: {e}"}}"#))
}

/// Find the most active agents.
///
/// `graph_json` is a serialised KnowledgeGraph. `limit` is the max number of results.
/// Returns a JSON array of `{ agent, activity }` objects.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn top_agents_wasm(graph_json: &str, limit: u32) -> String {
    let graph: KnowledgeGraph = match serde_json::from_str(graph_json) {
        Ok(g) => g,
        Err(e) => return format!(r#"{{"error":"Invalid graph JSON: {e}"}}"#),
    };
    let result = top_agents_native(&graph, limit as usize);
    serde_json::to_string(&result)
        .unwrap_or_else(|e| format!(r#"{{"error":"Serialization: {e}"}}"#))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_msg(id: &str, agent: &str, content: &str) -> MessageInput {
        MessageInput {
            id: id.to_string(),
            from_agent_id: agent.to_string(),
            content: content.to_string(),
            metadata: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    // ── extract_mentions ──────────────────────────────────────────

    #[test]
    fn mentions_basic() {
        let m = extract_mentions("hello @alice and @bob");
        assert_eq!(m, vec!["alice", "bob"]);
    }

    #[test]
    fn mentions_dedup() {
        let m = extract_mentions("@alice @alice @bob");
        assert_eq!(m, vec!["alice", "bob"]);
    }

    #[test]
    fn mentions_skip_at_all() {
        let m = extract_mentions("@all @bob");
        assert_eq!(m, vec!["bob"]);
    }

    #[test]
    fn mentions_empty() {
        let m = extract_mentions("no mentions here");
        assert!(m.is_empty());
    }

    // ── extract_tags ──────────────────────────────────────────────

    #[test]
    fn tags_basic() {
        let t = extract_tags("working on #rust and #wasm");
        assert_eq!(t, vec!["rust", "wasm"]);
    }

    #[test]
    fn tags_dedup() {
        let t = extract_tags("#rust #rust #wasm");
        assert_eq!(t, vec!["rust", "wasm"]);
    }

    // ── extract_directives ────────────────────────────────────────

    #[test]
    fn directives_basic() {
        let d = extract_directives("/decision\n/action\n/info");
        assert!(d.contains(&"decision".to_string()));
        assert!(d.contains(&"action".to_string()));
        assert!(d.contains(&"info".to_string()));
    }

    #[test]
    fn directives_unknown_ignored() {
        let d = extract_directives("/unknown-directive");
        assert!(d.is_empty());
    }

    #[test]
    fn directives_dedup() {
        let d = extract_directives("/review\n/review");
        assert_eq!(d.len(), 1);
    }

    // ── build_graph_native ────────────────────────────────────────

    #[test]
    fn graph_builds_agent_nodes() {
        let msgs = vec![
            make_msg("1", "alice", "hello @bob"),
            make_msg("2", "bob", "hi @alice"),
        ];
        let graph = build_graph_native(&msgs);
        assert!(graph.nodes.iter().any(|n| n.id == "agent:alice"));
        assert!(graph.nodes.iter().any(|n| n.id == "agent:bob"));
    }

    #[test]
    fn graph_builds_topic_nodes() {
        let msgs = vec![make_msg("1", "alice", "working on #rust")];
        let graph = build_graph_native(&msgs);
        assert!(graph.nodes.iter().any(|n| n.id == "topic:rust"));
    }

    #[test]
    fn graph_builds_decision_node() {
        let msgs = vec![make_msg("1", "alice", "/decision\nuse Rust")];
        let graph = build_graph_native(&msgs);
        assert!(graph.nodes.iter().any(|n| n.node_type == "decision"));
    }

    #[test]
    fn graph_stats_correct() {
        let msgs = vec![
            make_msg("1", "alice", "@bob #topic"),
            make_msg("2", "bob", "#wasm"),
        ];
        let graph = build_graph_native(&msgs);
        assert_eq!(graph.stats.agent_count, 2);
        assert_eq!(graph.stats.topic_count, 2);
    }

    // ── top_topics ────────────────────────────────────────────────

    #[test]
    fn top_topics_ranking() {
        let msgs = vec![
            make_msg("1", "alice", "#rust"),
            make_msg("2", "bob", "#rust #wasm"),
            make_msg("3", "charlie", "#rust"),
        ];
        let graph = build_graph_native(&msgs);
        let topics = top_topics_native(&graph, 10);
        // rust discussed by 3 agents, wasm by 1
        assert_eq!(topics[0].topic, "rust");
        assert_eq!(topics[0].agents, 3);
    }

    // ── top_agents ────────────────────────────────────────────────

    #[test]
    fn top_agents_ranking() {
        let msgs = vec![
            make_msg("1", "alice", "#topic1 #topic2 @bob"),
            make_msg("2", "bob", "#topic1"),
        ];
        let graph = build_graph_native(&msgs);
        let agents = top_agents_native(&graph, 10);
        assert_eq!(agents[0].agent, "alice");
    }

    // ── WASM JSON roundtrip ───────────────────────────────────────

    #[test]
    fn wasm_extract_mentions_json() {
        let json = extract_mentions_wasm("hello @alice @bob");
        let parsed: Vec<String> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, vec!["alice", "bob"]);
    }

    #[test]
    fn wasm_build_graph_json() {
        let msgs_json = r#"[{"id":"1","fromAgentId":"alice","content":"@bob #rust","createdAt":"2026-01-01T00:00:00Z"}]"#;
        let out = build_graph_wasm(msgs_json);
        let parsed: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(parsed.get("error").is_none());
        assert!(parsed.get("nodes").is_some());
    }

    // Byte-identity vectors matching TypeScript graph.ts
    #[test]
    fn byte_identity_vec1_mentions() {
        // TS: extractMentions('@alice and @bob') => ['alice', 'bob']
        assert_eq!(extract_mentions("@alice and @bob"), vec!["alice", "bob"]);
    }

    #[test]
    fn byte_identity_vec2_tags() {
        // TS: extractTags('working on #rust') => ['rust']
        assert_eq!(extract_tags("working on #rust"), vec!["rust"]);
    }

    #[test]
    fn byte_identity_vec3_directives() {
        // TS: extractDirectives('/decision\n/action') => ['decision', 'action']
        let d = extract_directives("/decision\n/action");
        assert!(d.contains(&"decision".to_string()));
        assert!(d.contains(&"action".to_string()));
    }
}
