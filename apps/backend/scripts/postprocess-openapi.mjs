/**
 * Post-process the forge-ts generated openapi.json to:
 * 1. Upgrade version to OpenAPI 3.1.0
 * 2. Detect path parameters (query params whose name matches a path segment)
 * 3. Convert matching segments to {param} OpenAPI template notation
 * 4. Fix in:"query" → in:"path" + required:true for those params
 * 5. Inject server info, security schemes, and tags
 * 6. Add response schemas for all operations (operationId-keyed map)
 * 7. Add routes missing from the forge-ts manifest (blobs, export, collections, etc.)
 * 8. Fix tags so each operation has a domain tag (not just "openapi-manifest")
 *
 * forge-ts strips {slug} → slug because TSDoc interprets {...} as inline link tags.
 * This script recovers the intent by matching param names to path segments.
 *
 * Usage: node scripts/postprocess-openapi.mjs [inputPath] [outputPath]
 * Default: in-place on openapi.json
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const inputPath = resolve(process.argv[2] ?? 'openapi.json');
const outputPath = resolve(process.argv[3] ?? inputPath);

const raw = readFileSync(inputPath, 'utf-8');
const spec = JSON.parse(raw);

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Given a path string like /api/documents/slug/versions/num and a set of
 * parameter names from the operation (e.g. {slug, num}), return the OpenAPI
 * path template: /api/documents/{slug}/versions/{num}
 */
function templatePath(rawPath, paramNames) {
  const segments = rawPath.split('/');
  return segments.map(seg => {
    if (paramNames.has(seg)) return `{${seg}}`;
    return seg;
  }).join('/');
}

/**
 * Collect all query-param names from an operation that look like they should
 * be path params (their name appears verbatim as a path segment).
 */
function detectPathParams(rawPath, operation) {
  const segments = new Set(rawPath.split('/').filter(s => s.length > 0));
  const pathParamNames = new Set();
  for (const param of (operation.parameters ?? [])) {
    if (segments.has(param.name)) {
      pathParamNames.add(param.name);
    }
  }
  return pathParamNames;
}

// Collect all param names across ALL operations in a path item
// so we get a consistent template for all methods sharing a path
function collectAllPathParams(rawPath, pathItem) {
  const allNames = new Set();
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!operation || typeof operation !== 'object') continue;
    const names = detectPathParams(rawPath, operation);
    for (const n of names) allNames.add(n);
  }
  return allNames;
}

// ── Standard Error Schema ─────────────────────────────────────────────────────

const errorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
    statusCode: { type: 'integer' },
  },
  required: ['error'],
};

const errorResponse = (description) => ({
  description,
  content: { 'application/json': { schema: errorSchema } },
});

// ── Response Map (keyed by operationId) ───────────────────────────────────────
// Every operation in the spec must appear here.

