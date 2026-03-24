/**
 * Knowledge graph extraction from message metadata.
 * Builds a graph of agents, topics, and decisions from
 * @mentions, #tags, and /directives in message content.
 *
 * Phase 6.5: No external dependencies.
 */

// ── Types ───────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  type: 'agent' | 'topic' | 'decision';
  label: string;
  weight: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'mentions' | 'discusses' | 'decides' | 'participates';
  weight: number;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    agentCount: number;
    topicCount: number;
    decisionCount: number;
    edgeCount: number;
  };
}

export interface MessageInput {
  id: string;
  fromAgentId: string;
  content: string;
  metadata?: {
    mentions?: string[];
    directives?: string[];
    tags?: string[];
  };
  createdAt: string;
}

// ── Extraction ──────────────────────────────────────────────────

const MENTION_RE = /@([a-zA-Z0-9_-]+)/g;
const TAG_RE = /#([a-zA-Z0-9_-]+)/g;
const DIRECTIVE_RE = /^\/(action|info|review|decision|blocked|claim|done|proposal)\b/gm;

/**
 * Extract @mentions from message content.
 */
export function extractMentions(content: string): string[] {
  const matches = [...content.matchAll(MENTION_RE)];
  return [...new Set(matches.map(m => m[1]).filter(m => m !== 'all'))];
}

/**
 * Extract #tags from message content.
 */
export function extractTags(content: string): string[] {
  const matches = [...content.matchAll(TAG_RE)];
  return [...new Set(matches.map(m => m[1]))];
}

/**
 * Extract /directives from message content.
 */
export function extractDirectives(content: string): string[] {
  const matches = [...content.matchAll(DIRECTIVE_RE)];
  return [...new Set(matches.map(m => m[1]))];
}

// ── Graph Building ──────────────────────────────────────────────

/**
 * Build a knowledge graph from an array of messages.
 *
 * Nodes: agents (from fromAgentId + @mentions), topics (#tags), decisions (/decision messages)
 * Edges: mentions (agent→agent), discusses (agent→topic), decides (agent→decision), participates (agent→agent in same conversation)
 */
export function buildGraph(messages: MessageInput[]): KnowledgeGraph {
  const nodeMap = new Map<string, GraphNode>();
  const edgeMap = new Map<string, GraphEdge>();

  function getOrCreateNode(id: string, type: GraphNode['type'], label: string): GraphNode {
    const existing = nodeMap.get(id);
    if (existing) {
      existing.weight++;
      return existing;
    }
    const node: GraphNode = { id, type, label, weight: 1 };
    nodeMap.set(id, node);
    return node;
  }

  function addEdge(source: string, target: string, type: GraphEdge['type']): void {
    const key = `${source}→${target}:${type}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.weight++;
    } else {
      edgeMap.set(key, { source, target, type, weight: 1 });
    }
  }

  for (const msg of messages) {
    const agentId = msg.fromAgentId;
    const mentions = msg.metadata?.mentions ?? extractMentions(msg.content);
    const tags = msg.metadata?.tags ?? extractTags(msg.content);
    const directives = msg.metadata?.directives ?? extractDirectives(msg.content);

    // Agent node
    getOrCreateNode(`agent:${agentId}`, 'agent', agentId);

    // Mention edges (agent → mentioned agent)
    for (const mentioned of mentions) {
      getOrCreateNode(`agent:${mentioned}`, 'agent', mentioned);
      addEdge(`agent:${agentId}`, `agent:${mentioned}`, 'mentions');
    }

    // Topic edges (agent → tag)
    for (const tag of tags) {
      getOrCreateNode(`topic:${tag}`, 'topic', tag);
      addEdge(`agent:${agentId}`, `topic:${tag}`, 'discusses');
    }

    // Decision nodes
    if (directives.includes('decision')) {
      const decisionId = `decision:${msg.id}`;
      const preview = msg.content.slice(0, 80).replace(/\n/g, ' ');
      getOrCreateNode(decisionId, 'decision', preview);
      addEdge(`agent:${agentId}`, decisionId, 'decides');
    }
  }

  const nodes = [...nodeMap.values()];
  const edges = [...edgeMap.values()];

  return {
    nodes,
    edges,
    stats: {
      agentCount: nodes.filter(n => n.type === 'agent').length,
      topicCount: nodes.filter(n => n.type === 'topic').length,
      decisionCount: nodes.filter(n => n.type === 'decision').length,
      edgeCount: edges.length,
    },
  };
}

/**
 * Find the most connected topics in the graph.
 * Returns topics sorted by number of discussing agents.
 */
export function topTopics(graph: KnowledgeGraph, limit = 10): Array<{ topic: string; agents: number }> {
  const topicAgents = new Map<string, Set<string>>();

  for (const edge of graph.edges) {
    if (edge.type === 'discusses') {
      const topic = edge.target.replace('topic:', '');
      if (!topicAgents.has(topic)) topicAgents.set(topic, new Set());
      topicAgents.get(topic)!.add(edge.source.replace('agent:', ''));
    }
  }

  return [...topicAgents.entries()]
    .map(([topic, agents]) => ({ topic, agents: agents.size }))
    .sort((a, b) => b.agents - a.agents)
    .slice(0, limit);
}

/**
 * Find the most active agents in the graph.
 * Returns agents sorted by total edge weight (mentions + discussions + decisions).
 */
export function topAgents(graph: KnowledgeGraph, limit = 10): Array<{ agent: string; activity: number }> {
  const agentActivity = new Map<string, number>();

  for (const edge of graph.edges) {
    if (edge.source.startsWith('agent:')) {
      const agent = edge.source.replace('agent:', '');
      agentActivity.set(agent, (agentActivity.get(agent) ?? 0) + edge.weight);
    }
  }

  return [...agentActivity.entries()]
    .map(([agent, activity]) => ({ agent, activity }))
    .sort((a, b) => b.activity - a.activity)
    .slice(0, limit);
}
