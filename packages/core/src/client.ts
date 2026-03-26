/**
 * Lightweight llmtxt client for agents.
 * Wraps the ClawMsgr attachment API with typed helpers.
 * No framework dependencies — uses native fetch.
 *
 * When `@cleocode/lafs` is installed, responses are validated
 * against the LAFS envelope schema. Without it, raw JSON is parsed directly.
 */

export interface LlmtxtClientConfig {
  apiBase: string;
  apiKey: string;
  agentId: string;
}

export interface UploadResult {
  slug: string;
  contentHash: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  tokens: number;
  signedUrl: string;
  expiresAt: number;
}

export interface FetchResult {
  slug: string;
  content: string;
  format: string;
  title?: string;
  contentHash: string;
  originalSize: number;
  tokens: number;
}

export interface ResignResult {
  slug: string;
  signedUrl: string;
  expiresAt: number;
}

// ── LAFS integration (optional) ─────────────────────────────────

/** Lazy-loaded LAFS parser. Cached after first resolution. */
let lafsParser: ((envelope: unknown) => unknown) | false | undefined;

/**
 * Attempt to load parseLafsResponse from @cleocode/lafs.
 * Returns the parser function, or false if LAFS is not installed.
 */
async function getLafsParser(): Promise<((envelope: unknown) => unknown) | false> {
  if (lafsParser !== undefined) return lafsParser;
  try {
    const lafs = await import('@cleocode/lafs');
    lafsParser = lafs.parseLafsResponse;
    return lafsParser;
  } catch {
    lafsParser = false;
    return false;
  }
}

/**
 * Parse a JSON response, using LAFS envelope validation when available.
 *
 * LAFS envelope: { success, result, _meta, error }
 * Legacy envelope: { success, data }
 *
 * With LAFS: validates envelope, throws LafsError on failure, returns result.
 * Without LAFS: extracts from `result` (LAFS) or `data` (legacy) directly.
 */
async function parseResponse<T>(json: unknown): Promise<T> {
  const envelope = json as Record<string, unknown>;

  // Try LAFS parsing when available AND the response looks like a LAFS envelope.
  // During the migration period, SignalDock may return legacy envelopes without
  // $schema — in that case, fall through to the manual parser.
  const parser = await getLafsParser();
  if (parser && '$schema' in envelope) {
    return parser(json) as T;
  }

  // Fallback: handle both LAFS (`result`) and legacy (`data`) envelope formats
  if (envelope.success === false) {
    const err = envelope.error as Record<string, unknown> | undefined;
    throw new Error(err?.message as string ?? 'Request failed');
  }
  return (envelope.result ?? envelope.data) as T;
}

// ── Client ──────────────────────────────────────────────────────

/**
 * Create a lightweight llmtxt client for uploading and fetching content.
 *
 * ```ts
 * const client = createClient({
 *   apiBase: 'https://api.clawmsgr.com',
 *   apiKey: 'sk_live_...',
 *   agentId: 'my-agent',
 * });
 *
 * const { slug, signedUrl } = await client.upload('conv_123', '# My Doc\n\nContent here');
 * const { content } = await client.fetch(signedUrl);
 * ```
 */
export function createClient(config: LlmtxtClientConfig) {
  const headers = {
    'Authorization': `Bearer ${config.apiKey}`,
    'X-Agent-Id': config.agentId,
    'Content-Type': 'application/json',
  };

  return {
    /**
     * Upload content as an attachment to a conversation.
     * Returns slug, signed URL, and metadata.
     */
    async upload(
      conversationId: string,
      content: string,
      options: { format?: string; title?: string; expiresIn?: number } = {},
    ): Promise<UploadResult> {
      const { format = 'markdown', title, expiresIn = 3600 } = options;
      const res = await fetch(
        `${config.apiBase}/conversations/${conversationId}/attachments`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ content, format, title, expiresIn }),
        },
      );
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Upload failed (${res.status}): ${err}`);
      }
      return parseResponse<UploadResult>(await res.json());
    },

    /**
     * Fetch content from a signed URL.
     * Handles decompression automatically (server returns decompressed content).
     */
    async fetch(signedUrl: string): Promise<FetchResult> {
      const res = await fetch(signedUrl, { headers });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Fetch failed (${res.status}): ${err}`);
      }
      return parseResponse<FetchResult>(await res.json());
    },

    /**
     * Fetch an attachment shared in a conversation without needing a signed URL.
     */
    async fetchFromConversation(slug: string, conversationId: string): Promise<FetchResult> {
      const url = new URL(`${config.apiBase}/attachments/${slug}`);
      url.searchParams.set('conv', conversationId);
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Conversation fetch failed (${res.status}): ${err}`);
      }
      return parseResponse<FetchResult>(await res.json());
    },

    /**
     * Fetch an attachment owned by the current agent.
     */
    async fetchOwned(slug: string): Promise<FetchResult> {
      const res = await fetch(`${config.apiBase}/attachments/${slug}`, { headers });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Owner fetch failed (${res.status}): ${err}`);
      }
      return parseResponse<FetchResult>(await res.json());
    },

    /**
     * Generate a fresh signed URL for an attachment owned by the current agent.
     */
    async resign(slug: string, options: { expiresIn?: number } = {}): Promise<ResignResult> {
      const { expiresIn = 3600 } = options;
      const res = await fetch(`${config.apiBase}/attachments/${slug}/resign`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ expiresIn }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Resign failed (${res.status}): ${err}`);
      }
      return parseResponse<ResignResult>(await res.json());
    },

    /**
     * Check if a signed URL is still valid (not expired) without fetching content.
     * Returns true if the URL would succeed, false if expired.
     */
    isValid(signedUrl: string): boolean {
      try {
        const url = new URL(signedUrl);
        const exp = url.searchParams.get('exp');
        if (!exp) return false;
        return Date.now() < parseInt(exp, 10);
      } catch {
        return false;
      }
    },
  };
}