const RESPONSES = {
  // ── Documents ──────────────────────────────────────────────────────────────
  postCompress: {
    201: {
      description: 'Document stored successfully',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              slug: { type: 'string' },
              url: { type: 'string', format: 'uri' },
              format: { type: 'string', enum: ['json', 'text', 'markdown'] },
              tokenCount: { type: 'integer' },
              compressionRatio: { type: 'number' },
              originalSize: { type: 'integer' },
              compressedSize: { type: 'integer' },
            },
          },
        },
      },
    },
    400: errorResponse('Validation failed — invalid body or unknown schema'),
    413: errorResponse('Content too large (exceeds limit)'),
    429: errorResponse('Write rate limit exceeded'),
  },

  wsDocumentStream: {
    101: { description: 'WebSocket upgrade — real-time document event stream' },
    401: { description: 'Unauthenticated (WS close code 4401)' },
  },

  putDocument: {
    200: {
      description: 'New version created',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              versionNumber: { type: 'integer' },
              tokenCount: { type: 'integer' },
              compressionRatio: { type: 'number' },
            },
          },
        },
      },
    },
    403: errorResponse('Write access denied'),
    404: errorResponse('Document not found'),
    423: errorResponse('Document is locked (LOCKED state)'),
    429: errorResponse('Write rate limit exceeded'),
  },

  postDecompress: {
    200: {
      description: 'Document decompressed',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              format: { type: 'string' },
              tokenCount: { type: 'integer' },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  postValidate: {
    200: {
      description: 'Content is valid',
      content: {
        'application/json': {
          schema: { type: 'object', properties: { valid: { type: 'boolean', enum: [true] } } },
        },
      },
    },
    400: errorResponse('Validation failed with detailed errors'),
  },

  getDocument: {
    200: {
      description: 'Document content',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              slug: { type: 'string' },
              content: { type: 'string' },
              format: { type: 'string' },
              tokenCount: { type: 'integer' },
              compressionRatio: { type: 'number' },
              originalSize: { type: 'integer' },
              compressedSize: { type: 'integer' },
            },
          },
        },
      },
    },
    403: errorResponse('Access denied (private document)'),
    404: errorResponse('Document not found'),
  },

  getDocumentsMine: {
    200: {
      description: 'List of owned documents',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              documents: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    slug: { type: 'string' },
                    format: { type: 'string' },
                    tokenCount: { type: 'integer' },
                    createdAt: { type: 'string', format: 'date-time' },
                    state: { type: 'string' },
                  },
                },
              },
              total: { type: 'integer' },
            },
          },
        },
      },
    },
    401: errorResponse('Authentication required'),
  },

  getSchemas: {
    200: {
      description: 'Available schema names',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { schemas: { type: 'array', items: { type: 'string' } } },
          },
        },
      },
    },
  },

  getSchema: {
    200: {
      description: 'JSON schema object',
      content: { 'application/json': { schema: { type: 'object' } } },
    },
    404: errorResponse('Schema not found'),
  },

  getStatsCache: {
    200: {
      description: 'Cache statistics',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              hits: { type: 'integer' },
              misses: { type: 'integer' },
              size: { type: 'integer' },
            },
          },
        },
      },
    },
  },

  deleteCache: {
    200: {
      description: 'Cache cleared',
      content: {
        'application/json': {
          schema: { type: 'object', properties: { cleared: { type: 'integer' } } },
        },
      },
    },
    401: errorResponse('Authentication required (admin only)'),
  },

  getLlmsTxt: {
    200: {
      description: 'Plain text llms.txt autodiscovery file',
      content: { 'text/plain': { schema: { type: 'string' } } },
    },
  },

  // ── Versions ────────────────────────────────────────────────────────────────
  getDocumentVersions: {
    200: {
      description: 'Version list',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              versions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    versionNumber: { type: 'integer' },
                    tokenCount: { type: 'integer' },
                    createdAt: { type: 'string', format: 'date-time' },
                    createdBy: { type: 'string' },
                    changelog: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  getDocumentVersion: {
    200: {
      description: 'Specific version content',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              versionNumber: { type: 'integer' },
              tokenCount: { type: 'integer' },
              createdAt: { type: 'string', format: 'date-time' },
              createdBy: { type: 'string' },
            },
          },
        },
      },
    },
    404: errorResponse('Document or version not found'),
  },

  getDocumentDiff: {
    200: {
      description: 'Two-way diff between versions',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              diff: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['add', 'remove', 'equal'] },
                    content: { type: 'string' },
                    lineNumber: { type: 'integer' },
                  },
                },
              },
              fromVersion: { type: 'integer' },
              toVersion: { type: 'integer' },
            },
          },
        },
      },
    },
    400: errorResponse('Invalid version numbers'),
    404: errorResponse('Document or version not found'),
  },

  getDocumentMultiDiff: {
    200: {
      description: 'Multi-way LCS-aligned diff',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              lines: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' },
                    content: { type: 'string' },
                    versions: { type: 'array', items: { type: 'integer' } },
                  },
                },
              },
              versions: { type: 'array', items: { type: 'integer' } },
            },
          },
        },
      },
    },
    400: errorResponse('Fewer than 2 versions specified'),
    404: errorResponse('Document or version not found'),
  },

  postBatchVersions: {
    200: {
      description: 'Batch versions created',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              created: { type: 'integer' },
              latestVersion: { type: 'integer' },
            },
          },
        },
      },
    },
    400: errorResponse('Invalid batch payload'),
    404: errorResponse('Document not found'),
  },

  // ── Lifecycle / Approvals ────────────────────────────────────────────────────
  postDocumentTransition: {
    200: {
      description: 'State transitioned',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              state: { type: 'string', enum: ['DRAFT', 'REVIEW', 'APPROVED', 'LOCKED', 'REJECTED'] },
              previousState: { type: 'string' },
            },
          },
        },
      },
    },
    400: errorResponse('Invalid transition'),
    403: errorResponse('Insufficient permissions'),
    404: errorResponse('Document not found'),
  },

  postDocumentApprove: {
    201: {
      description: 'Approval recorded',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              approvalId: { type: 'string' },
              agentId: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
    409: errorResponse('Already approved by this agent'),
  },

  postDocumentReject: {
    200: {
      description: 'Document rejected',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              state: { type: 'string', enum: ['REJECTED'] },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  getDocumentApprovals: {
    200: {
      description: 'Approval records',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              approvals: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    agentId: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                    comment: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  getDocumentContributors: {
    200: {
      description: 'Contributor statistics',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              contributors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    agentId: { type: 'string' },
                    versionsAuthored: { type: 'integer' },
                    netTokens: { type: 'integer' },
                    firstContribution: { type: 'string', format: 'date-time' },
                    lastContribution: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  // ── Agent Keys ───────────────────────────────────────────────────────────────
  postAgentKey: {
    201: {
      description: 'Agent key registered',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              fingerprint: { type: 'string' },
              pubkey_hex: { type: 'string' },
              label: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    400: errorResponse('Invalid Ed25519 public key'),
    401: errorResponse('Authentication required'),
  },

  getAgentKeys: {
    200: {
      description: 'Agent key list',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              keys: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    fingerprint: { type: 'string' },
                    pubkey_hex: { type: 'string' },
                    label: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    401: errorResponse('Authentication required'),
  },

  deleteAgentKey: {
    200: {
      description: 'Key revoked',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              revokedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    401: errorResponse('Authentication required'),
    404: errorResponse('Key not found or belongs to another user'),
  },

  // ── API Keys ─────────────────────────────────────────────────────────────────
  postApiKey: {
    201: {
      description: 'API key created — key value shown once',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              key: { type: 'string' },
              name: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
              expiresAt: { type: 'string', format: 'date-time', nullable: true },
            },
          },
        },
      },
    },
    401: errorResponse('Authentication required'),
  },

  getApiKeys: {
    200: {
      description: 'API key list',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              keys: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                    expiresAt: { type: 'string', format: 'date-time', nullable: true },
                    lastUsed: { type: 'string', format: 'date-time', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    401: errorResponse('Authentication required'),
  },

  deleteApiKey: {
    200: {
      description: 'API key deleted',
      content: {
        'application/json': {
          schema: { type: 'object', properties: { id: { type: 'string' } } },
        },
      },
    },
    401: errorResponse('Authentication required'),
    404: errorResponse('Key not found'),
  },

  postApiKeyRotate: {
    200: {
      description: 'New key value — shown once',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { id: { type: 'string' }, key: { type: 'string' } },
          },
        },
      },
    },
    401: errorResponse('Authentication required'),
    404: errorResponse('Key not found'),
  },

  // ── Health / Metrics ─────────────────────────────────────────────────────────
  getHealth: {
    200: {
      description: 'Service is alive',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok'] },
              version: { type: 'string' },
              ts: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  },

  getReady: {
    200: {
      description: 'Service is ready',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok'] },
              version: { type: 'string' },
              ts: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    503: errorResponse('Database unavailable'),
  },

  getMetrics: {
    200: {
      description: 'Prometheus text metrics',
      content: { 'text/plain': { schema: { type: 'string' } } },
    },
    401: errorResponse('Invalid or missing token'),
  },

  // ── Progressive Disclosure ───────────────────────────────────────────────────
  getDocumentOverview: {
    200: {
      description: 'Document structure overview',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              sectionCount: { type: 'integer' },
              tokenCount: { type: 'integer' },
              format: { type: 'string' },
              sections: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  getDocumentSections: {
    200: {
      description: 'All document sections',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              sections: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    content: { type: 'string' },
                    tokenCount: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  getDocumentToc: {
    200: {
      description: 'Table of contents',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              toc: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    heading: { type: 'string' },
                    level: { type: 'integer' },
                    anchor: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  getDocumentSection: {
    200: {
      description: 'Named section content',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              content: { type: 'string' },
              tokenCount: { type: 'integer' },
            },
          },
        },
      },
    },
    404: errorResponse('Document or section not found'),
  },

  getDocumentSearch: {
    200: {
      description: 'Search results within document',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    section: { type: 'string' },
                    excerpt: { type: 'string' },
                    score: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  getDocumentRaw: {
    200: {
      description: 'Raw document content',
      content: { 'text/plain': { schema: { type: 'string' } } },
    },
    404: errorResponse('Document not found'),
  },

  postDocumentBatch: {
    200: {
      description: 'Batch section results',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              sections: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    content: { type: 'string' },
                    tokenCount: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  // ── CRDT ─────────────────────────────────────────────────────────────────────
  getSectionCrdtState: {
    200: {
      description: 'CRDT state (base64-encoded)',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { state: { type: 'string', description: 'base64-encoded CRDT state vector' } },
          },
        },
      },
    },
    404: errorResponse('Document or section not found'),
  },

  postSectionCrdtUpdate: {
    200: {
      description: 'CRDT update applied',
      content: {
        'application/json': {
          schema: { type: 'object', properties: { applied: { type: 'boolean' } } },
        },
      },
    },
    400: errorResponse('Invalid update payload'),
    404: errorResponse('Document or section not found'),
  },

  wsDocumentSectionCollab: {
    101: { description: 'WebSocket upgrade — CRDT collaboration session' },
    401: { description: 'Unauthenticated (WS close code 4401)' },
    403: { description: 'Forbidden — insufficient role (WS close code 4403)' },
  },

  // ── Presence ─────────────────────────────────────────────────────────────────
  getDocumentPresence: {
    200: {
      description: 'Active agents in document',
      content: {
        'application/json': {
          schema: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                agentId: { type: 'string' },
                section: { type: 'string' },
                cursorOffset: { type: 'integer' },
                lastSeen: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  // ── Leases ────────────────────────────────────────────────────────────────────
  postSectionLease: {
    201: {
      description: 'Lease acquired',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              leaseId: { type: 'string' },
              agentId: { type: 'string' },
              expiresAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
    409: errorResponse('Section already leased by another agent'),
  },

  getSectionLease: {
    200: {
      description: 'Current lease holder (or null)',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              leaseId: { type: 'string', nullable: true },
              agentId: { type: 'string' },
              expiresAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  deleteSectionLease: {
    200: {
      description: 'Lease released',
      content: {
        'application/json': {
          schema: { type: 'object', properties: { released: { type: 'boolean' } } },
        },
      },
    },
    404: errorResponse('Lease not found or not owned by caller'),
  },

  patchSectionLease: {
    200: {
      description: 'Lease renewed',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              leaseId: { type: 'string' },
              expiresAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    404: errorResponse('Lease not found or expired'),
  },

  // ── Scratchpad ────────────────────────────────────────────────────────────────
  postDocumentScratchpad: {
    201: {
      description: 'Scratchpad entry created',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              agentId: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  getDocumentScratchpad: {
    200: {
      description: 'Scratchpad entries',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              entries: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    agentId: { type: 'string' },
                    content: { type: 'string' },
                    section: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  getDocumentScratchpadStream: {
    200: {
      description: 'SSE stream of scratchpad entries',
      content: { 'text/event-stream': { schema: { type: 'string' } } },
    },
    404: errorResponse('Document not found'),
  },

  // ── BFT ───────────────────────────────────────────────────────────────────────
  postBftVote: {
    201: {
      description: 'BFT vote submitted',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              voteId: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'consensus', 'byzantine'] },
            },
          },
        },
      },
    },
    400: errorResponse('Invalid vote payload'),
    404: errorResponse('Document not found'),
  },

  getBftStatus: {
    200: {
      description: 'BFT consensus status',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['pending', 'consensus', 'byzantine'] },
              votes: { type: 'integer' },
              quorum: { type: 'integer' },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  getDocumentChain: {
    200: {
      description: 'BFT hash chain for audit',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              chain: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    blockIndex: { type: 'integer' },
                    hash: { type: 'string' },
                    prevHash: { type: 'string' },
                    agentId: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  // ── A2A Messaging ─────────────────────────────────────────────────────────────
  postAgentInbox: {
    201: {
      description: 'Message queued',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              messageId: { type: 'string' },
              queued: { type: 'boolean' },
            },
          },
        },
      },
    },
    404: errorResponse('Agent not found'),
  },

  getAgentInbox: {
    200: {
      description: 'Agent inbox messages',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              messages: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    from: { type: 'string' },
                    content: { type: 'string' },
                    replyTo: { type: 'string' },
                    ts: { type: 'string', format: 'date-time' },
                  },
                },
              },
              count: { type: 'integer' },
            },
          },
        },
      },
    },
    404: errorResponse('Agent not found'),
  },

  // ── Document Events ───────────────────────────────────────────────────────────
  getDocumentEvents: {
    200: {
      description: 'Document event log',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              events: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    type: { type: 'string' },
                    agentId: { type: 'string' },
                    ts: { type: 'string', format: 'date-time' },
                    payload: { type: 'object' },
                  },
                },
              },
              total: { type: 'integer' },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  getDocumentEventsStream: {
    200: {
      description: 'SSE stream of document events',
      content: { 'text/event-stream': { schema: { type: 'string' } } },
    },
    404: errorResponse('Document not found'),
  },

  // ── Subscribe ─────────────────────────────────────────────────────────────────
  getSubscribe: {
    200: {
      description: 'SSE stream of global events',
      content: { 'text/event-stream': { schema: { type: 'string' } } },
    },
  },

  // ── Signed URLs ───────────────────────────────────────────────────────────────
  postSignedUrl: {
    201: {
      description: 'Signed URL generated',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              url: { type: 'string', format: 'uri' },
              expiresAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  // ── Merge ─────────────────────────────────────────────────────────────────────
  postDocumentMerge: {
    200: {
      description: 'Merged document',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              merged: { type: 'string' },
              conflicts: { type: 'integer' },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
    409: errorResponse('Unresolvable conflict detected'),
  },

  // ── Patches ───────────────────────────────────────────────────────────────────
  postDocumentPatch: {
    200: {
      description: 'Patch applied',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              versionNumber: { type: 'integer' },
              applied: { type: 'boolean' },
            },
          },
        },
      },
    },
    400: errorResponse('Patch failed to apply cleanly'),
    404: errorResponse('Document not found'),
  },

  // ── Cross-Document / Search ───────────────────────────────────────────────────
  postSearch: {
    200: {
      description: 'Cross-document search results',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    slug: { type: 'string' },
                    excerpt: { type: 'string' },
                    score: { type: 'number' },
                    format: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },

  getDocumentLinks: {
    200: {
      description: 'Outgoing document links',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              links: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    targetSlug: { type: 'string' },
                    label: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  postDocumentLink: {
    201: {
      description: 'Link created',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              sourceSlug: { type: 'string' },
              targetSlug: { type: 'string' },
              label: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    404: errorResponse('Source or target document not found'),
  },

  deleteDocumentLink: {
    200: {
      description: 'Link deleted',
      content: {
        'application/json': {
          schema: { type: 'object', properties: { deleted: { type: 'boolean' } } },
        },
      },
    },
    404: errorResponse('Link not found'),
  },

  getGraph: {
    200: {
      description: 'Cross-document relationship graph',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              nodes: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { id: { type: 'string' }, slug: { type: 'string' } },
                },
              },
              edges: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    source: { type: 'string' },
                    target: { type: 'string' },
                    label: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },

  // ── Semantic Diff ─────────────────────────────────────────────────────────────
  postDocumentSemanticDiff: {
    200: {
      description: 'Semantic diff results',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              sections: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    similarity: { type: 'number' },
                    changed: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  getDocumentSemanticSimilarity: {
    200: {
      description: 'Cosine similarity score',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { similarity: { type: 'number' } },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  postDocumentSemanticConsensus: {
    200: {
      description: 'Semantic consensus result',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              consensus: { type: 'boolean' },
              score: { type: 'number' },
              divergentAgents: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  // ── Well-Known Agents ─────────────────────────────────────────────────────────
  getWellKnownAgent: {
    200: {
      description: 'Agent descriptor',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              capabilities: { type: 'array', items: { type: 'string' } },
              protocols: { type: 'array', items: { type: 'string' } },
              publicKey: { type: 'string' },
            },
          },
        },
      },
    },
    404: errorResponse('Agent not found'),
  },

  // ── Webhooks ──────────────────────────────────────────────────────────────────
  postWebhook: {
    201: {
      description: 'Webhook registered',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              url: { type: 'string', format: 'uri' },
              events: { type: 'array', items: { type: 'string' } },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    400: errorResponse('Invalid URL or event types'),
    401: errorResponse('Authentication required'),
  },

  getWebhooks: {
    200: {
      description: 'Webhook list',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              webhooks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    url: { type: 'string', format: 'uri' },
                    events: { type: 'array', items: { type: 'string' } },
                    createdAt: { type: 'string', format: 'date-time' },
                    lastDelivery: { type: 'string', format: 'date-time', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    401: errorResponse('Authentication required'),
  },

  deleteWebhook: {
    200: {
      description: 'Webhook deleted',
      content: {
        'application/json': {
          schema: { type: 'object', properties: { deleted: { type: 'boolean' } } },
        },
      },
    },
    401: errorResponse('Authentication required'),
    404: errorResponse('Webhook not found'),
  },

  // ── Access Control ────────────────────────────────────────────────────────────
  getDocumentAccess: {
    200: {
      description: 'Document ACL',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              roles: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    userId: { type: 'string' },
                    role: { type: 'string', enum: ['viewer', 'editor', 'admin'] },
                  },
                },
              },
              visibility: { type: 'string', enum: ['public', 'private'] },
            },
          },
        },
      },
    },
    404: errorResponse('Document not found'),
  },

  postDocumentAccess: {
    201: {
      description: 'Role granted',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              role: { type: 'string' },
              grantedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    403: errorResponse('Only document owners can grant roles'),
    404: errorResponse('Document not found'),
  },

  deleteDocumentAccess: {
    200: {
      description: 'Role revoked',
      content: {
        'application/json': {
          schema: { type: 'object', properties: { revoked: { type: 'boolean' } } },
        },
      },
    },
    404: errorResponse('Role not found'),
  },

  // ── Organizations ─────────────────────────────────────────────────────────────
  postOrganization: {
    201: {
      description: 'Organization created',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              slug: { type: 'string' },
              name: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    401: errorResponse('Authentication required'),
  },

  getOrganizations: {
    200: {
      description: 'Organization list',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              organizations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    slug: { type: 'string' },
                    name: { type: 'string' },
                    role: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    401: errorResponse('Authentication required'),
  },

  getOrganization: {
    200: {
      description: 'Organization details',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              slug: { type: 'string' },
              name: { type: 'string' },
              members: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    userId: { type: 'string' },
                    role: { type: 'string', enum: ['member', 'admin'] },
                  },
                },
              },
            },
          },
        },
      },
    },
    404: errorResponse('Organization not found'),
  },

  postOrganizationMember: {
    201: {
      description: 'Member added',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              role: { type: 'string' },
            },
          },
        },
      },
    },
    403: errorResponse('Only org admins can add members'),
  },

  deleteOrganizationMember: {
    200: {
      description: 'Member removed',
      content: {
        'application/json': {
          schema: { type: 'object', properties: { removed: { type: 'boolean' } } },
        },
      },
    },
    403: errorResponse('Only org admins can remove members'),
  },
};

