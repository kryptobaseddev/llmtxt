/**
 * Lightweight llmtxt client for agents.
 * Wraps the ClawMsgr attachment API with typed helpers.
 * No framework dependencies — uses native fetch.
 *
 * When `@cleocode/lafs` is installed, responses are validated
 * against the LAFS envelope schema. Without it, raw JSON is parsed directly.
 */

import { createPatch } from './patch.js';
import type {
  AttachmentReshareOptions,
  AttachmentSharingMode,
  AttachmentVersionOptions,
} from './types.js';

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

export interface ReshareResult {
  slug: string;
  mode: AttachmentSharingMode;
  signedUrl?: string;
  expiresAt?: number | null;
}

/** Backward-compatible alias. Prefer `ReshareResult`. */
export type ResignResult = ReshareResult;

export interface AttachmentVersionResult {
  slug: string;
  versionNumber: number;
  patchText?: string;
  contentHash?: string;
  createdAt?: string;
  createdBy?: string;
  changelog?: string;
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
 */
async function parseResponse<T>(json: unknown): Promise<T> {
  const envelope = json as Record<string, unknown>;
  const parser = await getLafsParser();
  if (parser && '$schema' in envelope) {
    return parser(json) as T;
  }

  if (envelope.success === false) {
    const err = envelope.error as Record<string, unknown> | undefined;
    throw new Error(err?.message as string ?? 'Request failed');
  }
  return (envelope.result ?? envelope.data) as T;
}

// ── Client ──────────────────────────────────────────────────────

export function createClient(config: LlmtxtClientConfig) {
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'X-Agent-Id': config.agentId,
    'Content-Type': 'application/json',
  };

  return {
    /** Upload content as an attachment to a conversation. */
    async upload(
      conversationId: string,
      content: string,
      options: { format?: string; title?: string; expiresIn?: number } = {},
    ): Promise<UploadResult> {
      const { format = 'markdown', title, expiresIn = 3600 } = options;
      const res = await fetch(`${config.apiBase}/conversations/${conversationId}/attachments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content, format, title, expiresIn }),
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
      return parseResponse<UploadResult>(await res.json());
    },

    /** Fetch content from a signed URL. */
    async fetch(signedUrl: string): Promise<FetchResult> {
      const res = await fetch(signedUrl, { headers });
      if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${await res.text()}`);
      return parseResponse<FetchResult>(await res.json());
    },

    /** Fetch an attachment shared in a conversation without needing a signed URL. */
    async fetchFromConversation(slug: string, conversationId: string): Promise<FetchResult> {
      const url = new URL(`${config.apiBase}/attachments/${slug}`);
      url.searchParams.set('conv', conversationId);
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`Conversation fetch failed (${res.status}): ${await res.text()}`);
      }
      return parseResponse<FetchResult>(await res.json());
    },

    /** Fetch an attachment owned by the current agent. */
    async fetchOwned(slug: string): Promise<FetchResult> {
      const res = await fetch(`${config.apiBase}/attachments/${slug}`, { headers });
      if (!res.ok) throw new Error(`Owner fetch failed (${res.status}): ${await res.text()}`);
      return parseResponse<FetchResult>(await res.json());
    },

    /**
     * Change how an attachment is shared. For `signed_url` mode the API may
     * return a fresh `signedUrl`; for `conversation`/`public` it may not.
     */
    async reshare(
      slug: string,
      options: AttachmentReshareOptions = {},
    ): Promise<ReshareResult> {
      const { expiresIn = 3600, mode = 'signed_url' } = options;
      const res = await fetch(`${config.apiBase}/attachments/${slug}/reshare`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ expiresIn, mode }),
      });
      if (!res.ok) throw new Error(`Reshare failed (${res.status}): ${await res.text()}`);
      return parseResponse<ReshareResult>(await res.json());
    },

    /** Backward-compatible alias for older API wording. Prefer `reshare`. */
    async resign(
      slug: string,
      options: AttachmentReshareOptions = {},
    ): Promise<ResignResult> {
      return this.reshare(slug, options);
    },

    /** Build a version patch locally using the Rust/WASM core. */
    createVersionPatch(original: string, updated: string): string {
      return createPatch(original, updated);
    },

    /** Submit a patch as the next version for an attachment slug. */
    async addVersion(
      slug: string,
      patchText: string,
      options: AttachmentVersionOptions = {},
    ): Promise<AttachmentVersionResult> {
      const res = await fetch(`${config.apiBase}/attachments/${slug}/versions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ patchText, ...options }),
      });
      if (!res.ok) throw new Error(`Add version failed (${res.status}): ${await res.text()}`);
      return parseResponse<AttachmentVersionResult>(await res.json());
    },

    /** Convenience helper that diffs local content then appends the new version. */
    async addVersionFromContent(
      slug: string,
      original: string,
      updated: string,
      options: AttachmentVersionOptions = {},
    ): Promise<AttachmentVersionResult> {
      const patchText = createPatch(original, updated);
      return this.addVersion(slug, patchText, options);
    },

    /** Check if a signed URL is still valid without fetching content. */
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
