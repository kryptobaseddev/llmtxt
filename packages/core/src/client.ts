/**
 * Lightweight llmtxt client for agents.
 * Wraps the ClawMsgr attachment API with typed helpers.
 * No framework dependencies — uses native fetch.
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
      const json = await res.json();
      return json.data as UploadResult;
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
      const json = await res.json();
      return json.data as FetchResult;
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