// ── Tag Map (operationId → tag) ───────────────────────────────────────────────

const TAG_MAP = {
  postCompress: 'documents', postDecompress: 'documents', postValidate: 'documents',
  getDocument: 'documents', putDocument: 'documents', getDocumentsMine: 'documents',
  getSchemas: 'schemas', getSchema: 'schemas',
  getStatsCache: 'system', deleteCache: 'system', getLlmsTxt: 'system',
  getDocumentVersions: 'versions', getDocumentVersion: 'versions',
  getDocumentDiff: 'versions', getDocumentMultiDiff: 'versions',
  postBatchVersions: 'versions',
  postDocumentTransition: 'lifecycle', postDocumentApprove: 'lifecycle',
  postDocumentReject: 'lifecycle', getDocumentApprovals: 'lifecycle',
  getDocumentContributors: 'lifecycle',
  postAgentKey: 'agent-keys', getAgentKeys: 'agent-keys', deleteAgentKey: 'agent-keys',
  postApiKey: 'api-keys', getApiKeys: 'api-keys', deleteApiKey: 'api-keys',
  postApiKeyRotate: 'api-keys',
  getHealth: 'health', getReady: 'health', getMetrics: 'health',
  getDocumentOverview: 'disclosure', getDocumentSections: 'disclosure',
  getDocumentToc: 'disclosure', getDocumentSection: 'disclosure',
  getDocumentSearch: 'disclosure', getDocumentRaw: 'disclosure',
  postDocumentBatch: 'disclosure',
  getSectionCrdtState: 'crdt', postSectionCrdtUpdate: 'crdt',
  wsDocumentSectionCollab: 'crdt', wsDocumentStream: 'realtime',
  getDocumentPresence: 'presence',
  postSectionLease: 'leases', getSectionLease: 'leases',
  deleteSectionLease: 'leases', patchSectionLease: 'leases',
  postDocumentScratchpad: 'scratchpad', getDocumentScratchpad: 'scratchpad',
  getDocumentScratchpadStream: 'scratchpad',
  postBftVote: 'bft', getBftStatus: 'bft', getDocumentChain: 'bft',
  postAgentInbox: 'a2a', getAgentInbox: 'a2a',
  getDocumentEvents: 'events', getDocumentEventsStream: 'events',
  getSubscribe: 'events',
  postSignedUrl: 'signed-urls',
  postDocumentMerge: 'merge', postDocumentPatch: 'merge',
  postSearch: 'search', getDocumentLinks: 'cross-doc',
  postDocumentLink: 'cross-doc', deleteDocumentLink: 'cross-doc',
  getGraph: 'cross-doc',
  postDocumentSemanticDiff: 'semantic', getDocumentSemanticSimilarity: 'semantic',
  postDocumentSemanticConsensus: 'semantic',
  getWellKnownAgent: 'agents',
  postWebhook: 'webhooks', getWebhooks: 'webhooks', deleteWebhook: 'webhooks',
  getDocumentAccess: 'access-control', postDocumentAccess: 'access-control',
  deleteDocumentAccess: 'access-control',
  postOrganization: 'organizations', getOrganizations: 'organizations',
  getOrganization: 'organizations', postOrganizationMember: 'organizations',
  deleteOrganizationMember: 'organizations',
};

