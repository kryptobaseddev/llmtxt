# LLMtxt Specification Document

## Overview

LLMtxt is a text document collaboration system optimized for LLM agents. Unlike textarea.my (which is zero-backend, URL-based), LLMtxt provides a lightweight API-first service with persistent storage and version-based collaboration.

**Key Design Principles:**
- **Low token usage**: Minimal API surface, compressed payloads
- **Dual format support**: JSON (structured/validated) and text/markdown (human-readable)
- **Version-based collaboration**: Each edit creates a new version, no real-time sync
- **URL sharing**: Short, shareable URLs for document access
- **LLM-optimized**: Designed specifically for agent-to-agent and agent-to-human workflows

---

## Architecture Decisions

### Backend Infrastructure

**Recommended Stack:**
- **Runtime**: Node.js with Fastify (lightweight, high performance)
- **Storage**: SQLite with optional PostgreSQL upgrade path
- **Caching**: In-memory LRU cache for hot documents
- **Compression**: Built-in gzip/brotli for HTTP responses
- **URL Shortening**: Base62 encoded document IDs

**Why This Architecture:**
1. **SQLite**: Zero-config, single-file database perfect for MVP. Easy migration to PostgreSQL later.
2. **Fastify**: 2x faster than Express, lower memory footprint, built-in JSON schema validation
3. **Version-based**: Simpler than real-time sync, works better with async LLM workflows
4. **Compression**: Reduces token transfer size significantly

### Storage Strategy

```
Documents Table:
- id (TEXT, PK): base62 encoded UUID
- slug (TEXT): human-readable short URL slug
- format (TEXT): 'json' | 'text'
- schema_version (INTEGER): for JSON format validation
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
- expires_at (TIMESTAMP, optional): TTL support

Versions Table:
- id (TEXT, PK): base62 encoded UUID
- document_id (TEXT, FK): references Documents
- version_number (INTEGER): sequential (1, 2, 3...)
- content (BLOB): compressed content
- content_hash (TEXT): SHA-256 for deduplication
- token_count (INTEGER): estimated tokens
- created_by (TEXT): agent identifier or 'anonymous'
- created_at (TIMESTAMP)
- metadata (JSON): format-specific metadata

Collaborators Table (optional):
- document_id (TEXT, FK)
- agent_id (TEXT)
- access_level (TEXT): 'read' | 'write'
- added_at (TIMESTAMP)
```

---

## API Design

### Base URL
```
https://api.llmtxt.io/v1
```

### 1. Create Document

**Endpoint:** `POST /documents`

**Request Headers:**
```http
Content-Type: application/json
X-Agent-ID: optional-agent-identifier
```

**Request Body:**

**JSON Format:**
```json
{
  "format": "json",
  "schema": "prompt-v1",  // Optional: predefined schema
  "content": {
    "system": "You are a helpful assistant",
    "messages": [
      {"role": "user", "content": "Hello"}
    ],
    "temperature": 0.7
  },
  "metadata": {
    "title": "Chat Session",
    "tags": ["support", "general"]
  },
  "expires_in": 86400  // seconds, optional
}
```

**Text Format:**
```json
{
  "format": "text",
  "content": "# My Document\n\nThis is markdown content...",
  "syntax": "markdown",  // optional: markdown | plain | code
  "metadata": {
    "title": "My Notes"
  }
}
```

**Response:**
```json
{
  "id": "abc123xyz",
  "slug": "abc123",
  "url": "https://llmtxt.io/abc123",
  "api_url": "https://api.llmtxt.io/v1/documents/abc123xyz",
  "format": "json",
  "version": 1,
  "token_count": 42,
  "created_at": "2026-03-08T23:44:31Z",
  "expires_at": null
}
```

### 2. Get Document

**Endpoint:** `GET /documents/{id}`

**Query Parameters:**
- `version`: Specific version number (default: latest)
- `format`: Override response format (optional)
- `compact`: Boolean, return minified JSON if true

**Response (JSON format):**
```json
{
  "id": "abc123xyz",
  "slug": "abc123",
  "format": "json",
  "version": 3,
  "content": {
    "system": "You are a helpful assistant",
    "messages": [...]
  },
  "metadata": {...},
  "token_count": 42,
  "created_at": "...",
  "updated_at": "...",
  "versions_count": 3
}
```

**Response (Text format):**
```json
{
  "id": "abc123xyz",
  "slug": "abc123",
  "format": "text",
  "version": 3,
  "content": "# My Document\n\nContent here...",
  "syntax": "markdown",
  "metadata": {...}
}
```

### 3. Update Document (Create New Version)

**Endpoint:** `PUT /documents/{id}`

Creates a new version while preserving history.

**Request:**
```json
{
  "content": { /* new content */ },
  "changelog": "Added system prompt"  // Optional description
}
```

**Response:**
```json
{
  "id": "abc123xyz",
  "version": 4,
  "previous_version": 3,
  "token_count": 45,
  "created_at": "...",
  "url": "https://llmtxt.io/abc123"
}
```

### 4. List Versions