// ── Additional Routes Missing from forge-ts manifest ─────────────────────────
// These exist in the backend but are not captured by the forge-ts TSDoc manifest.

const ADDITIONAL_ROUTES = {
  '/api/documents/{slug}/blobs': {
    post: {
      operationId: 'attachBlob',
      summary: 'Attach a binary blob to a document.',
      description: 'Upload a raw binary file and attach it to a document. Auth required. Max 100 MB.',
      tags: ['blobs'],
      security: [{ ApiKeyAuth: [] }, { SessionCookie: [] }],
      parameters: [
        { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'name', in: 'query', required: true, schema: { type: 'string' }, description: 'Attachment filename' },
        { name: 'contentType', in: 'query', required: false, schema: { type: 'string' }, description: 'MIME type override' },
      ],
      requestBody: {
        required: true,
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      },
      responses: {
        201: {
          description: 'Blob attached',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  hash: { type: 'string' },
                  size: { type: 'integer' },
                  contentType: { type: 'string' },
                  attachedAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        400: errorResponse('Invalid blob name or payload'),
        401: errorResponse('Authentication required'),
        403: errorResponse('Write access denied'),
        413: errorResponse('Blob too large (max 100 MB)'),
      },
    },
    get: {
      operationId: 'listBlobs',
      summary: 'List blob attachments for a document (metadata only).',
      tags: ['blobs'],
      security: [{ ApiKeyAuth: [] }, { SessionCookie: [] }],
      parameters: [
        { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Blob list',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  blobs: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        hash: { type: 'string' },
                        size: { type: 'integer' },
                        contentType: { type: 'string' },
                        attachedAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: errorResponse('Authentication required'),
        404: errorResponse('Document not found'),
      },
    },
  },

  '/api/documents/{slug}/blobs/{name}': {
    get: {
      operationId: 'downloadBlob',
      summary: 'Download a named blob attachment with hash verification.',
      tags: ['blobs'],
      security: [{ ApiKeyAuth: [] }, { SessionCookie: [] }],
      parameters: [
        { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'name', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Blob bytes',
          content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
        },
        401: errorResponse('Authentication required'),
        404: errorResponse('Blob not found'),
        500: errorResponse('Blob corrupted — hash mismatch'),
      },
    },
    delete: {
      operationId: 'detachBlob',
      summary: 'Detach (soft-delete) a named blob from a document.',
      tags: ['blobs'],
      security: [{ ApiKeyAuth: [] }, { SessionCookie: [] }],
      parameters: [
        { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'name', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Blob detached',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { detached: { type: 'boolean' } } },
            },
          },
        },
        401: errorResponse('Authentication required'),
        403: errorResponse('Write access denied'),
        404: errorResponse('Blob not found'),
      },
    },
  },

  '/api/blobs/{hash}': {
    get: {
      operationId: 'fetchBlobByHash',
      summary: 'Fetch blob bytes by content-addressed SHA-256 hash.',
      description: 'Sync pull endpoint for P2P mesh. Requires read access to at least one document referencing the hash.',
      tags: ['blobs'],
      security: [{ ApiKeyAuth: [] }, { SessionCookie: [] }],
      parameters: [
        { name: 'hash', in: 'path', required: true, schema: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
      ],
      responses: {
        200: {
          description: 'Blob bytes',
          content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
        },
        401: errorResponse('Authentication required'),
        403: errorResponse('No document referencing this hash readable by caller'),
        404: errorResponse('Blob not found'),
      },
    },
  },

  '/api/documents/{slug}/export': {
    get: {
      operationId: 'exportDocument',
      summary: 'Export a document in one of four canonical formats.',
      tags: ['export'],
      parameters: [
        { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
        {
          name: 'format',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['markdown', 'json', 'text', 'llmtxt'], default: 'llmtxt' },
        },
      ],
      responses: {
        200: {
          description: 'Exported document content',
          content: {
            'text/markdown': { schema: { type: 'string' } },
            'application/json': { schema: { type: 'object' } },
            'text/plain': { schema: { type: 'string' } },
          },
        },
        404: errorResponse('Document not found'),
      },
    },
  },

  '/api/collections': {
    post: {
      operationId: 'createCollection',
      summary: 'Create a named collection of documents.',
      tags: ['collections'],
      security: [{ ApiKeyAuth: [] }, { SessionCookie: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                slug: { type: 'string' },
                description: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Collection created',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  slug: { type: 'string' },
                  name: { type: 'string' },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        401: errorResponse('Authentication required'),
      },
    },
    get: {
      operationId: 'listCollections',
      summary: 'List all collections accessible to the authenticated user.',
      tags: ['collections'],
      security: [{ ApiKeyAuth: [] }, { SessionCookie: [] }],
      parameters: [],
      responses: {
        200: {
          description: 'Collection list',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  collections: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        slug: { type: 'string' },
                        name: { type: 'string' },
                        documentCount: { type: 'integer' },
                        createdAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: errorResponse('Authentication required'),
      },
    },
  },

  '/api/collections/{slug}': {
    get: {
      operationId: 'getCollection',
      summary: 'Get a collection and its document list.',
      tags: ['collections'],
      parameters: [
        { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Collection details',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  slug: { type: 'string' },
                  name: { type: 'string' },
                  documents: { type: 'array', items: { type: 'object' } },
                },
              },
            },
          },
        },
        404: errorResponse('Collection not found'),
      },
    },
    delete: {
      operationId: 'deleteCollection',
      summary: 'Delete a collection (documents are not deleted).',
      tags: ['collections'],
      security: [{ ApiKeyAuth: [] }, { SessionCookie: [] }],
      parameters: [
        { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Collection deleted',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { deleted: { type: 'boolean' } } },
            },
          },
        },
        401: errorResponse('Authentication required'),
        404: errorResponse('Collection not found'),
      },
    },
  },

  '/api/retrieval': {
    post: {
      operationId: 'retrieveDocuments',
      summary: 'Semantic retrieval — find documents relevant to a query.',
      tags: ['retrieval'],
      parameters: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['query'],
              properties: {
                query: { type: 'string' },
                limit: { type: 'integer', default: 10 },
                threshold: { type: 'number', description: 'Minimum similarity score (0–1)' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Retrieval results',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  results: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        slug: { type: 'string' },
                        score: { type: 'number' },
                        excerpt: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },

  '/api/auth/session': {
    get: {
      operationId: 'getSession',
      summary: 'Get the current authenticated session.',
      tags: ['auth'],
      security: [{ SessionCookie: [] }],
      parameters: [],
      responses: {
        200: {
          description: 'Session info',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  userId: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        401: errorResponse('Not authenticated'),
      },
    },
    delete: {
      operationId: 'signOut',
      summary: 'Sign out and invalidate the current session.',
      tags: ['auth'],
      security: [{ SessionCookie: [] }],
      parameters: [],
      responses: {
        200: {
          description: 'Signed out',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { success: { type: 'boolean' } } },
            },
          },
        },
      },
    },
  },
};

// ── Step 1: Fix path template params ─────────────────────────────────────────

const newPaths = {};

for (const [rawPath, pathItem] of Object.entries(spec.paths)) {
  const allPathParamNames = collectAllPathParams(rawPath, pathItem);

  const templateKey = allPathParamNames.size > 0
    ? templatePath(rawPath, allPathParamNames)
    : rawPath;

  const newPathItem = {};
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!operation || typeof operation !== 'object') {
      newPathItem[method] = operation;
      continue;
    }
    const newParams = (operation.parameters ?? []).map(param => {
      if (allPathParamNames.has(param.name) && param.in === 'query') {
        return { ...param, in: 'path', required: true };
      }
      return param;
    });
    newPathItem[method] = { ...operation, parameters: newParams };
  }

  newPaths[templateKey] = newPathItem;
}

spec.paths = newPaths;

// ── Step 2: Inject responses, tags, and security refs ────────────────────────

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

for (const [, pathItem] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!HTTP_METHODS.includes(method)) continue;
    if (!operation || typeof operation !== 'object') continue;

    const opId = operation.operationId;

    // Inject responses from map
    if (opId && RESPONSES[opId]) {
      const responseMap = RESPONSES[opId];
      operation.responses = {};
      for (const [code, resp] of Object.entries(responseMap)) {
        operation.responses[String(code)] = resp;
      }
    } else if (!operation.responses) {
      // Fallback generic response
      operation.responses = {
        200: { description: 'Success' },
        default: errorResponse('Unexpected error'),
      };
    }

    // Fix tag — replace generic "openapi-manifest" with domain tag
    if (opId && TAG_MAP[opId]) {
      operation.tags = [TAG_MAP[opId]];
    }

    // Add security to authenticated operations (heuristic: has 401 response)
    const hasAuth = operation.responses && (
      '401' in operation.responses || '403' in operation.responses
    );
    if (hasAuth && !operation.security) {
      operation.security = [{ ApiKeyAuth: [] }, { SessionCookie: [] }];
    }
  }
}