**Endpoint:** `GET /documents/{id}/versions`

**Response:**
```json
{
  "document_id": "abc123xyz",
  "versions": [
    {
      "version": 3,
      "token_count": 45,
      "created_at": "...",
      "created_by": "agent-123",
      "changelog": "Added system prompt"
    },
    {
      "version": 2,
      "token_count": 42,
      "created_at": "..."
    }
  ]
}
```

### 5. Compare Versions

**Endpoint:** `GET /documents/{id}/compare`

**Query Parameters:**
- `from`: Version number (default: previous)
- `to`: Version number (default: latest)

**Response:**
```json
{
  "document_id": "abc123xyz",
  "from_version": 2,
  "to_version": 3,
  "diff": {
    "added_tokens": 3,
    "removed_tokens": 0,
    "changes": [
      {"op": "add", "path": "/messages/2", "value": {...}}
    ]
  }
}
```

### 6. Fork Document

**Endpoint:** `POST /documents/{id}/fork`

Creates a copy with new ID, optionally at specific version.

**Response:**
```json
{
  "id": "def456uvw",
  "slug": "def456",
  "parent_id": "abc123xyz",
  "parent_version": 3,
  "url": "https://llmtxt.io/def456"
}
```

### 7. Delete Document

**Endpoint:** `DELETE /documents/{id}`

Soft delete with optional purge.

---

## Data Formats

### 1. JSON Format with Validation

**Predefined Schemas:**

#### Schema: `prompt-v1`
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["messages"],
  "properties": {
    "system": {
      "type": "string",
      "description": "System prompt"
    },
    "messages": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["role", "content"],
        "properties": {
          "role": {
            "type": "string",
            "enum": ["system", "user", "assistant", "tool"]
          },
          "content": {
            "type": "string"
          },
          "name": {
            "type": "string"
          }
        }
      }
    },
    "temperature": {
      "type": "number",
      "minimum": 0,
      "maximum": 2
    },
    "max_tokens": {
      "type": "integer",
      "minimum": 1
    }
  }
}
```

#### Schema: `agent-context-v1`
```json
{
  "type": "object",
  "required": ["context", "goals"],
  "properties": {
    "context": {"type": "string"},
    "goals": {
      "type": "array",
      "items": {"type": "string"}
    },
    "constraints": {
      "type": "array",
      "items": {"type": "string"}
    },
    "tools_available": {
      "type": "array",
      "items": {"type": "string"}
    }
  }
}
```

**Custom Schema Support:**
Users can provide custom JSON Schema for validation.

### 2. Text/Markdown Format

**Plain Text:**
```
Raw text content without formatting
```

**Markdown:**
```markdown
# Heading 1
## Heading 2

**Bold** and *italic* text.

- List item 1
- List item 2

```code block```
```

**Code with Language:**
```json
{
  "format": "code",
  "syntax": "python",
  "content": "def hello():\n    print('world')"
}
```

---

## Token Optimization Strategies

### 1. Compression

**Content Storage:**
- Store compressed (gzip/deflate) in database
- Decompress on read
- ~70% reduction for typical text

**API Responses:**
- HTTP compression (brotli/gzip)
- Minified JSON with `?compact=true`

### 2. Efficient Encoding

**Document IDs:**
- Base62 encoding: `a-zA-Z0-9` (62 characters)
- 8-character ID = 62^8 = 218 trillion combinations
- URL-safe, no encoding needed

**Example IDs:**
```
abc123xyz
xK9mP2nQ
```

### 3. Selective Field Retrieval

**Field Selection:**
```http
GET /documents/abc123?fields=id,content,version
```

**Exclude Content:**
```http
GET /documents/abc123?exclude=content
```

### 4. Diff-based Updates

Instead of sending full content:
```json
{
  "patch": [
    {"op": "add", "path": "/messages/-", "value": {...}}
  ]
}
```

### 5. Token Counting

**Automatic Calculation:**
- Use tiktoken (OpenAI) or similar for accurate counts
- Store in metadata
- Include in API responses

---

## URL Design

### Short URLs

**Format:** `https://llmtxt.io/{slug}`

**Slug Generation:**
1. Generate UUID
2. Base62 encode first 48 bits → 8 characters
3. Check for collisions
4. Reserve profanity-free slugs

**Examples:**
```
https://llmtxt.io/abc123
https://llmtxt.io/xK9mP2nQ
```

### API URLs

**Format:** `https://api.llmtxt.io/v1/documents/{id}`

**Version-specific:**
```
https://api.llmtxt.io/v1/documents/abc123?version=3
```

### QR Code Support

Generate QR codes for easy mobile sharing:
```
https://llmtxt.io/qr/abc123
```

---

## Collaboration Model (Version-Based)

### Workflow

1. **Agent A** creates document → Gets URL
2. **Agent A** shares URL with Agent B
3. **Agent B** reads document
4. **Agent B** creates new version with changes
5. **Agent A** sees new version available
6. **Agent A** can compare versions

### Access Control

**Simple Model (Default):**
- Anyone with URL can read
- Anyone with URL can write (creates new version)
- No authentication required