// ── Step 3: Merge additional routes ──────────────────────────────────────────

for (const [path, pathItem] of Object.entries(ADDITIONAL_ROUTES)) {
  if (spec.paths[path]) {
    // Merge methods
    Object.assign(spec.paths[path], pathItem);
  } else {
    spec.paths[path] = pathItem;
  }
}

// ── Step 4: Upgrade OpenAPI version + inject metadata ────────────────────────

spec.openapi = '3.1.0';

spec.info = {
  title: 'LLMtxt API',
  version: '2026.4.6',
  description:
    'LLMtxt — agent-first document storage, compression, versioning, and multi-agent collaboration. ' +
    'Auth: Bearer API key (`Authorization: Bearer <key>`) or session cookie (`llmtxt_session`). ' +
    'Read routes on public documents are unauthenticated.',
  contact: { name: 'LLMtxt Support', url: 'https://llmtxt.my' },
  license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
  'x-logo': { url: 'https://llmtxt.my/favicon.svg' },
};

spec.servers = [
  { url: 'https://api.llmtxt.my', description: 'Production' },
  { url: 'http://localhost:3000', description: 'Local dev' },
];

// ── Step 5: Security schemes ─────────────────────────────────────────────────

if (!spec.components) spec.components = {};
if (!spec.components.securitySchemes) spec.components.securitySchemes = {};