**Enhanced Model (Optional):**
- Read tokens vs Write tokens
- Agent identification via `X-Agent-ID` header
- Audit log of who created each version

### Conflict Resolution

**No Conflicts (Version-Based):**
- Each write creates new version
- No merge conflicts
- Agents can fork if they diverge

**Branching:**
```
Document v1
    ├── v2 (Agent A)
    └── v3 (Agent B) → Forks to new document
```

---

## Implementation Phases

### Phase 1: MVP (Core API)
- [ ] Basic CRUD operations
- [ ] SQLite storage
- [ ] Text format support
- [ ] URL generation
- [ ] Simple version tracking

### Phase 2: Enhanced Features
- [ ] JSON format with validation
- [ ] Schema definitions
- [ ] Token counting
- [ ] Compression
- [ ] Fork functionality

### Phase 3: Advanced
- [ ] Diff/patch operations
- [ ] Access control
- [ ] Expiration/TTL
- [ ] Rate limiting
- [ ] Webhook notifications

---

## Security Considerations

### Data Privacy
- Documents are encrypted at rest (SQLite encryption)
- HTTPS only
- No sensitive data logged
- Optional document expiration

### Abuse Prevention
- Rate limiting per IP/agent
- Maximum document size (e.g., 1MB)
- Maximum versions per document (e.g., 100)
- Content scanning for malicious data

### URL Safety
- Short URLs are unguessable
- No sequential IDs
- Slug validation (no profanity)

---

## Example Workflows

### Workflow 1: LLM Chat Session

```javascript
// Agent A creates conversation
const doc = await fetch('https://api.llmtxt.io/v1/documents', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    format: 'json',
    schema: 'prompt-v1',
    content: {
      system: 'You are a coding assistant',
      messages: [
        {role: 'user', content: 'Help me write a function'}
      ]
    }
  })
});

// Response: {id: 'abc123', url: 'https://llmtxt.io/abc123', ...}

// Agent B reads and continues
const response = await fetch('https://api.llmtxt.io/v1/documents/abc123');
const conversation = await response.json();

// Agent B adds assistant response
await fetch('https://api.llmtxt.io/v1/documents/abc123', {
  method: 'PUT',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    content: {
      ...conversation.content,
      messages: [
        ...conversation.content.messages,
        {role: 'assistant', content: 'Here is the function...'}
      ]
    }
  })
});
```

### Workflow 2: Collaborative Document

```javascript
// Agent A creates markdown document
const doc = await fetch('https://api.llmtxt.io/v1/documents', {
  method: 'POST',
  body: JSON.stringify({
    format: 'text',
    syntax: 'markdown',
    content: '# Project Plan\n\n## Goals\n- Goal 1'
  })
});

// Share URL with Agent B
// Agent B edits and creates v2
// Agent A views version history
const versions = await fetch('https://api.llmtxt.io/v1/documents/abc123/versions');
```

### Workflow 3: Agent Context Sharing

```javascript
// Agent A prepares context for Agent B
const context = await fetch('https://api.llmtxt.io/v1/documents', {
  method: 'POST',
  body: JSON.stringify({
    format: 'json',
    schema: 'agent-context-v1',
    content: {
      context: 'Customer is asking about refund policy',
      goals: ['Explain refund process', 'Offer alternative'],
      constraints: ['Be polite', 'Follow company policy'],
      tools_available: ['search_kb', 'create_ticket']
    }
  })
});

// Agent B receives context via URL and takes over
```

---

## Database Schema

```sql
-- Documents table
CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('json', 'text')),
    schema_name TEXT,
    schema_version INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    metadata JSON
);

-- Versions table
CREATE TABLE versions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    content BLOB NOT NULL,  -- compressed
    content_hash TEXT NOT NULL,
    token_count INTEGER,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    changelog TEXT,
    metadata JSON,
    UNIQUE(document_id, version_number)
);

-- Indexes
CREATE INDEX idx_documents_slug ON documents(slug);
CREATE INDEX idx_versions_document ON versions(document_id);
CREATE INDEX idx_versions_number ON versions(document_id, version_number);
```

---

## Success Metrics

- **Token Efficiency**: 50%+ reduction vs sending full content repeatedly
- **API Response Time**: <100ms for 95th percentile
- **Availability**: 99.9% uptime
- **Document Load**: Support 1000+ concurrent documents
- **Storage**: <1MB per document (compressed)

---

## Future Enhancements

1. **Real-time collaboration** (WebSockets) - if version-based becomes limiting
2. **Advanced permissions** (teams, organizations)
3. **Webhooks** (notify on new versions)
4. **Analytics** (token usage, popular documents)
5. **CLI tool** for easy integration
6. **IDE plugins** (VS Code, Cursor)
7. **Template library** (predefined schemas)

---

## Conclusion

LLMtxt bridges the gap between textarea.my's simplicity and full collaborative document systems. By focusing on:
- Low token usage
- Dual format support
- Version-based collaboration
- Simple API

We create a tool optimized for LLM agent workflows while remaining lightweight and easy to deploy.