spec.components.securitySchemes = {
  ApiKeyAuth: {
    type: 'http',
    scheme: 'bearer',
    description:
      'API key issued by POST /api/keys. Pass as `Authorization: Bearer llmtxt_<key>`.',
  },
  SessionCookie: {
    type: 'apiKey',
    in: 'cookie',
    name: 'llmtxt_session',
    description: 'Session cookie set by the auth provider (Better Auth / OAuth).',
  },
  AgentSignature: {
    type: 'apiKey',
    in: 'header',
    name: 'X-Agent-Signature',
    description:
      'Ed25519 signature of the request. Used together with X-Agent-Pubkey-Id, X-Agent-Nonce, X-Agent-Timestamp.',
  },
};

// ── Step 6: Tags definition ───────────────────────────────────────────────────

spec.tags = [
  { name: 'documents', description: 'Core document storage and retrieval' },
  { name: 'versions', description: 'Version management and diffing' },
  { name: 'lifecycle', description: 'Document lifecycle state machine and approvals' },
  { name: 'disclosure', description: 'Progressive disclosure — sections, TOC, search' },
  { name: 'crdt', description: 'Real-time CRDT collaboration (Loro)' },
  { name: 'realtime', description: 'WebSocket real-time event streams' },
  { name: 'presence', description: 'Agent presence and awareness' },
  { name: 'leases', description: 'Section write leases for turn-taking' },
  { name: 'scratchpad', description: 'Agent scratchpad for ephemeral notes' },
  { name: 'bft', description: 'Byzantine fault-tolerant consensus voting' },
  { name: 'a2a', description: 'Agent-to-agent messaging' },
  { name: 'events', description: 'Document and global event streams' },
  { name: 'blobs', description: 'Binary blob attachments (content-addressed)' },
  { name: 'export', description: 'Document export in multiple formats' },
  { name: 'collections', description: 'Document collection management' },
  { name: 'retrieval', description: 'Semantic retrieval and similarity' },
  { name: 'semantic', description: 'Semantic diff and consensus' },
  { name: 'search', description: 'Full-text and cross-document search' },
  { name: 'cross-doc', description: 'Cross-document links and graph' },
  { name: 'merge', description: 'Three-way merge and patch application' },
  { name: 'signed-urls', description: 'Temporary signed URLs for unauthenticated access' },
  { name: 'webhooks', description: 'Webhook event delivery' },
  { name: 'access-control', description: 'Document ACL and role management' },
  { name: 'organizations', description: 'Organization and member management' },
  { name: 'api-keys', description: 'API key lifecycle management' },
  { name: 'agent-keys', description: 'Ed25519 agent key registration and revocation' },
  { name: 'agents', description: 'Well-known agent registry' },
  { name: 'auth', description: 'Authentication — session management' },
  { name: 'schemas', description: 'Predefined validation schemas' },
  { name: 'health', description: 'Liveness, readiness, and Prometheus metrics' },
  { name: 'system', description: 'Cache management and system utilities' },
];

// ── Write output ──────────────────────────────────────────────────────────────

writeFileSync(outputPath, JSON.stringify(spec, null, 2), 'utf-8');

const routeCount = Object.keys(spec.paths).length;
const opCount = Object.values(spec.paths).reduce((sum, item) =>
  sum + Object.keys(item).filter(k => HTTP_METHODS.includes(k)).length, 0);
const schemaCount = Object.keys(spec.components?.schemas ?? {}).length;
const securitySchemeCount = Object.keys(spec.components?.securitySchemes ?? {}).length;
const paramsFixed = Object.values(spec.paths).flatMap(item =>
  Object.values(item).flatMap(op =>
    Array.isArray(op?.parameters) ? op.parameters.filter(p => p.in === 'path') : []
  )
).length;

console.log(`OpenAPI spec post-processed: ${outputPath}`);
console.log(`  Version: ${spec.openapi}`);
console.log(`  Paths: ${routeCount}, Operations: ${opCount}`);
console.log(`  Schemas: ${schemaCount}, Security schemes: ${securitySchemeCount}`);
console.log(`  Path params fixed: ${paramsFixed}`);
